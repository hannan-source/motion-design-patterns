// The Guide's content, as data. guide.js draws the Guide screen from it and plays the tours.
//
// GUIDE_ROLES: the kinds of team member a person can pick. `erp` lists the ERP roles (ids from
// ROLES in shared/schema.js) that usually hold it; the first is the closest match.
//
// TOURS: each has an id, a title, a one-line outcome, minutes, the guide roles it is for, a
// group ('start' for the bring-up-to-speed series, 'day' for daily work) and steps.
// A step is { route, target, title, text, hint? }:
//   route   the screen the step is on. A list means "the first of these this login may open".
//   target  a CSS selector on that screen, or null to talk over the screen.
//   title   a few words.   text  one or two short sentences.   hint  a small extra line.
// Two optional extras the player understands:
//   open    one selector, or a list pressed in order, when the target is not on screen yet.
//           Only for controls that show something (a tab, an Add form, a record, an action's
//           form); never one that saves, posts or deletes. The player refuses those.
//   alt     one selector or a list to point at when the target is not there, for example when
//           a list is still empty or this login may look but not add.
//
// This file imports nothing, so it can be checked with Node on its own.

export const GUIDE_ROLES = [
  { id: 'founder', name: 'Founder', line: 'Sees the whole business and the go-live at a glance, tests a change, and decides. Enters nothing.', erp: ['founder'] },
  { id: 'ops', name: 'Operations head', line: 'Runs the system day to day: logins, roles, approvals and the go-live plan.', erp: ['ops_head', 'admin'] },
  { id: 'prod_manager', name: 'Production manager', also: 'on the floor', line: 'Runs the floor: work orders, daily output, bundles, machines and the weekly plan.', erp: ['production_manager', 'line_manager'] },
  { id: 'prod_b2b', name: 'Production head, B2B', line: 'Owns wholesale orders from the customer\'s PO to shipped and invoiced.', erp: ['production_head', 'b2b'] },
  { id: 'merch', name: 'Merchandising head', line: 'Buys fabric and trims, asks for samples, and keeps styles and collections right.', erp: ['b2b', 'design'] },
  { id: 'stores', name: 'Stores, inward and outward', line: 'Receives, tags, stores and issues every roll and material, and moves dye lots.', erp: ['stores', 'qc'] },
  { id: 'qc', name: 'Quality', also: 'QC head', line: 'Inspects fabric, checks shade after dyeing, and logs garment checks.', erp: ['qc'] },
  { id: 'dispatch', name: 'E-com dispatch checker', line: 'Packs online orders, labels parcels and scans everything through the gate.', erp: ['dispatch', 'sales'] },
  { id: 'logistics', name: 'Logistics', line: 'Tracks parcels and checks courier invoices before they are paid.', erp: ['logistics'] },
  { id: 'finance', name: 'Finance', line: 'Keeps vouchers, bills and receivables right and sends them to Tally.', erp: ['finance'] },
  { id: 'hr', name: 'HR', line: 'Keeps employee records, attendance, leave, KRAs and payroll.', erp: ['hr_admin'] },
  { id: 'tailor', name: 'Tailor or master', also: 'scan only', line: 'Scans a bundle when starting it and again when it is finished.', erp: ['operator'] },
  { id: 'everyone', name: 'Everyone', also: 'attendance and leave', line: 'Checks in and out, applies for leave, and keeps up with own tasks.', erp: ['staff', 'marketing', 'design'] },
];

// Selectors that recur on every ERP list (see web/js/erp.js).
const ADD = '.erp-body [data-act="add"]';
const IMPORT = '.erp-body [data-act="import"]';
const TAGS = '.erp-body [data-act="tags"]';
const BAR = '.erp-body .flow';
const VIEWS = '.erp-body .toolbar .seg';
const TOOLBAR = '.erp-body .toolbar';
const LIST = '.erp-body .panel';
const ROW = '.erp-body [data-open]';
const TABS = '.erp .tabs';
const ACTS = '.drawer div.drawer-body:not(.stack) > .row'; // the action buttons on an open record
const FACTS = '.drawer .facts';
const tab = (id) => `.erp .tabs [data-tab="${id}"]`;
const act = (id) => `.drawer [data-action="${id}"]`;
const field = (k) => `.drawer #f-${k}`;
const lines = (k) => `.drawer [data-lines="${k}"]`;
const ACT_FORM = '.drawer .action-form';
const SAVE = '.drawer form [type="submit"]';
// The Production room shows a list of what is missing until there is something to plan.
const ROOM_GAPS = '.room .room-gaps';

