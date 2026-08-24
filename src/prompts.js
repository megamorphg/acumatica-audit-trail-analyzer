// AI prompt presets, shared by the content script and the options page.
// Placeholders {entity}, {record}, {users}, {actions} and {url} are filled in
// from the analyzed audit at copy time.

const ACU_AUDIT_PROMPT_PRESETS = [
  {
    id: 'explain',
    name: 'Explain what happened (default)',
    text:
      'Below is the audit history for {entity} {record} in Acumatica, already summarized into a plain-English timeline. Walk me through what happened to this record, who did what, and call out anything that looks unusual or out of process.'
  },
  {
    id: 'who-changed',
    name: 'Investigate a specific change',
    text:
      'Below is the audit history for {entity} {record} in Acumatica. I need to work out who changed what and when, and why the record ended up in its current state. Identify the change that most likely caused the problem and explain the chain of events leading to it.'
  },
  {
    id: 'approvals',
    name: 'Audit / controls review',
    text:
      'Below is the audit history for {entity} {record} in Acumatica, covering {actions} recorded actions by {users}. Review it from an internal-controls perspective: flag changes made after approval, pricing or discount changes, edits made from unexpected screens, and anything that suggests a segregation-of-duties issue.'
  },
  {
    id: 'customer-answer',
    name: 'Draft a customer/colleague answer',
    text:
      'Below is the audit history for {entity} {record} in Acumatica. Draft a short, non-technical reply I can send to a colleague explaining what happened to this record and when, without ERP jargon.'
  },
  {
    id: 'timeline-only',
    name: 'Just tidy the timeline',
    text:
      'Below is the audit history for {entity} {record} in Acumatica. Rewrite it as a clean chronological timeline in bullet points, one line per meaningful business action, dropping anything that is only a system recalculation.'
  }
];

const ACU_AUDIT_DEFAULT_PROMPT = ACU_AUDIT_PROMPT_PRESETS[0].text;
