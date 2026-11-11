// How the company is organised, as data.
//
// A WORK CENTRE is a part of the business with one person in charge: Production, Merchandising,
// Design, Finance. A WORKSTATION is a place inside a work centre where one kind of work is done:
// the cutting table, a stitching line, the inspection table, the dispatch gate.
// A POSITION is the job a person holds: it places them in a work centre, gives them the access
// that job needs (a role from schema.js) and decides which tasks of the go-live plan are theirs.
//
// The work centres and workstations below are created when the system is set up, so nobody
// starts from a blank page. They are a starting structure, not data: every one of them can be
// renamed, removed or added to. Headcount and the person in charge are left empty on purpose.
//
// This file imports nothing, so schema.js, golive.js and the browser can all read it.

// `approve`: who lets a person into this position. 'admin' positions carry wide access or lead a
// work centre; 'head' positions can be confirmed by the head of the work centre.
// `guide`: the walkthrough set in web/js/guides-content.js that fits this position.
export const POSITIONS = [
  { id: 'setup', name: 'System admin', line: 'Sets the system up: work centres, logins, the go-live plan, connections.', role: 'admin', centre: 'management', approve: 'admin', guide: 'ops' },
  { id: 'founder', name: 'Founder', line: 'Sees the whole business and the go-live at a glance, and decides.', role: 'founder', centre: 'management', approve: 'admin', guide: 'founder' },
  { id: 'ops', name: 'Operations head', line: 'Runs the system day to day: people, approvals and the go-live plan.', role: 'ops_head', centre: 'management', approve: 'admin', guide: 'ops' },
  { id: 'prod_b2b', name: 'Production head', line: 'In charge of production: wholesale orders from the customer\'s PO to shipped.', role: 'production_head', centre: 'production', approve: 'admin', guide: 'prod_b2b' },
  { id: 'prod_manager', name: 'Production manager', line: 'Runs the floor: work orders, daily output, bundles, machines, the weekly plan.', role: 'production_manager', centre: 'production', approve: 'head', guide: 'prod_manager' },
  { id: 'line_manager', name: 'Line manager', line: 'Runs one line: its bundles, its people, its output for the day.', role: 'line_manager', centre: 'production', approve: 'head', guide: 'prod_manager' },
  { id: 'masters', name: 'Tailor or master', line: 'Scans a bundle when starting it and again when it is finished.', role: 'operator', centre: 'production', approve: 'head', guide: 'tailor' },
  { id: 'merch', name: 'Merchandising head', line: 'Buys fabric and trims, asks for samples, keeps styles and collections right.', role: 'b2b', centre: 'merchandising', approve: 'admin', guide: 'merch' },
  { id: 'design', name: 'Designer', line: 'Develops each style from sketch to approved sample.', role: 'design', centre: 'design', approve: 'head', guide: 'everyone' },
  { id: 'stores', name: 'Stores, inward and outward', line: 'Receives, tags, stores and issues every roll and material, and moves dye lots.', role: 'stores', centre: 'stores', approve: 'head', guide: 'stores' },
  { id: 'qc', name: 'QC head', line: 'Inspects fabric, checks shade after dyeing, logs garment checks.', role: 'qc', centre: 'stores', approve: 'head', guide: 'qc' },
  { id: 'dispatch', name: 'E-com dispatch checker', line: 'Packs online orders, labels parcels, scans everything through the gate.', role: 'dispatch', centre: 'dispatch', approve: 'head', guide: 'dispatch' },
  { id: 'logistics', name: 'Logistics', line: 'Tracks parcels and checks courier invoices before they are paid.', role: 'logistics', centre: 'dispatch', approve: 'head', guide: 'logistics' },
  { id: 'sales', name: 'Sales, B2C and store', line: 'Looks after online and store orders, fit visits and returns.', role: 'sales', centre: 'dispatch', approve: 'head', guide: 'dispatch' },
  { id: 'finance', name: 'Finance', line: 'Keeps vouchers, bills and receivables right and sends them to Tally.', role: 'finance', centre: 'finance', approve: 'admin', guide: 'finance' },
  { id: 'hr', name: 'HR', line: 'Keeps employee records, attendance, leave, KRAs and payroll.', role: 'hr_admin', centre: 'people', approve: 'admin', guide: 'hr' },
  { id: 'marketing', name: 'Marketing', line: 'Plans campaigns and the content calendar.', role: 'marketing', centre: 'marketing', approve: 'head', guide: 'everyone' },
  { id: 'staff', name: 'Team member', line: 'Attendance, leave and own tasks.', role: 'staff', centre: '', approve: 'head', guide: 'everyone' },
];
export const positionById = Object.fromEntries(POSITIONS.map((p) => [p.id, p]));
/** The owner choices on a task: every position, by id and name. */
export const FUNCTIONS = POSITIONS.filter((p) => p.id !== 'staff').map((p) => [p.id, p.name]);

