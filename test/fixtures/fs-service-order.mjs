// A field service order audit, modelled on a real SM205540 capture that came
// out as an unreadable wall of text.
//
// It reproduces the specific shapes that broke the first version:
//   - captions glued to values ("User User pnadeau", "SCREEN ID SCREEN ID FS300100")
//   - a dozen recalculated rollups per save (Estimated Total, Cost Total,
//     Actual Tax Total, Margin %, Mark Up %, Gross Profit $, service counts)
//   - detail rows that two rules both wanted to describe
//   - a purchase order raised from inside a service order audit
//   - heavy Line Status churn across four lines
//
// All identifiers are fictional; only the shape is drawn from the capture.
//
// Values are representative rather than a byte-exact transcription.

const mod = (header, from, to) => ({
  Header: header,
  Cells: [{ Value: from, Color: 2 }, { Value: to, Color: 1 }],
});
const key = (header, value) => mod(header, value, value);
const val = (header, value) => ({ Header: header, Cells: [{ Value: value, Color: 1 }] });

const APPT_KEYS = [key('Service Order Type', 'RC'), key('Appointment Nbr.', '0012045-1')];

// The rollups Acumatica rewrites on essentially every save.
const rollups = (a, b) => [
  mod('Estimated Total', a, b),
  mod('Estimated Cost Total', a * 0.6, b * 0.6),
  mod('Actual Billable Total', a, b),
  mod('Cost Total', a * 0.6, b * 0.6),
  mod('Actual Tax Total', a * 0.06, b * 0.06),
  mod('Invoice Total', a * 1.06, b * 1.06),
  mod('Ext. Price Total', a, b),
  mod('Margin %', 100, 0),
  mod('Margin Amount', a, b),
  mod('Gross Profit $ (Unit)', a, b),
  mod('Mark Up %', 6141959, 0),
  mod('Scheduled Service Count', 2, 0),
  mod('Complete Service Count', 0, 2),
];

const batch = (time, user, screen, tableData) => ({
  // Deliberately caption-doubled, exactly as the DOM fallback delivered it.
  date: `Date Date 7/20/2026 ${time}`,
  user: `User User ${user}`,
  screen: `SCREEN ID SCREEN ID ${screen}`,
  tableData,
});

