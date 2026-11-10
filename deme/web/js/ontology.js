// The ontology of the business: places (nodes), what moves between them (flows),
// and which system watches each place. Everything on the 3D map is drawn from this file,
// so extending the map is a matter of adding a node or a flow here.

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
  { id: 'channels', name: 'Customers and channels' },
  { id: 'office', name: 'Business office' },
];

// kind drives the 3D model. pos is [x, z] centre, size is [width, depth].
export const NODES = [
  // ── Suppliers ──
  {
    id: 'mills', zone: 'supply', kind: 'mill', name: 'Fabric mills', pos: [-52, 8], size: [12, 10],
    blurb: 'Vendors who supply greige (undyed) fabric by the roll.',
    today: ['Rolls arrive with stains, weave lines and holes that nobody checks at the gate.', 'A defect found after dyeing cannot be returned. The mill says the fabric has been altered.'],
    change: ['Every roll is scored at the gate, so claims go back while the mill still has to accept them.', 'A supplier scorecard shows reject rate and claims recovered per mill.'],
    systems: ['erp-inbound', 'agent-claims'],
  },
  {
    id: 'trims', zone: 'supply', kind: 'vendor', name: 'Thread & trim vendors', pos: [-52, -10], size: [10, 8],
    blurb: 'Thread cones, needles, labels, buttons, scissors and other consumables.',
    today: ['Thread is bought after the dyed fabric arrives, so a runner goes out for matching shades.', 'Needles and sharp shears run out without warning.'],
    change: ['A thread order is raised the day a dye lot is sent out, for that exact shade.', 'Minimum levels on consumables raise purchase requests before the floor stops.'],
    systems: ['erp-inventory', 'agent-thread'],
  },
  {
    id: 'dyer', zone: 'jobwork', kind: 'dye', name: 'Dye house', pos: [-22, -31], size: [13, 9],
    blurb: 'Outside job-worker that dyes passed fabric to the season shades.',
    today: ['Faulty fabric is often found only here, sometimes after it is dyed.', 'Estimated loss from post-dye defects is north of $250,000 a year (production head\'s estimate).'],
    change: ['Only rolls with a pass from the inspection rig can be put on a dye challan.', 'Each lot is tracked out and back with metres, shade and days at the dyer.'],
    systems: ['erp-dye', 'agent-thread'],
  },

  // ── Factory floor ──
  {
    id: 'dock', zone: 'factory', kind: 'dock', name: 'Inbound dock', pos: [-25, 13], size: [9, 8],
    blurb: 'Where fabric and consumables enter the building.',
    today: ['Receipts are not recorded against the purchase order.', 'Nobody knows exactly what came in, or when.'],
    change: ['Each roll gets a QR tag and a goods receipt note at the door.', 'The receipt posts a purchase voucher to Tally automatically.'],
    systems: ['erp-inbound', 'conn-tally'],
  },
  {
    id: 'fabricqc', zone: 'factory', kind: 'rig', name: 'Fabric inspection rig', pos: [-14, 13], size: [10, 8],
    blurb: 'A roller frame with a line camera that reads every metre of every roll.',
    today: ['No inspection step exists. Defects travel to the dyer unseen.'],
    change: ['The vision model marks stains, lines and holes and gives the roll a 4-point score.', 'Fail: the roll goes back to the mill with photos and a debit note. Pass: it is cleared for dyeing.'],
    systems: ['vision-roll', 'erp-inbound', 'agent-claims'],
  },
  {
    id: 'darkroom', zone: 'factory', kind: 'dark', name: 'Unaudited store', pos: [-25, 1], size: [9, 11],
    blurb: 'The dark room: fabric that has piled up without ever being counted or checked.',
    today: ['Nobody knows what is in here, how old it is or what it is worth.', 'Planning cannot count on it, so the same fabric is bought again.'],
    change: ['A one-time audit runs every roll through the rig and tags it.', 'Shelf cameras then keep the count honest by reading the tags.'],
    systems: ['vision-shelf', 'erp-inventory'],
  },
  {
    id: 'fabricstore', zone: 'factory', kind: 'racks', name: 'Fabric store', pos: [-14, 1], size: [10, 11],
    blurb: 'Dyed, shade-approved fabric, racked and reserved against orders.',
    today: ['Stock lives in memory and on paper.'],
    change: ['Every roll has a location, a status and the order it is reserved for.', 'Cutting pulls fabric by scanning the roll.'],
    systems: ['erp-inventory', 'vision-shelf'],
  },
  {
    id: 'dyecheck', zone: 'factory', kind: 'check', name: 'Dye return check', pos: [-14, -11], size: [10, 8],
    blurb: 'Dyed lots are checked for shade and metres before they are accepted.',
    today: ['Shade differences surface on the cutting table.'],
    change: ['Shade is compared with the approved swatch under a light box camera.', 'The dyer\'s invoice is released for payment only for accepted metres.'],
    systems: ['vision-shade', 'erp-dye', 'conn-tally'],
  },
  {
    id: 'threadstore', zone: 'factory', kind: 'thread', name: 'Thread & trim store', pos: [-2, -12], size: [10, 6],
    blurb: 'Thread cones by shade, labels, buttons and elastic.',
    today: ['It is impossible to hold every shade, and nobody tracks which shades are in stock.', 'A line waits while a runner goes to the market.'],
    change: ['A camera reads the cone wall and keeps a count by shade code.', 'Thread is kitted per order before the bundle reaches the line.'],
    systems: ['vision-thread', 'erp-inventory', 'agent-thread'],
  },
  {
    id: 'cutting', zone: 'factory', kind: 'cutting', name: 'Cutting', pos: [-2, 1], size: [10, 12],
    blurb: 'Masters and under-masters lay, mark and cut fabric into bundles.',
    today: ['Fabric faults are sometimes found here, with tailors already waiting.'],
    change: ['The daily cut plan comes from the schedule, in due-date order.', 'Each bundle gets a tag that follows it through every stage.'],
    systems: ['erp-floor', 'agent-planner'],
  },
  {
    id: 'toolcrib', zone: 'factory', kind: 'tools', name: 'Tool crib & maintenance', pos: [-2, 15], size: [10, 7],
    blurb: 'Needles, shears, dress forms, bobbins and machine upkeep.',
    today: ['Blunt shears, missing needles and dress forms in the wrong place stop tailors.', 'Machine breakdowns are handled as they happen.'],
    change: ['Each station has a kit list checked at shift start.', 'Sharpening and machine service run on a calendar.'],
    systems: ['erp-inventory', 'erp-floor'],
  },
  {
    id: 'lineb2b', zone: 'factory', kind: 'line', name: 'B2B stitching line', pos: [11, -9], size: [13, 9],
    blurb: 'Volume line for Revolve, UK buyers and wholesale orders.',
    today: ['The highest-revenue lane. A slip here costs the most.', 'Stitching time per style is not known.'],
    change: ['Bundle scans at start and finish give real minutes per style and per tailor.', 'The schedule shows the effect of any change before it is made.'],
    systems: ['erp-floor', 'agent-planner'],
  },
  {
    id: 'lined2c', zone: 'factory', kind: 'line', name: 'D2C stitching line', pos: [11, 3], size: [13, 9],
    blurb: 'Shopify lots, Bombay store orders and fit alterations.',
    today: ['Small urgent jobs and fit returns interrupt the planned lots.'],
    change: ['Store alterations get their own queue with a time budget.', 'Bundle scans show how long each piece really took.'],
    systems: ['erp-floor', 'agent-planner'],
  },
  {
    id: 'sampling', zone: 'factory', kind: 'sample', name: 'Sampling room', pos: [11, 15], size: [13, 7],
    blurb: 'Sample tailors make prototypes for new collections.',
    today: ['A request for 80 samples lands when every machine is busy.', 'Merchandising and production argue from different pictures.'],
    change: ['Merchandising tests a sample run in the Production room and sees what it moves.', 'The decision is made on one shared schedule.'],
    systems: ['agent-planner', 'erp-floor'],
  },
  {
    id: 'finishing', zone: 'factory', kind: 'finish', name: 'Finishing', pos: [23, -9], size: [8, 9],
    blurb: 'Thread trimming, pressing and tagging.',
    today: ['Runs close to full. It becomes the hidden bottleneck when stitching speeds up.'],
    change: ['Load is visible a week ahead, so helpers can be moved in time.'],
    systems: ['erp-floor'],
  },
  {
    id: 'finalqc', zone: 'factory', kind: 'qc', name: 'Final QC', pos: [23, 3], size: [8, 8],
    blurb: 'Measurement, stitch and finish checks before packing.',
    today: ['Rework is not recorded, so the same faults repeat.'],
    change: ['Each fault is logged against style, operation and station.'],
    systems: ['erp-floor'],
  },
  {
    id: 'dispatch', zone: 'factory', kind: 'gate', name: 'Dispatch scan gate', pos: [23, 15], size: [9, 7],
    blurb: 'One gate for every parcel leaving or returning.',
    today: ['Shopify parcels carry a DHL label, but shipping is not recorded in inventory.', 'Store pieces come back two or three times for fit with no trail.'],
    change: ['A camera reads the DHL barcode, matches it to the order and updates stock.', 'Returns and fit visits come in through the same gate, so the count always tallies.'],
    systems: ['vision-gate', 'erp-dispatch', 'conn-dhl', 'conn-shopify'],
  },

  // ── Channels ──
  {
    id: 'dhl', zone: 'channels', kind: 'hub', name: 'DHL', pos: [41, 13], size: [8, 7],
    blurb: 'Carrier for Shopify parcels and export cartons.',
    today: ['Tracking is checked by hand on the DHL site.'],
    change: ['Tracking events are pulled into each order automatically.'],
    systems: ['conn-dhl', 'erp-dispatch'],
  },
  {
    id: 'shopify', zone: 'channels', kind: 'shop', name: 'Shopify store', pos: [56, 21], size: [10, 8],
    blurb: 'The online store and its customers worldwide.',
    today: ['Orders reach the factory as tags. Stock in Shopify drifts from stock on the shelf.'],
    change: ['Orders flow into the production queue as they are placed.', 'Stock and shipping status are written back to Shopify.'],
    systems: ['conn-shopify', 'erp-dispatch'],
  },
  {
    id: 'bombay', zone: 'channels', kind: 'store', name: 'Bombay store', pos: [56, 7], size: [10, 8],
    blurb: 'Dema\'s own retail store.',
    today: ['A dress can travel to the factory two or three times for fit checks.', 'No record of when it came, how long it took or when it left.'],
    change: ['Every piece carries a note: store order, arrival, stitching time, dispatch and visit count.'],
    systems: ['erp-dispatch'],
  },
  {
    id: 'revolve', zone: 'channels', kind: 'tower', name: 'Revolve', pos: [56, -9], size: [10, 9],
    blurb: 'Large US online retailer. The biggest B2B account.',
    today: ['Purchase orders are tracked in mail and spreadsheets.'],
    change: ['Each PO is a set of work orders with a live promise date.'],
    systems: ['conn-b2b', 'agent-planner'],
  },
  {
    id: 'ukbuyers', zone: 'channels', kind: 'buyers', name: 'UK buyers', pos: [56, -24], size: [10, 8],
    blurb: 'Fashion buyers who place orders for UK stores, online and physical.',
    today: ['Delivery windows are agreed without a view of floor capacity.'],
    change: ['A buyer\'s order is checked against capacity before it is confirmed.'],
    systems: ['conn-b2b', 'agent-planner'],
  },
  {
    id: 'global', zone: 'channels', kind: 'buyers', name: 'Global wholesale', pos: [43, -27], size: [9, 7],
    blurb: 'Smaller wholesale customers around the world.',
    today: ['Small orders compete with large ones for the same line.'],
    change: ['Small orders are slotted into gaps the schedule can show.'],
    systems: ['conn-b2b'],
  },

  // ── Office ──
  {
    id: 'merch', zone: 'office', kind: 'studio', name: 'Merchandising & design', pos: [0, -34], size: [10, 8],
    blurb: 'Plans collections and asks production for samples.',
    today: ['Sample deadlines are set without seeing the production load.'],
    change: ['Any team member can test a request and see what it would move.'],
    systems: ['agent-planner'],
  },
  {
    id: 'tower', zone: 'office', kind: 'control', name: 'Intelligence Room', pos: [12, -34], size: [9, 9],
    blurb: 'The live picture of orders, capacity, stock and cash, with a planner that answers what-if questions.',
    today: ['The picture lives in the production head\'s memory and phone.'],
    change: ['One schedule, built from scans and counts, open to the founder and every team.'],
    systems: ['agent-planner', 'agent-claims', 'agent-thread', 'agent-books'],
  },
  {
    id: 'finance', zone: 'office', kind: 'ledger', name: 'Finance (Tally)', pos: [25, -34], size: [10, 8],
    blurb: 'Accounts are kept in Tally.',
    today: ['Entries are keyed in later from paper. Supplier claims and dyer bills are hard to trace.'],
    change: ['Each receipt, rejection, dye bill, sale and payment becomes a Tally voucher with its source attached.'],
    systems: ['conn-tally', 'agent-books'],
  },
];

