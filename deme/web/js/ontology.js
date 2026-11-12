// The ontology of the business: places (nodes), what moves between them (flows), which system
// watches each place and what the things drawn inside a place are (parts). Everything on the 3D
// map is drawn from this file, so extending the map is a matter of adding a node or a flow here.
// Production vendors are the one kind of place that comes from a list: world() adds a place and
// its flows for each one on record. Nothing here is a figure: counts and health come from the
// records, in map.js.

export const LAYERS = {
  material: { name: 'Material', what: 'Fabric, thread, trims and tools coming in', var: '--material' },
  goods: { name: 'Garments', what: 'Cut bundles, stitched pieces and parcels going out', var: '--goods' },
  money: { name: 'Money', what: 'Customer receipts, supplier payments and debit notes', var: '--money' },
  data: { name: 'Intelligence', what: 'Scans, camera reads and plans', var: '--data' },
};

export const ZONES = [
  { id: 'supply', name: 'Suppliers' },
  { id: 'jobwork', name: 'Outside job-work' },
  { id: 'factory', name: 'Factory floor' },
  { id: 'makers', name: 'Production vendors' },
  { id: 'channels', name: 'Customers and channels' },
  { id: 'office', name: 'Business office' },
];

// kind drives the 3D model. pos is [x, z] centre, size is [width, depth].
// rec is the record type "Open records" goes to; add is the one to start with when the place has
// nothing yet (defaults to rec). wc matches work centres by stage and line. plan marks places whose
// load can be tested in the Production room.
export const NODES = [
  // ── Suppliers ──
  {
    id: 'mills', zone: 'supply', kind: 'mill', name: 'Fabric mills', pos: [-52, 8], size: [12, 10], rec: 'suppliers',
    blurb: 'Vendors who supply fabric by the roll. Most of it is ready for dyeing and goes from the mill straight to the dye house; the rest comes to Deme\'s fabric store.',
    today: ['Rolls arrive with stains, weave lines and holes.', 'Some faults, such as yarn lines and pilling, show only after dyeing.'],
    change: ['A roll is passed on the mill\'s own QC report, or by Deme\'s checker at the dye house or the store.', 'A roll that fails, before or after dyeing, opens a claim on the mill. The claim stays open until the credit note or the replacement fabric arrives.'],
    systems: ['erp-inbound', 'agent-claims'],
  },
  {
    id: 'trims', zone: 'supply', kind: 'vendor', name: 'Thread & trim vendors', pos: [-52, -10], size: [10, 8], rec: 'items', add: 'suppliers',
    blurb: 'Thread cones, needles, labels, buttons, scissors and other consumables.',
    today: ['Thread is bought after the dyed fabric arrives, so a runner goes out for matching shades.', 'Needles and sharp shears run out without warning.'],
    change: ['A thread order is raised the day a dye lot is sent out, for that exact shade.', 'Minimum levels on consumables raise purchase requests before the floor stops.'],
    systems: ['erp-inventory', 'agent-thread'],
  },
  {
    id: 'dyer', zone: 'jobwork', kind: 'dye', name: 'Dye house', pos: [-22, -31], size: [13, 9], rec: 'dye_lots',
    blurb: 'Outside job-worker that dyes fabric to the season shades. Mills deliver ready-for-dyeing fabric straight here.',
    today: ['Fabric lies here before anyone at Deme has seen it.', 'A problem found here reaches Deme late, by phone.'],
    change: ['Rolls lying here are passed on the mill\'s QC report or checked by Deme\'s person at the dye house, then put on a dye lot.', 'The dye house reports a problem from a phone, with photos.', 'A dyeing fault is claimed from the dye house and a fabric fault from the mill. Only a failure nobody answers for is written off.'],
    systems: ['erp-dye', 'agent-thread'],
  },

  // ── Factory floor ──
  {
    id: 'dock', zone: 'factory', kind: 'dock', name: 'Inbound dock', pos: [-25, 13], size: [9, 8], rec: 'goods_receipts',
    blurb: 'Where consumables, and fabric that does not go to a dye house, enter the building.',
    today: ['Receipts are not recorded against the purchase order.', 'Nobody knows exactly what came in, or when.'],
    change: ['A goods receipt says where the fabric was delivered: here, or straight to a dye house.', 'Each roll gets a tag. The receipt posts a purchase voucher to Tally automatically.'],
    systems: ['erp-inbound', 'conn-tally'],
  },
  {
    id: 'fabricqc', zone: 'factory', kind: 'rig', name: 'Fabric inspection rig', pos: [-14, 13], size: [10, 8], rec: 'rolls',
    blurb: 'Deme\'s own check on rolls that come to the store without a mill QC report: a roller frame with a line camera.',
    today: ['Fabric is checked only when a fault shows.'],
    change: ['The checker scores stains, lines and holes on the 4-point scale.', 'Fail: a claim opens on the mill and the roll goes back with photos. Pass: it is cleared for dyeing or cutting.', 'A roll with a mill QC report is accepted on that report and is not inspected again.'],
    systems: ['vision-roll', 'erp-inbound', 'agent-claims'],
  },
  {
    id: 'darkroom', zone: 'factory', kind: 'dark', name: 'Unaudited store', pos: [-25, 1], size: [9, 11], rec: 'rolls',
    blurb: 'The dark room: fabric that has piled up without ever being counted or checked.',
    today: ['Nobody knows what is in here, how old it is or what it is worth.', 'Planning cannot count on it, so the same fabric is bought again.'],
    change: ['A one-time audit runs every roll through the rig and tags it.', 'Shelf cameras then keep the count honest by reading the tags.'],
    systems: ['vision-shelf', 'erp-inventory'],
  },
  {
    id: 'fabricstore', zone: 'factory', kind: 'racks', name: 'Fabric store', pos: [-14, 1], size: [10, 11], rec: 'rolls',
    blurb: 'Dyed fabric back from the dye house and other passed fabric, racked with the metres left on each roll.',
    today: ['Stock lives in memory and on paper.'],
    change: ['Every roll has a location, the metres left and the order it is reserved for.', 'The day plan sets fabric aside from named rolls, so cutting gets exactly what it needs.'],
    systems: ['erp-inventory', 'vision-shelf'],
  },
  {
    id: 'dyecheck', zone: 'factory', kind: 'check', name: 'Dye return check', pos: [-14, -11], size: [10, 8], rec: 'dye_lots',
    blurb: 'Dyed lots are checked for shade and metres before they are accepted.',
    today: ['Shade differences surface on the cutting table.'],
    change: ['Shade is compared with the approved swatch under a light box camera.', 'A roll that fails is claimed from whoever is at fault: the mill for a fabric fault, the dye house for a dyeing fault.', 'The dyer\'s invoice is released for payment only for accepted metres.'],
    systems: ['vision-shade', 'erp-dye', 'conn-tally'],
  },
  {
    id: 'threadstore', zone: 'factory', kind: 'thread', name: 'Thread & trim store', pos: [-2, -12], size: [10, 6], rec: 'items',
    blurb: 'Thread cones by shade, labels, buttons and elastic.',
    today: ['It is impossible to hold every shade, and nobody tracks which shades are in stock.', 'A line waits while a runner goes to the market.'],
    change: ['A camera reads the cone wall and keeps a count by shade code.', 'Thread is kitted per order before the bundle reaches the line.'],
    systems: ['vision-thread', 'erp-inventory', 'agent-thread'],
  },
  {
    id: 'cutting', zone: 'factory', kind: 'cutting', name: 'Cutting', pos: [-2, 1], size: [10, 12], rec: 'work_orders', wc: { stage: 'cut' }, plan: true,
    blurb: 'Masters and under-masters lay, mark and cut fabric into bundles.',
    today: ['Fabric faults are sometimes found here, with tailors already waiting.'],
    change: ['The day plan is made the evening before and checked against fabric that is really in the store.', 'Each master gets one bundle per line, of exactly the cut quantity. No slip goes out without fabric behind it.', 'Each bundle gets a tag that follows it through every stage.'],
    systems: ['erp-floor', 'agent-planner'],
  },
  {
    id: 'toolcrib', zone: 'factory', kind: 'tools', name: 'Tool crib & maintenance', pos: [-2, 15], size: [10, 7], rec: 'items',
    blurb: 'Needles, shears, dress forms, bobbins and machine upkeep.',
    today: ['Blunt shears, missing needles and dress forms in the wrong place stop tailors.', 'Machine breakdowns are handled as they happen.'],
    change: ['Each station has a kit list checked at shift start.', 'Sharpening and machine service run on a calendar.'],
    systems: ['erp-inventory', 'erp-floor'],
  },
  {
    id: 'lineb2b', zone: 'factory', kind: 'line', name: 'B2B stitching line', pos: [11, -9], size: [13, 9], rec: 'work_orders', wc: { stage: 'stitch', line: 'b2b' }, plan: true,
    blurb: 'In-house line for wholesale orders. Most wholesale work is made by production vendors; this line makes the rest.',
    today: ['Stitching time per style is not known.'],
    change: ['Bundle scans at start and finish give real minutes per style and per tailor.', 'The schedule shows the effect of any change before it is made.'],
    systems: ['erp-floor', 'agent-planner'],
  },
  {
    id: 'lined2c', zone: 'factory', kind: 'line', name: 'D2C stitching line', pos: [11, 3], size: [13, 9], rec: 'work_orders', wc: { stage: 'stitch', line: 'd2c' }, plan: true,
    blurb: 'Shopify lots, Bombay store orders and fit alterations.',
    today: ['Small urgent jobs and fit returns interrupt the planned lots.'],
    change: ['Store alterations get their own queue with a time budget.', 'Bundle scans show how long each piece really took.'],
    systems: ['erp-floor', 'agent-planner'],
  },
  {
    id: 'sampling', zone: 'factory', kind: 'sample', name: 'Sampling room', pos: [11, 15], size: [13, 7], rec: 'work_orders', wc: { stage: 'stitch', line: 'sample' }, plan: true,
    blurb: 'Sample tailors make prototypes for new collections.',
    today: ['A request for 80 samples lands when every machine is busy.', 'Merchandising and production argue from different pictures.'],
    change: ['Merchandising tests a sample run in the Production room and sees what it moves.', 'The decision is made on one shared schedule.'],
    systems: ['agent-planner', 'erp-floor'],
  },
  {
    id: 'finishing', zone: 'factory', kind: 'finish', name: 'Finishing', pos: [23, -9], size: [8, 9], rec: 'work_orders', wc: { stage: 'finish' }, plan: true,
    blurb: 'Thread trimming, pressing and tagging.',
    today: ['Runs close to full. It becomes the hidden bottleneck when stitching speeds up.'],
    change: ['Load is visible a week ahead, so helpers can be moved in time.'],
    systems: ['erp-floor'],
  },
  {
    id: 'finalqc', zone: 'factory', kind: 'qc', name: 'Final QC', pos: [23, 3], size: [8, 8], rec: 'qc_checks', wc: { stage: 'qc' }, plan: true,
    blurb: 'Measurement, stitch and finish checks before packing, on in-house work and on pieces that come back from a vendor.',
    today: ['Rework is not recorded, so the same faults repeat.'],
    change: ['Each fault is logged against style, operation and station.', 'Pieces back from a vendor wait here for the same check.'],
    systems: ['erp-floor'],
  },
  {
    id: 'dispatch', zone: 'factory', kind: 'gate', name: 'Dispatch scan gate', pos: [23, 15], size: [9, 7], rec: 'parcels', wc: { stage: 'pack' }, plan: true,
    blurb: 'One gate for every parcel leaving or returning.',
    today: ['Shopify parcels carry a DHL label, but shipping is not recorded in inventory.', 'Store pieces come back two or three times for fit with no trail.'],
    change: ['A camera reads the DHL barcode, matches it to the order and updates stock.', 'A parcel leaves only with its paperwork from the office. Without it, the gate stops the parcel.', 'Returns and fit visits come in through the same gate, so the count always tallies.'],
    systems: ['vision-gate', 'erp-dispatch', 'conn-dhl', 'conn-shopify'],
  },

  // ── Channels ──
  {
    id: 'dhl', zone: 'channels', kind: 'hub', name: 'DHL', pos: [41, 13], size: [8, 7], rec: 'parcels',
    blurb: 'Carrier for Shopify parcels and export cartons.',
    today: ['Tracking is checked by hand on the DHL site.'],
    change: ['Tracking events are pulled into each order automatically.'],
    systems: ['conn-dhl', 'erp-dispatch'],
  },
  {
    id: 'shopify', zone: 'channels', kind: 'shop', name: 'Shopify store', pos: [56, 21], size: [10, 8], rec: 'shop_orders',
    blurb: 'The online store and its customers worldwide.',
    today: ['Orders reach the factory as tags. Stock in Shopify drifts from stock on the shelf.'],
    change: ['Orders flow into the production queue as they are placed.', 'Stock and shipping status are written back to Shopify.'],
    systems: ['conn-shopify', 'erp-dispatch'],
  },
  {
    id: 'bombay', zone: 'channels', kind: 'store', name: 'Bombay store', pos: [56, 7], size: [10, 8], rec: 'store_orders',
    blurb: 'Deme\'s own retail store.',
    today: ['A dress can travel to the factory two or three times for fit checks.', 'No record of when it came, how long it took or when it left.'],
    change: ['Every piece carries a note: store order, arrival, stitching time, dispatch and visit count.'],
    systems: ['erp-dispatch'],
  },
  {
    id: 'revolve', zone: 'channels', kind: 'tower', name: 'Revolve', pos: [56, -9], size: [10, 9], rec: 'sales_orders',
    blurb: 'Large US online retailer. The biggest B2B account.',
    today: ['Purchase orders are tracked in mail and spreadsheets.'],
    change: ['Each PO is a set of work orders with a live promise date.'],
    systems: ['conn-b2b', 'agent-planner'],
  },
  {
    id: 'ukbuyers', zone: 'channels', kind: 'buyers', name: 'UK buyers', pos: [56, -24], size: [10, 8], rec: 'sales_orders',
    blurb: 'Fashion buyers who place orders for UK stores, online and physical.',
    today: ['Delivery windows are agreed without a view of floor capacity.'],
    change: ['A buyer\'s order is checked against capacity before it is confirmed.'],
    systems: ['conn-b2b', 'agent-planner'],
  },
  {
    id: 'global', zone: 'channels', kind: 'buyers', name: 'Global wholesale', pos: [43, -27], size: [9, 7], rec: 'sales_orders',
    blurb: 'Smaller wholesale customers around the world.',
    today: ['Small orders compete with large ones for the same line.'],
    change: ['Small orders are slotted into gaps the schedule can show.'],
    systems: ['conn-b2b'],
  },

  // ── Office ──
  {
    id: 'merch', zone: 'office', kind: 'studio', name: 'Merchandising & design', pos: [-3, -34], size: [10, 8], rec: 'sample_requests', plan: true,
    blurb: 'Plans collections and asks production for samples.',
    today: ['Sample deadlines are set without seeing the production load.'],
    change: ['Any team member can test a request and see what it would move.'],
    systems: ['agent-planner'],
  },
  {
    id: 'tower', zone: 'office', kind: 'control', name: 'Intelligence Room', pos: [8, -34], size: [9, 9], rec: 'work_orders', plan: true,
    blurb: 'The live picture of orders, capacity, stock and cash, with a planner that answers what-if questions.',
    today: ['The picture lives in the production head\'s memory and phone.'],
    change: ['One schedule, built from scans and counts, open to the founder and every team.'],
    systems: ['agent-planner', 'agent-claims', 'agent-thread', 'agent-books'],
  },
  {
    id: 'finance', zone: 'office', kind: 'ledger', name: 'Finance (Tally)', pos: [19, -34], size: [10, 8], rec: 'vouchers',
    blurb: 'Accounts are kept in Tally.',
    today: ['Entries are keyed in later from paper. Supplier claims and dyer bills are hard to trace.'],
    change: ['Each receipt, claim, dye bill, sale and payment becomes a Tally voucher with its source attached.'],
    systems: ['conn-tally', 'agent-books'],
  },
  {
    id: 'papers', zone: 'office', kind: 'desk', name: 'Office paperwork', pos: [28.5, -34], size: [7, 7], rec: 'parcels',
    blurb: 'The office adds the paperwork for every parcel: the e-invoice number, the invoice value and, above ₹50,000, the e-way bill number.',
    today: ['Parcels wait packed while someone asks the office for the invoice.'],
    change: ['The office adds the paperwork to the parcel record. The factory prints it, attaches it and scans the parcel out.', 'A parcel without it is stopped at the gate.'],
    systems: ['erp-dispatch', 'conn-tally'],
  },
];