export default {
  source: 'fixture',
  info: {
    entity: 'Appointment',
    createdBy: 'pnadeau',
    createdOn: '7/20/2026 10:56:00 AM',
    createdThrough: 'CR306000',
    lastModifiedBy: 'sberger',
    lastModifiedOn: '7/20/2026 3:09:00 PM',
    changesLimitReached: false,
  },
  // Newest-first, as Acumatica's feed delivers.
  batches: [
    batch('3:09:00 PM', 'sberger', 'FS300100', [{
      TableName: 'Appointment Item Detail', Operation: 'Modified',
      Columns: APPT_KEYS.concat([key('Line Nbr.', 7), mod('Part Request ID', null, 1874)]),
    }]),

    batch('3:08:00 PM', 'sberger', 'FS300100', [
      {
        TableName: 'Appointment Item Detail', Operation: 'Created',
        Columns: [
          val('Service Order Type', 'RC'), val('Appointment Nbr.', '0012045-1'),
          val('Line Nbr.', 7), val('Inventory ID', '100-AB12-50771-1'),
          val('Quantity', 1), val('Unit Price', 61419.59), val('Ext. Price', 61419.59),
        ],
      },
      { TableName: 'Appointment', Operation: 'Modified', Columns: APPT_KEYS.concat(rollups(124379.18, 185798.77)) },
    ]),

    batch('2:54:00 PM', 'sberger', 'FS300100', [
      {
        TableName: 'Appointment Item Detail', Operation: 'Created',
        Columns: [
          val('Service Order Type', 'RC'), val('Appointment Nbr.', '0012045-1'),
          val('Line Nbr.', 6), val('Inventory ID', '100-AB12-50771-1'),
          val('Quantity', 1), val('Unit Price', 61419.59), val('Subaccount', '050012'),
        ],
      },
      { TableName: 'Appointment', Operation: 'Modified', Columns: APPT_KEYS.concat(rollups(62959.59, 124379.18)) },
    ]),

    batch('2:51:00 PM', 'pnadeau', 'FS300100', [{
      TableName: 'Appointment', Operation: 'Modified',
      Columns: APPT_KEYS.concat([
        mod('Status', 'Completed', 'Ops Team Review'),
        mod('Service Manager Reviewed Date', '7/20/2026 12:00 AM', '7/24/2026 12:00 AM'),
        mod('Amount', 330, 990),
      ]).concat(rollups(880, 1540)),
    }]),

    batch('2:50:00 PM', 'pnadeau', 'FS300100', [
      {
        TableName: 'Appointment Item Detail', Operation: 'Modified',
        Columns: APPT_KEYS.concat([
          key('Line Nbr.', 3),
          mod('Line Status', 'In Process', 'Completed'),
          mod('Discount Percent', 0, 100),
        ]),
      },
      {
        TableName: 'Appointment Item Detail', Operation: 'Modified',
        Columns: APPT_KEYS.concat([
          key('Line Nbr.', 5),
          mod('Line Status', 'Scheduled', 'Completed'),
          mod('Discount Percent', 66.6667, 0),
        ]),
      },
      {
        TableName: 'Appointment', Operation: 'Modified',
        Columns: APPT_KEYS.concat([mod('Completed', false, true)]).concat(rollups(61749.59, 1540)),
      },
    ]),

    batch('2:47:00 PM', 'pnadeau', 'FS300100', [
      {
        TableName: 'Appointment Item Detail', Operation: 'Created',
        Columns: [
          val('Service Order Type', 'RC'), val('Appointment Nbr.', '0012045-1'),
          val('Line Nbr.', 5), val('Service', 'OT'), val('Quantity', 2),
        ],
      },
      {
        TableName: 'Appointment', Operation: 'Modified',
        Columns: APPT_KEYS.concat([
          mod('Actual Duration', 100, 300),
          mod('Scheduled End Date', '7/20/2026 11:56 AM', '7/20/2026 1:56 PM'),
        ]).concat(rollups(61969.59, 62959.59)),
      },
    ]),

    batch('2:35:00 PM', 'sberger', 'FS300100', [{
      TableName: 'Appointment', Operation: 'Modified',
      Columns: APPT_KEYS.concat([mod('Status', 'Completed', 'In Process')]),
    }]),

    batch('2:13:00 PM', 'pnadeau', 'FS300100', [
      {
        TableName: 'Appointment Item Detail', Operation: 'Modified',
        Columns: APPT_KEYS.concat([
          key('Line Nbr.', 3),
          mod('Line Status', 'Scheduled', 'Completed'),
          mod('Return Notes', null, 'CANCELLED'),
        ]),
      },
      {
        TableName: 'Appointment', Operation: 'Modified',
        Columns: APPT_KEYS.concat([mod('Status', 'Completed', 'Ops Team Review')]).concat(rollups(550, 61969.59)),
      },
    ]),

    batch('11:59:00 AM', 'sberger', 'PO301000', [{
      TableName: 'Purchase Order', Operation: 'Modified',
      Columns: [
        key('Order Type', 'RO'), key('Order Nbr.', 'PO002298'),
        mod('Status', 'Pending Printing', 'Completed'),
      ],
    }]),

    batch('11:58:00 AM', 'sberger', 'PO301000', [{
      TableName: 'Purchase Order', Operation: 'Modified',
      Columns: [
        key('Order Type', 'RO'), key('Order Nbr.', 'PO002298'),
        mod('Status', 'On Hold', 'Pending Approval'),
        mod('Unit Cost', 0, 18425.88),
        mod('Order Total', 0, 18425.88),
        mod('Line Total', 0, 18425.88),
        mod('Cost Total', 0, 18545.88),
      ],
    }]),

    batch('11:57:00 AM', 'sberger', 'PO505000', [
      {
        TableName: 'Purchase Order', Operation: 'Created',
        Columns: [
          val('Order Type', 'RO'), val('Order Nbr.', 'PO002298'),
          val('Vendor', 'V0000031'), val('Location', 'MAIN'),
          val('Promised On', '7/20/2026 12:00 AM'), val('Status', 'On Hold'),
        ],
      },
      {
        TableName: 'Appointment Item Detail', Operation: 'Created',
        Columns: [
          val('Service Order Type', 'RC'), val('Appointment Nbr.', '0012045-1'),
          val('Line Nbr.', 3), val('Inventory ID', '100-AB12-50771-1'), val('Quantity', 1),
        ],
      },
    ]),

    batch('11:14:00 AM', 'pnadeau', 'FS300100', [{
      TableName: 'Appointment', Operation: 'Modified',
      Columns: APPT_KEYS.concat([
        mod('Status', 'Open', 'In Process'),
        mod('Actual Duration', 0, 100),
        mod('Actual Start Time', null, '7/20/2026 11:14 AM'),
      ]).concat(rollups(0, 550)),
    }]),

    batch('10:56:30 AM', 'admin', 'FS300100', [{
      TableName: 'Appointment', Operation: 'Modified',
      Columns: APPT_KEYS.concat([mod('Delivery Method', null, 'Dispatched')]),
    }]),

    batch('10:56:00 AM', 'pnadeau', 'CR306000', [
      {
        TableName: 'Appointment', Operation: 'Created',
        Columns: [
          val('Service Order Type', 'RC'), val('Appointment Nbr.', '0012045-1'),
          val('Customer', 'C0000317'), val('Scheduled Date', '7/20/2026 10:56 AM'),
          val('Status', 'Open'), val('Workflow Type', 'Simple'),
          val('Estimated Total', 550), val('Cost Total', 120),
        ],
      },
      {
        TableName: 'Service Order', Operation: 'Created',
        Columns: [
          val('Service Order Type', 'RC'), val('Service Order Nbr.', '0078097'),
          val('Customer', 'C0000317'), val('Status', 'Open'),
        ],
      },
      {
        TableName: 'Appointment Item Detail', Operation: 'Created',
        Columns: [
          val('Service Order Type', 'RC'), val('Appointment Nbr.', '0012045-1'),
          val('Line Nbr.', 1), val('Service', 'TZ1'), val('Quantity', 1),
          val('Unit Price', 220), val('Discount Percent', 100),
        ],
      },
      {
        TableName: 'Appointment Item Detail', Operation: 'Created',
        Columns: [
          val('Service Order Type', 'RC'), val('Appointment Nbr.', '0012045-1'),
          val('Line Nbr.', 2), val('Service', 'TZ2'), val('Quantity', 1),
          val('Unit Price', 330), val('Discount Percent', 100),
        ],
      },
    ]),
  ],
};
