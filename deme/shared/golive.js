// The go-live plan: the steps Deme's teams take to bring the ERP into daily use, as a template
// of tasks with an owner by function, a start and a length in working days (Monday to Saturday).
// "Create the go-live plan" turns this into a real project with dated tasks that people can
// reassign, move and reschedule. It is a proposal to adjust, not a fixed schedule.

import { addWorkdays, iso } from './util.js';

export const FUNCTIONS = [
  ['founder', 'Founder'], ['ops', 'Operations head'], ['prod_manager', 'Production manager'], ['prod_b2b', 'Production head, B2B'],
  ['merch', 'Merchandising head'], ['stores', 'Stores, inward and outward'], ['dispatch', 'E-com dispatch checker'], ['qc', 'QC head'],
  ['logistics', 'Logistics'], ['finance', 'Finance'], ['hr', 'HR'], ['sales', 'Sales, B2C'], ['masters', 'Masters (input only)'], ['setup', 'Implementation team'],
];
export const TRACKS = [
  ['kickoff', 'Kick-off'], ['lists', 'Reference lists'], ['stock', 'Stock truth'], ['inward', 'Inward flow'],
  ['floor', 'Floor'], ['dispatch', 'Dispatch and sales'], ['finance', 'Finance and people'], ['run', 'Run and review'],
];
export const GOLIVE_NAME = 'Go live with Deme ERP';