// The place where returned pieces wait: it sits with the channels, next to the carrier.
NODES.splice(NODES.findIndex((n) => n.id === 'shopify'), 0, {
  id: 'resale', zone: 'channels', kind: 'resale', name: 'Returns, fit to sell', pos: [41, 23], size: [8, 5], rec: 'returns',
  blurb: 'Pieces that came back, were checked and approved as fit to sell. They wait here until they are sold on.',
  today: ['Returned pieces sit in the factory with no record of what they are or whether they can be sold.'],
  change: ['Each return is checked: fit to sell, or written off.', 'Pieces fit to sell wait here and are marked sold on, with what they sold for.'],
  systems: ['erp-dispatch'],
});

// Every flow is one sentence of the ontology: `from` sends `what` to `to`.
// rec is the record type behind the flow. only keeps records whose field holds one of the values;
// via keeps records whose reference (field, record type) has a field with one of the values;
// where names a test in map.js for what a field list cannot say; label names the filtered set.
export const FLOWS = [
  // Material
  { from: 'mills', to: 'dyer', layer: 'material', what: 'Ready-for-dyeing fabric, straight from the mill', rec: 'goods_receipts', where: 'toDyer', label: 'Receipts delivered to a dye house' },
  { from: 'mills', to: 'dock', layer: 'material', what: 'Other fabric, to Deme\'s fabric store', rec: 'goods_receipts', where: 'toStore', label: 'Receipts delivered to the store' },
  { from: 'dock', to: 'fabricqc', layer: 'material', what: 'Rolls with no mill QC report, for Deme\'s check', rec: 'rolls', where: 'storeWaiting', label: 'Rolls at the store awaiting inspection' },
  { from: 'dock', to: 'darkroom', layer: 'material', what: 'Rolls shelved unchecked (how the backlog grew)', weak: true, rec: 'rolls', where: 'storeWaiting', label: 'Rolls at the store awaiting inspection' },
  { from: 'darkroom', to: 'fabricqc', layer: 'material', what: 'Backlog audited through the rig', rec: 'inspections' },
  { from: 'fabricqc', to: 'mills', layer: 'material', what: 'Rolls that fail the check go back as a claim on the mill', lift: 9, rec: 'claims', only: { against: ['mill'], stage: ['before'] }, label: 'Claims on mills, before dyeing' },
  { from: 'fabricqc', to: 'dyer', layer: 'material', what: 'Passed rolls from the store, on a dye lot', rec: 'dye_lots' },
  { from: 'dyer', to: 'dyecheck', layer: 'material', what: 'Dyed lots, back to the fabric store through the shade check', rec: 'dye_lots', only: { status: ['at_dyer'] }, label: 'Dye lots at the dyer' },
  { from: 'dyecheck', to: 'fabricstore', layer: 'material', what: 'Accepted dyed rolls, to the racks', rec: 'rolls', only: { status: ['dyed'] }, label: 'Dyed rolls in store' },
  { from: 'dyecheck', to: 'mills', layer: 'material', what: 'Fabric faults that show after dyeing: a claim on the mill', lift: 13, rec: 'claims', only: { against: ['mill'], stage: ['after'] }, label: 'Claims on mills, after dyeing' },
  { from: 'dyecheck', to: 'dyer', layer: 'material', what: 'Dyeing faults: a claim on the dye house', lift: 6, rec: 'claims', only: { against: ['dyer'] }, label: 'Claims on dye houses' },
  { from: 'fabricstore', to: 'cutting', layer: 'material', what: 'Fabric set aside by the day plan, bundle by bundle', rec: 'bundles', where: 'fromPlan', label: 'Bundles from a day plan' },
  { from: 'trims', to: 'threadstore', layer: 'material', what: 'Thread cones, labels, needles', rec: 'stock_moves', only: { reason: ['receipt'] }, label: 'Stock receipts' },
  { from: 'threadstore', to: 'lineb2b', layer: 'material', what: 'Thread kits matched to the dye lot', rec: 'stock_moves', only: { reason: ['issue'] }, label: 'Stock issues' },
  { from: 'threadstore', to: 'lined2c', layer: 'material', what: 'Thread kits matched to the dye lot', rec: 'stock_moves', only: { reason: ['issue'] }, label: 'Stock issues' },
  { from: 'toolcrib', to: 'lined2c', layer: 'material', what: 'Needles, shears, dress forms', rec: 'stock_moves', only: { reason: ['issue'] }, label: 'Stock issues' },
  { from: 'toolcrib', to: 'sampling', layer: 'material', what: 'Needles, shears, dress forms', rec: 'stock_moves', only: { reason: ['issue'] }, label: 'Stock issues' },
  // Garments
  { from: 'cutting', to: 'lineb2b', layer: 'goods', what: 'Tagged cut bundles', rec: 'bundles' },
  { from: 'cutting', to: 'lined2c', layer: 'goods', what: 'Tagged cut bundles', rec: 'bundles' },
  { from: 'cutting', to: 'sampling', layer: 'goods', what: 'Sample cuts', rec: 'work_orders', only: { channel: ['SAMPLE'] }, label: 'Sample work orders' },
  { from: 'lineb2b', to: 'finishing', layer: 'goods', what: 'Stitched pieces', rec: 'bundles', only: { status: ['stitched'] }, label: 'Bundles stitched' },
  { from: 'lined2c', to: 'finishing', layer: 'goods', what: 'Stitched pieces', rec: 'bundles', only: { status: ['stitched'] }, label: 'Bundles stitched' },
  { from: 'sampling', to: 'merch', layer: 'goods', what: 'Finished samples', lift: 12, rec: 'sample_requests' },
  { from: 'finishing', to: 'finalqc', layer: 'goods', what: 'Pressed and tagged pieces', rec: 'work_orders', only: { status: ['released', 'in_progress'] }, label: 'Work orders on the floor' },
  { from: 'finalqc', to: 'dispatch', layer: 'goods', what: 'Passed pieces', rec: 'qc_checks', only: { stage: ['final'] }, label: 'Final checks' },
  { from: 'dispatch', to: 'dhl', layer: 'goods', what: 'Scanned parcels and cartons', rec: 'parcels' },
  { from: 'dhl', to: 'shopify', layer: 'goods', what: 'Online orders delivered', rec: 'shop_orders', only: { status: ['shipped', 'delivered'] }, label: 'Shopify orders shipped' },
  { from: 'dhl', to: 'revolve', layer: 'goods', what: 'Export cartons', rec: 'parcels', only: { kind: ['b2b'] }, label: 'B2B cartons' },
  { from: 'dhl', to: 'ukbuyers', layer: 'goods', what: 'Export cartons', rec: 'parcels', only: { kind: ['b2b'] }, label: 'B2B cartons' },
  { from: 'dhl', to: 'global', layer: 'goods', what: 'Export cartons', rec: 'parcels', only: { kind: ['b2b'] }, label: 'B2B cartons' },
  { from: 'dispatch', to: 'bombay', layer: 'goods', what: 'Store orders and altered pieces', rec: 'store_orders' },
  { from: 'bombay', to: 'dispatch', layer: 'goods', what: 'Fit-check returns, scanned in', lift: 10, rec: 'fit_visits' },
  { from: 'shopify', to: 'dispatch', layer: 'goods', what: 'Customer returns, scanned in', lift: 14, rec: 'returns' },
  { from: 'dispatch', to: 'resale', layer: 'goods', what: 'Returned pieces approved as fit to sell', rec: 'returns', only: { status: ['restocked'] }, label: 'Returns fit to sell, waiting' },
  { from: 'resale', to: 'bombay', layer: 'goods', what: 'Returned pieces sold on', rec: 'returns', only: { status: ['sold'] }, label: 'Returns sold on' },
  // Money
  { from: 'shopify', to: 'finance', layer: 'money', what: 'Online payments', rec: 'vouchers', only: { type: ['Sales', 'Receipt'] }, label: 'Sales and receipt vouchers' },
  { from: 'bombay', to: 'finance', layer: 'money', what: 'Store takings', rec: 'vouchers', only: { type: ['Sales', 'Receipt'] }, label: 'Sales and receipt vouchers' },
  { from: 'revolve', to: 'finance', layer: 'money', what: 'PO payments in USD', rec: 'invoices' },
  { from: 'ukbuyers', to: 'finance', layer: 'money', what: 'Wholesale payments', rec: 'invoices' },
  { from: 'global', to: 'finance', layer: 'money', what: 'Wholesale payments', rec: 'invoices' },
  { from: 'finance', to: 'mills', layer: 'money', what: 'Fabric invoices, net of claims', lift: 16, rec: 'bills', via: ['supplier', 'suppliers', 'kind', ['mill']], label: 'Mill bills' },
  { from: 'finance', to: 'dyer', layer: 'money', what: 'Dyeing job-work, accepted metres only', rec: 'bills', via: ['supplier', 'suppliers', 'kind', ['dyer']], label: 'Dye house bills' },
  { from: 'finance', to: 'trims', layer: 'money', what: 'Thread and consumables', lift: 20, rec: 'bills', via: ['supplier', 'suppliers', 'kind', ['trims']], label: 'Thread and trim bills' },
  { from: 'finance', to: 'lineb2b', layer: 'money', what: 'Wages and piece rates', rec: 'payroll_runs' },
  { from: 'finance', to: 'dhl', layer: 'money', what: 'Freight', rec: 'courier_invoices' },
  { from: 'mills', to: 'finance', layer: 'money', what: 'Debit notes for claims, until the credit note comes', lift: 22, rec: 'vouchers', only: { type: ['Debit Note'] }, label: 'Debit notes' },
  // Intelligence
  { from: 'fabricqc', to: 'tower', layer: 'data', what: 'Defect map and score per roll', rec: 'inspections' },
  { from: 'dyer', to: 'tower', layer: 'data', what: 'Problem reports from the dye house, with photos', rec: 'fabric_reports' },
  { from: 'papers', to: 'dispatch', layer: 'data', what: 'E-invoice and e-way bill for each parcel', rec: 'parcels', where: 'needsPapers', label: 'Parcels waiting for paperwork' },
  { from: 'darkroom', to: 'tower', layer: 'data', what: 'Shelf counts', rec: 'stock_counts' },
  { from: 'threadstore', to: 'tower', layer: 'data', what: 'Cone count by shade', rec: 'items', only: { kind: ['thread'] }, label: 'Thread materials' },
  { from: 'lineb2b', to: 'tower', layer: 'data', what: 'Bundle scans: minutes per piece', rec: 'scans' },
  { from: 'lined2c', to: 'tower', layer: 'data', what: 'Bundle scans: minutes per piece', rec: 'scans' },
  { from: 'dispatch', to: 'tower', layer: 'data', what: 'Barcode reads in and out', rec: 'parcels' },
  { from: 'dhl', to: 'tower', layer: 'data', what: 'Tracking events', rec: 'parcels', only: { status: ['in_transit', 'returning'] }, label: 'Parcels on the way' },
  { from: 'shopify', to: 'tower', layer: 'data', what: 'New orders', rec: 'shop_orders', only: { status: ['new'] }, label: 'New Shopify orders' },
  { from: 'revolve', to: 'tower', layer: 'data', what: 'Purchase orders', rec: 'sales_orders' },
  { from: 'bombay', to: 'tower', layer: 'data', what: 'Store orders and fit notes', rec: 'store_orders' },
  { from: 'merch', to: 'tower', layer: 'data', what: 'Sample and collection requests', rec: 'sample_requests' },
  { from: 'tower', to: 'merch', layer: 'data', what: 'What fits, what moves', rec: 'sample_requests', only: { status: ['approved', 'declined'] }, label: 'Sample requests answered' },
  { from: 'tower', to: 'cutting', layer: 'data', what: 'Day plan, issued the evening before', rec: 'day_plans', only: { status: ['issued'] }, label: 'Day plans issued' },
  { from: 'tower', to: 'finance', layer: 'data', what: 'Vouchers for Tally', rec: 'vouchers' },
];