// Every flow is one sentence of the ontology: `from` sends `what` to `to`.
export const FLOWS = [
  // Material
  { from: 'mills', to: 'dock', layer: 'material', what: 'Greige fabric rolls' },
  { from: 'dock', to: 'fabricqc', layer: 'material', what: 'Every new roll, before anything else' },
  { from: 'dock', to: 'darkroom', layer: 'material', what: 'Rolls shelved unchecked (how the backlog grew)', weak: true },
  { from: 'darkroom', to: 'fabricqc', layer: 'material', what: 'Backlog audited through the rig' },
  { from: 'fabricqc', to: 'mills', layer: 'material', what: 'Failed rolls returned before dyeing', lift: 9 },
  { from: 'fabricqc', to: 'dyer', layer: 'material', what: 'Passed rolls only' },
  { from: 'dyer', to: 'dyecheck', layer: 'material', what: 'Dyed lots' },
  { from: 'dyecheck', to: 'fabricstore', layer: 'material', what: 'Shade-approved fabric' },
  { from: 'fabricstore', to: 'cutting', layer: 'material', what: 'Rolls reserved for the day\'s cut plan' },
  { from: 'trims', to: 'threadstore', layer: 'material', what: 'Thread cones, labels, needles' },
  { from: 'threadstore', to: 'lineb2b', layer: 'material', what: 'Thread kits matched to the dye lot' },
  { from: 'threadstore', to: 'lined2c', layer: 'material', what: 'Thread kits matched to the dye lot' },
  { from: 'toolcrib', to: 'lined2c', layer: 'material', what: 'Needles, shears, dress forms' },
  { from: 'toolcrib', to: 'sampling', layer: 'material', what: 'Needles, shears, dress forms' },
  // Garments
  { from: 'cutting', to: 'lineb2b', layer: 'goods', what: 'Tagged cut bundles' },
  { from: 'cutting', to: 'lined2c', layer: 'goods', what: 'Tagged cut bundles' },
  { from: 'cutting', to: 'sampling', layer: 'goods', what: 'Sample cuts' },
  { from: 'lineb2b', to: 'finishing', layer: 'goods', what: 'Stitched pieces' },
  { from: 'lined2c', to: 'finishing', layer: 'goods', what: 'Stitched pieces' },
  { from: 'sampling', to: 'merch', layer: 'goods', what: 'Finished samples', lift: 12 },
  { from: 'finishing', to: 'finalqc', layer: 'goods', what: 'Pressed and tagged pieces' },
  { from: 'finalqc', to: 'dispatch', layer: 'goods', what: 'Passed pieces' },
  { from: 'dispatch', to: 'dhl', layer: 'goods', what: 'Scanned parcels and cartons' },
  { from: 'dhl', to: 'shopify', layer: 'goods', what: 'Online orders delivered' },
  { from: 'dhl', to: 'revolve', layer: 'goods', what: 'Export cartons' },
  { from: 'dhl', to: 'ukbuyers', layer: 'goods', what: 'Export cartons' },
  { from: 'dhl', to: 'global', layer: 'goods', what: 'Export cartons' },
  { from: 'dispatch', to: 'bombay', layer: 'goods', what: 'Store orders and altered pieces' },
  { from: 'bombay', to: 'dispatch', layer: 'goods', what: 'Fit-check returns, scanned in', lift: 10 },
  { from: 'shopify', to: 'dispatch', layer: 'goods', what: 'Customer returns, scanned in', lift: 14 },
  // Money
  { from: 'shopify', to: 'finance', layer: 'money', what: 'Online payments' },
  { from: 'bombay', to: 'finance', layer: 'money', what: 'Store takings' },
  { from: 'revolve', to: 'finance', layer: 'money', what: 'PO payments in USD' },
  { from: 'ukbuyers', to: 'finance', layer: 'money', what: 'Wholesale payments' },
  { from: 'global', to: 'finance', layer: 'money', what: 'Wholesale payments' },
  { from: 'finance', to: 'mills', layer: 'money', what: 'Fabric invoices, net of claims', lift: 16 },
  { from: 'finance', to: 'dyer', layer: 'money', what: 'Dyeing job-work, accepted metres only' },
  { from: 'finance', to: 'trims', layer: 'money', what: 'Thread and consumables', lift: 20 },
  { from: 'finance', to: 'lineb2b', layer: 'money', what: 'Wages and piece rates' },
  { from: 'finance', to: 'dhl', layer: 'money', what: 'Freight' },
  { from: 'mills', to: 'finance', layer: 'money', what: 'Debit notes for rejected rolls', lift: 22 },
  // Intelligence
  { from: 'fabricqc', to: 'tower', layer: 'data', what: 'Defect map and score per roll' },
  { from: 'darkroom', to: 'tower', layer: 'data', what: 'Shelf counts' },
  { from: 'threadstore', to: 'tower', layer: 'data', what: 'Cone count by shade' },
  { from: 'lineb2b', to: 'tower', layer: 'data', what: 'Bundle scans: minutes per piece' },
  { from: 'lined2c', to: 'tower', layer: 'data', what: 'Bundle scans: minutes per piece' },
  { from: 'dispatch', to: 'tower', layer: 'data', what: 'Barcode reads in and out' },
  { from: 'dhl', to: 'tower', layer: 'data', what: 'Tracking events' },
  { from: 'shopify', to: 'tower', layer: 'data', what: 'New orders' },
  { from: 'revolve', to: 'tower', layer: 'data', what: 'Purchase orders' },
  { from: 'bombay', to: 'tower', layer: 'data', what: 'Store orders and fit notes' },
  { from: 'merch', to: 'tower', layer: 'data', what: 'Sample and collection requests' },
  { from: 'tower', to: 'merch', layer: 'data', what: 'What fits, what moves' },
  { from: 'tower', to: 'cutting', layer: 'data', what: 'Daily plan' },
  { from: 'tower', to: 'finance', layer: 'data', what: 'Vouchers for Tally' },
];

