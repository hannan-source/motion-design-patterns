// The ERP's data model, roles and permissions, in one declarative file.
// The server validates against it and the web app draws lists, forms and imports from it,
// so adding a field or an entity here is enough for it to appear everywhere.
// Runs unchanged in Node and in the browser.

import { FUNCTIONS, TRACKS } from './golive.js';

export const COMPANY = 'Deme';
export const STAGES = ['cut', 'stitch', 'finish', 'qc', 'pack'];
export const STAGE_NAMES = { cut: 'Cutting', stitch: 'Stitching', finish: 'Finishing', qc: 'Final QC', pack: 'Packing' };
export const INSPECTION_PASS_MARK = 40; // 4-point system: penalty points per 100 sq yd

// ───────── Roles ─────────
// Levels, lowest to highest. `scan` is the floor tier: scan bundles in and out, nothing else.
export const LEVELS = ['none', 'scan', 'read', 'write', 'admin'];

export const MODULES = {
  masters: { name: 'Masters', info: 'The reference lists every other module points at: materials, styles with their stitch minutes and bill of materials, suppliers, customers, work centres and machines. Fill these first.' },
  purchasing: { name: 'Purchasing', info: 'Raise purchase orders, get them approved, and book goods receipts when material arrives. Posting a receipt creates fabric rolls or adds stock, opens a supplier bill and writes the purchase voucher.' },
  inventory: { name: 'Inventory', info: 'Fabric by roll, and thread, trims, tools and consumables by quantity. Every change is a stock movement, so the count can always be traced. Minimum levels drive the low-stock alerts.' },
  quality: { name: 'Quality', info: 'Fabric inspection on the 4-point system before dyeing, dye lots out to the dyer and back with a shade check, and in-line and final checks on work orders. Only inspected rolls can be sent for dyeing.' },
  production: { name: 'Production', info: 'Work orders through cutting, stitching, finishing, final QC and packing. Bundles are scanned in and out at stations, which gives real minutes per piece. Sample requests and machine upkeep live here too.' },
  b2b: { name: 'B2B sales', info: 'Wholesale customers, their purchase orders and invoices. Confirming a sales order raises the work orders for it. Posting an invoice writes the sales voucher and opens the receivable.' },
  b2c: { name: 'B2C sales', info: 'Shopify orders, store orders, fit visits and returns. Import Shopify orders from a CSV export until the connector is live. The sales of the day view reads from here.' },
  logistics: { name: 'Logistics', info: 'Every parcel in or out passes one scan gate. Scans update the order and the stock. Courier invoices are matched line by line against the parcels actually shipped before they are approved for payment.' },
  finance: { name: 'Finance', info: 'Ledgers, vouchers, supplier bills and receivables. Most vouchers are written by events elsewhere in the ERP; manual journals can be added here. Vouchers export to Tally as import XML.' },
  hr: { name: 'People', info: 'Employee records, attendance, leave, KRAs and payroll. Everyone can check in and out, apply for leave and see their own KRAs from My day. Salaries and payroll are visible to HR admins only.' },
  projects: { name: 'Projects', info: 'Shared projects and tasks for any team: a collection launch, a factory fix, a shoot. Tasks have an owner, a due date and a status.' },
  marketing: { name: 'Marketing', info: 'Campaigns with budget, spend and revenue, and the content calendar across channels.' },
  design: { name: 'Design', info: 'Collections and the development of each style from sketch to approved sample. Sample requests go to Production from here.' },
  admin: { name: 'Admin', info: 'Team members and what each role can do, company settings, connections to outside systems, and the audit trail of who changed what.' },
};

const ALL = (lvl) => Object.fromEntries(Object.keys(MODULES).map((m) => [m, lvl]));
// From the access plan the Deme team drew up for their ERP evaluation.
export const ROLES = {
  founder: { name: 'Founder / CEO', perms: ALL('admin') },
  ops_head: { name: 'Operations head', perms: ALL('admin') },
  production_head: { name: 'Production head', perms: { production: 'admin', b2c: 'write', projects: 'write', purchasing: 'write', masters: 'write', inventory: 'read', quality: 'read', b2b: 'read', logistics: 'read', design: 'read' } },
  production_manager: { name: 'Production manager', perms: { production: 'write', b2c: 'write', projects: 'write', purchasing: 'write', masters: 'read', inventory: 'read', quality: 'read', b2b: 'read', design: 'read' } },
  line_manager: { name: 'Line manager', perms: { production: 'write', projects: 'write', purchasing: 'write', masters: 'read', inventory: 'read' } },
  operator: { name: 'Tailor / Master (scan only)', perms: { production: 'scan' } },
  qc: { name: 'QC head / assistant manager', perms: { quality: 'write', inventory: 'write', purchasing: 'write', projects: 'write', production: 'read', masters: 'read' } },
  logistics: { name: 'Logistics', perms: { logistics: 'write', projects: 'write', purchasing: 'write', b2c: 'read', b2b: 'read', masters: 'read' } },
  b2b: { name: 'B2B and merchandising', perms: { b2b: 'write', inventory: 'write', purchasing: 'write', projects: 'write', production: 'read', masters: 'write', design: 'read', logistics: 'read' } },
  sales: { name: 'Sales (B2C)', perms: { b2c: 'write', production: 'read', projects: 'write', purchasing: 'write', logistics: 'read', masters: 'read' } },
  finance: { name: 'Finance', perms: { finance: 'write', projects: 'write', purchasing: 'write', b2b: 'read', b2c: 'read', inventory: 'read', logistics: 'read', masters: 'read' } },
  marketing: { name: 'Marketing', perms: { marketing: 'write', projects: 'write', b2c: 'read' } },
  design: { name: 'Design', perms: { design: 'write', projects: 'write', purchasing: 'write', masters: 'read', production: 'read' } },
  hr_admin: { name: 'HR admin', perms: { hr: 'admin', projects: 'write' } },
  staff: { name: 'Staff (self-service only)', perms: {} },
};

/** Effective level a user holds on a module: role level, raised by any extra grants on the user. */
export function levelOf(user, module) {
  if (!user) return 'none';
  const base = ROLES[user.role]?.perms[module] || 'none';
  const extra = (user.extra || []).includes(module) ? 'write' : 'none';
  return LEVELS.indexOf(extra) > LEVELS.indexOf(base) ? extra : base;
}
export const can = (user, module, level = 'read') => LEVELS.indexOf(levelOf(user, module)) >= LEVELS.indexOf(level);