// Systems that attach to the map.
export const SYSTEMS = {
  'erp-inbound': { kind: 'erp', name: 'Inbound & fabric QC', does: 'Goods receipts, roll tags, inspection results, supplier claims.' },
  'erp-inventory': { kind: 'erp', name: 'Inventory', does: 'Fabric by roll, thread by shade, trims and tools with minimum levels.' },
  'erp-dye': { kind: 'erp', name: 'Dye house tracking', does: 'Fabric lying at the dye house, lots out and back, shade approval, problem reports with photos.' },
  'erp-floor': { kind: 'erp', name: 'Work orders & floor', does: 'The day plan, bundles through each stage, time per piece, rework.' },
  'erp-vendors': { kind: 'erp', name: 'Vendor work', does: 'Work orders sent to a production vendor: pieces out, pieces back, pieces passed at the vendor.' },
  'erp-dispatch': { kind: 'erp', name: 'Dispatch & returns', does: 'One scan gate for parcels out, returns and store fit visits. Paperwork on every parcel before it leaves.' },
  'vision-roll': { kind: 'vision', name: 'Roll inspection camera', does: 'Line-scan camera on a roller frame finds stains, lines and holes.' },
  'vision-shelf': { kind: 'vision', name: 'Shelf cameras', does: 'Read roll tags on the racks to keep stock counts true.' },
  'vision-thread': { kind: 'vision', name: 'Thread wall camera', does: 'Counts cones and reads shade codes.' },
  'vision-shade': { kind: 'vision', name: 'Shade check light box', does: 'Compares dyed fabric with the approved swatch.' },
  'vision-gate': { kind: 'vision', name: 'Dispatch barcode camera', does: 'Reads DHL and bundle codes on anything passing the gate.' },
  'agent-planner': { kind: 'agent', name: 'Planner', does: 'Keeps the schedule current and answers what-if questions.' },
  'agent-claims': { kind: 'agent', name: 'Supplier claims', does: 'Opens the claim and the debit note for each failed roll and keeps it open until the credit note or the replacement arrives.' },
  'agent-thread': { kind: 'agent', name: 'Thread matcher', does: 'Raises thread orders when a dye lot is sent, by shade and quantity.' },
  'agent-books': { kind: 'agent', name: 'Bookkeeper', does: 'Turns each factory event into a Tally voucher and flags mismatches.' },
  'conn-shopify': { kind: 'connector', name: 'Shopify', does: 'Orders in, stock and fulfilment status back.' },
  'conn-dhl': { kind: 'connector', name: 'DHL', does: 'Labels, pickups and tracking events.' },
  'conn-tally': { kind: 'connector', name: 'Tally', does: 'Vouchers and ledgers, both directions.' },
  'conn-b2b': { kind: 'connector', name: 'B2B order intake', does: 'Revolve and buyer POs read from portal exports and email.' },
};
export const SYSTEM_KINDS = {
  erp: { name: 'ERP module', tag: 'tag-material' },
  vision: { name: 'Vision station', tag: 'tag-goods' },
  agent: { name: 'Agent', tag: 'tag-data' },
  connector: { name: 'Connector', tag: 'tag-money' },
};