// Systems that attach to the map. Full detail (hardware, phasing) lives in the Systems view.
export const SYSTEMS = {
  'erp-inbound': { kind: 'erp', name: 'Inbound & fabric QC', does: 'Goods receipts, roll tags, inspection results, supplier claims.' },
  'erp-inventory': { kind: 'erp', name: 'Inventory', does: 'Fabric by roll, thread by shade, trims and tools with minimum levels.' },
  'erp-dye': { kind: 'erp', name: 'Dye house tracking', does: 'Lots out and back, shade approval, days at the dyer.' },
  'erp-floor': { kind: 'erp', name: 'Work orders & floor', does: 'Bundles through each stage, time per piece, rework.' },
  'erp-dispatch': { kind: 'erp', name: 'Dispatch & returns', does: 'One scan gate for parcels out, returns and store fit visits.' },
  'vision-roll': { kind: 'vision', name: 'Roll inspection camera', does: 'Line-scan camera on a roller frame finds stains, lines and holes.' },
  'vision-shelf': { kind: 'vision', name: 'Shelf cameras', does: 'Read roll tags on the racks to keep stock counts true.' },
  'vision-thread': { kind: 'vision', name: 'Thread wall camera', does: 'Counts cones and reads shade codes.' },
  'vision-shade': { kind: 'vision', name: 'Shade check light box', does: 'Compares dyed fabric with the approved swatch.' },
  'vision-gate': { kind: 'vision', name: 'Dispatch barcode camera', does: 'Reads DHL and bundle codes on anything passing the gate.' },
  'agent-planner': { kind: 'agent', name: 'Planner', does: 'Keeps the schedule current and answers what-if questions.' },
  'agent-claims': { kind: 'agent', name: 'Supplier claims', does: 'Drafts the claim and debit note with defect photos for each failed roll.' },
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
      ['mills', 'A mill ships greige fabric by the roll.'],
      ['dock', 'At the dock the roll gets a QR tag and a goods receipt. From here on, the system knows it exists.'],
      ['fabricqc', 'The roll runs over the inspection rig. A camera scores stains, lines and holes on the 4-point scale.'],
      ['mills', 'A failed roll goes straight back with photos and a debit note. It has not been dyed, so the mill has to take it.'],
      ['dyer', 'Only passed rolls reach the dye house. This single gate is what stops the post-dye loss.'],
      ['dyecheck', 'Dyed lots are checked for shade and metres. The dyer is paid for accepted metres.'],
      ['fabricstore', 'Approved fabric is racked and reserved for the order it was bought for.'],
      ['cutting', 'Cutting scans the roll out. Stock and the order update together.'],
    ],
  },
  {
    id: 'order', name: 'Follow a Shopify order', layer: 'goods',
    steps: [
      ['shopify', 'A customer orders online.'],
      ['tower', 'The order joins the production queue with a promise date the schedule can keep.'],
      ['lined2c', 'The D2C line stitches it. Bundle scans record the minutes it took.'],
      ['finalqc', 'Final QC measures and checks it.'],
      ['dispatch', 'At the gate a camera reads the DHL barcode. The order is marked shipped and stock drops by one.'],
      ['dhl', 'DHL tracking events flow back into the order.'],
      ['shopify', 'The customer sees tracking. If the parcel comes back, it re-enters through the same gate.'],
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
      ['mills', 'Mills are paid net of claims for rolls that failed inspection.'],
      ['dyer', 'The dyer is paid for accepted metres only.'],
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

export const nodeById = Object.fromEntries(NODES.map((n) => [n.id, n]));
