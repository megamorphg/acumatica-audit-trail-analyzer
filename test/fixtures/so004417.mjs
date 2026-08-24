// Audit history for sales order SO004417, hand-transcribed from the two
// SM205540 screenshots that kicked this project off.
//
// This is a faithful but abridged transcription: every meaningful field is
// here, along with a representative spread of the derived/plumbing columns
// that the classifier has to suppress. It is NOT a byte-for-byte capture of
// all ~200 columns Acumatica emits per row. Once a real diagnostic dump is
// available from a live instance, drop it into this folder as .json and the
// harness will pick it up instead.
//
// All identifiers are fictional: the order number, customer code, contact,
// customer PO, part number and usernames were replaced before publication.
// Only the shape of the data is drawn from the original capture.
//
// Batches are ordered newest-first, the way Acumatica's feed delivers them.

// Modified column: old value (red) then new value (green).
const mod = (header, from, to) => ({
  Header: header,
  Align: 0,
  Cells: [{ Value: from, Color: 2 }, { Value: to, Color: 1 }],
});

// Key column: same value on both rows — this is how the parser recognises it.
const key = (header, value) => mod(header, value, value);

// Created row: a single green value.
const val = (header, value) => ({
  Header: header,
  Align: 0,
  Cells: [{ Value: value, Color: 1 }],
});

const SO_KEYS = [key('Order Type', 'SO'), key('Order Nbr.', 'SO004417')];
const LINE_KEYS = SO_KEYS.concat([key('Line Nbr.', 1)]);