// Guided walks across the map. Each step flies the camera to a node.
export const TOURS = [
  {
    id: 'roll', name: 'Follow a fabric roll', layer: 'material',
    steps: [
      ['mills', 'A mill ships fabric by the roll. Most of it is ready for dyeing.'],
      ['dyer', 'Ready-for-dyeing fabric goes from the mill straight to the dye house. The goods receipt says so, and the rolls are on record as lying there.'],
      ['dyer', 'Each roll is passed on the mill\'s QC report, or checked by Deme\'s person at the dye house. Passed rolls go on a dye lot.'],
      ['dock', 'Fabric that is not for dyeing comes to Deme. Rolls with no mill report run over the inspection rig.'],
      ['dyer', 'If the dye house sees a problem, it sends a report from a phone, with photos.'],
      ['dyecheck', 'Dyed lots come back and are checked for shade and metres. The dyer is paid for accepted metres.'],
      ['mills', 'A roll that fails is claimed from whoever is at fault: the mill for a fabric fault, even one that shows only after dyeing, the dye house for a dyeing fault. The claim stays open until the credit note or the replacement arrives.'],
      ['fabricstore', 'Accepted fabric is racked, with the metres left on each roll.'],
      ['cutting', 'The day plan, made the evening before, sets fabric aside from named rolls. Each master gets a bundle of exactly the cut quantity.'],
    ],
  },
  {
    id: 'order', name: 'Follow a Shopify order', layer: 'goods',
    steps: [
      ['shopify', 'A customer orders online.'],
      ['tower', 'The order joins the production queue with a promise date the schedule can keep.'],
      ['lined2c', 'The D2C line stitches it. Bundle scans record the minutes it took.'],
      ['finalqc', 'Final QC measures and checks it.'],
      ['papers', 'The office adds the invoice number to the packed parcel.'],
      ['dispatch', 'At the gate a camera reads the DHL barcode. With its paperwork the parcel goes: the order is marked shipped and stock drops by one.'],
      ['dhl', 'DHL tracking events flow back into the order.'],
      ['shopify', 'The customer sees tracking. If the parcel comes back, it re-enters through the same gate.'],
      ['resale', 'A returned piece is checked. If it is fit to sell it waits here until it is sold on.'],
    ],
  },
  {
    id: 'wholesale', name: 'Follow a wholesale order', layer: 'goods',
    steps: [
      ['revolve', 'A wholesale buyer places a purchase order.'],
      ['tower', 'Confirming it raises one work order per line. Each line is made in-house or by a production vendor.'],
      ['mk-0', 'Most of it is bulk, made by a vendor. Deme\'s own QC checks the pieces at the vendor.'],
      ['papers', 'The office adds the e-invoice and, above ₹50,000, the e-way bill.'],
      ['revolve', 'Bulk passed at the vendor ships from there, direct to the buyer.'],
      ['finalqc', 'Difficult pieces are made by another vendor and come back here for final QC.'],
      ['lineb2b', 'The rest is made in-house, from the day plan.'],
      ['dispatch', 'In-house and returned pieces are packed here. A parcel without its paperwork is stopped at the gate.'],
    ],
  },
  {
    id: 'fit', name: 'The Bombay fit loop', layer: 'goods',
    steps: [
      ['bombay', 'A store customer needs a fit change.'],
      ['dispatch', 'The piece is scanned in. Its note records that it is a store order and when it arrived.'],
      ['lined2c', 'The alteration queue shows how long the work took.'],
      ['dispatch', 'It is scanned out. The note now carries visit number, time in the factory and dispatch time.'],
      ['bombay', 'If it comes back, the visit count goes to two. Styles that return often are flagged for a pattern fix.'],
    ],
  },
  {
    id: 'money', name: 'Follow the money', layer: 'money',
    steps: [
      ['revolve', 'Revolve pays against a purchase order.'],
      ['finance', 'The receipt lands in Tally against the right invoice.'],
      ['mills', 'Mills are paid net of claims. A claim stays open until the credit note or the replacement fabric arrives.'],
      ['dyer', 'The dyer is paid for accepted metres only, and answers for dyeing faults.'],
      ['finance', 'Every voucher links back to the roll, lot or parcel that caused it.'],
    ],
  },
  {
    id: 'samples', name: 'Squeeze in 80 samples', layer: 'data',
    steps: [
      ['merch', 'Merchandising needs 80 samples for a new collection.'],
      ['tower', 'They enter the run in the Production room and see what it moves before asking anyone.'],
      ['sampling', 'The sampling room alone cannot finish in time.'],
      ['lined2c', 'Borrowing the D2C line gets it done, and the schedule shows which Shopify lots slip and by how many days.'],
      ['tower', 'The decision is made on shared facts: overtime, a later date, or a smaller first batch.'],
    ],
  },
];

