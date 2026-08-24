// Turns the audit model into plain English.
//
// Pipeline: run rules over each batch (batch-scoped first, then table-scoped,
// both in priority order), let matched rules "consume" the fields they
// explain, fall back to generic phrasing for whatever primary fields are left,
// then coalesce adjacent batches from the same user into single actions and
// compose the top-line story.
//
// Pure — no DOM, no chrome APIs — so it runs unchanged under node.

(function (global, factory) {
  const ns = (global.AcuAudit = global.AcuAudit || {});
  factory(ns);
})(typeof globalThis !== 'undefined' ? globalThis : self, function (AcuAudit) {
  'use strict';

  const DEFAULTS = {
    coalesceSeconds: 10,      // batches this close from one user are one action
    maxRuleSentences: 8,      // per action, after coalescing
    maxGenericSentences: 4,   // per action, after coalescing
    maxHighlightSentences: 3, // per bullet in the summary
  };

  // ---------- labels ----------
  function entityLabel(name) {
    return String(name || 'record').toLowerCase();
  }

  function articleFor(label) {
    return /^[aeiou]/i.test(label) ? 'an' : 'a';
  }

  function timeText(date, fallback) {
    if (!date) return fallback || '';
    let h = date.getHours();
    const m = String(date.getMinutes()).padStart(2, '0');
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    if (h === 0) h = 12;
    return h + ':' + m + ' ' + ampm;
  }

  function dateText(date, fallback) {
    if (!date) return fallback || '';
    return (date.getMonth() + 1) + '/' + date.getDate() + '/' + date.getFullYear();
  }

  // ---------- rule contexts ----------
  function makeTableCtx(model, batch, table, tableIdx, consumed, docLabel, docRecord) {
    const dict = AcuAudit.dictionary;
    const ck = field => tableIdx + '::' + field;

    const ctx = {
      model, batch, table,
      tableIdx,
      tableName: table.tableName,
      operation: table.operation,
      keys: table.keys,
      screen: batch.screen,
      entity: model.entity,
      entityLabel: docLabel,
      // A batch often touches tables other than the audited document — a
      // service order audit picks up the purchase order it raised. Rules that
      // name a record must use the table's own label, or you get nonsense
      // like "created service order PO002298 — vendor V0000031".
      //
      // Through dict.entityName, so the AR/AP register projections are called
      // what the row calls itself: "took the bill off hold", not "took the
      // document off hold".
      tableLabel: entityLabel(dict.entityName(table.tableName, table.keys)),
      tableArticle: articleFor(entityLabel(dict.entityName(table.tableName, table.keys))),
      article: articleFor(docLabel),
      docRecord,
      record: dict.describeRecord(table.tableName, table.keys, docRecord),
      isDetail: dict.isDetailTable(table.tableName),
      dict,

      get changes() {
        return table.changes.filter(c => !consumed.has(ck(c.field)));
      },
      get values() {
        return table.values.filter(v => !consumed.has(ck(v.field)));
      },
      changed(field) {
        if (consumed.has(ck(field))) return undefined;
        return table.changes.find(c => c.field === field);
      },
      from(field) {
        const c = ctx.changed(field);
        return c ? c.from : undefined;
      },
      to(field) {
        const c = ctx.changed(field);
        if (c) return c.to;
        return ctx.value(field);
      },
      value(field) {
        if (consumed.has(ck(field))) return undefined;
        const v = table.values.find(x => x.field === field);
        if (v) return v.value;
        const c = table.changes.find(x => x.field === field);
        return c ? c.to : undefined;
      },
      turnedOn(field) {
        const c = ctx.changed(field);
        return !!c && !c.from && c.to === true;
      },
      turnedOff(field) {
        const c = ctx.changed(field);
        return !!c && c.from === true && !c.to;
      },
      consume(fields) {
        if (fields === 'all') {
          table.changes.forEach(c => consumed.add(ck(c.field)));
          table.values.forEach(v => consumed.add(ck(v.field)));
          return;
        }
        (fields || []).forEach(f => consumed.add(ck(f)));
      },
    };

    ctx.isHeader = !ctx.isDetail;
    return ctx;
  }

  function makeBatchCtx(model, batch, tableCtxs, docLabel, docRecord) {
    return {
      model, batch,
      screen: batch.screen,
      entity: model.entity,
      entityLabel: docLabel,
      article: articleFor(docLabel),
      docRecord,
      dict: AcuAudit.dictionary,
      tables: tableCtxs,
      table(nameOrRe) {
        if (nameOrRe instanceof RegExp) return tableCtxs.find(t => nameOrRe.test(t.tableName));
        return tableCtxs.find(t => t.tableName === nameOrRe);
      },
      consume(fields) {
        tableCtxs.forEach(t => t.consume(fields));
      },
    };
  }

  // ---------- generic fallback ----------
  function genericSentence(ctx, change) {
    const dict = ctx.dict;
    const where = ctx.isDetail ? ' on ' + ctx.record : '';
    const fmt = dict.isMoneyField(change.field) ? dict.formatMoney
      : dict.isDurationField(change.field) ? dict.formatDuration
        : dict.formatValue;

    if (typeof change.to === 'boolean' && typeof change.from !== 'number') {
      return (change.to ? 'ticked ' : 'un-ticked ') + change.field + where;
    }
    return 'changed ' + change.field + where + ' from ' +
      fmt(change.from) + ' to ' + fmt(change.to);
  }

  // ---------- per-batch analysis ----------
  function analyzeBatch(model, batch, docLabel, docRecord, options) {
    const dict = AcuAudit.dictionary;
    const rules = (AcuAudit.rules && AcuAudit.rules.all) || [];
    const consumed = new Set();

    const tableCtxs = batch.tables.map((t, i) =>
      makeTableCtx(model, batch, t, i, consumed, docLabel, docRecord));
    const batchCtx = makeBatchCtx(model, batch, tableCtxs, docLabel, docRecord);

    const sorted = rules.slice().sort((a, b) => (b.priority || 0) - (a.priority || 0));
    const sentences = [];

    function fire(rule, ctx) {
      let matched;
      try {
        matched = rule.when(ctx);
      } catch (e) {
        return; // a rule that throws must never take the whole summary down
      }
      if (!matched) return;
      let said = null;
      try {
        said = rule.say ? rule.say(ctx) : null;
      } catch (e) {
        said = null;
      }
      const consumes = typeof rule.consumes === 'function' ? rule.consumes(ctx) : rule.consumes;
      if (consumes) ctx.consume(consumes);
      // A rule may return either a string or { text, lowSignal }, or nothing at
      // all when it exists purely to consume. Low-signal sentences stay in the
      // timeline but are kept out of the summary.
      const text = said ? (typeof said === 'object' ? said.text : said) : null;
      const lowSignal = said && typeof said === 'object'
        ? !!said.lowSignal : !!rule.lowSignal;
      if (text) sentences.push({ text, lowSignal, generic: false, ruleId: rule.id });
      // A rule that consumed the whole table has accounted for it, whether or
      // not it had anything to say. Letting later rules match on operation
      // alone is what produced duplicates like "added line 5 — OT, added line
      // 5" — and, for a table consumed deliberately in silence such as the tax
      // engine's own breakdown rows, a bare "added <record>".
      return consumes === 'all';
    }

    // Header tables before detail tables, so "created the order" is said
    // before "added line 1" regardless of the order Acumatica emitted them.
    const ordered = tableCtxs.slice().sort((a, b) => (a.isDetail ? 1 : 0) - (b.isDetail ? 1 : 0));

    for (const rule of sorted) {
      if (rule.scope === 'batch') fire(rule, batchCtx);
    }
    for (const ctx of ordered) {
      // A batch-scoped rule may already have taken everything in this table.
      if (!ctx.changes.length && !ctx.values.length) continue;
      for (const rule of sorted) {
        if (rule.scope === 'batch') continue;
        if (fire(rule, ctx)) break;
      }
    }

    // Whatever primary fields no rule explained get spelled out literally.
    // No cap here — capping happens per action, after coalescing, so the
    // count in "…and N further field changes" stays honest.
    for (const ctx of ordered) {
      for (const change of ctx.changes) {
        if (dict.classifyField(change.field) !== dict.PRIMARY) continue;
        sentences.push({ text: genericSentence(ctx, change), generic: true, ruleId: 'generic' });
      }
    }

    // Full detail for the expandable view — everything, tagged by tier, so
    // "show system fields" reveals rather than re-derives.
    const details = batch.tables.map(t => ({
      tableName: t.tableName,
      operation: t.operation,
      record: dict.describeRecord(t.tableName, t.keys, docRecord),
      keys: t.keys,
      fields: t.changes.map(c => ({
        field: c.field, from: c.from, to: c.to,
        tier: dict.classifyField(c.field),
      })).concat(t.values.map(v => ({
        field: v.field, value: v.value,
        tier: dict.classifyField(v.field),
      }))),
    }));

    return { sentences, details };
  }

  // ---------- coalescing ----------
  // Coalescing exists to rejoin one save that Acumatica emitted as several
  // batches — a header write and the line writes that went with it. Two
  // batches that write the *same field of the same row* are not that: they are
  // two saves, and merging them makes an action contradict itself. A live SO
  // invoice put on hold and released two seconds later came out as "put the
  // invoice on hold" sitting next to "took the invoice off hold", and a
  // customer's statement preferences as "ticked Print Statements" next to
  // "un-ticked Print Statements". Rewriting a field is the signal.
  // Only fields a person can see count. Acumatica rewrites its recalculated
  // rollups on every batch of a save — the open and unbilled totals move each
  // time a line is touched — so counting those as conflicts would split every
  // multi-table save back into the batches coalescing exists to rejoin.
  function fieldSignatures(item) {
    const dict = AcuAudit.dictionary;
    const seen = new Set();
    for (const d of item.details) {
      const keys = Object.keys(d.keys).sort()
        .map(k => k + '=' + String(d.keys[k] == null ? '' : d.keys[k]).trim())
        .join('|');
      for (const f of d.fields) {
        if (f.tier !== dict.PRIMARY) continue;
        seen.add(d.tableName + '|' + keys + '|' + f.field);
      }
    }
    return seen;
  }

  function rewritesSameField(prev, next) {
    const later = fieldSignatures(next);
    for (const sig of fieldSignatures(prev)) {
      if (later.has(sig)) return true;
    }
    return false;
  }

  function shouldMerge(prev, next, options) {
    if (!prev || prev.user !== next.user || prev.screen !== next.screen) return false;
    if (rewritesSameField(prev, next)) return false;
    if (!prev.date || !next.date) return true; // undated: adjacency is all we have
    const gap = Math.abs(next.date.getTime() - prev.date.getTime()) / 1000;
    return gap <= options.coalesceSeconds;
  }

  // ---------- story ----------
  function joinSentences(list) {
    if (list.length === 0) return '';
    if (list.length === 1) return list[0];
    if (list.length === 2) return list[0] + ' and ' + list[1];
    return list.slice(0, -1).join(', ') + ', and ' + list[list.length - 1];
  }

  // ---------- condensing ----------
  // Coalescing merges several batches into one action, and each contributed
  // its own sentences. Without deduping and capping here, a busy save turns
  // into a paragraph nobody will read.
  function condense(action, options) {
    const seen = new Set();
    const unique = [];
    for (const s of action.sentences) {
      if (seen.has(s.text)) continue;
      seen.add(s.text);
      unique.push(s);
    }

    const fromRules = unique.filter(s => !s.generic);
    const generic = unique.filter(s => s.generic);
    const keptRules = fromRules.slice(0, options.maxRuleSentences);
    const keptGeneric = generic.slice(0, options.maxGenericSentences);
    const hidden = (fromRules.length - keptRules.length) +
      (generic.length - keptGeneric.length);

    action.sentences = keptRules.concat(keptGeneric);
    action.hiddenSentenceCount = hidden;
    if (hidden > 0) {
      action.sentences.push({
        text: '…and ' + hidden + ' further field change' + (hidden === 1 ? '' : 's'),
        generic: true,
        lowSignal: true,
        ruleId: 'generic.overflow',
      });
    }
  }

  // ---------- summary ----------
  function buildOverview(actions, entity, record) {
    if (!actions.length) return 'No changes were recorded for this record.';

    const users = Array.from(new Set(actions.map(a => a.user).filter(Boolean)));
    const who = users.length === 0 ? 'an unknown user'
      : users.length <= 3 ? joinSentences(users)
        : users.length + ' users';

    const dated = actions.filter(a => a.date);
    let when = '';
    if (dated.length) {
      const first = dated[0];
      const last = dated[dated.length - 1];
      const from = first.dateText + ' ' + first.timeText;
      const to = last.dateText === first.dateText
        ? last.timeText
        : last.dateText + ' ' + last.timeText;
      when = from === to ? ' at ' + from : ' between ' + from + ' and ' + to;
    }

    const label = entity + (record ? ' ' + record : '');
    return actions.length + ' recorded action' + (actions.length === 1 ? '' : 's') +
      ' on ' + label + ' by ' + who + when + '.';
  }

  /**
   * One bullet per action that a person would call an event. Generic field
   * edits and low-signal system chatter stay in the timeline below.
   */
  function buildHighlights(actions, homeScreen, options) {
    const out = [];
    for (const action of actions) {
      const fromRules = action.sentences.filter(s => !s.generic && !s.lowSignal);
      // On a document, a plain field edit is a footnote to the workflow verbs
      // around it, and promoting every one is what turned the summary into a
      // wall of text. A master record has no workflow: nobody releases or
      // completes a customer, so editing its pricing option or its statement
      // preferences is the whole event, and leaving those actions out left a
      // live AR303000 history summarising five of its seven.
      if (!fromRules.length && !options.promoteGenericHighlights) continue;
      // Prefer rule-derived sentences, but top up with plain field edits when
      // there's room — "changed Return Notes to CANCELLED" is worth surfacing
      // and would otherwise only ever appear down in the timeline.
      const generic = action.sentences.filter(
        s => s.generic && !s.lowSignal && s.ruleId !== 'generic.overflow');
      const candidates = fromRules.concat(generic);
      if (!candidates.length) continue;

      const shown = candidates.slice(0, options.maxHighlightSentences);
      // Semicolons, not commas: these sentences are full of commas themselves.
      let text = shown.map(s => s.text).join('; ');
      const more = candidates.length - shown.length + (action.hiddenSentenceCount || 0);
      if (more > 0) text += ' (+' + more + ' more)';

      out.push({
        dateText: action.dateText,
        timeText: action.timeText,
        user: action.user,
        screen: action.screen,
        screenLabel: action.screenLabel,
        // Worth calling out: a change made somewhere other than this record's
        // own screen (a purchase receipt closing a sales order).
        foreign: !!(action.screen && homeScreen && action.screen !== homeScreen),
        text,
      });
    }
    return out;
  }

  function highlightLine(h) {
    const when = (h.dateText ? h.dateText + ' ' : '') + h.timeText;
    const via = h.foreign ? ' · ' + h.screenLabel : '';
    return when + ' · ' + (h.user || 'unknown user') + via + ' — ' + h.text;
  }

  // ---------- entry point ----------
  function analyze(model, opts) {
    const options = Object.assign({}, DEFAULTS, opts || {});
    const dict = AcuAudit.dictionary;

    // The document's own identifier. A batch routinely touches more than one
    // header table — completing an appointment writes the service order too —
    // so prefer the table the entity was inferred from. Taking whichever came
    // first titled a service order audit with the appointment's number.
    let docRecord = '';
    let docKeys = {};
    for (const wantEntity of [true, false]) {
      for (const b of model.batches) {
        for (const t of b.tables) {
          if (wantEntity && t.tableName !== model.entity) continue;
          if (!dict.isDetailTable(t.tableName) && Object.keys(t.keys).length) {
            docRecord = dict.describeRecord(t.tableName, t.keys);
            docKeys = t.keys;
            break;
          }
        }
        if (docRecord) break;
      }
      if (docRecord) break;
    }

    // "AR Document" and "Document" are projection names, not words anyone
    // uses. The row's own Type turns them back into "Invoice" and "Bill".
    const entityName = dict.entityName(model.entity, docKeys);
    const docLabel = entityLabel(entityName);
    options.promoteGenericHighlights = dict.isMasterTable(model.entity);

    // Which screen this record normally lives on — used to decide when a
    // screen is worth mentioning in the story.
    const screenCounts = {};
    model.batches.forEach(b => {
      if (b.screen) screenCounts[b.screen] = (screenCounts[b.screen] || 0) + 1;
    });
    let homeScreen = '';
    Object.keys(screenCounts).forEach(s => {
      if (!homeScreen || screenCounts[s] > screenCounts[homeScreen]) homeScreen = s;
    });

    const raw = model.batches.map(batch => {
      const out = analyzeBatch(model, batch, docLabel, docRecord, options);
      return {
        date: batch.date,
        dateText: dateText(batch.date, batch.dateText),
        timeText: timeText(batch.date, batch.dateText),
        rawDateText: batch.dateText,
        user: batch.user,
        screen: batch.screen,
        screenLabel: dict.describeScreen(batch.screen),
        sentences: out.sentences,
        details: out.details,
        batchIndexes: [batch.index],
      };
    });

    const actions = [];
    for (const item of raw) {
      const prev = actions[actions.length - 1];
      if (shouldMerge(prev, item, options)) {
        prev.sentences = prev.sentences.concat(item.sentences);
        prev.details = prev.details.concat(item.details);
        prev.batchIndexes = prev.batchIndexes.concat(item.batchIndexes);
        // Keep the earliest time as the action's timestamp.
        if (item.date && prev.date && item.date < prev.date) {
          prev.date = item.date;
          prev.timeText = item.timeText;
          prev.dateText = item.dateText;
        }
      } else {
        actions.push(item);
      }
    }

    actions.forEach(a => condense(a, options));

    // An action whose every batch was pure plumbing has nothing to say.
    actions.forEach(a => {
      a.isSilent = a.sentences.every(s => s.lowSignal || s.ruleId === 'generic.overflow');
    });
    const spoken = actions.filter(a => !a.isSilent);

    return {
      entity: model.entity,
      // What to call it in a title. `entity` stays the audited table name,
      // because the rule packs and the curated maps are keyed on it.
      entityName,
      entityLabel: docLabel,
      record: docRecord,
      info: model.info || {},
      source: model.source,
      homeScreen,
      actions,
      overview: buildOverview(spoken, entityName, docRecord),
      highlights: buildHighlights(spoken, homeScreen, options),
      silentCount: actions.length - spoken.length,
    };
  }

  // ---------- exports ----------
  function toMarkdown(analysis, opts) {
    const options = Object.assign({ showSystemFields: false }, opts || {});
    const dict = AcuAudit.dictionary;
    const L = [];

    L.push('# Audit history — ' + (analysis.entityName || analysis.entity) +
      (analysis.record ? ' ' + analysis.record : ''));
    L.push('');
    if (analysis.filter) {
      L.push('Filtered to ' + analysis.filter.label +
        ' — ' + analysis.filter.matchedActions + ' of ' +
        analysis.filter.totalActions + ' actions.');
      L.push('');
    }
    if (analysis.info.createdBy) {
      L.push('- Created by ' + analysis.info.createdBy +
        (analysis.info.createdOn ? ' on ' + analysis.info.createdOn : '') +
        (analysis.info.createdThrough ? ' via ' + dict.describeScreen(analysis.info.createdThrough) : ''));
    }
    if (analysis.info.lastModifiedBy) {
      L.push('- Last modified by ' + analysis.info.lastModifiedBy +
        (analysis.info.lastModifiedOn ? ' on ' + analysis.info.lastModifiedOn : ''));
    }
    if (analysis.info.changesLimitReached) {
      L.push('- **Warning: Acumatica truncated this history** (change limit reached). ' +
        'The full list is on Audit History by Screen (SM205530).');
    }
    if (analysis.info.batchesTruncated) {
      L.push('- **Warning: only ' + analysis.info.batchesLoaded + ' of ' +
        analysis.info.batchesTotal + ' recorded batches were read** — this summary is partial.');
    }
    L.push('');
    L.push('## What happened');
    L.push('');
    L.push(analysis.overview);
    L.push('');
    if (analysis.highlights.length) {
      analysis.highlights.forEach(h => L.push('- ' + highlightLine(h)));
    } else {
      L.push('- No user-visible changes — everything recorded was a system recalculation.');
    }
    L.push('');
    L.push('## Timeline');
    L.push('');

    for (const a of analysis.actions) {
      if (a.isSilent && !options.showSystemFields) continue;
      const when = (a.dateText ? a.dateText + ' ' : '') + a.timeText;
      L.push('### ' + when + ' — ' + a.user);
      L.push('');
      L.push('*' + a.screenLabel + '*');
      L.push('');
      if (a.sentences.length) {
        a.sentences.forEach(s => L.push('- ' + s.text));
      } else {
        L.push('- (system fields only)');
      }
      if (options.showSystemFields) {
        L.push('');
        for (const d of a.details) {
          L.push('  <details><summary>' + d.tableName + ' ' + d.operation + ' — ' + d.record + '</summary>');
          L.push('');
          for (const f of d.fields) {
            const line = f.value !== undefined
              ? '  - `' + f.field + '` = ' + dict.formatValue(f.value)
              : '  - `' + f.field + '`: ' + dict.formatValue(f.from) + ' → ' + dict.formatValue(f.to);
            L.push(line + '  _(' + f.tier + ')_');
          }
          L.push('');
          L.push('  </details>');
        }
      }
      L.push('');
    }

    return L.join('\n').trim() + '\n';
  }

  /**
   * Compact digest for pasting into an AI assistant: the readable timeline
   * plus the primary/secondary field diffs, with plumbing dropped. Typically
   * an order of magnitude smaller than the raw audit screen.
   */
  function toAiDigest(analysis, opts) {
    const options = Object.assign({}, opts || {});
    const dict = AcuAudit.dictionary;
    const L = [];

    L.push('Acumatica audit history — ' + (analysis.entityName || analysis.entity) +
      (analysis.record ? ' ' + analysis.record : ''));
    if (analysis.info.changesLimitReached) {
      L.push('NOTE: Acumatica truncated this history (change limit reached).');
    }
    L.push('');
    L.push(analysis.overview);
    L.push('');
    L.push('What happened:');
    analysis.highlights.forEach(h => L.push('- ' + highlightLine(h)));
    L.push('');
    L.push('Timeline (oldest first, derived/system fields removed):');

    for (const a of analysis.actions) {
      if (a.isSilent) continue;
      L.push('');
      L.push('- ' + (a.dateText ? a.dateText + ' ' : '') + a.timeText + ' | ' + a.user +
        ' | ' + a.screenLabel);
      a.sentences.forEach(s => L.push('    * ' + s.text));
      for (const d of a.details) {
        // Primary only. Secondary fields are real, but they are the
        // recalculated rollups Acumatica rewrites on every save — carrying
        // them would triple the digest for no interpretive gain.
        const fields = d.fields.filter(f => f.tier === dict.PRIMARY);
        if (!fields.length) continue;
        L.push('    ' + d.tableName + ' ' + d.operation + ' (' + d.record + '):');
        for (const f of fields) {
          L.push('      ' + (f.value !== undefined
            ? f.field + ' = ' + dict.formatValue(f.value)
            : f.field + ': ' + dict.formatValue(f.from) + ' -> ' + dict.formatValue(f.to)));
        }
      }
    }

    if (options.prompt) return options.prompt + '\n\n' + L.join('\n');
    return L.join('\n');
  }

  // ---------- filtering ----------
  // "did anyone touch the unit cost or the discount" is the question a long
  // audit is usually opened to answer, and scrolling is a poor way to answer
  // it. Terms are OR-ed, so `unit cost, discount` does what it looks like.

  function normalizeText(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim();
  }

  // "Unit Cost", "UnitCost" and "unit_cost" are the same field to a reader,
  // and Acumatica emits both of the first two on the same save.
  function squash(s) {
    return normalizeText(s).replace(/[^a-z0-9]+/g, '');
  }

  function parseQuery(query) {
    return String(query || '')
      .split(/\s*,\s*|\s+or\s+/i)
      .map(normalizeText)
      .filter(Boolean)
      .map(text => ({ text, squashed: squash(text) }));
  }

  /**
   * Field names get the punctuation-insensitive comparison as well, so typing
   * "unitcost" finds "Unit Cost". Values don't: squashing a value would let a
   * short term match across word boundaries that a reader can see.
   */
  function matchesField(terms, field) {
    const dict = AcuAudit.dictionary;
    const name = normalizeText(field.field);
    const nameSquashed = squash(field.field);
    const parts = [name];
    for (const v of [field.from, field.to, field.value]) {
      if (v === undefined) continue;
      parts.push(normalizeText(v));
      parts.push(normalizeText(dict.formatValue(v)));
      if (dict.isMoneyField(field.field)) parts.push(normalizeText(dict.formatMoney(v)));
      if (dict.isDurationField(field.field)) parts.push(normalizeText(dict.formatDuration(v)));
    }
    return terms.some(t =>
      parts.some(p => p.includes(t.text)) ||
      (t.squashed.length >= 4 && nameSquashed.includes(t.squashed)));
  }

  function matchesSentence(terms, sentence) {
    const text = normalizeText(sentence.text);
    return terms.some(t => text.includes(t.text));
  }

  function matchesRecord(terms, detail) {
    const parts = [normalizeText(detail.tableName), normalizeText(detail.record)];
    return terms.some(t => parts.some(p => p.includes(t.text)));
  }

  /**
   * Narrow an analysis to the changes matching `query`, keeping the same shape
   * so the panel, the markdown and the AI digest all work off the result
   * unchanged. Returns null for an empty query.
   *
   * Deliberately searches every field, including the ones the tier classifier
   * hides: answering "was the unit cost changed" with "no" because the match
   * sat in a system field would be worse than useless in an audit tool.
   */
  function filterAnalysis(analysis, query) {
    const dict = AcuAudit.dictionary;
    const terms = parseQuery(query);
    if (!terms.length) return null;

    let matchedFields = 0;
    let hiddenMatches = 0;
    const actions = [];

    for (const action of analysis.actions) {
      const sentences = action.sentences.filter(s => matchesSentence(terms, s));
      const details = [];

      for (const d of action.details) {
        // A table matched by name or record keeps all of its fields, because
        // the match was about the row rather than a particular column.
        const wholeRow = matchesRecord(terms, d);
        const fields = wholeRow ? d.fields : d.fields.filter(f => matchesField(terms, f));
        if (!fields.length) continue;
        matchedFields += fields.length;
        hiddenMatches += fields.filter(f => f.tier === dict.NOISE).length;
        details.push(Object.assign({}, d, { fields }));
      }

      if (!sentences.length && !details.length) continue;
      actions.push(Object.assign({}, action, { sentences, details, isSilent: false }));
    }

    const label = terms.map(t => '"' + t.text + '"').join(' or ');
    const overview = actions.length
      ? actions.length + ' of ' + analysis.actions.length + ' recorded action' +
        (analysis.actions.length === 1 ? '' : 's') + ' match ' + label +
        ' — ' + matchedFields + ' field change' + (matchedFields === 1 ? '' : 's') + '.'
      : 'Nothing in this audit history matches ' + label + '.';

    return Object.assign({}, analysis, {
      actions,
      overview,
      // The general story is not the answer to a search, so the summary
      // bullets are replaced by the matches themselves.
      highlights: [],
      silentCount: 0,
      filter: {
        query: String(query),
        terms: terms.map(t => t.text),
        label,
        matchedActions: actions.length,
        totalActions: analysis.actions.length,
        matchedFields,
        hiddenMatches,
      },
    });
  }

  AcuAudit.narrative = {
    analyze, toMarkdown, toAiDigest,
    buildOverview, buildHighlights, highlightLine,
    filterAnalysis, parseQuery,
    timeText, dateText, DEFAULTS,
  };
});