export default {
  source: 'fixture',
  info: {
    entity: 'Sales Order',
    createdBy: 'dmorgan@northwind.example',
    createdOn: '8/5/2026 12:45:10 PM',
    createdThrough: 'SO301000',
    lastModifiedBy: 'tlawson@northwind.example',
    lastModifiedOn: '8/5/2026 4:15:18 PM',
    lastModifiedThrough: 'PO302000',
    changesLimitReached: false,
  },
  batches: [
    // ---- 8:15:20 PM — drop-ship receipt released, order ships and closes ----
    {
      date: '8/5/2026 8:15:20 PM',
      user: 'tlawson@northwind.example',
      screen: 'PO302000',
      tableData: [
        {
          TableName: 'Sales Order',
          Operation: 'Modified',
          Columns: SO_KEYS.concat([
            mod('Completed', false, true),
            mod('Status', 'Open', 'Completed'),
            mod('Unshipped Amount', 41.75, 0.0),
            mod('OpenOrderTotal', 41.75, 0.0),
            mod('Unshipped Line Total', 39.26, 0.0),
            mod('OpenLineTotal', 39.26, 0.0),
            mod('Unshipped Tax Total', 2.49, 0.0),
            mod('OpenTaxTotal', 2.49, 0.0),
            mod('Unshipped Quantity', 2.0, 0.0),
            mod('Unbilled Balance', 41.75, 39.26),
            mod('UnbilledOrderTotal', 41.75, 39.26),
            mod('Unbilled Tax Total', 2.49, 0.0),
            mod('UnbilledTaxTotal', 2.49, 0.0),
            mod('ShipmentCntr', 0, 1),
            mod('OpenSiteCntr', 1, 0),
            mod('OpenLineCntr', 1, 0),
          ]),
        },
        {
          TableName: 'Sales Order Line',
          Operation: 'Modified',
          Columns: LINE_KEYS.concat([
            mod('BaseShippedQty', 0, 2.0),
            mod('Qty. On Shipments', 0.0, 2.0),
            mod('Open Qty.', 2, 0),
            mod('Base Open Qty.', 2, 0),
            mod('Completed', false, true),
            mod('Open Amount', 39.26, 0),
            mod('OpenAmt', 39.26, 0.0),
            mod('Open Line', true, false),
          ]),
        },
      ],
    },

    // ---- 4:49:17 PM — tax flags invalidated by the drop-ship change ----
    {
      date: '8/5/2026 4:49:17 PM',
      user: 'dmorgan@northwind.example',
      screen: 'SO301000',
      tableData: [
        {
          TableName: 'Sales Order',
          Operation: 'Modified',
          Columns: SO_KEYS.concat([
            mod('Tax Is Up to Date', false, true),
            mod('IsOpenTaxValid', false, true),
            mod('IsUnbilledTaxValid', false, true),
          ]),
        },
      ],
    },

    // ---- 4:49:16 PM — line flagged for drop-ship ----
    {
      date: '8/5/2026 4:49:16 PM',
      user: 'dmorgan@northwind.example',
      screen: 'SO301000',
      tableData: [
        {
          TableName: 'Sales Order Line',
          Operation: 'Modified',
          Columns: LINE_KEYS.concat([
            mod('DiscountsAppliedToLine', false, true),
            mod('Mark for PO', false, true),
            mod('PO Source', null, 'Drop-Ship'),
            mod('Purchase Warehouse', null, 14),
          ]),
        },
        {
          TableName: 'Sales Order',
          Operation: 'Modified',
          Columns: SO_KEYS.concat([
            mod('Tax Is Up to Date', true, false),
            mod('IsOpenTaxValid', true, false),
            mod('IsUnbilledTaxValid', true, false),
            mod('MarkforDS', false, true),
          ]),
        },
      ],
    },

    // ---- 4:45:40 PM — printed ----
    {
      date: '8/5/2026 4:45:40 PM',
      user: 'dmorgan@northwind.example',
      screen: 'SO301000',
      tableData: [
        {
          TableName: 'Sales Order',
          Operation: 'Modified',
          Columns: SO_KEYS.concat([mod('Printed', false, true)]),
        },
      ],
    },

    // ---- 4:45:11 PM — tax calculated ----
    {
      date: '8/5/2026 4:45:11 PM',
      user: 'dmorgan@northwind.example',
      screen: 'SO301000',
      tableData: [
        {
          TableName: 'Sales Order',
          Operation: 'Modified',
          Columns: SO_KEYS.concat([
            mod('Order Total', 39.26, 41.75),
            mod('OrderTotal', 39.26, 41.75),
            mod('Tax Total', 0.0, 2.49),
            mod('TaxTotal', 0.0, 2.49),
            mod('Unshipped Amount', 39.26, 41.75),
            mod('OpenOrderTotal', 39.26, 41.75),
            mod('Unshipped Tax Total', 0.0, 2.49),
            mod('OpenTaxTotal', 0.0, 2.49),
            mod('Unbilled Balance', 39.26, 41.75),
            mod('UnbilledOrderTotal', 39.26, 41.75),
            mod('Unbilled Tax Total', 0.0, 2.49),
            mod('UnbilledTaxTotal', 0.0, 2.49),
            mod('Control Total', 39.26, 41.75),
            mod('ControlTotal', 39.26, 41.75),
            mod('Unpaid Balance', 39.26, 41.75),
            mod('UnpaidBalance', 39.26, 41.75),
            mod('Tax Is Up to Date', false, true),
            mod('IsOpenTaxValid', false, true),
            mod('IsUnbilledTaxValid', false, true),
          ]),
        },
      ],
    },

    // ---- 4:45:10 PM — order and line created ----
    {
      date: '8/5/2026 4:45:10 PM',
      user: 'dmorgan@northwind.example',
      screen: 'SO301000',
      tableData: [
        {
          TableName: 'Sales Order Line',
          Operation: 'Created',
          Columns: [
            val('Order Type', 'SO'),
            val('Order Nbr.', 'SO004417'),
            val('Line Nbr.', 1),
            val('Branch', 14),
            val('Line Order', 1),
            val('Behavior', 'SO'),
            val('DefaultOperation', 'I'),
            val('Operation', 'Issue'),
            val('LineSign', 1),
            val('Shipping Rule', 'Back Order Allowed'),
            val('Completed', false),
            val('Open Line', true),
            val('CustomerID', 27111),
            val('Ship-To Location', 'MAIN'),
            val('OrderDate', '8/5/2026 12:00 AM'),
            val('Cancel By', '6/6/2079 12:00 AM'),
            val('Requested On', '8/5/2026 12:00 AM'),
            val('Ship On', '8/5/2026 12:00 AM'),
            val('Inventory Multiplier', -1),
            val('Manual Price', true),
            val('Is stock', true),
            val('Inventory ID', 'HBX 480J10'),
            val('Line Type', 'Goods for Inventory'),
            val('Warehouse', 14),
            val('UOM', 'EA'),
            val('Quantity', 2),
            val('Base Order Qty.', 2),
            val('UnassignedQty', 0.0),
            val('Qty. On Shipments', 0.0),
            val('BaseShippedQty', 0.0),
            val('Open Qty.', 2),
            val('Base Open Qty.', 2.0),
            val('Billed Quantity', 0),
            val('BaseBilledQty', 0.0),
            val('Unbilled Quantity', 2),
            val('BaseUnbilledQty', 2.0),
            val('Undership Threshold (%)', 100.0),
            val('Overship Threshold (%)', 999),
            val('CuryInfoID', 17664),
            val('Unit Price', 19.63),
            val('UnitPrice', 19.63),
            val('Ext. Price', 39.26),
            val('ExtPrice', 39.26),
            val('Extended Cost', 0.0),
            val('ExtCost', 0.0),
            val('Tax Category', 'AVALARA'),
            val('Tax Exemption Type', 'Default'),
            val('Line Description', 'POLY-V BELT 10 RIBS, 48"'),
            val('Unit Weight', 0.0),
            val('UnitVolume', 0.0),
            val('Free Item', false),
            val('Discount Percent', 0.0),
            val('Discount Amount', 0.0),
            val('DiscAmt', 0.0),
            val('Manual Discount', false),
            val('LineAmt', 39.26),
            val('Open Amount', 39.26),
            val('OpenAmt', 39.26),
            val('Unbilled Amount', 39.26),
            val('UnbilledAmt', 39.26),
            val('GroupDiscountRate', 1.0),
            val('DocumentDiscountRate', 1.0),
            val('Inventory Source', 'Free Stock'),
            val('ProjectID', 1401),
            val('Account', 501000),
            val('Subaccount', '00000'),
            val('Commissionable', false),
            val('Mark for PO', false),
            val('Special Order', false),
          ],
        },
        {
          TableName: 'Sales Order',
          Operation: 'Created',
          Columns: [
            val('Order Type', 'SO'),
            val('Order Nbr.', 'SO004417'),
            val('Branch', 14),
            val('RiskLineCntr', 0),
            val('Behavior', 'Sales Order'),
            val('Customer', 'C01187'),
            val('Location', 'MAIN'),
            val('Contact', 'HOLLAND, MARIE'),
            val('Date', '8/5/2026 12:00 AM'),
            val('Customer PO', '40928-02'),
            val('Cancel By', '6/6/2079 12:00 AM'),
            val('Requested On', '8/5/2026 12:00 AM'),
            val('Sched. Shipment', '8/5/2026 12:00 AM'),
            val('Hold', false),
            val('Approved', true),
            val('Emailed', false),
            val('Printed', false),
            val('Credit Hold', false),
            val('Completed', false),
            val('Canceled', false),
            val('OpenDoc', true),
            val('Bill Separately', false),
            val('Ship Separately', false),
            val('Status', 'Open'),
            val('LineCntr', 2),
            val('BilledCntr', 0),
            val('ReleasedCntr', 0),
            val('BillAddressID', 25651),
            val('ShipAddressID', 312880),
            val('Currency', 'USD'),
            val('CuryInfoID', 17664),
            val('Order Total', 39.26),
            val('OrderTotal', 39.26),
            val('Line Total', 39.26),
            val('LineTotal', 39.26),
            val('Tax Total', 0.0),
            val('TaxTotal', 0.0),
            val('Unshipped Amount', 39.26),
            val('Unbilled Balance', 39.26),
            val('Control Total', 39.26),
            val('Ship Via', 'UPSNDA'),
            val('Shipping Terms', 'PREPAYADD'),
            val('Terms', 'N60'),
            val('Entered By', 'Scalzo, Bret'),
            val('Salesperson ID', 1401),
            val('Tax Zone', 'AVALARA'),
            val('Payment Method', 'CHECK'),
          ],
        },
      ],
    },
  ],
};