// What the things drawn inside a place are. models.js tags every mesh with one of these ids;
// clicking one names it in the inspector, with a live fact from the records where there is one.
export const PARTS = {
  shed: { name: 'Mill shed', what: 'Where the mill weaves greige fabric.' },
  chimney: { name: 'Chimney', what: 'The boiler stack of the mill or dye house.' },
  greige: { name: 'Greige fabric roll', what: 'Undyed fabric as it comes from the mill. It is passed on the mill\'s QC report or by Deme\'s checker before it is dyed.' },
  vendor: { name: 'Vendor shop', what: 'A supplier of thread, trims, tools or consumables.' },
  cone: { name: 'Thread cone', what: 'Thread is bought and counted by the cone, one shade per material.' },
  carton: { name: 'Carton', what: 'Trims and consumables packed for delivery.' },
  dyeworks: { name: 'Dye works', what: 'The outside job-worker that dyes passed fabric.' },
  held: { name: 'Fabric lying at the dye house', what: 'Rolls the mill delivered straight here. They wait to be accepted on the mill\'s report or checked by Deme\'s person, then go on a dye lot.' },
  vat: { name: 'Dye vat', what: 'One vat stands for a dye lot: passed rolls dyed in one shade.' },
  dryline: { name: 'Drying line', what: 'Dyed fabric drying before it comes back.' },
  bench: { name: 'Receiving bench', what: 'Where a delivery is counted against the purchase order and a goods receipt is booked.' },
  truck: { name: 'Truck', what: 'A delivery from a supplier.' },
  frame: { name: 'Roller frame', what: 'The roll runs over these rollers so every metre passes under the camera.' },
  camera: { name: 'Camera', what: 'A vision station that reads what passes under it.' },
  darkstore: { name: 'Closed store', what: 'Fabric shelved without being inspected.' },
  rack: { name: 'Rack', what: 'Dyed and passed fabric by location, with the metres left on each roll.' },
  dyedroll: { name: 'Dyed fabric roll', what: 'Fabric back from the dyer and accepted on shade.' },
  lightbox: { name: 'Light box', what: 'Dyed fabric is compared with the approved swatch under even light.' },
  swatch: { name: 'Shade swatch', what: 'The approved shade a dye lot is checked against.' },
  conewall: { name: 'Thread cone wall', what: 'Thread cones racked by shade.' },
  counter: { name: 'Issue counter', what: 'Material is issued to the floor from here. Each issue is a stock movement.' },
  cuttable: { name: 'Cutting table', what: 'Fabric is laid, marked and cut into bundles here.' },
  toolwall: { name: 'Tool wall', what: 'Shears, needles and other tools and consumables.' },
  repair: { name: 'Repair bench', what: 'Machines that are down or in service.' },
  station: { name: 'Sewing station', what: 'One tailor, one machine. Bundles are scanned in and out here.' },
  stationdown: { name: 'Sewing station, machine down', what: 'A machine on this line is marked down in the machine list.' },
  rail: { name: 'Garment rail', what: 'Finished pieces and samples on hangers.' },
  press: { name: 'Pressing table', what: 'Thread trimming, pressing and tagging.' },
  qctable: { name: 'Checking table', what: 'Measurement, stitch and finish checks before packing.' },
  gauge: { name: 'Measuring frame', what: 'Pieces are hung and measured against the size chart.' },
  rework: { name: 'Rework bin', what: 'Pieces sent back to be put right.' },
  conveyor: { name: 'Conveyor', what: 'Packed parcels on their way through the gate.' },
  parcel: { name: 'Parcel', what: 'A parcel or carton with a barcode on its label.' },
  scangate: { name: 'Scan gate', what: 'Every parcel out or back is scanned here.' },
  depot: { name: 'Courier depot', what: 'Where the carrier collects and sorts parcels.' },
  van: { name: 'Van', what: 'The carrier\'s pickup.' },
  screen: { name: 'Shop screen', what: 'The online store as customers see it.' },
  shopfront: { name: 'Shopfront', what: 'The store window, awning and door.' },
  tower: { name: 'Office tower', what: 'The buyer\'s head office.' },
  office: { name: 'Buyer\'s office', what: 'A wholesale buyer.' },
  studio: { name: 'Studio', what: 'Where collections are planned and styles developed.' },
  controltower: { name: 'Tower', what: 'One picture of orders, capacity, stock and cash.' },
  beacon: { name: 'Beacon', what: 'Signals what needs attention.' },
  ledgerhall: { name: 'Ledger hall', what: 'The books, kept in Tally.' },
  columns: { name: 'Columns', what: 'The ledgers every voucher posts to.' },
  coins: { name: 'Coin stack', what: 'Money owed to suppliers.' },
  form: { name: 'Dress form', what: 'Used for fitting and draping.' },
  person: { name: 'Person', what: 'Someone who works or shops here.' },
  workshop: { name: 'Vendor workshop', what: 'A production vendor cuts, stitches and finishes wholesale work here.' },
  vendorline: { name: 'Vendor\'s line', what: 'Work orders sent out to this vendor are made here.' },
  qcdesk: { name: 'Deme\'s QC at the vendor', what: 'Bulk work is checked here by Deme\'s own QC and shipped from the vendor.' },
  plot: { name: 'Empty plot', what: 'No production vendor is on record yet. Add one as a supplier of the kind Production vendor.' },
  deskoffice: { name: 'Office', what: 'Where invoices and e-way bills are raised.' },
  papers: { name: 'Paperwork', what: 'The e-invoice and, above ₹50,000, the e-way bill for a parcel.' },
  printer: { name: 'Printer', what: 'The factory prints the paperwork and attaches it to the parcel.' },
  returnrail: { name: 'Returns rail', what: 'Returned pieces approved as fit to sell, waiting to be sold on.' },
  checktable: { name: 'Checking table', what: 'A returned piece is checked here: fit to sell, or written off.' },
};