export const TOURS = [
  // ───────── Bring the system up to speed ─────────
  {
    id: 'team', group: 'start', title: 'Work centres and your team', minutes: 4,
    outcome: 'Every work centre has a person in charge and every lead has a login.',
    roles: ['ops'],
    steps: [
      { route: 'org', target: '.org .og-grid', title: 'How Deme is organised', text: 'Each card is a work centre: a part of the business with one person in charge. A starting set is already here.' },
      { route: 'org', target: '.org .og-card .og-head', title: 'Name who is in charge', text: 'Press Name someone on each card. That person confirms the people who join, and requests to the work centre go to them.' },
      { route: 'org', target: '.org .og-card .og-stations', alt: '.org .og-card', title: 'Workstations', text: 'The places inside a work centre where work is done. The person in charge adds and changes these. The number is the headcount.' },
      { route: 'org', target: '.org [data-add-centre]', alt: '.org .og-grid', title: 'Add or rename', text: 'Change the set to match how Deme really runs. Only the system admin can add or remove a work centre.' },
      { route: 'm-admin', open: tab('team'), target: '.erp-body [data-user="new"]', title: 'Add each lead', text: 'Press this once for each person in charge. The rest of the team can sign in with Google and pick their own position.' },
      { route: 'm-admin', open: [tab('team'), '.erp-body [data-user="new"]'], target: '.drawer #uPos', title: 'Pick the position', text: 'The position sets the role and the work centre, and decides which go-live tasks are theirs.' },
      { route: 'm-admin', open: [tab('team'), '.erp-body [data-user="new"]'], target: '.drawer #uPass', title: 'Password, or Google', text: 'Leave it empty if they sign in with their Deme Google account. Otherwise type 8 characters or more and tell them in person.' },
      { route: 'journey', target: '.journey .jn-joins', alt: '.journey .jn-me', title: 'Confirm who joins', text: 'People who picked their own position wait here. Confirm the right ones; they get their access and their tasks.' },
      { route: 'm-admin', open: tab('roles'), target: '.erp-body .matrix', title: 'What each role can do', text: 'View is read only. Edit can add and change. Full can also approve, cancel and delete. Scan is the floor tier.' },
    ],
  },
  {
    id: 'import', group: 'start', title: 'Bring in existing lists', minutes: 4,
    outcome: 'The lists you already keep in spreadsheets are in Deme.',
    roles: ['ops', 'prod_manager', 'prod_b2b', 'merch', 'stores', 'finance', 'hr'],
    steps: [
      { route: 'import', target: '#siFile', title: 'Choose your file', text: 'Pick a spreadsheet you already keep, saved as CSV: suppliers, materials, styles, customers, employees or open orders. One list per file.' },
      { route: 'import', target: '#siPaste', title: 'Or paste the rows', text: 'Copy the rows from Excel or Google Sheets with the heading row on top, and paste them here.' },
      { route: 'import', target: '#siType', title: 'Say what it holds', text: 'Leave the first choice and Deme works out which list this is. Or pick the record type yourself.' },
      { route: 'import', target: '#siRead', title: 'Read the file', text: 'Press this. Deme reads the headings and suggests which column fills which field.' },
      { route: 'import', target: '.si-map', alt: '#siRead', title: 'Check the match', text: 'Each row is one column of your file. Change any that points at the wrong field, or leave it out.', hint: 'The match appears after you press Read the file.' },
      { route: 'import', target: '#siImport', alt: '#siRead', title: 'Import the rows', text: 'Press Import. Rows that fail a check are listed with the reason, so you can fix them and import again.', hint: 'The button appears under the match.' },
      { route: ['e-suppliers', 'e-employees', 'e-ledgers', 'e-work-orders'], target: TABS, title: 'Where the records land', text: 'Each list lands in its own module, under its tab. Open the tab and check a few rows against your sheet.' },
    ],
  },
  {
    id: 'lists', group: 'start', title: 'Reference lists by hand', minutes: 4,
    outcome: 'Materials, styles, workstation headcount, suppliers and customers are filled in.',
    roles: ['ops', 'prod_manager', 'prod_b2b', 'merch', 'stores'],
    steps: [
      { route: 'e-items', target: TABS, title: 'Masters come first', text: 'Every other screen points at these lists. Fill them before raising any order.' },
      { route: 'e-items', open: ADD, target: field('minLevel'), alt: [ADD, TOOLBAR], title: 'Materials with a minimum', text: 'Give each fabric, thread shade, trim and tool a code, a unit and a minimum level. Stock under the minimum shows on Today.' },
      { route: 'e-styles', open: ADD, target: field('smvStitch'), alt: [ADD, TOOLBAR], title: 'Styles with stitch minutes', text: 'Enter minutes per piece for cutting, stitching, finishing, QC and packing. The production plan is built from these.' },
      { route: 'e-workstations', open: ADD, target: field('people'), alt: [ADD, TOOLBAR], title: 'Workstations with headcount', text: 'Cutting, each stitching line, sampling, finishing, QC and packing are already listed under Production. Enter the people really on each today.' },
      { route: 'e-suppliers', target: ADD, alt: TOOLBAR, title: 'Suppliers', text: 'Add mills, dyers, trim vendors and couriers with payment terms. The Tally ledger name must match Tally exactly.' },
      { route: 'e-customers', target: ADD, alt: TOOLBAR, title: 'Customers', text: 'Add each wholesale account and your own store, with currency and payment terms.' },
      { route: 'home', target: '.hm-start', alt: '#hmBody', title: 'Watch the list tick off', text: 'Until the first work order, Today shows what is still missing. Each line ticks itself when its list has records.' },
    ],
  },
  {
    id: 'stock', group: 'start', title: 'Opening stock', minutes: 4,
    outcome: 'Every roll is tagged and on-hand figures match the shelves.',
    roles: ['ops', 'stores', 'qc'],
    steps: [
      { route: 'e-rolls', target: ADD, alt: TOOLBAR, title: 'Add each roll', text: 'One record per roll on the racks: fabric, metres, shade and location. A new roll starts as awaiting inspection.' },
      { route: 'e-rolls', target: TAGS, alt: TOOLBAR, title: 'Print roll tags', text: 'Print tags for the rolls on screen and stick one on each roll. Scanning a tag opens its roll.', hint: 'Print tags appears once there are rolls.' },
      { route: 'e-rolls', target: BAR, alt: LIST, title: 'See where rolls stand', text: 'The bar counts rolls by status. Press a part of it to list only those rolls.' },
      { route: 'e-stock-counts', target: ADD, alt: TOOLBAR, title: 'Count thread, trims and tools', text: 'Add one stock count for each area you count.' },
      { route: 'e-stock-counts', open: ADD, target: lines('lines'), alt: [ADD, TOOLBAR], title: 'Enter what you counted', text: 'One line per material with the quantity on the shelf. Save it as a draft while you count.' },
      { route: 'e-stock-counts', target: LIST, title: 'Post the count', text: 'Open the draft and press Post count. On hand moves to the counted quantity and the difference is recorded.' },
      { route: 'e-items', target: LIST, title: 'Check the levels', text: 'On hand now matches the shelves. The Level bar turns red where a material is under its minimum.' },
    ],
  },
  {
    id: 'golive', group: 'start', title: 'Create the go-live plan', minutes: 3,
    outcome: 'Every team has dated tasks for bringing Deme into daily use.',
    roles: ['ops'],
    steps: [
      { route: 'm-projects', target: '#tkPlan .tk-plan', alt: '#tkProjects', title: 'The go-live plan', text: 'A ready set of tasks in eight tracks, each with an owner and dates. It is a proposal you can change.', hint: 'This card goes away once the plan is created.' },
      { route: 'm-projects', target: '#tkPlanStart', alt: '#tkProjects', title: 'Pick the start date', text: 'Choose the day the team starts. The preview shows how the tracks fall across the weeks.' },
      { route: 'm-projects', target: '#tkPlanCreate', alt: '#tkProjects', title: 'Create the plan', text: 'Press this once. Every task is created with its owner by function and its due date.' },
      { route: 'm-projects', target: '#tkControls', alt: ['#tkPlan .tk-plan', '#tkProjects'], title: 'Board and timeline', text: 'Switch between the board and the timeline. Group the board by track or by owner.', hint: 'These controls appear once there are tasks.' },
      { route: 'm-projects', target: '#tkMain .tk-board, #tkMain .tk-g', alt: ['#tkMain', '#tkPlan .tk-plan', '#tkProjects'], title: 'Give tasks to people', text: 'Open a task to name the person, move its dates, or mark it started, blocked or done.' },
      { route: 'pulse', target: '.pulse .pl-sec[aria-label="Go-live"]', title: 'Follow it from the Founder view', text: 'The Founder view counts done, late and blocked tasks from the plan each time something changes.' },
    ],
  },

  // ───────── Founder ─────────
  {
    id: 'founder-view', group: 'day', title: 'Read the Founder view', minutes: 3,
    outcome: 'You can read the state of the business in one screen.',
    roles: ['founder', 'ops'],
    steps: [
      { route: 'pulse', target: '#plHeadline', title: 'The sentence at the top', text: 'It states the most pressing fact right now: late or blocked go-live tasks first, then work orders that will miss their date.' },
      { route: 'pulse', target: '.pulse .pl-sec[aria-label="Go-live"]', title: 'Go-live', text: 'How far the plan has come against where it should be today, by track and by owner.' },
      { route: 'pulse', target: '.pulse .pl-grid > .pl-block.pl-c8', title: 'Fabric pipeline', text: 'Where every metre of fabric stands: to inspect, passed, at the dyer, dyed, issued. Rejected fabric drops off the line.' },
      { route: 'pulse', target: '.pulse .pl-grid > .pl-col.pl-c7', title: 'Production and alerts', text: 'Open work orders stage by stage and how many will be late. Below: low stock, machines down, parcels and samples waiting.' },
      { route: 'pulse', target: '.pulse .pl-grid > .pl-col.pl-c5', title: 'Sales and money', text: 'Sales today and over 14 days. Below: what you owe suppliers and what customers owe you, with the overdue part marked.' },
      { route: 'pulse', target: '.pulse .pl-sec[aria-label="What just happened"]', alt: '#plLog', title: 'What just happened', text: 'The latest twelve changes anyone made, with who and when. The full trail is under Admin, Activity.' },
    ],
  },
  {
    id: 'map', group: 'day', title: 'Walk the business map', minutes: 3,
    outcome: 'You can find any place, flow or zone and see what the records say about it.',
    roles: ['founder', 'ops'],
    steps: [
      { route: 'map', target: '.map .map-inspector', title: 'The whole business', text: 'Fabric comes in on the left and garments leave on the right. This panel lists the places that need attention.' },
      { route: 'map', target: '.map .map-canvas', title: 'Click a place', text: 'Press any building. The panel shows what is there now, what is waiting and the records behind it.' },
      { route: 'map', target: '.map .map-layers', title: 'Click a flow', text: 'Material, goods, money and data each have a colour. Switch one off to see the others. Press a moving line to read that flow.' },
      { route: 'map', target: '.map .map-canvas', title: 'Click a zone', text: 'Press the ground under a group of buildings to see the zone as a whole: its places and what is late in it.' },
      { route: 'map', target: '.map .map-inspector .tour-list', alt: '.map .map-inspector', title: 'Walk through', text: 'Each button follows one thing end to end, a stop at a time, starting with a fabric roll.' },
      { route: 'map', target: '.map .map-home', alt: '.map .map-canvas', title: 'Back to the full view', text: 'Whole business clears what you picked and pulls back. Drag to turn, scroll or pinch to zoom.' },
    ],
  },
  {
    id: 'test-change', group: 'day', title: 'Test a change before agreeing to it', minutes: 3,
    outcome: 'You know what a rush order or a sample run moves before you say yes.',
    roles: ['founder', 'ops', 'prod_b2b'],
    steps: [
      { route: 'room', target: '#roomKpis', alt: ROOM_GAPS, title: 'The plan as it stands', text: 'The room schedules every open work order against the people on each line for the next eight weeks.' },
      { route: 'room', target: '.room .builder .group', alt: ROOM_GAPS, title: 'Describe the request', text: 'Choose a sample run or more of a style, then the style, the pieces and the date it is needed by. Nothing is saved.' },
      { route: 'room', target: '.room .builder [data-act="add"]', alt: ROOM_GAPS, title: 'Add to the plan', text: 'Press this and the plan is worked out again beside the current one. Add more than one request to test them together.' },
      { route: 'room', target: '.room .room-verdict', alt: ROOM_GAPS, title: 'Read the answer', text: 'It fits, the new work is late, or other dates slip. The orders that move are listed with how many days.' },
      { route: 'room', target: '.room .builder .group:nth-of-type(3)', alt: ROOM_GAPS, title: 'Ways to make it fit', text: 'Try overtime, more tailors or stitching sent outside, and choose who goes first. The cost per month is shown with the answer.' },
      { route: 'room', target: '#runList', alt: ['.room .builder', ROOM_GAPS], title: 'Agree to it', text: 'When you are happy, send it as a sample request or raise the work order from here. Clear removes the test.', hint: 'The buttons appear beside each request you add.' },
    ],
  },
  {
    id: 'approvals', group: 'day', title: 'Approve what is waiting', minutes: 2,
    outcome: 'Purchase orders, samples and leave are not held up by you.',
    roles: ['ops', 'founder'],
    steps: [
      { route: 'home', target: '.hm-panel', alt: '#hmBody', title: 'Needs attention', text: 'Purchase orders, sample requests and leave waiting for a yes or no show here. Press a row to open its list.' },
      { route: 'e-purchase-orders', target: BAR, alt: LIST, title: 'Drafts wait for you', text: 'Press Draft on the bar to list the purchase orders waiting for approval.' },
      { route: 'e-purchase-orders', open: ROW, target: act('po.approve'), alt: [ACTS, LIST], title: 'Approve', text: 'Open one, check the supplier, lines and total, then press Approve. Only then can it be marked as sent.' },
      { route: 'e-sample-requests', target: LIST, title: 'Sample requests', text: 'Approve raises a sample work order. Decline closes the request. Test the run in the Production room first.' },
      { route: 'e-leaves', target: LIST, title: 'Leave', text: 'Open a request and press Approve or Reject. The person sees the answer in My day.' },
    ],
  },

  // ───────── Production manager ─────────
  {
    id: 'morning', group: 'day', title: 'Your morning', minutes: 3,
    outcome: 'You know what is late, what is stopped and what to release before the shift starts.',
    roles: ['prod_manager', 'ops'],
    steps: [
      { route: 'home', target: '.work .kpis', alt: ['.hm-start', '#hmBody'], title: 'Today', text: 'Open work orders, how many are overdue, and today\'s orders. Counted fresh each time something changes.' },
      { route: 'home', target: '.hm-panel', alt: '#hmBody', title: 'Needs attention', text: 'Late or stopped things first, then things waiting on someone. Press a row to go where the work is done.' },
      { route: 'e-work-orders', target: BAR, alt: LIST, title: 'Work orders by status', text: 'Planned, released, in progress, done and on hold. Press a part of the bar to list only those.' },
      { route: 'e-work-orders', target: VIEWS, alt: TOOLBAR, title: 'List or board', text: 'The board shows one column per status. The list shows progress through the five stages on every row.' },
      { route: 'e-work-orders', open: ROW, target: act('wo.release'), alt: [ACTS, LIST], title: 'Release to floor', text: 'Open a planned work order and press Release to floor once fabric and thread are ready.' },
      { route: 'e-maintenance', target: ADD, alt: TOOLBAR, title: 'Log a breakdown', text: 'A machine stopped? Add an upkeep entry as Breakdown. The machine shows as down until you close the entry.' },
    ],
  },
  {
    id: 'output', group: 'day', title: 'Record the day\'s output', minutes: 3,
    outcome: 'Each work order shows how many pieces are through each stage.',
    roles: ['prod_manager'],
    steps: [
      { route: 'e-work-orders', target: LIST, title: 'Find the work order', text: 'At the end of the shift, open each work order that was worked on today.' },
      { route: 'e-work-orders', open: ROW, target: act('wo.output'), alt: [ACTS, LIST], title: 'Record output', text: 'On a released work order, press Record output.', hint: 'A planned work order has to be released to the floor first.' },
      { route: 'e-work-orders', open: [ROW, act('wo.output')], target: field('stage'), alt: [ACTS, LIST], title: 'Stage and pieces', text: 'Pick the stage and enter the pieces finished since the last entry, not the running total.' },
      { route: 'e-work-orders', open: [ROW, act('wo.output')], target: ACT_FORM, alt: [ACTS, LIST], title: 'The stage rule', text: 'A stage can never be ahead of the one before it. You cannot stitch more than were cut, or pack more than passed QC.' },
      { route: 'e-work-orders', open: ROW, target: FACTS, alt: LIST, title: 'The running count', text: 'Cut, stitched, finished, passed QC and packed add up here. When every piece is packed, the work order is done.' },
      { route: 'e-work-orders', target: LIST, title: 'Progress in the list', text: 'The five small bars on each row are the five stages, so you can see at a glance where each order is stuck.' },
    ],
  },
  {
    id: 'bundles', group: 'day', title: 'Bundles and scans', minutes: 3,
    outcome: 'Every bundle carries a tag and gives real minutes per piece.',
    roles: ['prod_manager'],
    steps: [
      { route: 'e-work-orders', open: ROW, target: act('wo.bundles'), alt: [ACTS, LIST], title: 'Make bundles', text: 'On a released work order, press Make bundles when the pieces are cut.' },
      { route: 'e-work-orders', open: [ROW, act('wo.bundles')], target: ACT_FORM, alt: [ACTS, LIST], title: 'How many, how big', text: 'Enter the number of bundles and the pieces in each. Every bundle gets its own number.' },
      { route: 'e-bundles', target: TAGS, alt: [TOOLBAR, LIST], title: 'Print bundle tags', text: 'Print the tags and tie one to each bundle at the cutting table.', hint: 'Print tags appears once there are bundles.' },
      { route: 'scan', target: '#scStation', title: 'The scan station', text: 'Each tablet on the line is named once with its station.' },
      { route: 'scan', target: '#scBundle', title: 'Start and finish', text: 'The tailor scans the tag when picking up a bundle and again when it is finished.' },
      { route: 'scan', target: '#scFloor', alt: '#scForm', title: 'Minutes per piece', text: 'Finished scans give real minutes per piece for each style, set against its standard. More than 10% over is flagged.' },
    ],
  },
  {
    id: 'week', group: 'day', title: 'Plan the week', minutes: 3,
    outcome: 'Next week\'s priorities are agreed on one schedule.',
    roles: ['prod_manager', 'prod_b2b'],
    steps: [
      { route: 'room', target: '#roomKpis', alt: ROOM_GAPS, title: 'Start from the plan', text: 'Worked out from open work orders, the people on each workstation and the minutes each style takes.' },
      { route: 'room', target: '.room .gantt', alt: ['.room .results', ROOM_GAPS], title: 'The timeline', text: 'Each bar runs from first cut to last piece packed. The upright mark is the due date. Red is time past it.' },
      { route: 'room', target: '.room .heat-table', alt: ['.room .results', ROOM_GAPS], title: 'Load by workstation', text: 'Darker weeks are busier. A ringed cell is a week with no spare minutes.' },
      { route: 'room', target: '.room .builder .group:nth-of-type(2)', alt: ROOM_GAPS, title: 'Things that go wrong', text: 'Slide in absent tailors, a faulty fabric lot or bigger orders and see which dates move.' },
      { route: 'room', target: '.room .builder .group:nth-of-type(3)', alt: ROOM_GAPS, title: 'What you can do about it', text: 'Try overtime, extra tailors or stitching sent outside, and choose who goes first.' },
      { route: 'room', target: '.room .room-verdict', alt: ROOM_GAPS, title: 'Agree the week', text: 'Read the answer with merchandising and B2B in the room, then release the work orders you agreed on.' },
      { route: 'room', target: '.room .assume', alt: ROOM_GAPS, title: 'Planning numbers', text: 'Lead times and costs the plan assumes. Change one and the plan is worked out again. Saved on this device only.' },
    ],
  },

  // ───────── Production head, B2B ─────────
  {
    id: 'po-to-wo', group: 'day', title: 'From customer PO to work orders', minutes: 4,
    outcome: 'A customer\'s order is on the floor with dates, and invoiced when it ships.',
    roles: ['prod_b2b'],
    steps: [
      { route: 'e-sales-orders', target: ADD, alt: TOOLBAR, title: 'Enter the customer\'s PO', text: 'Add a sales order with the customer, their PO number and the ship by date.' },
      { route: 'e-sales-orders', open: ADD, target: lines('lines'), alt: [ADD, TOOLBAR], title: 'One line per style', text: 'Enter the style, pieces and price on each line. Add line gives you another row.' },
      { route: 'e-sales-orders', open: ROW, target: act('so.confirm'), alt: [ACTS, LIST], title: 'Confirm it', text: 'Open the draft and press Confirm and raise work orders. One work order is raised per line, due on the ship by date.' },
      { route: 'e-work-orders', target: LIST, title: 'Follow the work orders', text: 'The new work orders show B2B, the customer and the due date. Production releases them and records output.' },
      { route: 'room', target: '.room .gantt', alt: ['.room .results', ROOM_GAPS], title: 'Check the dates', text: 'The Production room shows whether each order finishes by its date, and what a change would move.' },
      { route: 'e-sales-orders', open: ROW, target: act('so.invoice'), alt: [ACTS, LIST], title: 'Raise the invoice', text: 'On a confirmed or shipped order, press Raise invoice. A draft invoice is made from the order.' },
      { route: 'e-invoices', target: LIST, title: 'Post the invoice', text: 'Enter the rupees per unit of currency on the draft, then press Post invoice. The receivable opens in Finance.' },
    ],
  },

  // ───────── Merchandising head ─────────
  {
    id: 'po', group: 'day', title: 'Raise a purchase order', minutes: 3,
    outcome: 'Nothing is ordered without a PO number and an approval.',
    roles: ['merch', 'stores'],
    steps: [
      { route: 'e-purchase-orders', target: ADD, alt: TOOLBAR, title: 'Add a purchase order', text: 'Start every order here, before the supplier is called or messaged.' },
      { route: 'e-purchase-orders', open: ADD, target: field('supplier'), alt: [ADD, TOOLBAR], title: 'Supplier and date', text: 'Pick the supplier and the date the material is needed by.' },
      { route: 'e-purchase-orders', open: ADD, target: lines('lines'), alt: [ADD, TOOLBAR], title: 'What you are ordering', text: 'One line per material with quantity and rate. The total is worked out for you.' },
      { route: 'e-purchase-orders', open: ADD, target: SAVE, alt: [ADD, TOOLBAR], title: 'Save the draft', text: 'It is saved as a draft and waits for the founder or operations head to approve it.' },
      { route: 'e-purchase-orders', target: BAR, alt: LIST, title: 'Follow it', text: 'Draft, approved, sent, part received, received. Open an approved order and press Mark as sent when it goes out.' },
      { route: 'e-goods-receipts', target: LIST, title: 'When it arrives', text: 'Stores book the delivery as a goods receipt against your order, which moves it to part received or received.' },
    ],
  },
  {
    id: 'samples', group: 'day', title: 'Ask for samples the right way', minutes: 3,
    outcome: 'Each sample has a request, and production can see what it costs the plan.',
    roles: ['merch'],
    steps: [
      { route: 'room', target: '.room .builder .group', alt: ROOM_GAPS, title: 'Test the run first', text: 'In the Production room choose Sample run, the closest existing style, the pieces and the date you need them.' },
      { route: 'room', target: '.room .builder [data-act="add"]', alt: ROOM_GAPS, title: 'Add to the plan', text: 'Press this. Nothing is saved; the plan is only worked out again with your samples in it.' },
      { route: 'room', target: '.room .room-verdict', alt: ROOM_GAPS, title: 'Read the answer', text: 'If it does not fit, you are shown a later date that moves nothing, or what extra capacity would cost.' },
      { route: 'room', target: '#runList', alt: ['.room .builder', ROOM_GAPS], title: 'Send as sample request', text: 'Press Send as sample request beside the run you tested. No retyping.', hint: 'The button appears beside each run you add.' },
      { route: 'e-sample-requests', target: ADD, alt: TOOLBAR, title: 'Or add one directly', text: 'Pick the closest existing style, the number of samples and the date needed.' },
      { route: 'e-sample-requests', target: BAR, alt: LIST, title: 'Requested, approved, declined', text: 'Production approves or declines. Approving raises a sample work order, so the sample is on the plan like any order.' },
    ],
  },
  {
    id: 'styles', group: 'day', title: 'Styles and collections', minutes: 3,
    outcome: 'Each style has its fabric, thread, minutes and prices before it is sold.',
    roles: ['merch'],
    steps: [
      { route: 'e-collections', target: LIST, alt: TOOLBAR, title: 'Collections', text: 'Each collection has a season, a launch date and a planned number of styles. Design moves it forward.' },
      { route: 'e-developments', target: BAR, alt: LIST, title: 'Style development', text: 'Each style moves from sketch to pattern, sample, fit and approved. Dropped styles stay on record.' },
      { route: 'e-styles', target: ADD, alt: TOOLBAR, title: 'Add the approved style', text: 'Add it under Masters with its style code, collection and main fabric.' },
      { route: 'e-styles', open: ADD, target: field('metres'), alt: [ADD, TOOLBAR], title: 'Fabric and thread per piece', text: 'Enter fabric per piece in metres and thread cones per 100 pieces. Material checks use these.' },
      { route: 'e-styles', open: ADD, target: lines('bom'), alt: [ADD, TOOLBAR], title: 'Bill of materials', text: 'List the trims and other materials that go into one piece.' },
      { route: 'e-styles', open: ADD, target: field('wholesale'), alt: [ADD, TOOLBAR], title: 'Prices and status', text: 'Enter the wholesale and retail price. Keep the status at in development until the style can be sold.' },
    ],
  },

  // ───────── Stores ─────────
  {
    id: 'receive', group: 'day', title: 'Receive a delivery', minutes: 3,
    outcome: 'Every delivery is booked at the dock and its rolls are ready to inspect.',
    roles: ['stores'],
    steps: [
      { route: 'e-goods-receipts', target: ADD, alt: TOOLBAR, title: 'Add a goods receipt', text: 'Do this at the dock for every delivery, while the truck is still there.' },
      { route: 'e-goods-receipts', open: ADD, target: field('po'), alt: [ADD, TOOLBAR], title: 'Order and supplier', text: 'Pick the purchase order if there is one, then the supplier and the number on their invoice.' },
      { route: 'e-goods-receipts', open: ADD, target: lines('lines'), alt: [ADD, TOOLBAR], title: 'What arrived', text: 'One line per material with the quantity. For fabric, enter total metres and the number of rolls.' },
      { route: 'e-goods-receipts', open: ADD, target: SAVE, alt: [ADD, TOOLBAR], title: 'Save, then check', text: 'Save it as a draft and check it against the challan before posting.' },
      { route: 'e-goods-receipts', open: ROW, target: act('grn.post'), alt: [ACTS, LIST], title: 'Post receipt', text: 'Posting makes one record per fabric roll, adds other materials to stock, opens the supplier bill and writes the purchase voucher.' },
      { route: 'e-rolls', target: BAR, alt: LIST, title: 'Rolls wait for inspection', text: 'The new rolls are here, at the Dock, awaiting inspection. Tag them and give them a location next.' },
    ],
  },
  {
    id: 'tags', group: 'day', title: 'Tags, locations and issuing', minutes: 4,
    outcome: 'Anything in the store can be found by scanning, and every issue is on record.',
    roles: ['stores'],
    steps: [
      { route: 'e-rolls', target: TAGS, alt: TOOLBAR, title: 'Print tags', text: 'Search or filter first, then print. Only the rolls on screen are printed.', hint: 'Print tags appears once there are rolls.' },
      { route: 'e-rolls', open: ROW, target: '.drawer .tagview', alt: LIST, title: 'The tag on a roll', text: 'Each roll has its own barcode. Scan it anywhere in Deme and the roll opens.' },
      { route: 'e-rolls', open: ROW, target: '.drawer [data-edit]', alt: LIST, title: 'Set the location', text: 'Press Edit and type the rack or bin under Location, so anyone can find the roll.' },
      { route: 'e-rolls', open: ROW, target: act('roll.issue'), alt: [ACTS, LIST], title: 'Issue a roll to cutting', text: 'On a passed or dyed roll, press Issue to cutting and choose the work order it is for.' },
      { route: 'e-items', open: ROW, target: act('stock.adjust'), alt: [ACTS, LIST], title: 'Adjust stock', text: 'Counted something different? Enter the counted quantity and why. The correction is kept as a stock movement.' },
      { route: 'e-items', open: ROW, target: act('stock.issue'), alt: [ACTS, LIST], title: 'Issue to the floor', text: 'For thread, trims and tools: enter the quantity and the work order or station it goes to.' },
      { route: 'e-stock-moves', target: LIST, title: 'The trail', text: 'Every receipt, issue and correction is listed here. Nothing is typed over.' },
    ],
  },
  {
    id: 'dye', group: 'day', title: 'Send and receive a dye lot', minutes: 3,
    outcome: 'Every lot out has a record and comes back with accepted and failed metres.',
    roles: ['stores', 'qc'],
    steps: [
      { route: 'e-dye-lots', target: ADD, alt: TOOLBAR, title: 'Start a dye lot', text: 'Add one lot for each dye house and shade.' },
      { route: 'e-dye-lots', open: ADD, target: '.drawer [data-refs="rolls"]', alt: [ADD, TOOLBAR], title: 'Choose the rolls', text: 'Only rolls that passed inspection are listed. Tick the ones going out and set the due back date.' },
      { route: 'e-dye-lots', open: ROW, target: act('dye.send'), alt: [ACTS, LIST], title: 'Send to dyer', text: 'Open the draft and press Send to dyer when the rolls leave. They show as at the dyer.' },
      { route: 'e-dye-lots', open: ROW, target: act('dye.receive'), alt: [ACTS, LIST], title: 'Receive and check shade', text: 'When the lot is back, press this and tick any roll that failed on shade.' },
      { route: 'e-dye-lots', target: BAR, alt: LIST, title: 'What receiving does', text: 'Accepted rolls become dyed, in store. The dyer is billed for accepted metres only.' },
      { route: 'e-purchase-orders', target: ADD, alt: TOOLBAR, title: 'Order thread the same day', text: 'Raise the thread order by shade the day the lot goes out, so it arrives before the fabric returns.' },
    ],
  },

  // ───────── Quality ─────────
  {
    id: 'inspect', group: 'day', title: 'Inspect a roll', minutes: 3,
    outcome: 'No roll goes for dyeing without a score.',
    roles: ['qc'],
    steps: [
      { route: 'e-rolls', target: BAR, alt: LIST, title: 'Rolls awaiting inspection', text: 'Press Awaiting inspection on the bar to list the rolls that still need checking.' },
      { route: 'e-rolls', open: ROW, target: act('roll.inspect'), alt: [ACTS, LIST], title: 'Inspect', text: 'Open a roll that is awaiting inspection and press Inspect.' },
      { route: 'e-rolls', open: [ROW, act('roll.inspect')], target: field('points'), alt: [ACTS, LIST], title: 'Enter the score', text: 'Score the roll on the 4-point system. Enter the penalty points per 100 square yards and the defects you saw.' },
      { route: 'e-rolls', open: [ROW, act('roll.inspect')], target: ACT_FORM, alt: [ACTS, LIST], title: '40 or under passes', text: 'At 40 points or under the roll passes and can be put on a dye lot.' },
      { route: 'e-rolls', open: ROW, target: '.drawer .steps', alt: LIST, title: 'What a fail does', text: 'Over 40, the roll is rejected and a debit note is raised on the mill. Press Return to mill when it leaves.' },
      { route: 'e-inspections', target: LIST, title: 'Every score is kept', text: 'Each inspection is listed with the roll, points, result, defects and inspector.' },
    ],
  },
  {
    id: 'shade', group: 'day', title: 'Shade check on a dye lot', minutes: 2,
    outcome: 'Off-shade fabric is caught at the door and the dyer is billed only for good metres.',
    roles: ['qc'],
    steps: [
      { route: 'e-dye-lots', target: BAR, alt: LIST, title: 'Lots at the dyer', text: 'Press At the dyer on the bar to list the lots that are out.' },
      { route: 'e-dye-lots', open: ROW, target: act('dye.receive'), alt: [ACTS, LIST], title: 'Receive and check shade', text: 'When a lot comes back, open it and press Receive and check shade.' },
      { route: 'e-dye-lots', open: [ROW, act('dye.receive')], target: ACT_FORM, alt: [ACTS, LIST], title: 'Tick what failed', text: 'Tick each roll whose shade is off and write what was wrong. Leave good rolls unticked.' },
      { route: 'e-dye-lots', open: ROW, target: FACTS, alt: LIST, title: 'Accepted and failed metres', text: 'The lot keeps both figures. The dyer is billed for accepted metres only.' },
      { route: 'e-rolls', target: BAR, alt: LIST, title: 'Where the rolls go', text: 'Accepted rolls show as dyed, in store. Failed ones show as failed after dyeing.' },
    ],
  },
  {
    id: 'garment-checks', group: 'day', title: 'Log garment checks', minutes: 3,
    outcome: 'Every work order that ships has its checks on record.',
    roles: ['qc'],
    steps: [
      { route: 'e-qc-checks', target: ADD, alt: TOOLBAR, title: 'Add a garment check', text: 'Log one for every in-line round and every final check.' },
      { route: 'e-qc-checks', open: ADD, target: field('workOrder'), alt: [ADD, TOOLBAR], title: 'Work order and check', text: 'Pick the work order, then in-line or final.' },
      { route: 'e-qc-checks', open: ADD, target: field('checked'), alt: [ADD, TOOLBAR], title: 'The counts', text: 'Enter how many you checked and how many passed, went for rework or were rejected.' },
      { route: 'e-qc-checks', open: ADD, target: field('defects'), alt: [ADD, TOOLBAR], title: 'Defects', text: 'Write what was wrong in plain words, so the line knows what to fix.' },
      { route: 'e-qc-checks', target: LIST, title: 'The record', text: 'Checks are listed newest first with the work order, the counts and who checked.' },
      { route: 'e-work-orders', target: LIST, title: 'Passed QC on the work order', text: 'Production records pieces passed at Final QC on the work order. It can never be more than the pieces finished.' },
    ],
  },

  // ───────── E-com dispatch checker ─────────
  {
    id: 'pack', group: 'day', title: 'Pack and label an order', minutes: 3,
    outcome: 'Each online order has a parcel waiting at the gate with its tracking barcode.',
    roles: ['dispatch'],
    steps: [
      { route: 'e-shop-orders', target: IMPORT, alt: TOOLBAR, title: 'Bring in the orders', text: 'Until Shopify is connected, import the Shopify orders export here each morning.' },
      { route: 'e-shop-orders', target: BAR, alt: LIST, title: 'Orders to pack', text: 'Press New on the bar to list the orders not yet packed.' },
      { route: 'e-shop-orders', open: ROW, target: act('shop.pack'), alt: [ACTS, LIST], title: 'Pack and create parcel', text: 'Open the order, check style and size against the piece in your hand, then press Pack and create parcel.' },
      { route: 'e-shop-orders', open: [ROW, act('shop.pack')], target: field('awb'), alt: [ACTS, LIST], title: 'Scan the label', text: 'Scan or type the tracking barcode on the courier label and pick the carrier.' },
      { route: 'e-parcels', target: BAR, alt: LIST, title: 'The parcel waits', text: 'It shows as packed, not scanned, until it is scanned out at the Dispatch gate.' },
    ],
  },
  {
    id: 'gate', group: 'day', title: 'Scan parcels out, returns in', minutes: 3,
    outcome: 'Nothing leaves or comes back without a scan.',
    roles: ['dispatch', 'logistics'],
    steps: [
      { route: 'gate', target: '#gtBarcode', title: 'Scan the label', text: 'Scan the courier barcode on the parcel. A handheld scanner types it here and presses Enter.' },
      { route: 'gate', target: '#gtGo', title: 'Out', text: 'A packed parcel is scanned out. Its order is marked shipped and the sale is booked.' },
      { route: 'gate', target: '#gtLists .gt-panel:nth-child(1)', alt: '#gtForm', title: 'Packed, waiting for scan', text: 'Everything that is ready and has not passed the gate. Tap a row to put its barcode in the box.' },
      { route: 'gate', target: '#gtLists .gt-panel:nth-child(3)', alt: '#gtForm', title: 'In', text: 'If a parcel comes back, scan it again. It is scanned in as a return and you are asked for its condition.' },
      { route: 'gate', target: '#gtResult .wk-result', alt: '#gtForm', title: 'The answer', text: 'Each scan says what it did in large type under the box: scanned out, scanned in, or why not.' },
      { route: 'e-returns', target: BAR, alt: LIST, title: 'Decide the return', text: 'Open a received return, check the piece, then press Restock or Write off.' },
    ],
  },
  {
    id: 'store', group: 'day', title: 'Store pieces and fit visits', minutes: 3,
    outcome: 'Each store piece is tracked on every trip to the factory and back.',
    roles: ['dispatch'],
    steps: [
      { route: 'e-store-orders', target: ADD, alt: TOOLBAR, title: 'Add the store order', text: 'Every piece ordered or altered through the store gets a store order.' },
      { route: 'e-store-orders', open: ADD, target: field('tag'), alt: [ADD, TOOLBAR], title: 'The piece tag', text: 'Type or scan the barcode you tag the piece with. This is what the gate reads.' },
      { route: 'e-store-orders', target: TAGS, alt: TOOLBAR, title: 'Print the tags', text: 'Print tags for the store orders on screen and fix one to each piece.', hint: 'Print tags appears once there are store orders.' },
      { route: 'gate', target: '#gtBarcode', title: 'Scan it in', text: 'When a piece arrives for a fit, scan its tag and type what needs doing. A fit visit is counted on the order.' },
      { route: 'gate', target: '#gtLists .gt-panel:nth-child(2)', alt: '#gtForm', title: 'Store pieces at the factory', text: 'Pieces that are in for a fit or an alteration, with the visit number on each.' },
      { route: 'gate', target: '#gtForm', title: 'Scan it out', text: 'When the work is done, scan the tag again and enter the work minutes. The piece goes back to the store.' },
      { route: 'e-fit-visits', target: LIST, title: 'Fit visits', text: 'One line per trip: when it arrived, what was asked for, the work minutes and when it left.' },
    ],
  },

  // ───────── Logistics ─────────
  {
    id: 'courier', group: 'day', title: 'Match a courier invoice', minutes: 3,
    outcome: 'The courier is paid only for parcels that really shipped.',
    roles: ['logistics'],
    steps: [
      { route: 'e-courier-invoices', target: ADD, alt: TOOLBAR, title: 'Add the courier\'s invoice', text: 'Pick the courier and enter their invoice number and date.' },
      { route: 'e-courier-invoices', open: ADD, target: lines('lines'), alt: [ADD, TOOLBAR], title: 'One line per parcel', text: 'Enter each tracking number on the invoice with the amount billed for it.' },
      { route: 'e-courier-invoices', open: ROW, target: act('courier.match'), alt: [ACTS, LIST], title: 'Match against parcels', text: 'Open the invoice and press Match against parcels. Each line is checked against a parcel that was scanned out.' },
      { route: 'e-courier-invoices', open: ROW, target: '.drawer .table-wrap', alt: LIST, title: 'Read the Match column', text: 'Lines with no parcel, or billed twice, are marked. Take those up with the courier, correct the invoice and match again.' },
      { route: 'e-courier-invoices', open: ROW, target: act('courier.approve'), alt: [ACTS, LIST], title: 'Approve for payment', text: 'When every line matches, press Approve for payment. The bill opens in Finance and the freight voucher is written.' },
      { route: 'e-parcels', target: BAR, alt: LIST, title: 'Parcels', text: 'Every parcel with its status. Open one in transit to add a tracking update or mark it delivered.' },
    ],
  },

  // ───────── Finance ─────────
  {
    id: 'vouchers', group: 'day', title: 'Where vouchers come from', minutes: 3,
    outcome: 'You can trace any voucher back to the receipt, invoice or parcel behind it.',
    roles: ['finance'],
    steps: [
      { route: 'e-vouchers', target: tab('vouchers'), title: 'Vouchers', text: 'Every accounting entry is here, in Tally\'s own voucher types.' },
      { route: 'e-vouchers', target: LIST, title: 'Most write themselves', text: 'Posting a goods receipt writes Purchase. Posting an invoice writes Sales. Paying a bill writes Payment. Source names the record behind each.' },
      { route: 'e-vouchers', target: BAR, alt: TOOLBAR, title: 'In Tally or not', text: 'The bar splits vouchers into not in Tally and in Tally. Press a part to list only those.' },
      { route: 'e-vouchers', target: ADD, alt: TOOLBAR, title: 'Journals by hand', text: 'For anything Deme does not write itself, add a voucher with its type, debit ledger, credit ledger and amount.' },
      { route: 'e-ledgers', target: LIST, title: 'Ledger names', text: 'Rename the starter ledgers so each is spelt exactly as in Tally. A name that differs will not import.' },
    ],
  },
  {
    id: 'bills', group: 'day', title: 'Bills and payments', minutes: 3,
    outcome: 'What Deme owes and is owed is right, and every payment has a voucher.',
    roles: ['finance'],
    steps: [
      { route: 'e-bills', target: tab('bills'), title: 'Supplier bills', text: 'Bills open themselves when a receipt is posted, a dye lot is received or a courier invoice is approved.' },
      { route: 'e-bills', target: BAR, alt: LIST, title: 'Unpaid, part paid, paid', text: 'Press Unpaid on the bar to see what is still owed. The Paid bar on each row shows how much has gone out.' },
      { route: 'e-bills', open: ROW, target: act('bill.pay'), alt: [ACTS, LIST], title: 'Record payment', text: 'Open a bill, press Record payment, then enter the amount and the bank ledger. The payment voucher is written.' },
      { route: 'e-invoices', target: LIST, title: 'What customers owe', text: 'Posted invoices are the receivables. Open one and press Record payment when money comes in.' },
      { route: 'home', target: '.work .kpis', alt: '#hmBody', title: 'On Today', text: 'Owed to suppliers is counted from unpaid bills. Bills past their due date show under Needs attention.' },
    ],
  },
  {
    id: 'tally', group: 'day', title: 'Send vouchers to Tally', minutes: 2,
    outcome: 'Tally has every voucher once, and Deme knows which ones.',
    roles: ['finance'],
    steps: [
      { route: 'e-vouchers', target: '.erp-body [data-act="tally"]', alt: TOOLBAR, title: 'Tally export', text: 'Press Tally export. It gathers every voucher not yet in Tally.', hint: 'The button appears once there are vouchers.' },
      { route: 'e-vouchers', open: '.erp-body [data-act="tally"]', target: '.drawer #tallyXml', alt: TOOLBAR, title: 'The import file', text: 'This is Tally Prime import XML. Copy it, or download it as a file.' },
      { route: 'e-vouchers', open: '.erp-body [data-act="tally"]', target: '.drawer .drawer-body.stack > .row', alt: TOOLBAR, title: 'Import it in Tally', text: 'In Tally choose Import, then Transactions, and pick the file.' },
      { route: 'e-vouchers', open: '.erp-body [data-act="tally"]', target: '.drawer [data-mark]', alt: TOOLBAR, title: 'Mark as in Tally', text: 'After Tally accepts the file, press this so the same vouchers are not sent twice.' },
      { route: 'e-ledgers', target: LIST, title: 'If Tally rejects one', text: 'Check the ledger name here against Tally, correct it, and export again.' },
    ],
  },

  // ───────── HR ─────────
  {
    id: 'employees', group: 'day', title: 'Employees and logins', minutes: 3,
    outcome: 'Every person has a record, and everyone with a login is linked to theirs.',
    roles: ['hr'],
    steps: [
      { route: 'e-employees', target: ADD, alt: TOOLBAR, title: 'Add each employee', text: 'One record per person with code, department, designation and joining date.' },
      { route: 'e-employees', open: ADD, target: field('login'), alt: [ADD, TOOLBAR], title: 'Link the login', text: 'Choose the person\'s login here. Only then can they check in, apply for leave and see their KRAs.', hint: 'Logins are created by the founder or operations head under Admin.' },
      { route: 'e-employees', open: ADD, target: field('salary'), alt: [ADD, TOOLBAR], title: 'Monthly salary', text: 'Only HR admins see this figure. Payroll is built from it.' },
      { route: 'e-employees', target: IMPORT, alt: TOOLBAR, title: 'Import the staff list', text: 'If the list is already in a spreadsheet, import it here instead of typing.' },
      { route: 'e-kras', target: ADD, alt: TOOLBAR, title: 'Set KRAs', text: 'Add each person\'s key result areas for the period with a target and a weight. They see their own in My day.' },
    ],
  },
  {
    id: 'leave', group: 'day', title: 'Leave and attendance', minutes: 3,
    outcome: 'Attendance is complete each day and no leave request is left waiting.',
    roles: ['hr'],
    steps: [
      { route: 'myday', target: '#mdCheck', alt: ['#mdUnlinked', '#mdTasks'], title: 'Where people check in', text: 'Each person checks in and out from My day. That writes their attendance line for the day.' },
      { route: 'e-attendance', target: LIST, title: 'Attendance', text: 'One line per person per day. Open a line to correct a time or mark half day, leave or absent.' },
      { route: 'e-attendance', target: ADD, alt: TOOLBAR, title: 'Add a missed day', text: 'If someone could not check in, add their entry by hand.' },
      { route: 'e-leaves', target: BAR, alt: LIST, title: 'Leave requests', text: 'Requests made from My day wait here as applied.' },
      { route: 'e-leaves', open: ROW, target: act('leave.approve'), alt: [ACTS, LIST], title: 'Approve or reject', text: 'Open a request and press Approve or Reject. Approved leave, other than unpaid, is paid in payroll.' },
    ],
  },
  {
    id: 'payroll', group: 'day', title: 'Run payroll', minutes: 3,
    outcome: 'The month\'s pay is built from attendance and posted to Finance.',
    roles: ['hr'],
    steps: [
      { route: 'e-payroll-runs', target: ADD, alt: TOOLBAR, title: 'Start the month', text: 'Add one payroll run for the month.' },
      { route: 'e-payroll-runs', open: ADD, target: field('month'), alt: [ADD, TOOLBAR], title: 'The month', text: 'Type the year and month, like 2026-11, and save. The run starts as a draft.' },
      { route: 'e-payroll-runs', open: ROW, target: act('payroll.build'), alt: [ACTS, LIST], title: 'Build from attendance', text: 'Open the draft and press Build from attendance. Pay is salary times days present over working days in the month.' },
      { route: 'e-payroll-runs', open: ROW, target: '.drawer .table-wrap', alt: LIST, title: 'Check the lines', text: 'Check days paid and gross for each person. If a figure is wrong, fix the attendance and build again.' },
      { route: 'e-payroll-runs', open: ROW, target: act('payroll.post'), alt: [ACTS, LIST], title: 'Post payroll', text: 'Posting writes the salary journal in Finance. Statutory deductions are not worked out here yet.' },
    ],
  },

  // ───────── Tailor or master ─────────
  {
    id: 'scan', group: 'day', title: 'Start and finish a bundle', minutes: 2,
    outcome: 'Every bundle you stitch is scanned in and out.',
    roles: ['tailor'],
    steps: [
      { route: 'scan', target: '#scStation', title: 'Your station', text: 'Type the name of your station once. The tablet remembers it.' },
      { route: 'scan', target: '#scBundle', title: 'Scan the tag', text: 'Pick up a bundle and scan its tag.' },
      { route: 'scan', target: '#scStart', title: 'Start', text: 'Press Start bundle. Now stitch.' },
      { route: 'scan', target: '#scBundle', title: 'When it is done', text: 'Scan the same tag again.' },
      { route: 'scan', target: '#scFinish', title: 'Finish', text: 'Press Finish bundle. The screen shows your minutes per piece.' },
      { route: 'scan', target: '#scStarted', title: 'Your open bundles', text: 'Bundles you started and have not finished are listed here. Press Finish on one when it is done.' },
    ],
  },

  // ───────── Everyone ─────────
  {
    id: 'journey', group: 'start', title: 'Your journey', minutes: 2,
    outcome: 'You know what is yours to do and where to do it.',
    roles: ['ops', 'prod_manager', 'prod_b2b', 'merch', 'stores', 'qc', 'dispatch', 'logistics', 'finance', 'hr', 'everyone', 'founder'],
    steps: [
      { route: 'journey', target: '.journey .jn-me', alt: '.journey .view-head', title: 'Who you are here', text: 'Your position and your work centre. If you have not picked a position yet, this screen asks you to.' },
      { route: 'journey', target: '.journey .jn-progress', alt: '.journey .jn-me', title: 'How far you are', text: 'Your own steps of the go-live, done out of the total.' },
      { route: 'journey', target: '.journey .jn-now', alt: '.journey .jn-me', title: 'Do this now', text: 'The next step, the screen it is done on, and Show me how. Mark it done when it meets the test written on it.' },
      { route: 'journey', target: '.rail .bell', alt: '.topbar .bell', title: 'Notices', text: 'A task given to you, a request to your work centre, a comment or something you were waiting for shows up here, and in your email.' },
      { route: 'm-projects', target: '.tracker [data-ask]', alt: '.tracker', title: 'Ask another work centre', text: 'Need something from another team? Ask here. It goes to the person in charge, and you hear when it is done.' },
      { route: 'org', target: '.org .og-grid', title: 'Who is who', text: 'Every work centre, who runs it, its workstations and its people.' },
    ],
  },
  {
    id: 'myday', group: 'day', title: 'Check in, leave and your tasks', minutes: 2,
    outcome: 'Your attendance, leave and tasks are up to date.',
    roles: ['everyone', 'tailor'],
    steps: [
      { route: 'myday', target: '.rail a[data-route="myday"]', title: 'My day', text: 'Everyone has My day in the menu, whatever their role.' },
      { route: 'myday', target: '#mdCheckBtn', alt: ['#mdCheck', '#mdUnlinked'], title: 'Check in and out', text: 'Press Check in when you arrive and Check out when you leave.', hint: 'If you see a note about your login, ask HR to link it to your employee record.' },
      { route: 'myday', target: '#mdMonth', alt: '#mdUnlinked', title: 'This month', text: 'Days present, half days and leave days so far this month.' },
      { route: 'myday', target: '#mdLeaveForm', alt: '#mdUnlinked', title: 'Apply for leave', text: 'Pick the dates and the type, give a reason, and press Apply for leave. HR approves or rejects it.' },
      { route: 'myday', target: '#mdTasks', alt: '#mdKras', title: 'My tasks', text: 'Tasks given to you, soonest first. Press Done when one is finished.' },
      { route: 'myday', target: '#mdKras', alt: '#mdPassForm', title: 'My KRAs', text: 'Your key result areas for each period, with the target, weight and score.' },
      { route: 'myday', target: '#mdPassForm', title: 'Change my password', text: 'Type a new password twice, 8 characters or more.' },
    ],
  },
  {
    id: 'find', group: 'day', title: 'Find anything by scanning or typing', minutes: 2,
    outcome: 'You can get to any roll, bundle, parcel or document from its number.',
    roles: ['everyone', 'stores', 'dispatch'],
    steps: [
      { route: 'myday', target: '.rail .finder', title: 'Scan or find', text: 'This box is at the top of the menu on every screen.' },
      { route: 'myday', target: '#finderBox', title: 'Type any number', text: 'A roll, bundle, parcel barcode, store piece tag, material code, order number or document number. Then press Enter.' },
      { route: 'myday', target: '#finderBox', title: 'Where it takes you', text: 'A parcel opens the Dispatch gate. A bundle opens the Scan station. Anything else opens its record.' },
      { route: 'myday', target: '.rail .finder', title: 'With a scanner', text: 'With no field selected, a handheld scanner works from any screen. Just scan the tag.' },
      { route: 'myday', target: '#finderBox', title: 'If nothing is found', text: 'A red message says no record has that code. Check the tag and try again.' },
    ],
  },
];