// ───────── Entities ─────────
// Field: [key, label, type, options]. Types: text, long, number, money, date, datetime, bool,
// select (opts.options), ref (opts.ref = entity id), refs (many), user, lines (opts.cols), status.
// opts: req, list (show in table), ro (set by the system, not typed), secret (admin level only), def (default), hint.
const S = (...pairs) => Object.fromEntries(pairs.map(([id, name, tone = 'plain']) => [id, { name, tone }]));
const opt = (...v) => v.map((x) => (Array.isArray(x) ? x : [x, x]));

export const ENTITIES = [
  // ── Masters ──
  { id: 'items', module: 'masters', name: 'Materials', one: 'Material', title: 'name',
    info: 'Everything that is bought and stocked: fabric types, thread by shade, trims, tools and consumables. On hand is kept by stock movements, never typed.',
    fields: [['code', 'Code', 'text', { req: true, list: true }], ['name', 'Name', 'text', { req: true, list: true }],
      ['kind', 'Kind', 'select', { req: true, list: true, options: opt(['fabric', 'Fabric'], ['thread', 'Thread'], ['trim', 'Trim'], ['tool', 'Tool'], ['consumable', 'Consumable']) }],
      ['unit', 'Unit', 'select', { req: true, list: true, options: opt('m', 'cones', 'pcs', 'boxes', 'pairs', 'kg') }], ['shade', 'Shade', 'text', { list: true }],
      ['cost', 'Cost per unit', 'money', {}], ['dyeCost', 'Dyeing cost per metre', 'money', { hint: 'Fabric only' }], ['minLevel', 'Minimum level', 'number', { list: true }],
      ['onHand', 'On hand', 'number', { ro: true, list: true }], ['location', 'Kept at', 'text', {}]] },
  { id: 'styles', module: 'masters', name: 'Styles', one: 'Style', title: 'name',
    info: 'Each garment Deme makes. Standard minutes per piece at each stage drive the production plan, and the fabric and thread per piece drive material checks. Bundle scans show how far real minutes are from these.',
    fields: [['code', 'Style code', 'text', { req: true, list: true }], ['name', 'Name', 'text', { req: true, list: true }], ['collection', 'Collection', 'ref', { ref: 'collections' }],
      ['fabric', 'Main fabric', 'ref', { ref: 'items', list: true }], ['shade', 'Shade', 'text', { list: true }], ['metres', 'Fabric per piece (m)', 'number', {}], ['cones', 'Thread cones per 100 pieces', 'number', {}],
      ['smvCut', 'Cutting minutes', 'number', { req: true }], ['smvStitch', 'Stitching minutes', 'number', { req: true, list: true }], ['smvFinish', 'Finishing minutes', 'number', { req: true }], ['smvQc', 'QC minutes', 'number', { req: true }], ['smvPack', 'Packing minutes', 'number', { req: true }],
      ['wholesale', 'Wholesale price', 'money', {}], ['retail', 'Retail price', 'money', { list: true }],
      ['bom', 'Bill of materials', 'lines', { cols: [['item', 'Material', 'ref', { ref: 'items' }], ['qty', 'Per piece', 'number', {}]] }],
      ['status', 'Status', 'select', { def: 'active', list: true, options: opt(['development', 'In development'], ['active', 'Active'], ['discontinued', 'Discontinued']) }]] },
  { id: 'suppliers', module: 'masters', name: 'Suppliers', one: 'Supplier', title: 'name',
    info: 'Mills, dyers, trim vendors and couriers. The ledger name must match the name in Tally exactly for vouchers to import.',
    fields: [['name', 'Name', 'text', { req: true, list: true }], ['kind', 'Kind', 'select', { req: true, list: true, options: opt(['mill', 'Fabric mill'], ['dyer', 'Dye house'], ['trims', 'Thread and trims'], ['courier', 'Courier'], ['other', 'Other']) }],
      ['contact', 'Contact person', 'text', { list: true }], ['phone', 'Phone', 'text', {}], ['email', 'Email', 'text', {}], ['gstin', 'GSTIN', 'text', {}], ['terms', 'Payment terms (days)', 'number', { def: 30 }], ['ledger', 'Tally ledger name', 'text', {}]] },
  { id: 'customers', module: 'masters', name: 'Customers', one: 'Customer', title: 'name',
    info: 'Wholesale accounts and Deme\'s own store. Online shoppers are not kept here; they stay on the Shopify order.',
    fields: [['name', 'Name', 'text', { req: true, list: true }], ['kind', 'Kind', 'select', { req: true, list: true, options: opt(['b2b', 'B2B account'], ['store', 'Own store'], ['other', 'Other']) }],
      ['country', 'Country', 'text', { list: true }], ['currency', 'Currency', 'select', { def: 'INR', list: true, options: opt('INR', 'USD', 'GBP', 'EUR', 'AED', 'AUD') }], ['contact', 'Contact person', 'text', {}], ['email', 'Email', 'text', {}], ['terms', 'Payment terms (days)', 'number', { def: 30 }], ['ledger', 'Tally ledger name', 'text', {}]] },
  { id: 'work_centres', module: 'masters', name: 'Work centres', one: 'Work centre', title: 'name',
    info: 'The teams work flows through. People × shift minutes × efficiency gives the standard minutes a work centre can produce in a day, which is what the production plan schedules against.',
    fields: [['name', 'Name', 'text', { req: true, list: true }], ['stage', 'Stage', 'select', { req: true, list: true, options: STAGES.map((s) => [s, STAGE_NAMES[s]]) }],
      ['line', 'Line', 'select', { def: 'shared', list: true, hint: 'Stitching only', options: opt(['b2b', 'B2B line'], ['d2c', 'D2C line'], ['sample', 'Sampling room'], ['shared', 'Shared']) }],
      ['people', 'People', 'number', { req: true, list: true }], ['shiftMinutes', 'Shift minutes', 'number', { def: 480 }], ['efficiency', 'Efficiency (0 to 1)', 'number', { def: 0.7, list: true }]] },
  { id: 'machines', module: 'masters', name: 'Machines', one: 'Machine', title: 'code',
    fields: [['code', 'Machine code', 'text', { req: true, list: true }], ['type', 'Type', 'text', { list: true }], ['workCentre', 'Work centre', 'ref', { ref: 'work_centres', list: true }],
      ['status', 'Status', 'select', { def: 'running', list: true, options: opt(['running', 'Running'], ['down', 'Down'], ['service', 'In service']) }], ['lastService', 'Last service', 'date', {}], ['notes', 'Notes', 'long', {}]] },

  // ── Purchasing ──
  { id: 'purchase_orders', module: 'purchasing', name: 'Purchase orders', one: 'Purchase order', no: 'PO', title: 'no',
    info: 'A purchase order is drafted by any team with PO access and approved by an admin before it is sent. Receipts are booked against it.',
    statuses: S(['draft', 'Draft'], ['approved', 'Approved', 'info'], ['sent', 'Sent', 'info'], ['part_received', 'Part received', 'warn'], ['received', 'Received', 'ok'], ['cancelled', 'Cancelled', 'crit']),
    fields: [['supplier', 'Supplier', 'ref', { ref: 'suppliers', req: true, list: true }], ['date', 'Date', 'date', { def: 'today', list: true }], ['needBy', 'Needed by', 'date', { list: true }],
      ['lines', 'Lines', 'lines', { req: true, cols: [['item', 'Material', 'ref', { ref: 'items' }], ['qty', 'Quantity', 'number', {}], ['rate', 'Rate', 'money', {}]] }],
      ['total', 'Total', 'money', { ro: true, list: true }], ['notes', 'Notes', 'long', {}], ['requestedBy', 'Raised by', 'user', { ro: true }]],
    actions: [{ id: 'po.approve', label: 'Approve', when: ['draft'], level: 'admin' }, { id: 'po.send', label: 'Mark as sent', when: ['approved'] }, { id: 'po.cancel', label: 'Cancel', when: ['draft', 'approved', 'sent'], level: 'admin' }] },
  { id: 'goods_receipts', module: 'purchasing', name: 'Goods receipts', one: 'Goods receipt', no: 'GRN', title: 'no',
    info: 'Record what actually arrived. For fabric, give the number of rolls and the metres on each. Posting creates the rolls for inspection, adds other materials to stock, opens the supplier bill and writes the purchase voucher.',
    statuses: S(['draft', 'Draft'], ['posted', 'Posted', 'ok']),
    fields: [['po', 'Purchase order', 'ref', { ref: 'purchase_orders', list: true }], ['supplier', 'Supplier', 'ref', { ref: 'suppliers', req: true, list: true }], ['date', 'Received on', 'date', { def: 'today', list: true }], ['invoiceNo', 'Supplier invoice no.', 'text', {}],
      ['lines', 'Lines', 'lines', { req: true, cols: [['item', 'Material', 'ref', { ref: 'items' }], ['qty', 'Quantity', 'number', {}], ['rolls', 'Rolls (fabric)', 'number', {}], ['rate', 'Rate', 'money', {}]] }],
      ['total', 'Total', 'money', { ro: true, list: true }]],
    actions: [{ id: 'grn.post', label: 'Post receipt', when: ['draft'] }] },

  // ── Inventory ──
  { id: 'rolls', module: 'inventory', name: 'Fabric rolls', one: 'Fabric roll', no: 'R', title: 'no',
    info: 'One record per roll, from the dock to the cutting table. Rolls that were never checked can be added here as an opening audit; they then go through inspection like any new roll.',
    statuses: S(['received', 'Awaiting inspection', 'warn'], ['passed', 'Passed', 'ok'], ['rejected', 'Rejected', 'crit'], ['returned', 'Returned to mill'], ['at_dyer', 'At the dyer', 'info'], ['dyed', 'Dyed, in store', 'ok'], ['dye_reject', 'Failed after dyeing', 'crit'], ['issued', 'Issued to cutting']),
    initial: 'received',
    fields: [['item', 'Fabric', 'ref', { ref: 'items', req: true, list: true }], ['supplier', 'Supplier', 'ref', { ref: 'suppliers', list: true }], ['metres', 'Metres', 'number', { req: true, list: true }], ['shade', 'Shade', 'text', { list: true }],
      ['location', 'Location', 'text', { list: true }], ['receivedOn', 'Received on', 'date', { def: 'today' }], ['grn', 'Goods receipt', 'ref', { ref: 'goods_receipts', ro: true }], ['points', 'Inspection points', 'number', { ro: true }], ['defects', 'Defects', 'text', { ro: true }],
      ['dyeLot', 'Dye lot', 'ref', { ref: 'dye_lots', ro: true }], ['reservedFor', 'Reserved for', 'ref', { ref: 'work_orders', list: true }]],
    actions: [{ id: 'roll.inspect', label: 'Inspect', when: ['received'], module: 'quality', form: [['points', 'Penalty points per 100 sq yd', 'number', { req: true }], ['defects', 'Defects seen', 'text', {}]] },
      { id: 'roll.return', label: 'Return to mill', when: ['rejected'] }, { id: 'roll.issue', label: 'Issue to cutting', when: ['dyed', 'passed'], form: [['workOrder', 'Work order', 'ref', { ref: 'work_orders', req: true }]] }] },
  { id: 'stock_moves', module: 'inventory', name: 'Stock movements', one: 'Stock movement', title: 'ref', readonly: true,
    info: 'The trail behind every quantity. Receipts, issues to the floor and corrections all appear here. To correct a count, use Adjust stock on the material.',
    fields: [['date', 'Date', 'date', { list: true }], ['item', 'Material', 'ref', { ref: 'items', list: true }], ['qty', 'Quantity', 'number', { list: true }],
      ['reason', 'Reason', 'select', { list: true, options: opt(['receipt', 'Receipt'], ['issue', 'Issue'], ['adjust', 'Adjustment'], ['count', 'Stock count'], ['opening', 'Opening stock']) }], ['ref', 'Reference', 'text', { list: true }], ['note', 'Note', 'text', {}]] },
  { id: 'stock_counts', module: 'inventory', name: 'Stock counts', one: 'Stock count', no: 'CNT', title: 'no',
    info: 'A physical count of an area. Posting it moves the system quantity to the counted quantity and records the difference.',
    statuses: S(['draft', 'Draft'], ['posted', 'Posted', 'ok']),
    fields: [['date', 'Date', 'date', { def: 'today', list: true }], ['area', 'Area', 'text', { req: true, list: true }], ['lines', 'Counted', 'lines', { req: true, cols: [['item', 'Material', 'ref', { ref: 'items' }], ['counted', 'Counted quantity', 'number', {}]] }], ['notes', 'Notes', 'long', {}]],
    actions: [{ id: 'count.post', label: 'Post count', when: ['draft'] }] },

  // ── Quality ──
  { id: 'inspections', module: 'quality', name: 'Fabric inspections', one: 'Fabric inspection', title: 'roll', readonly: true,
    info: 'Each roll is scored on the 4-point system: penalty points per 100 square yards. 40 or under passes. A fail before dyeing goes back to the mill with a debit note.',
    fields: [['date', 'Date', 'date', { list: true }], ['roll', 'Roll', 'ref', { ref: 'rolls', list: true }], ['points', 'Points', 'number', { list: true }], ['result', 'Result', 'select', { list: true, options: opt(['pass', 'Pass'], ['fail', 'Fail']) }], ['defects', 'Defects', 'text', { list: true }], ['inspector', 'Inspector', 'user', { list: true }]] },
  { id: 'dye_lots', module: 'quality', name: 'Dye lots', one: 'Dye lot', no: 'DL', title: 'no',
    info: 'A batch of passed rolls sent to the dye house in one shade. Only inspected rolls can be added. On return, each roll is accepted or failed on shade; the dyer is billed for accepted metres only.',
    statuses: S(['draft', 'Draft'], ['at_dyer', 'At the dyer', 'info'], ['received', 'Received', 'ok']),
    fields: [['dyer', 'Dye house', 'ref', { ref: 'suppliers', req: true, list: true }], ['shade', 'Shade', 'text', { req: true, list: true }], ['rolls', 'Rolls', 'refs', { ref: 'rolls', req: true, filter: { status: 'passed' } }],
      ['sentOn', 'Sent on', 'date', { ro: true, list: true }], ['dueBack', 'Due back', 'date', { list: true }], ['receivedOn', 'Received on', 'date', { ro: true }], ['acceptedMetres', 'Accepted metres', 'number', { ro: true, list: true }], ['failedMetres', 'Failed metres', 'number', { ro: true }]],
    actions: [{ id: 'dye.send', label: 'Send to dyer', when: ['draft'] }, { id: 'dye.receive', label: 'Receive and check shade', when: ['at_dyer'], form: [['failed', 'Rolls that failed', 'refs', { ref: 'rolls', scope: 'lot' }], ['note', 'What was wrong', 'text', {}]] }] },
  { id: 'qc_checks', module: 'quality', name: 'Garment checks', one: 'Garment check', title: 'workOrder',
    info: 'In-line and final checks against a work order: how many were checked, passed, sent for rework or rejected, and why.',
    fields: [['date', 'Date', 'date', { def: 'today', list: true }], ['workOrder', 'Work order', 'ref', { ref: 'work_orders', req: true, list: true }], ['stage', 'Check', 'select', { req: true, list: true, options: opt(['inline', 'In-line'], ['final', 'Final']) }],
      ['checked', 'Checked', 'number', { req: true, list: true }], ['passed', 'Passed', 'number', { req: true, list: true }], ['rework', 'Rework', 'number', { list: true }], ['rejected', 'Rejected', 'number', { list: true }], ['defects', 'Defects', 'long', {}], ['checker', 'Checked by', 'user', { ro: true }]] },

  // ── Production ──
  { id: 'work_orders', module: 'production', name: 'Work orders', one: 'Work order', no: 'WO', title: 'no',
    info: 'One style, one quantity, one due date. Progress is recorded per stage; a stage can never be ahead of the one before it. Work orders are raised from sales orders, Shopify lots, store orders or sample requests.',
    statuses: S(['planned', 'Planned'], ['released', 'Released', 'info'], ['in_progress', 'In progress', 'info'], ['done', 'Done', 'ok'], ['hold', 'On hold', 'warn']), initial: 'planned',
    fields: [['channel', 'For', 'select', { req: true, list: true, options: opt(['B2B', 'B2B'], ['D2C', 'Shopify'], ['STORE', 'Store'], ['SAMPLE', 'Sample']) }], ['customer', 'Customer', 'ref', { ref: 'customers', list: true }], ['style', 'Style', 'ref', { ref: 'styles', req: true, list: true }],
      ['qty', 'Pieces', 'number', { req: true, list: true }], ['due', 'Due', 'date', { req: true, list: true }], ['source', 'Raised from', 'text', { ro: true }],
      ['cut', 'Cut', 'number', { ro: true }], ['stitch', 'Stitched', 'number', { ro: true }], ['finish', 'Finished', 'number', { ro: true }], ['qc', 'Passed QC', 'number', { ro: true }], ['pack', 'Packed', 'number', { ro: true, list: true }], ['notes', 'Notes', 'long', {}]],
    actions: [{ id: 'wo.release', label: 'Release to floor', when: ['planned', 'hold'] }, { id: 'wo.hold', label: 'Put on hold', when: ['released', 'in_progress'] },
      { id: 'wo.output', label: 'Record output', when: ['released', 'in_progress'], form: [['stage', 'Stage', 'select', { req: true, options: STAGES.map((s) => [s, STAGE_NAMES[s]]) }], ['pieces', 'Pieces finished', 'number', { req: true }]] },
      { id: 'wo.bundles', label: 'Make bundles', when: ['released', 'in_progress'], form: [['count', 'Number of bundles', 'number', { req: true }], ['pieces', 'Pieces in each', 'number', { req: true }]] }] },
  { id: 'bundles', module: 'production', name: 'Bundles', one: 'Bundle', no: 'B', title: 'no', readonly: true,
    info: 'A tagged stack of cut pieces. The tag is scanned when a tailor starts it and again when it is finished, which is where minutes per piece come from.',
    statuses: S(['cut', 'Cut, waiting'], ['stitching', 'Being stitched', 'info'], ['stitched', 'Stitched', 'ok']), initial: 'cut',
    fields: [['workOrder', 'Work order', 'ref', { ref: 'work_orders', list: true }], ['pieces', 'Pieces', 'number', { list: true }], ['station', 'Station', 'text', { list: true }], ['operator', 'Tailor', 'user', { list: true }]] },
  { id: 'scans', module: 'production', name: 'Bundle scans', one: 'Bundle scan', title: 'bundle', readonly: true,
    info: 'Start and finish times for each bundle at a station. Minutes per piece here, set against the standard on the style, show which styles and stations run slow.',
    fields: [['bundle', 'Bundle', 'ref', { ref: 'bundles', list: true }], ['workOrder', 'Work order', 'ref', { ref: 'work_orders', list: true }], ['style', 'Style', 'ref', { ref: 'styles', list: true }], ['station', 'Station', 'text', { list: true }], ['operator', 'Tailor', 'user', { list: true }],
      ['startedAt', 'Started', 'datetime', { list: true }], ['finishedAt', 'Finished', 'datetime', {}], ['pieces', 'Pieces', 'number', {}], ['minutes', 'Minutes', 'number', { list: true }]] },
  { id: 'sample_requests', module: 'production', name: 'Sample requests', one: 'Sample request', no: 'SMP', title: 'no', alsoWrite: ['design', 'b2b'],
    info: 'Merchandising and design ask for samples here. Approving a request raises a sample work order, so it competes for capacity in the open and its effect can be tested in the Production room first.',
    statuses: S(['requested', 'Requested', 'warn'], ['approved', 'Approved', 'info'], ['declined', 'Declined', 'crit'], ['done', 'Done', 'ok']), initial: 'requested',
    fields: [['collection', 'Collection', 'ref', { ref: 'collections', list: true }], ['style', 'Closest existing style', 'ref', { ref: 'styles', req: true, list: true }], ['qty', 'Samples', 'number', { req: true, list: true }], ['neededBy', 'Needed by', 'date', { req: true, list: true }], ['notes', 'Notes', 'long', {}], ['requestedBy', 'Requested by', 'user', { ro: true, list: true }]],
    actions: [{ id: 'sample.approve', label: 'Approve and raise work order', when: ['requested'], level: 'write', module: 'production' }, { id: 'sample.decline', label: 'Decline', when: ['requested'], module: 'production' }] },
  { id: 'maintenance', module: 'production', name: 'Machine upkeep', one: 'Upkeep entry', title: 'machine',
    info: 'Breakdowns and services per machine. An open breakdown marks the machine as down.',
    statuses: S(['open', 'Open', 'warn'], ['closed', 'Closed', 'ok']), initial: 'open',
    fields: [['date', 'Date', 'date', { def: 'today', list: true }], ['machine', 'Machine', 'ref', { ref: 'machines', req: true, list: true }], ['type', 'Type', 'select', { req: true, list: true, options: opt(['breakdown', 'Breakdown'], ['service', 'Planned service']) }], ['notes', 'What happened', 'long', {}]],
    actions: [{ id: 'maint.close', label: 'Close', when: ['open'] }] },

  // ── B2B ──
  { id: 'sales_orders', module: 'b2b', name: 'Sales orders', one: 'Sales order', no: 'SO', title: 'no',
    info: 'A wholesale customer\'s purchase order. Confirming it raises one work order per line with the ship-by date as the due date.',
    statuses: S(['draft', 'Draft'], ['confirmed', 'Confirmed', 'info'], ['shipped', 'Shipped', 'ok'], ['invoiced', 'Invoiced', 'ok'], ['cancelled', 'Cancelled', 'crit']),
    fields: [['customer', 'Customer', 'ref', { ref: 'customers', req: true, list: true }], ['customerPO', 'Customer PO no.', 'text', { list: true }], ['date', 'Order date', 'date', { def: 'today' }], ['shipBy', 'Ship by', 'date', { req: true, list: true }], ['currency', 'Currency', 'select', { def: 'USD', options: opt('INR', 'USD', 'GBP', 'EUR', 'AED', 'AUD') }],
      ['lines', 'Lines', 'lines', { req: true, cols: [['style', 'Style', 'ref', { ref: 'styles' }], ['qty', 'Pieces', 'number', {}], ['price', 'Price', 'money', {}]] }], ['total', 'Total', 'money', { ro: true, list: true }], ['notes', 'Notes', 'long', {}]],
    actions: [{ id: 'so.confirm', label: 'Confirm and raise work orders', when: ['draft'] }, { id: 'so.invoice', label: 'Raise invoice', when: ['confirmed', 'shipped'] }, { id: 'so.cancel', label: 'Cancel', when: ['draft', 'confirmed'], level: 'admin' }] },
  { id: 'invoices', module: 'b2b', name: 'Invoices', one: 'Invoice', no: 'INV', title: 'no',
    info: 'Posting an invoice writes the sales voucher in rupees at the exchange rate given and opens the receivable. Recording a payment writes the receipt.',
    statuses: S(['draft', 'Draft'], ['posted', 'Posted', 'info'], ['paid', 'Paid', 'ok']),
    fields: [['customer', 'Customer', 'ref', { ref: 'customers', req: true, list: true }], ['salesOrder', 'Sales order', 'ref', { ref: 'sales_orders', list: true }], ['date', 'Date', 'date', { def: 'today', list: true }], ['dueDate', 'Due', 'date', { list: true }],
      ['currency', 'Currency', 'select', { def: 'USD', options: opt('INR', 'USD', 'GBP', 'EUR', 'AED', 'AUD') }], ['fx', 'Rupees per unit of currency', 'number', { def: 1 }],
      ['lines', 'Lines', 'lines', { req: true, cols: [['style', 'Style', 'ref', { ref: 'styles' }], ['qty', 'Pieces', 'number', {}], ['price', 'Price', 'money', {}]] }], ['total', 'Total', 'money', { ro: true, list: true }], ['received', 'Received', 'money', { ro: true }]],
    actions: [{ id: 'inv.post', label: 'Post invoice', when: ['draft'] }, { id: 'inv.receive', label: 'Record payment', when: ['posted'], module: 'finance', form: [['amount', 'Amount received (invoice currency)', 'money', { req: true }], ['bank', 'Into bank ledger', 'ref', { ref: 'ledgers' }]] }] },

  // ── B2C ──
  { id: 'shop_orders', module: 'b2c', name: 'Shopify orders', one: 'Shopify order', title: 'orderNo',
    info: 'Online orders. Import the Shopify orders export as a CSV, or add one by hand. Shipping is recorded at the scan gate in Logistics, which also books the sale.',
    statuses: S(['new', 'New', 'warn'], ['in_production', 'In production', 'info'], ['packed', 'Packed', 'info'], ['shipped', 'Shipped', 'ok'], ['delivered', 'Delivered', 'ok'], ['returned', 'Returned', 'crit'], ['cancelled', 'Cancelled', 'crit']), initial: 'new',
    fields: [['orderNo', 'Order no.', 'text', { req: true, list: true }], ['date', 'Date', 'date', { def: 'today', list: true }], ['customerName', 'Customer', 'text', { list: true }], ['country', 'Ships to', 'text', { list: true }],
      ['style', 'Style', 'ref', { ref: 'styles', req: true, list: true }], ['size', 'Size', 'text', {}], ['qty', 'Pieces', 'number', { def: 1 }], ['amount', 'Amount', 'money', { list: true }], ['awb', 'Tracking no.', 'text', {}]],
    actions: [{ id: 'shop.pack', label: 'Pack and create parcel', when: ['new', 'in_production'], form: [['awb', 'Tracking barcode on the label', 'text', { req: true }], ['carrier', 'Carrier', 'ref', { ref: 'suppliers' }]] }, { id: 'shop.cancel', label: 'Cancel', when: ['new', 'in_production'] }] },
  { id: 'store_orders', module: 'b2c', name: 'Store orders', one: 'Store order', no: 'ST', title: 'no',
    info: 'Orders and alterations from Deme\'s own store. Each time a piece comes back for fit, it is scanned in at the gate and the visit is counted on the order.',
    statuses: S(['open', 'Open', 'info'], ['at_factory', 'At the factory', 'warn'], ['at_store', 'At the store', 'ok'], ['closed', 'Closed']), initial: 'open',
    fields: [['date', 'Date', 'date', { def: 'today', list: true }], ['customerName', 'Customer', 'text', { list: true }], ['style', 'Style', 'ref', { ref: 'styles', req: true, list: true }], ['size', 'Size', 'text', {}], ['amount', 'Amount', 'money', {}], ['tag', 'Piece tag (barcode)', 'text', { req: true, list: true }],
      ['visits', 'Fit visits', 'number', { ro: true, list: true }], ['notes', 'Notes', 'long', {}]],
    actions: [{ id: 'store.close', label: 'Close', when: ['at_store', 'open'] }] },
  { id: 'fit_visits', module: 'b2c', name: 'Fit visits', one: 'Fit visit', title: 'storeOrder', readonly: true,
    info: 'One line for each trip a store piece makes to the factory: when it arrived, what was asked for, how long the work took and when it left.',
    fields: [['storeOrder', 'Store order', 'ref', { ref: 'store_orders', list: true }], ['visitNo', 'Visit', 'number', { list: true }], ['inAt', 'Arrived', 'datetime', { list: true }], ['note', 'Asked for', 'text', { list: true }], ['workMinutes', 'Work minutes', 'number', { list: true }], ['outAt', 'Left', 'datetime', { list: true }]] },
  { id: 'returns', module: 'b2c', name: 'Returns', one: 'Return', no: 'RET', title: 'no',
    statuses: S(['expected', 'Expected', 'warn'], ['received', 'Received', 'info'], ['restocked', 'Restocked', 'ok'], ['written_off', 'Written off', 'crit']), initial: 'expected',
    fields: [['date', 'Date', 'date', { def: 'today', list: true }], ['order', 'Shopify order', 'ref', { ref: 'shop_orders', req: true, list: true }], ['reason', 'Reason', 'select', { list: true, options: opt('Size', 'Fit', 'Quality', 'Changed mind', 'Damaged in transit', 'Other') }], ['condition', 'Condition on arrival', 'text', {}], ['refund', 'Refund', 'money', { list: true }]],
    actions: [{ id: 'ret.restock', label: 'Restock', when: ['received'] }, { id: 'ret.writeoff', label: 'Write off', when: ['received'] }] },

  // ── Logistics ──
  { id: 'parcels', module: 'logistics', name: 'Parcels', one: 'Parcel', no: 'PCL', title: 'no', alsoWrite: ['b2c', 'b2b'],
    info: 'Anything that leaves or comes back: Shopify parcels, export cartons, store pieces. The barcode is the courier\'s tracking barcode on the label, or Deme\'s own tag for store pieces. Scan at the gate to move it.',
    statuses: S(['packed', 'Packed, not scanned', 'warn'], ['in_transit', 'In transit', 'info'], ['delivered', 'Delivered', 'ok'], ['returning', 'Coming back', 'warn'], ['at_factory', 'At the factory', 'info'], ['at_store', 'At the store', 'ok']), initial: 'packed',
    fields: [['kind', 'Kind', 'select', { req: true, list: true, options: opt(['shopify', 'Shopify parcel'], ['b2b', 'B2B cartons'], ['store', 'Store piece']) }], ['ref', 'Order', 'text', { req: true, list: true }], ['barcode', 'Barcode', 'text', { req: true, list: true }], ['carrier', 'Carrier', 'ref', { ref: 'suppliers', list: true }],
      ['dest', 'Going to', 'text', { list: true }], ['cartons', 'Cartons', 'number', { def: 1 }], ['weight', 'Weight (kg)', 'number', {}], ['events', 'Trail', 'lines', { ro: true, cols: [['at', 'When', 'datetime', {}], ['type', 'Type', 'text', {}], ['text', 'What', 'text', {}]] }]],
    actions: [{ id: 'parcel.delivered', label: 'Mark delivered', when: ['in_transit'] }, { id: 'parcel.track', label: 'Add tracking update', when: ['in_transit', 'returning'], form: [['text', 'Update', 'text', { req: true }]] }] },
  { id: 'courier_invoices', module: 'logistics', name: 'Courier invoices', one: 'Courier invoice', title: 'invoiceNo', editWhen: ['draft', 'disputed'],
    info: 'Enter each line of a courier\'s invoice with its tracking number. Matching checks every line against a parcel that was really scanned out, and flags lines with no parcel or billed twice. Approving it opens the bill and writes the freight voucher.',
    statuses: S(['draft', 'Draft'], ['matched', 'Matched', 'ok'], ['disputed', 'Has mismatches', 'crit'], ['approved', 'Approved', 'ok']),
    fields: [['carrier', 'Courier', 'ref', { ref: 'suppliers', req: true, list: true }], ['invoiceNo', 'Invoice no.', 'text', { req: true, list: true }], ['date', 'Date', 'date', { def: 'today', list: true }],
      ['lines', 'Lines', 'lines', { req: true, cols: [['awb', 'Tracking no.', 'text', {}], ['billed', 'Billed', 'money', {}], ['match', 'Match', 'text', { ro: true }]] }], ['total', 'Total', 'money', { ro: true, list: true }]],
    actions: [{ id: 'courier.match', label: 'Match against parcels', when: ['draft', 'disputed'] }, { id: 'courier.approve', label: 'Approve for payment', when: ['matched'], level: 'write' }] },

  // ── Finance ──
  { id: 'ledgers', module: 'finance', name: 'Ledgers', one: 'Ledger', title: 'name',
    info: 'The chart of accounts. Names must match Tally exactly. A starter set is created at setup; rename it to match your books before the first export.',
    fields: [['name', 'Name', 'text', { req: true, list: true }], ['group', 'Group', 'select', { req: true, list: true, options: opt('Bank Accounts', 'Sundry Creditors', 'Sundry Debtors', 'Purchase Accounts', 'Sales Accounts', 'Direct Expenses', 'Indirect Expenses', 'Current Assets', 'Current Liabilities', 'Stock-in-Hand') }], ['opening', 'Opening balance', 'money', {}]] },
  { id: 'vouchers', module: 'finance', name: 'Vouchers', one: 'Voucher', no: 'V', title: 'no',
    info: 'Every accounting entry, in Tally\'s own voucher types. Most are written automatically with a link to the receipt, lot, invoice or parcel behind them. Select vouchers and export them as Tally import XML.',
    statuses: S(['open', 'Not in Tally', 'warn'], ['synced', 'In Tally', 'ok']), initial: 'open',
    fields: [['date', 'Date', 'date', { def: 'today', req: true, list: true }], ['type', 'Type', 'select', { req: true, list: true, options: opt('Purchase', 'Sales', 'Receipt', 'Payment', 'Journal', 'Debit Note', 'Credit Note') }], ['party', 'Party', 'text', { list: true }],
      ['dr', 'Debit ledger', 'text', { req: true, list: true }], ['cr', 'Credit ledger', 'text', { req: true, list: true }], ['amount', 'Amount (₹)', 'money', { req: true, list: true }], ['narration', 'Narration', 'long', {}], ['ref', 'Source', 'text', { list: true }]],
    actions: [{ id: 'voucher.synced', label: 'Mark as in Tally', when: ['open'] }] },
  { id: 'bills', module: 'finance', name: 'Supplier bills', one: 'Supplier bill', no: 'BILL', title: 'no',
    info: 'What Deme owes. Bills open themselves when a receipt is posted, a dye lot is received or a courier invoice is approved. Paying one writes the payment voucher.',
    statuses: S(['unpaid', 'Unpaid', 'warn'], ['part_paid', 'Part paid', 'warn'], ['paid', 'Paid', 'ok']), initial: 'unpaid',
    fields: [['supplier', 'Supplier', 'ref', { ref: 'suppliers', req: true, list: true }], ['date', 'Date', 'date', { def: 'today', list: true }], ['due', 'Due', 'date', { list: true }], ['ref', 'For', 'text', { list: true }], ['amount', 'Amount', 'money', { req: true, list: true }], ['paid', 'Paid', 'money', { ro: true, list: true }]],
    actions: [{ id: 'bill.pay', label: 'Record payment', when: ['unpaid', 'part_paid'], form: [['amount', 'Amount paid', 'money', { req: true }], ['bank', 'From bank ledger', 'ref', { ref: 'ledgers' }]] }] },

  // ── People ──
  { id: 'employees', module: 'hr', name: 'Employees', one: 'Employee', title: 'name',
    info: 'One record per person. Link a login so they can check in, apply for leave and see their KRAs. Salary is visible to HR admins only.',
    fields: [['code', 'Employee code', 'text', { list: true }], ['name', 'Name', 'text', { req: true, list: true }], ['department', 'Department', 'select', { list: true, options: opt('Production', 'Quality', 'Logistics', 'Merchandising', 'Sales', 'Finance', 'Marketing', 'Design', 'HR', 'Administration', 'Management') }],
      ['designation', 'Designation', 'text', { list: true }], ['joinDate', 'Joined', 'date', {}], ['phone', 'Phone', 'text', {}], ['login', 'Login', 'user', { list: true }], ['salary', 'Monthly salary', 'money', { secret: true }],
      ['status', 'Status', 'select', { def: 'active', list: true, options: opt(['active', 'Active'], ['left', 'Left']) }]] },
  { id: 'attendance', module: 'hr', name: 'Attendance', one: 'Attendance entry', title: 'date',
    info: 'One line per person per day. People check themselves in and out from My day; HR can correct an entry here.',
    fields: [['date', 'Date', 'date', { def: 'today', req: true, list: true }], ['employee', 'Employee', 'ref', { ref: 'employees', req: true, list: true }], ['inAt', 'In', 'datetime', { list: true }], ['outAt', 'Out', 'datetime', { list: true }],
      ['status', 'Day', 'select', { def: 'present', list: true, options: opt(['present', 'Present'], ['half', 'Half day'], ['leave', 'On leave'], ['absent', 'Absent']) }]] },
  { id: 'leaves', module: 'hr', name: 'Leave', one: 'Leave request', title: 'employee',
    statuses: S(['applied', 'Applied', 'warn'], ['approved', 'Approved', 'ok'], ['rejected', 'Rejected', 'crit']), initial: 'applied',
    info: 'Leave is applied for from My day and approved here.',
    fields: [['employee', 'Employee', 'ref', { ref: 'employees', req: true, list: true }], ['from', 'From', 'date', { req: true, list: true }], ['to', 'To', 'date', { req: true, list: true }], ['type', 'Type', 'select', { list: true, options: opt('Casual', 'Sick', 'Earned', 'Unpaid') }], ['reason', 'Reason', 'long', {}]],
    actions: [{ id: 'leave.approve', label: 'Approve', when: ['applied'], level: 'admin' }, { id: 'leave.reject', label: 'Reject', when: ['applied'], level: 'admin' }] },
  { id: 'kras', module: 'hr', name: 'KRAs', one: 'KRA', title: 'title',
    info: 'Key result areas per person and period, with a target, a weight and a score. People see their own from My day.',
    fields: [['employee', 'Employee', 'ref', { ref: 'employees', req: true, list: true }], ['period', 'Period', 'text', { req: true, list: true }], ['title', 'KRA', 'text', { req: true, list: true }], ['target', 'Target', 'text', {}], ['weight', 'Weight %', 'number', { list: true }], ['score', 'Score', 'number', { list: true }]] },
  { id: 'payroll_runs', module: 'hr', name: 'Payroll', one: 'Payroll run', title: 'month', level: 'admin',
    info: 'Builds a month\'s pay from salaries and attendance: days present over working days in the month. Posting writes the salary journal. Statutory deductions are not calculated here yet.',
    statuses: S(['draft', 'Draft'], ['posted', 'Posted', 'ok']),
    fields: [['month', 'Month (YYYY-MM)', 'text', { req: true, list: true }], ['lines', 'Pay lines', 'lines', { ro: true, cols: [['employee', 'Employee', 'ref', { ref: 'employees' }], ['days', 'Days paid', 'number', {}], ['gross', 'Gross', 'money', {}]] }], ['total', 'Total', 'money', { ro: true, list: true }]],
    actions: [{ id: 'payroll.build', label: 'Build from attendance', when: ['draft'], level: 'admin' }, { id: 'payroll.post', label: 'Post payroll', when: ['draft'], level: 'admin' }] },

  // ── Projects ──
  { id: 'projects', module: 'projects', name: 'Projects', one: 'Project', title: 'name',
    info: 'A project groups tasks toward one outcome. The go-live plan is a project created from a ready-made set of tasks.',
    statuses: S(['active', 'Active', 'info'], ['done', 'Done', 'ok'], ['paused', 'Paused', 'warn']), initial: 'active', editWhen: ['active', 'paused', 'done'],
    fields: [['name', 'Name', 'text', { req: true, list: true }], ['owner', 'Owner', 'user', { list: true }], ['start', 'Start', 'date', { def: 'today' }], ['due', 'Due', 'date', { list: true }], ['about', 'About', 'long', {}], ['kind', 'Kind', 'text', { ro: true }]],
    actions: [{ id: 'project.done', label: 'Mark done', when: ['active', 'paused'] }, { id: 'project.pause', label: 'Pause', when: ['active'] }, { id: 'project.resume', label: 'Resume', when: ['paused'] }] },
  { id: 'tasks', module: 'projects', name: 'Tasks', one: 'Task', title: 'title',
    info: 'A task has one owner, a start and a due date, and a clear test for done. The owner can be a function, such as Stores, before a person is named. Masters do not use the system: where their input is needed it is written on the task.',
    statuses: S(['todo', 'To do'], ['doing', 'Doing', 'info'], ['blocked', 'Blocked', 'crit'], ['done', 'Done', 'ok']), initial: 'todo', editWhen: ['todo', 'doing', 'blocked', 'done'],
    fields: [['project', 'Project', 'ref', { ref: 'projects', req: true, list: true }], ['title', 'Task', 'text', { req: true, list: true }], ['track', 'Track', 'select', { list: true, options: TRACKS }],
      ['ownerRole', 'Owner', 'select', { list: true, options: FUNCTIONS }], ['assignee', 'Person', 'user', { list: true }], ['start', 'Start', 'date', {}], ['due', 'Due', 'date', { list: true }],
      ['needs', 'Needs input from', 'text', {}], ['doneWhen', 'Done when', 'long', {}], ['notes', 'Notes', 'long', {}], ['blockedBy', 'Blocked by', 'text', { ro: true }], ['doneOn', 'Done on', 'date', { ro: true }], ['opens', 'Screen', 'text', { ro: true }]],
    actions: [{ id: 'task.start', label: 'Start', when: ['todo', 'blocked'] }, { id: 'task.done', label: 'Done', when: ['todo', 'doing', 'blocked'] }, { id: 'task.block', label: 'Blocked', when: ['todo', 'doing'], form: [['reason', 'What is in the way', 'text', { req: true }]] }, { id: 'task.reopen', label: 'Reopen', when: ['done'] }] },

  // ── Marketing ──
  { id: 'campaigns', module: 'marketing', name: 'Campaigns', one: 'Campaign', title: 'name',
    statuses: S(['planned', 'Planned'], ['live', 'Live', 'info'], ['ended', 'Ended', 'ok']), initial: 'planned',
    fields: [['name', 'Name', 'text', { req: true, list: true }], ['channel', 'Channel', 'select', { req: true, list: true, options: opt('Meta', 'Google', 'Email', 'Influencer', 'Shopify', 'Other') }], ['start', 'Start', 'date', { list: true }], ['end', 'End', 'date', {}],
      ['budget', 'Budget', 'money', { list: true }], ['spend', 'Spend', 'money', { list: true }], ['revenue', 'Revenue', 'money', { list: true }], ['owner', 'Owner', 'user', {}], ['notes', 'Notes', 'long', {}]],
    actions: [{ id: 'campaign.live', label: 'Go live', when: ['planned'] }, { id: 'campaign.end', label: 'End', when: ['live'] }] },
  { id: 'content', module: 'marketing', name: 'Content calendar', one: 'Content item', title: 'title',
    statuses: S(['idea', 'Idea'], ['in_work', 'In work', 'info'], ['scheduled', 'Scheduled', 'info'], ['published', 'Published', 'ok']), initial: 'idea',
    fields: [['title', 'Title', 'text', { req: true, list: true }], ['type', 'Type', 'select', { list: true, options: opt('Reel', 'Post', 'Story', 'Email', 'Ad creative', 'Website', 'Shoot') }], ['channel', 'Channel', 'select', { list: true, options: opt('Instagram', 'Meta Ads', 'Google Ads', 'Email', 'Website', 'Other') }],
      ['publishDate', 'Publish date', 'date', { list: true }], ['owner', 'Owner', 'user', { list: true }], ['campaign', 'Campaign', 'ref', { ref: 'campaigns' }], ['notes', 'Notes', 'long', {}]],
    actions: [{ id: 'content.next', label: 'Move forward', when: ['idea', 'in_work', 'scheduled'] }] },

  // ── Design ──
  { id: 'collections', module: 'design', name: 'Collections', one: 'Collection', title: 'name',
    statuses: S(['planning', 'Planning'], ['sampling', 'Sampling', 'info'], ['production', 'In production', 'info'], ['launched', 'Launched', 'ok']), initial: 'planning',
    fields: [['name', 'Name', 'text', { req: true, list: true }], ['season', 'Season', 'text', { list: true }], ['launchDate', 'Launch date', 'date', { list: true }], ['styles', 'Planned styles', 'number', {}], ['notes', 'Notes', 'long', {}]],
    actions: [{ id: 'collection.next', label: 'Move forward', when: ['planning', 'sampling', 'production'] }] },
  { id: 'developments', module: 'design', name: 'Style development', one: 'Style in development', title: 'name',
    statuses: S(['sketch', 'Sketch'], ['pattern', 'Pattern', 'info'], ['sample', 'Sample', 'info'], ['fit', 'Fit', 'warn'], ['approved', 'Approved', 'ok'], ['dropped', 'Dropped', 'crit']), initial: 'sketch',
    fields: [['collection', 'Collection', 'ref', { ref: 'collections', req: true, list: true }], ['name', 'Working name', 'text', { req: true, list: true }], ['owner', 'Designer', 'user', { list: true }], ['fabric', 'Fabric', 'ref', { ref: 'items' }], ['notes', 'Notes', 'long', {}]],
    actions: [{ id: 'dev.next', label: 'Move forward', when: ['sketch', 'pattern', 'sample', 'fit'] }, { id: 'dev.drop', label: 'Drop', when: ['sketch', 'pattern', 'sample', 'fit'] }] },
];

export const entityById = Object.fromEntries(ENTITIES.map((e) => [e.id, e]));
export const fieldsOf = (e) => e.fields.map(([k, label, type, o = {}]) => ({ k, label, type, ...o }));

// Ledgers created at setup so events can post vouchers from day one. Rename to match Tally.
export const STARTER_LEDGERS = [
  ['Bank Account', 'Bank Accounts'], ['Fabric Purchases', 'Purchase Accounts'], ['Thread & Trims', 'Purchase Accounts'], ['Consumables', 'Purchase Accounts'], ['Purchase Returns', 'Purchase Accounts'],
  ['Dyeing Charges', 'Direct Expenses'], ['Fabric Loss: Post-Dye Defects', 'Direct Expenses'], ['Freight Outward', 'Direct Expenses'], ['Salaries & Wages', 'Direct Expenses'], ['Stock Adjustments', 'Indirect Expenses'], ['Sales Returns', 'Sales Accounts'],
  ['Export Sales', 'Sales Accounts'], ['Online Sales', 'Sales Accounts'], ['Store Sales', 'Sales Accounts'], ['Shopify Clearing', 'Current Assets'], ['Stock: Dyed Fabric', 'Stock-in-Hand'], ['Salaries Payable', 'Current Liabilities'],
];