export const nodeById = Object.fromEntries(NODES.map((n) => [n.id, n]));

// ── Production vendors ──
// One place per vendor while there are three or fewer; beyond that, one place per city, the
// two busiest cities by number of vendors and the rest together. With none on record, one quiet
// plot. `makers` is the list of suppliers of kind maker ({ id, name, city }), or null when the
// person cannot read suppliers: then one place stands for all vendor work.
const MAKER_SLOTS = 3, MAKER_Z = 36, MAKER_X = 16, MAKER_GAP = 17;
const makerText = {
  blurb: 'A production vendor makes wholesale work outside the factory: bulk orders at one vendor, difficult pieces at another.',
  today: ['Work sent out is followed by phone. Nobody sees how many pieces are out, or when they are due.'],
  change: ['A work order sent out shows the pieces with the vendor and the date they are due.', 'Bulk work is checked at the vendor by Deme\'s own QC and shipped from there.', 'Difficult pieces come back and go through final QC in-house.'],
  systems: ['erp-vendors', 'erp-floor'],
};
function makerGroups(makers) {
  if (makers === null) return [{ name: 'Production vendors', makers: null }];
  if (!makers.length) return [{ name: 'Production vendors', makers: [], empty: true }];
  const sorted = makers.slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
  if (sorted.length <= MAKER_SLOTS) return sorted.map((m) => ({ name: m.name, city: m.city || '', makers: [m.id] }));
  const cities = new Map();
  for (const m of sorted) { const key = String(m.city || '').trim().toLowerCase(); if (!cities.has(key)) cities.set(key, { city: String(m.city || '').trim(), makers: [] }); cities.get(key).makers.push(m.id); }
  const named = [...cities.values()].filter((c) => c.city).sort((a, b) => b.makers.length - a.makers.length || a.city.localeCompare(b.city));
  const keep = named.length + (cities.has('') ? 1 : 0) <= MAKER_SLOTS ? named : named.slice(0, MAKER_SLOTS - 1);
  const rest = sorted.filter((m) => !keep.some((c) => c.makers.includes(m.id))).map((m) => m.id);
  return [...keep.map((c) => ({ name: `Vendors in ${c.city}`, city: c.city, makers: c.makers })), ...(rest.length ? [{ name: 'Other vendors', makers: rest }] : [])];
}