// [track, title, owner, start day, working days, needs input from, done when, screen it opens]
const T = [
  ['kickoff', 'Name one owner for each track and agree the go-live date', 'founder', 0, 1, 'Operations head', 'Each track below has a named owner and the date is announced.', ''],
  ['kickoff', 'Create a login and role for every team lead', 'ops', 0, 2, '', 'Each lead has signed in once.', 'm-admin'],
  ['kickoff', 'Walk each team through its own screens', 'setup', 1, 3, 'All team leads', 'Every lead has added and deleted one practice record.', ''],
  ['kickoff', 'Buy handheld barcode scanners and a label printer', 'ops', 0, 5, 'Stores, production manager', 'Two scanners at the gate, one per stitching line, and tags print cleanly.', ''],
  ['kickoff', 'Agree the fabric pass mark and who inspects', 'qc', 2, 2, 'Masters', 'The pass mark and the inspector are written down and shared with stores.', ''],

  ['lists', 'Enter suppliers: mills, dyers, trim vendors, couriers', 'merch', 2, 3, 'Finance for payment terms', 'Every supplier paid in the last 12 months is listed with terms.', 'e-suppliers'],
  ['lists', 'Enter B2B customers and the store', 'prod_b2b', 2, 2, '', 'Every customer with an open order is listed with currency and terms.', 'e-customers'],
  ['lists', 'Enter materials with minimum levels: fabrics, thread shades, trims, tools', 'stores', 3, 5, 'Masters for needle, shear and thread minimums', 'Every material in use has a code, a unit and a minimum level.', 'e-items'],
  ['lists', 'Enter work centres with the real headcount on each line', 'prod_manager', 3, 1, 'Masters', 'Cutting, each stitching line, sampling, finishing, QC and packing show today\'s headcount.', 'e-work-centres'],
  ['lists', 'List every machine with a code painted on it', 'prod_manager', 4, 3, 'Masters', 'Each machine on the floor has a code that matches its record.', 'e-machines'],
  ['lists', 'Enter the 20 best-selling styles with fabric and thread per piece', 'merch', 4, 5, 'Masters for fabric per piece', 'Each style has its fabric, shade, metres and thread per 100 pieces.', 'e-styles'],
  ['lists', 'Time three bundles of each best-seller and enter the minutes', 'prod_manager', 6, 6, 'Masters time the bundles on the line', 'Each style has minutes for all five stages from timed runs, not estimates.', 'e-styles'],
  ['lists', 'Match ledger names to Tally', 'finance', 4, 2, '', 'Every ledger name is spelt exactly as in Tally.', 'e-ledgers'],
  ['lists', 'Import employees and link each login', 'hr', 4, 3, '', 'Every employee is listed; everyone with a login is linked.', 'e-employees'],
  ['lists', 'Enter the remaining active styles', 'merch', 9, 6, 'Masters', 'Every style with an open order is in the list.', 'e-styles'],

  ['stock', 'Give every rack and bin a location name', 'stores', 6, 2, '', 'Location labels are on the racks and used on records.', ''],
  ['stock', 'Print roll tags and tag every roll in the fabric store', 'stores', 6, 4, '', 'Every roll on the racks has a tag and a record with metres and location.', 'e-rolls'],
  ['stock', 'Count thread, trims and tools and post the opening count', 'stores', 8, 4, 'Masters for what is at the stations', 'The opening stock count is posted and on-hand figures match the shelves.', 'e-stock-counts'],
  ['stock', 'Audit the unaudited store, first half: oldest rolls', 'stores', 10, 6, 'QC inspector', 'Each roll is tagged, inspected and marked passed or rejected.', 'e-rolls'],
  ['stock', 'Audit the unaudited store, second half', 'stores', 16, 6, 'QC inspector', 'The room is empty of untagged fabric.', 'e-rolls'],
  ['stock', 'Decide what happens to rejected old stock', 'founder', 22, 2, 'Finance, QC head', 'Each rejected roll is returned, sold off or written off.', 'e-rolls'],

  ['inward', 'Raise every new purchase order in the system', 'merch', 12, 2, '', 'No order is placed by phone or message without a PO number.', 'e-purchase-orders'],
  ['inward', 'Book every delivery at the dock as a goods receipt', 'stores', 12, 6, '', 'One full week of receipts matches the supplier invoices.', 'e-goods-receipts'],
  ['inward', 'Inspect every new roll before it can go for dyeing', 'qc', 12, 6, 'Stores', 'A week with no uninspected roll on a dye lot.', 'e-rolls'],
  ['inward', 'Send and receive dye lots through the system', 'stores', 14, 6, 'QC head for the shade check', 'Every lot out has a record and comes back with accepted and failed metres.', 'e-dye-lots'],
  ['inward', 'Order thread by shade the day a dye lot goes out', 'merch', 16, 4, 'Masters for cones per style', 'Thread for each lot arrives before the fabric returns.', 'e-purchase-orders'],
  ['inward', 'Send the first debit note to a mill for a failed roll', 'finance', 18, 3, 'QC head', 'The mill has the claim with the inspection record attached.', 'e-vouchers'],

  ['floor', 'Enter the open B2B order book and confirm it', 'prod_b2b', 18, 3, 'Merchandising head', 'Every open customer PO has work orders with ship-by dates.', 'e-sales-orders'],
  ['floor', 'Enter this month\'s Shopify and store lots as work orders', 'prod_manager', 18, 2, 'Sales', 'Everything being cut or stitched today has a work order.', 'e-work-orders'],
  ['floor', 'Record output per stage at the end of every shift', 'prod_manager', 20, 6, 'Masters report the counts', 'Six working days recorded with no gaps.', 'e-work-orders'],
  ['floor', 'Log in-line and final QC checks', 'qc', 22, 6, '', 'Every work order shipped this week has a final check logged.', 'e-qc-checks'],
  ['floor', 'Log every machine breakdown and service', 'prod_manager', 22, 6, 'Masters', 'The down-machine list matches the floor each morning.', 'e-maintenance'],
  ['floor', 'Run the first weekly planning meeting from the Production room', 'prod_manager', 24, 1, 'Merchandising head, production head B2B', 'Next week\'s priorities are agreed on one schedule.', 'room'],
  ['floor', 'Take sample requests only through the system', 'merch', 24, 2, 'Production manager', 'Each new sample has a request and, once approved, a work order.', 'e-sample-requests'],
  ['floor', 'Pilot bundle tags and scanning on one line', 'prod_manager', 24, 6, 'Masters brief the tailors', 'One line scans every bundle in and out for a week.', 'scan'],
  ['floor', 'Roll bundle scanning out to all lines', 'prod_manager', 30, 6, 'Masters', 'Every line scans; unscanned bundles are the exception.', 'scan'],
  ['floor', 'Compare scanned minutes with the style minutes and correct them', 'prod_manager', 36, 2, 'Masters', 'Styles more than 10% off their standard are corrected or explained.', 'scan'],

  ['dispatch', 'Import Shopify orders every morning', 'sales', 24, 6, '', 'Every online order is in the system the day it is placed.', 'e-shop-orders'],
  ['dispatch', 'Check each e-com piece against its order, then pack and label', 'dispatch', 26, 6, '', 'Every parcel has a record with its tracking barcode before it is sealed.', 'e-shop-orders'],
  ['dispatch', 'Scan every parcel out at the gate', 'dispatch', 26, 6, 'Logistics', 'A week where parcels scanned out equal parcels the courier collected.', 'gate'],
  ['dispatch', 'Scan returns in and decide restock or write-off', 'dispatch', 28, 6, 'QC head', 'Every return has a record and a decision within two days.', 'e-returns'],
  ['dispatch', 'Tag store pieces and scan every fit visit in and out', 'sales', 28, 6, 'Masters give the work minutes', 'Each store piece shows its visits, time in the factory and work done.', 'e-store-orders'],
  ['dispatch', 'Match the first courier invoice against scanned parcels', 'logistics', 32, 2, 'Finance', 'Every line is matched or disputed before the invoice is approved.', 'e-courier-invoices'],

  ['finance', 'Review a week of vouchers and import them into a test company in Tally', 'finance', 30, 3, '', 'The test import shows no ledger errors.', 'e-vouchers'],
  ['finance', 'Start daily check-in and check-out for office staff', 'hr', 30, 6, '', 'A week of attendance with no missing days.', 'e-attendance'],
  ['finance', 'Record supplier payments and customer receipts', 'finance', 32, 6, '', 'Bills and invoices show what is still owed, to the rupee.', 'e-bills'],
  ['finance', 'Raise B2B invoices from sales orders', 'finance', 32, 4, 'Production head, B2B', 'Every shipped order has a posted invoice.', 'e-invoices'],
  ['finance', 'Import vouchers into the live Tally company', 'finance', 38, 2, '', 'One week of vouchers is in Tally and marked as sent.', 'e-vouchers'],
  ['finance', 'Run a trial payroll and compare it with last month', 'hr', 38, 3, 'Finance', 'Differences from last month are explained person by person.', 'e-payroll-runs'],

  ['run', 'Two weeks with the ERP as the only record', 'ops', 36, 12, 'Every team lead', 'No parallel notebook or spreadsheet for receipts, stock, output or dispatch.', ''],
  ['run', 'Founder review every week from the dashboard', 'founder', 36, 12, 'Operations head', 'Each review ends with at most three decisions, recorded as tasks.', 'pulse'],
  ['run', 'Decide the first camera pilot: the fabric inspection rig', 'founder', 44, 3, 'QC head, operations head', 'A yes or no, with a budget and an owner if yes.', ''],
  ['run', 'Retire the old spreadsheets', 'ops', 46, 2, '', 'Old files are archived read-only.', ''],
];