// [key, name, what it is for, [workstation name, production stage, stitching line]...]
// A stage is given only where the production plan schedules work: cut, stitch, finish, qc, pack.
export const DEFAULT_CENTRES = [
  ['management', 'Management', 'Direction, approvals and the system itself.', []],
  ['production', 'Production', 'Everything from cutting to packed goods, for wholesale, online and samples.', [
    ['Cutting', 'cut'], ['Stitching, B2B line', 'stitch', 'b2b'], ['Stitching, D2C line', 'stitch', 'd2c'], ['Sampling room', 'stitch', 'sample'], ['Finishing', 'finish'], ['Final QC', 'qc'], ['Packing', 'pack'],
  ]],
  ['merchandising', 'Merchandising', 'Fabric and trim buying, suppliers, styles, wholesale customers.', [['Sourcing desk']]],
  ['design', 'Design', 'Collections and the development of each style.', [['Design studio']]],
  ['stores', 'Stores and quality', 'Fabric and materials in and out, inspection before dyeing, the dye house.', [
    ['Fabric inward'], ['Fabric inspection table'], ['Fabric store'], ['Dye house desk'], ['Thread, trims and tools store'],
  ]],
  ['dispatch', 'Sales and dispatch', 'Online and store orders, parcels out, returns in, couriers.', [['E-com packing desk'], ['Dispatch gate'], ['Bombay store']]],
  ['finance', 'Finance', 'Vouchers, bills, receivables and Tally.', [['Accounts desk']]],
  ['people', 'People', 'Employee records, attendance, leave and payroll.', [['HR desk']]],
  ['marketing', 'Marketing', 'Campaigns and content.', [['Marketing desk']]],
];

/** The person in charge of a work centre, or null. `centres` is the list of work centre records. */
export const headOf = (centres, centreId) => (centres || []).find((c) => c.id === centreId)?.head || null;
/** Does this user lead any work centre (or this one)? */
export const isHead = (centres, user, centreId = null) => !!user && (centres || []).some((c) => c.head === user.id && (!centreId || c.id === centreId));

/** Is this task one of the user's? Named on it, or it belongs to their position and nobody is named. */
export const isMine = (task, user) => !!user && (task.assignee === user.id || (!task.assignee && !!task.ownerRole && task.ownerRole === user.position));

const KEYS = DEFAULT_CENTRES.map((c) => c[0]), STAGE_ORDER = ['cut', 'stitch', 'finish', 'qc', 'pack'];
/** Work centres in the order the business runs, then any added later by name. */
export const byCentre = (a, b) => ((KEYS.indexOf(a.key) + 1) || 99) - ((KEYS.indexOf(b.key) + 1) || 99) || String(a.name).localeCompare(String(b.name));
/** Workstations in the order work flows through them, then by name. */
export const byStation = (a, b) => ((STAGE_ORDER.indexOf(a.stage) + 1) || 9) - ((STAGE_ORDER.indexOf(b.stage) + 1) || 9) || String(a.name).localeCompare(String(b.name));