/** The map for the vendors on record: { NODES, FLOWS, nodeById }, the fixed places plus one per vendor or city. */
export function world(makers) {
  const groups = makerGroups(makers);
  const places = groups.map((g, i) => ({
    id: `mk-${i}`, zone: 'makers', kind: g.empty ? 'plot' : 'maker', name: g.name, city: g.city || '', makers: g.makers,
    pos: [MAKER_X + (i - (groups.length - 1) / 2) * MAKER_GAP, MAKER_Z], size: [10, 7], rec: 'work_orders', add: 'suppliers', ...makerText,
  }));
  const flows = places.flatMap((p) => [
    { from: 'dispatch', to: p.id, layer: 'goods', what: 'Wholesale work sent out to be made', rec: 'work_orders', where: 'sentOut', makers: p.makers, label: 'Work orders with the vendor' },
    { from: p.id, to: 'finalqc', layer: 'goods', what: 'Pieces made by the vendor, back for QC in-house', lift: 9, rec: 'work_orders', where: 'backForQc', makers: p.makers, label: 'Work orders checked in-house' },
    { from: p.id, to: 'revolve', layer: 'goods', what: 'Pieces checked at the vendor by Deme\'s QC, shipped direct to the buyer', lift: 15, rec: 'work_orders', where: 'shippedThere', makers: p.makers, label: 'Work orders checked at the vendor' },
  ]);
  const nodes = [...NODES, ...places];
  return { NODES: nodes, FLOWS: [...FLOWS, ...flows], nodeById: Object.fromEntries(nodes.map((n) => [n.id, n])) };
}