export const GOLIVE_TEMPLATE = T.map(([track, title, ownerRole, startDay, days, needs, doneWhen, opens]) => ({ track, title, ownerRole, startDay, days, needs, doneWhen, opens }));

const stepTo = (status, verb) => ({ run(ctx, _p, doc) { ctx.setStatus('tasks', doc, status, `Task ${verb}: ${doc.title}`); return { message: `Task ${verb}.` }; } });

export const GOLIVE_ACTIONS = {
  /** Build the go-live project and its dated tasks from the template. */
  'golive.create': {
    module: 'projects', level: 'write',
    run(ctx, { start }) {
      if (ctx.all('projects').some((p) => p.kind === 'golive')) ctx.fail('The go-live plan already exists. Open it under Projects.');
      const from = start && /^\d{4}-\d{2}-\d{2}$/.test(start) ? new Date(`${start}T00:00:00`) : new Date(`${ctx.today}T00:00:00`);
      const last = Math.max(...GOLIVE_TEMPLATE.map((t) => t.startDay + t.days - 1));
      const project = ctx.put('projects', { name: GOLIVE_NAME, kind: 'golive', owner: ctx.user.id, start: iso(addWorkdays(from, 0)), due: iso(addWorkdays(from, last)), about: 'The steps each team takes to bring the ERP into daily use.' });
      for (const t of GOLIVE_TEMPLATE) {
        ctx.put('tasks', { project: project.id, title: t.title, track: t.track, ownerRole: t.ownerRole, start: iso(addWorkdays(from, t.startDay)), due: iso(addWorkdays(from, t.startDay + t.days - 1)), needs: t.needs, doneWhen: t.doneWhen, opens: t.opens });
      }
      ctx.log('projects', project.id, 'created', `Go-live plan created with ${GOLIVE_TEMPLATE.length} tasks`);
      return { message: `Go-live plan created: ${GOLIVE_TEMPLATE.length} tasks from ${iso(addWorkdays(from, 0))}.`, data: { project: project.id } };
    },
  },
  /** Move a task to any column of the board. */
  'task.move': {
    module: 'projects', level: 'write',
    run(ctx, { id, status }) {
      const doc = ctx.get('tasks', id) || ctx.fail('That task no longer exists.');
      if (!['todo', 'doing', 'blocked', 'done'].includes(status)) ctx.fail('Unknown column.');
      if (doc.status !== status) { if (status === 'done') doc.doneOn = ctx.today; ctx.setStatus('tasks', doc, status, `Task moved to ${status}: ${doc.title}`); }
      return { message: null };
    },
  },
  'task.start': stepTo('doing', 'started'),
  'task.block': { run(ctx, { reason }, doc) { doc.blockedBy = reason || ''; ctx.setStatus('tasks', doc, 'blocked', `Task blocked: ${doc.title}${reason ? ` (${reason})` : ''}`); return { message: 'Marked as blocked.' }; } },
  'task.done': { run(ctx, _p, doc) { doc.doneOn = ctx.today; ctx.setStatus('tasks', doc, 'done', `Task done: ${doc.title}`); return { message: 'Task done.' }; } },
  'task.reopen': stepTo('todo', 'reopened'),
};
