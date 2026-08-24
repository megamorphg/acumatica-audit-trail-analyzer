// Field classification, screen names and value formatting.
//
// The single most important job here is separating the handful of fields a
// human actually touched from the ~200 derived columns Acumatica writes on
// every save. The trick comes from Acumatica itself: SM205530.aspx.cs renders
// a column header as the DAC field's DisplayName, and falls back to the raw
// field name when the field has no [PXUIField] attribute at all. So a header
// that still looks like a C# identifier ("ShipmentCntr", "IsOpenTaxValid",
// "MarkforDS") is by definition a field with no UI presence — plumbing. A
// header with spaces or punctuation ("Discount Percent", "Order Nbr."), or a
// plain English word ("Status", "Printed"), is something a user can see.
//
// Everything else in here is override lists layered on top of that heuristic,
// so a misclassification is always a one-line fix.

(function (global, factory) {
  const ns = (global.AcuAudit = global.AcuAudit || {});
  factory(ns);
})(typeof globalThis !== 'undefined' ? globalThis : self, function (AcuAudit) {
  'use strict';

  // ---------- significance tiers ----------
  // primary   — show in the headline sentence
  // secondary — real field, but derived/recalculated; detail view only
  // noise     — internal plumbing; hidden unless "show system fields" is on
  const PRIMARY = 'primary';
  const SECONDARY = 'secondary';
  const NOISE = 'noise';

  // Fields that must always be treated as primary even if a heuristic below
  // would demote them.
  const FORCE_PRIMARY = new Set([
    // identity
    'Order Type', 'Order Nbr.', 'Line Nbr.', 'Type', 'Reference Nbr.',
    'Inventory ID', 'Line Description', 'Description', 'Customer', 'CustomerID',
    'Customer ID', 'Vendor', 'Vendor ID', 'Location', 'Contact', 'Branch',
    'Warehouse', 'Subitem', 'UOM', 'Project', 'Task', 'Employee', 'Appointment Nbr.',
    'Service Order Nbr.', 'Service', 'Staff Member',
    // money / quantity a person edits. Document totals are deliberately NOT
    // here — they are always recalculated, never typed, and quoting every one
    // of them is what turns a summary into a wall of numbers. Rules that want
    // a total still read it directly; tier only governs generic phrasing.
    'Quantity', 'Qty.', 'Unit Price', 'Unit Cost', 'Discount Percent',
    'Discount Amount', 'Discount Code', 'Manual Price', 'Manual Discount',
    'Free Item', 'Amount', 'Cash Discount', 'Freight Price', 'Freight Cost',
    'Currency', 'Cury ID',
    // dates
    'Date', 'Order Date', 'Requested On', 'Ship On', 'Cancel By', 'Due Date',
    'Start Date', 'End Date', 'Scheduled Date', 'Expiration Date',
    // status / workflow
    'Status', 'Line Status', 'PO Status', 'Completed', 'Cancelled', 'Canceled',
    'Hold', 'Approved', 'Printed', 'Emailed', 'Credit Hold', 'Released',
    'Priority', 'Severity', 'Reason', 'Return Notes', 'Delivery Method',
    'Workflow Type', 'Part Request ID', 'PO Nbr.', 'Shipping Priority',
    // logistics / terms
    'Ship Via', 'Shipping Terms', 'Shipping Rule', 'Ship Zone', 'Terms',
    'Tax Zone', 'Tax Category', 'Tax Exemption Type', 'Payment Method',
    'Salesperson ID', 'Commissionable', 'Customer PO', 'External Ref.',
    'Residential Delivery', 'Saturday Delivery', 'Ground Collect', 'Insurance',
    'Mark for PO', 'PO Source', 'Purchase Warehouse', 'Special Order',
    'Account', 'Subaccount', 'Credit Limit', 'Class ID', 'Price Class',
  ]);

  // Real display names that are nonetheless recalculated by Acumatica rather
  // than typed by a person. Kept, but demoted out of headline sentences.
  const FORCE_SECONDARY = new Set([
    'Open Line', 'Open Qty.', 'Open Amount', 'Open Order Total', 'Open Line Total',
    'Open Tax Total', 'Open Doc.', 'Unshipped Amount', 'Unshipped Quantity',
    'Unshipped Line Total', 'Unshipped Tax Total', 'Unbilled Balance',
    'Unbilled Order Total', 'Unbilled Tax Total', 'Unbilled Amount',
    'Billed Quantity', 'Billed Amount', 'Qty. On Shipments', 'Qty. On Orders',
    'Unpaid Balance', 'Paid Amount', 'Control Total', 'Tax Is Up to Date',
    'Ordered Qty.', 'Received Qty.', 'Base Order Qty.', 'Base Open Qty.',
    'Unassigned Qty.', 'Extended Cost', 'Extended Price', 'Ext. Weight',
    'Ext. Volume', 'Unit Weight', 'Unit Volume', 'Order Weight', 'Order Volume',
    'Freight Total', 'Misc. Charges', 'Goods', 'Taxable Total', 'Tax Exempt Total',
    'VAT Exempt Total', 'VAT Taxable Total', 'Est. Margin Amount', 'Est. Margin (%)',
  ]);

  // Explicit hides for things the heuristic can't catch.
  const FORCE_NOISE = new Set([
    'NoteID', 'tstamp', 'Created By', 'Created On', 'Last Modified By',
    'Last Modified On', 'Created Through', 'Last Modified Through',
    // Field-service purchasing bookkeeping. All properly named, all written by
    // Acumatica as a PO moves through its workflow, none of them typed: seen
    // together on every batch of a live PO301000 audit.
    'Plan ID', 'PO Completed', 'Waiting for Purchased Items',
    'Allocated from Service Order PO Qty.', 'Line Order', 'Is stock',
  ]);

  // Derived-value prefixes/suffixes on otherwise well-named display fields.
  //
  // This is the difference between a readable summary and a wall of numbers.
  // A field service order save rewrites Estimated Total, Estimated Cost Total,
  // Actual Billable Total, Cost Total, Actual Tax Total, Invoice Total,
  // Margin %, Mark Up %, Gross Profit $ and two service counters — none of
  // which anyone typed. They all have proper display names, so only their
  // shape gives them away.
  // Matched as whole leading tokens rather than by regex: several of these end
  // in a period ("Ext.", "Est."), and \b after a period never fires because a
  // word boundary needs a word character on one side.
  const DERIVED_PREFIXES = [
    'Unshipped', 'Unbilled', 'Unpaid', 'Unreleased', 'Unrefunded', 'Open',
    'Billed', 'Released', 'Transferred', 'Authorized', 'Prepayment', 'Control',
    'Base', 'Cury', 'Actual', 'Scheduled', 'Estimated', 'Est.', 'Received',
    'Ordered', 'Shipped', 'Min', 'Max', 'Ext.', 'Extended', 'Margin',
    'Mark Up', 'Gross Profit', 'Total',
  ];

  function hasDerivedPrefix(header) {
    const lower = header.toLowerCase();
    return DERIVED_PREFIXES.some(word => {
      if (!lower.startsWith(word.toLowerCase())) return false;
      const next = header.charAt(word.length);
      return next === '' || next === ' ';
    });
  }

  const DERIVED_SUFFIX = /\b(Total|Count|Balance|Subtotal|Cntr|Counter)$/i;

  // Header patterns that are always plumbing.
  const NOISE_PATTERNS = [
    /Cntr$/,            // ShipmentCntr, OpenLineCntr
    /^Is[A-Z]/,         // IsOpenTaxValid, IsExpired
    /Valid$/,           // IsUnbilledTaxValid
    /^Cury[A-Z]/,       // CuryInfoID, CuryOpenAmt
    /^Base[A-Z]/,       // BaseShippedQty, BaseOpenQty
    /^Unbilled[A-Z]/,   // UnbilledAmt
    /Amt$/,             // OpenAmt, DiscAmt, LineAmt
    /Tot$/,             // MiscTot, FreightTot
    /^tstamp$/i,
    /^NoteID$/i,
  ];

  /**
   * True when a column header still looks like a raw C# identifier, which
   * means the underlying DAC field has no [PXUIField] display name.
   */
  function looksLikeRawFieldName(header) {
    // Anything with a space or display punctuation came from a DisplayName.
    if (/[\s.()%/\-,]/.test(header)) return false;
    // camelCase boundary: ShipmentCntr, MarkforDS, DiscountsAppliedToLine
    if (/[a-z][A-Z]/.test(header)) return true;
    // acronym prefix: POCreated, ARDocType
    if (/^[A-Z]{2,}[a-z]/.test(header)) return true;
    // ALLCAPS run with no lowercase at all: LINETYPE
    if (/^[A-Z]{4,}$/.test(header)) return true;
    return false;
  }

  /**
   * Classify a column header into primary / secondary / noise.
   */
  function classifyField(header) {
    const h = String(header || '').trim();
    if (!h) return NOISE;

    if (FORCE_NOISE.has(h)) return NOISE;
    if (FORCE_PRIMARY.has(h)) return PRIMARY;
    if (FORCE_SECONDARY.has(h)) return SECONDARY;

    for (const re of NOISE_PATTERNS) {
      if (re.test(h)) return NOISE;
    }
    if (looksLikeRawFieldName(h)) return NOISE;

    if (hasDerivedPrefix(h) || DERIVED_SUFFIX.test(h)) return SECONDARY;

    // A recognisable display name we don't know about — assume it matters.
    return PRIMARY;
  }

  // ---------- record identity ----------
  // Fallback key columns per audited table, used when a table only ever
  // appears as "Created" (one row, so old/new equality can't reveal the keys).
  const ENTITY_KEYS = {
    'Sales Order': ['Order Type', 'Order Nbr.'],
    'Sales Order Line': ['Order Type', 'Order Nbr.', 'Line Nbr.'],
    'Sales Order Shipment': ['Order Type', 'Order Nbr.', 'Shipment Nbr.'],
    'Purchase Order': ['Order Type', 'Order Nbr.'],
    'Purchase Order Line': ['Order Type', 'Order Nbr.', 'Line Nbr.'],
    // The name a live AP301000 audit actually uses for the same rows.
    'PO Line': ['Order Type', 'Order Nbr.', 'Line Nbr.'],
    'AR Transactions': ['Tran. Type', 'Reference Nbr.', 'Line Nbr.'],
    'AP Transactions': ['Tran. Type', 'Reference Nbr.', 'Line Nbr.'],
    'AR Document': ['Type', 'Reference Nbr.'],
    'Document': ['Type', 'Reference Nbr.'],
    'Purchase Receipt': ['Receipt Type', 'Receipt Nbr.'],
    'Purchase Receipt Line': ['Receipt Type', 'Receipt Nbr.', 'Line Nbr.'],
    'Invoice': ['Type', 'Reference Nbr.'],
    'Invoice Line': ['Type', 'Reference Nbr.', 'Line Nbr.'],
    'Customer': ['Customer ID'],
    'Vendor': ['Vendor ID'],
    'Stock Item': ['Inventory ID'],
    'Non-Stock Item': ['Inventory ID'],
    // Saving a customer bumps its address revision, and the audit records
    // nothing but the surrogate key and the new revision number. Naming the
    // key stops it being read as a field somebody edited.
    'Address': ['Address ID'],
    'Contact': ['Contact ID'],
    // Table names confirmed from PX.Objects.FS/Descriptor/TX.cs
    // The header table labels these "Order Type" / "Order Nbr."; only the
    // detail tables qualify them with "Service Order".
    'Service Order': ['Order Type', 'Order Nbr.'],
    'Appointment': ['Service Order Type', 'Appointment Nbr.'],
    'Service Order Item Detail': ['Service Order Type', 'Service Order Nbr.', 'Line Nbr.'],
    'Appointment Item Detail': ['Service Order Type', 'Appointment Nbr.', 'Line Nbr.'],
    'FSAppointmentEmployee': ['Service Order Type', 'Appointment Nbr.', 'Line Nbr.'],
  };

  // Which audited tables are the document header (vs. a detail line).
  // "Transactions" earns its place from live AR/AP captures: ARTran and APTran
  // are audited as "AR Transactions" / "AP Transactions", and read as headers
  // they announce themselves as documents somebody created — twice, alongside
  // the register row they belong to.
  const DETAIL_TABLE = /\b(Line|Detail|Details|Split|Splits|Tran|Trans|Transaction|Transactions)$/i;

  // Child collections whose names the pattern above cannot catch. Acumatica's
  // audit labels most of them from the DAC's display name, but a few arrive as
  // the bare class name — FSAppointmentEmployee is the staff assigned to an
  // appointment, and read as a header table it announces itself as a document
  // someone created.
  const DETAIL_TABLE_NAMES = new Set([
    'FSAppointmentEmployee',
    'FSAppointmentLog',
    'FSApptLineSplit',
    // Written when field service bills a service order; carries only the link
    // between the order and the invoice it produced.
    'FSBillHistory',
  ]);

  function isDetailTable(tableName) {
    const name = String(tableName || '').trim();
    return DETAIL_TABLE_NAMES.has(name) || DETAIL_TABLE.test(name);
  }

  function parentOf(keys) {
    return keys['Order Nbr.'] || keys['Reference Nbr.'] || keys['Receipt Nbr.'] ||
      keys['Appointment Nbr.'] || keys['Service Order Nbr.'] || null;
  }

  /**
   * Short human label for a record, e.g. "line 4" or "SO004417".
   *
   * `docRecord`, when given, is the document being audited. A batch routinely
   * touches lines on other documents — a purchase order audit carries the
   * service order lines it was raised from — and a bare "line 3" alongside
   * "line 1" reads as two lines of the same order. Naming the parent is the
   * only thing that tells them apart.
   */
  function describeRecord(tableName, keys, docRecord) {
    const line = keys['Line Nbr.'] != null ? keys['Line Nbr.']
      : keys['Line Number'] != null ? keys['Line Number'] : null;
    if (isDetailTable(tableName) && line != null) {
      const parent = parentOf(keys);
      if (parent != null && docRecord && String(parent).trim() !== String(docRecord).trim()) {
        return 'line ' + line + ' of ' + String(parent).trim();
      }
      return 'line ' + line;
    }
    const nbr = parentOf(keys) || keys['Customer ID'] ||
      keys['Vendor ID'] || keys['Inventory ID'];
    // Acumatica space-pads fixed-width key columns, so "C0000015   " arrives
    // with its padding intact and lands in the panel title as written.
    return nbr != null ? String(nbr).trim() : String(tableName || 'record');
  }

  // ---------- entity naming ----------
  // Acumatica audits one AR/AP document row through several DAC projections
  // and names each after the projection: an SO invoice is written as both
  // "SO Invoice" and "AR Document", a vendor bill as "AP document" and plain
  // "Document". None of those is what anyone calls the thing. The row's own
  // Type column is — "Invoice", "Bill", "Credit Memo" — so it wins when the
  // table name is one of the generic register names.
  const GENERIC_DOC_TABLES = new Set([
    'Document', 'AR Document', 'AP Document', 'AP document', 'SO Invoice',
  ]);

  function entityName(tableName, keys) {
    const name = String(tableName || '').trim();
    if (!GENERIC_DOC_TABLES.has(name)) return name;
    const k = keys || {};
    const type = k['Type'] != null ? k['Type'] : k['Tran. Type'];
    const label = type == null ? '' : String(type).trim();
    return label || name;
  }

  // ---------- master data ----------
  // Records that exist in their own right rather than moving through a
  // workflow. Nobody releases or completes a customer, so an edit to one of
  // its fields *is* the event — which changes how much of the timeline is
  // worth promoting into the summary.
  const MASTER_TABLES = new Set([
    'Customer', 'Vendor', 'Business Account', 'Contact', 'Employee',
    'Stock Item', 'Non-Stock Item', 'Customer Class', 'Vendor Class',
    'Item Class', 'Customer Location', 'Vendor Location',
  ]);

  function isMasterTable(tableName) {
    return MASTER_TABLES.has(String(tableName || '').trim());
  }

  // ---------- screen names ----------
  // Only screens whose titles are certain are listed. Everything else falls
  // back to the module name, and the raw ID is always shown alongside, so an
  // unmapped screen still reads sensibly.
  const SCREEN_NAMES = {
    // Sales
    SO301000: 'Sales Orders',
    SO302000: 'Shipments',
    SO303000: 'Invoices',
    SO201000: 'Order Types',
    SO501000: 'Process Orders',
    SO502000: 'Process Shipments',
    // Purchasing
    PO301000: 'Purchase Orders',
    PO302000: 'Purchase Receipts',
    PO501000: 'Process Orders',
    // Inventory
    IN202500: 'Stock Items',
    IN202000: 'Non-Stock Items',
    IN301000: 'Issues',
    IN302000: 'Receipts',
    IN303000: 'Adjustments',
    IN304000: 'Transfers',
    // Receivables
    AR301000: 'Invoices and Memos',
    AR302000: 'Payments and Applications',
    AR303000: 'Customers',
    AR202000: 'Customer Classes',
    // Payables
    AP301000: 'Bills and Adjustments',
    AP302000: 'Checks and Payments',
    AP303000: 'Vendors',
    // General ledger
    GL301000: 'Journal Transactions',
    // Field services
    FS300100: 'Service Orders',
    FS300200: 'Appointments',
    // System
    SM205510: 'Audit',
    SM205530: 'Audit History by Screen',
    SM205540: 'Audit History',
    SM201010: 'Users',
    CS100000: 'Enable/Disable Features',
  };

  // The audited table a screen opens onto. Key values alone cannot always pick
  // it: a customer's history carries "Customer" and "Business Account" rows
  // under the identical key, and an invoice's carries "AR Document" and
  // "SO Invoice". The screen the audit was opened from settles the tie.
  //
  // Names are the ones the codebase already commits to in ENTITY_KEYS, plus
  // the two confirmed from live SO303000 and AP301000 captures.
  const SCREEN_ENTITIES = {
    AR303000: 'Customer',
    AP303000: 'Vendor',
    IN202500: 'Stock Item',
    IN202000: 'Non-Stock Item',
    SO301000: 'Sales Order',
    SO303000: 'AR Document',
    PO301000: 'Purchase Order',
    PO302000: 'Purchase Receipt',
    AP301000: 'Document',
    FS300100: 'Service Order',
    FS300200: 'Appointment',
  };

  function screenEntity(screenId) {
    return SCREEN_ENTITIES[String(screenId || '').trim().toUpperCase()] || '';
  }

  const MODULE_NAMES = {
    SO: 'Sales Orders', PO: 'Purchasing', IN: 'Inventory',
    AR: 'Accounts Receivable', AP: 'Accounts Payable', GL: 'General Ledger',
    CA: 'Cash Management', CM: 'Currency Management', CR: 'Customer Management',
    FS: 'Field Services', PM: 'Projects', CT: 'Contracts', FA: 'Fixed Assets',
    TX: 'Taxes', CS: 'Common Settings', SM: 'System Management',
    RQ: 'Requisitions', AM: 'Manufacturing', DR: 'Deferred Revenue',
    PR: 'Payroll', EP: 'Employee Portal', EX: 'Expenses', SV: 'Service',
  };

  /**
   * "PO302000" -> "Purchase Receipts (PO302000)".
   * Unknown IDs fall back to the module, then to the bare ID.
   */
  function describeScreen(screenId) {
    const id = String(screenId || '').trim().toUpperCase();
    if (!id) return '';
    if (SCREEN_NAMES[id]) return SCREEN_NAMES[id] + ' (' + id + ')';
    const mod = MODULE_NAMES[id.slice(0, 2)];
    if (mod) return 'a ' + mod + ' screen (' + id + ')';
    return id;
  }

  // ---------- value formatting ----------
  function isBlank(v) {
    return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
  }

  /**
   * Render an audit cell value for prose. Booleans become yes/no rather than
   * "true"/"false"; blanks become "(blank)" so a cleared field still reads.
   */
  function formatValue(v) {
    if (typeof v === 'boolean') return v ? 'yes' : 'no';
    if (isBlank(v)) return '(blank)';
    if (typeof v === 'number') {
      // Trim Acumatica's trailing-zero precision: 2.000000 -> 2
      return Number.isInteger(v) ? String(v) : String(parseFloat(v.toFixed(6)));
    }
    const s = String(v).trim();
    // Numeric-looking strings get the same trailing-zero treatment.
    if (/^-?\d+\.\d+$/.test(s)) return String(parseFloat(s));
    return s;
  }

  /** Money-ish formatting for amounts quoted in sentences. */
  function formatMoney(v) {
    const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
    if (!isFinite(n)) return formatValue(v);
    // Grouped, because $18425.88 is genuinely hard to read at a glance.
    const [whole, cents] = Math.abs(n).toFixed(2).split('.');
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (n < 0 ? '-$' : '$') + grouped + '.' + cents;
  }

  function isMoneyField(header) {
    return /(Price|Cost|Amount|Total|Balance|Amt|Freight|Discount Amount)$/i.test(String(header || ''));
  }

  /**
   * Field Services durations are PXDBTimeSpanLong, and the audit renders them
   * as h:mm with the separator dropped — "200" is two hours, "000" is zero,
   * "130" is an hour and a half. A plain minutes value would never render as
   * "000", and the appointment line that reads Estimated Duration 200 also
   * carries Estimated Quantity 2 with UOM HOUR, which settles it.
   *
   * Anything that doesn't fit h:mm (minutes >= 60, non-numeric) is returned
   * unchanged rather than mangled.
   */
  function isDurationField(header) {
    return /Duration$/i.test(String(header || ''));
  }

  function formatDuration(v) {
    if (isBlank(v)) return formatValue(v);
    const s = String(v).trim();

    let hours;
    let mins;
    const colon = s.match(/^(\d+):([0-5]\d)$/);
    if (colon) {
      hours = parseInt(colon[1], 10);
      mins = parseInt(colon[2], 10);
    } else if (/^\d{1,6}$/.test(s)) {
      const padded = s.padStart(3, '0');
      hours = parseInt(padded.slice(0, -2), 10);
      mins = parseInt(padded.slice(-2), 10);
      if (mins > 59) return formatValue(v);
    } else {
      return formatValue(v);
    }

    if (!hours && !mins) return '0h';
    if (!mins) return hours + 'h';
    if (!hours) return mins + 'm';
    return hours + 'h ' + mins + 'm';
  }

  AcuAudit.dictionary = {
    PRIMARY, SECONDARY, NOISE,
    classifyField,
    looksLikeRawFieldName,
    ENTITY_KEYS,
    isDetailTable,
    isMasterTable,
    describeRecord,
    entityName,
    SCREEN_NAMES,
    SCREEN_ENTITIES,
    MODULE_NAMES,
    describeScreen,
    screenEntity,
    formatValue,
    formatMoney,
    isMoneyField,
    formatDuration,
    isDurationField,
    isBlank,
  };
});
