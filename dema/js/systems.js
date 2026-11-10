// Systems view: what gets attached to the business map, and in what order.
// System names and the places they watch come from ontology.js, so this page stays in step with the map.

import { SYSTEMS, SYSTEM_KINDS, NODES } from './ontology.js';
import { esc } from './util.js';

const ERP_MODULE = {
  'erp-inbound': 'inbound', 'erp-inventory': 'inventory', 'erp-dye': 'dye', 'erp-floor': 'floor', 'erp-dispatch': 'dispatch',
};

// ── Content ──────────────────────────────────────────────────────────────────

const VISION = [
  {
    id: 'vision-roll',
    watches: 'Every metre of every roll as it is wound across the inspection frame, lit from behind and from above.',
    writes: 'A defect map for the roll (type, position in metres, photo), a 4-point score per 100 square yards, and a pass or fail on the roll record.',
    removes: 'Faulty fabric reaching the dyer unseen. A roll that fails here goes back undyed, while the mill still has to take it. This is the loss the production head puts north of $250,000 a year.',
    hardware: 'A line-scan camera over a motorised inspection frame with back and top lighting, an encoder on the roller so each defect has a metre position, and a small PC at the rig.',
    person: 'Loads the roll, confirms or overrules each flagged defect, and makes the call on borderline rolls.',
  },
  {
    id: 'vision-shelf',
    watches: 'QR tags on rolls in the unaudited store and on the fabric racks.',
    writes: 'Which roll is in which location and a count per rack. It raises a mismatch when a tagged roll is missing or an untagged roll appears.',
    removes: 'The dark room nobody can count. Planning can rely on what is on the shelf, so the same fabric is not bought twice.',
    hardware: 'Fixed IP cameras reading printed QR tags. The unaudited store needs proper lighting first.',
    person: 'Tags each roll once during the audit and walks the mismatches the cameras raise.',
  },
  {
    id: 'vision-thread',
    watches: 'The cone wall in the thread store, with one shade per slot and the shade code on each slot label.',
    writes: 'A cone count per shade code, compared with the minimum level.',
    removes: 'Lines waiting while a runner goes to the market, and nobody knowing which shades are in stock.',
    hardware: 'One fixed camera facing re-racked, labelled shelving. The slot label carries the shade code, because close shades cannot be told apart reliably by colour on camera.',
    person: 'Keeps one shade per slot and confirms the count when a slot is blocked from view.',
  },
  {
    id: 'vision-shade',
    watches: 'A swatch from each returned dye lot beside the approved swatch, under fixed lighting.',
    writes: 'A shade difference reading, accept or refer on the dye lot, and the accepted metres.',
    removes: 'Shade differences surfacing on the cutting table, and paying the dyer for metres that cannot be used.',
    hardware: 'A light box with controlled lighting and a colour-calibrated camera or handheld colour reader.',
    person: 'Approves the master swatch each season and decides every referred lot.',
  },
  {
    id: 'vision-gate',
    watches: 'Every parcel, carton and store piece that passes the dispatch gate, going out or coming back.',
    writes: 'A scan event against the order (out, return in, fit visit in, fit visit out), the stock change, and for store pieces the visit count and time spent in the factory.',
    removes: 'Shopify shipments that never reach the inventory count, and store pieces that travel two or three times with no trail.',
    hardware: 'A phone or a fixed camera at the packing table that reads the DHL waybill barcode and Dema\'s own tags.',
    person: 'Presents the parcel and picks the reason for a return or fit visit.',
  },
];

const AGENTS = [
  {
    id: 'agent-planner',
    trigger: 'A change to orders, capacity, stock or scans, or a what-if question in the Production room.',
    does: 'Re-runs the schedule, updates promise dates, shows which orders move and by how many days, and lists the options: overtime, another line, a later date.',
    never: 'Changes a confirmed customer date or moves work between lines. The production head approves those.',
  },
  {
    id: 'agent-claims',
    trigger: 'A roll fails inspection before dyeing.',
    does: 'Drafts the claim to the mill with defect photos, positions and score, and prepares the debit note.',
    never: 'Sends the claim or posts the debit note. A person reads and sends it.',
  },
  {
    id: 'agent-thread',
    trigger: 'A dye lot is sent to the dye house.',
    does: 'Works out the cones needed for that shade from the orders the lot covers, compares with the cone count, and drafts a purchase request for the gap.',
    never: 'Places the order or substitutes a near shade. A person approves the purchase.',
  },
  {
    id: 'agent-books',
    trigger: 'Any factory event that carries money: receipt, rejection, dye bill, sale, payment.',
    does: 'Creates the Tally voucher with a link to its source, posts routine ones, and checks daily that both sides agree.',
    never: 'Posts anything unusual on its own: a new ledger, a write-off, an amount outside the normal range. Those wait for the accountant. It never edits or deletes a voucher in Tally.',
  },
];

const CONNECTORS = [
  {
    id: 'conn-shopify', dir: 'Both ways',
    moves: 'In: new orders, cancellations, return requests. Out: fulfilment with the tracking number, and stock levels.',
    how: 'Shopify Admin API, with webhooks for orders, fulfilments and inventory.',
  },
  {
    id: 'conn-dhl', dir: 'Mostly in',
    moves: 'In: tracking events for each parcel and carton. Out: nothing at first. Labels keep coming the way they do today.',
    how: 'DHL Express tracking API, keyed by the waybill (AWB) number the gate camera reads off the label.',
  },
  {
    id: 'conn-tally', dir: 'Both ways',
    moves: 'Out: vouchers for purchases, debit notes, dye bills, sales, receipts and payments. In: ledger and stock item names, and entries the accounts team makes directly.',
    how: 'Tally Prime XML over its local HTTP port, through a small bridge on the accounts PC. The plan is in docs/TALLY-CONNECTOR.md.',
  },
  {
    id: 'conn-b2b', dir: 'In',
    moves: 'In: Revolve and buyer purchase orders with styles, quantities and delivery windows.',
    how: 'Portal exports and email, read into draft work orders that a person confirms.',
  },
];

const PHASES = [
  {
    name: 'The map and an example-data ERP',
    tag: 'This build',
    live: ['The business map, the Production room and the ERP screens, all on example data.'],
    needs: ['A walkthrough with the founder and the production head to correct the map.'],
    check: 'The team agrees the map matches how the business runs, and every correction they raise is closed.',
  },
  {
    name: 'Stop the fabric loss',
    live: ['Goods receipts at the dock and a QR tag on every roll.', 'Inspection before dyeing: a trained checker first, with the rig advising.', 'A hard rule: only a passed roll can go on a dye challan.', 'A one-time audit of the unaudited store.'],
    needs: ['One checker and one storekeeper who own the step.', 'A label printer, the inspection frame, and lighting in the dark room.', 'The supplier list and open purchase orders.'],
    check: 'No roll leaves for the dyer without a pass on record. The value of post-dye rejections falls month on month. Every roll in the dark room has a tag and a status.',
  },
  {
    name: 'Floor truth',
    live: ['Bundle tags printed at cutting.', 'A scan at the start and finish of each stage.', 'Real minutes per piece by style.', 'The live schedule in the Production room, built from those scans.'],
    needs: ['A scan point for each line and stage (a phone is enough).', 'The floor supervisors owning the scans.', 'The style master, with stitch times or a week of timing.'],
    check: 'Pieces scanned through each stage match pieces packed, day by day. Promise dates from the schedule are tracked against actual dispatch every week.',
  },
  {
    name: 'The dispatch gate, Shopify and DHL',
    live: ['One gate for parcels out, returns in and store fit visits.', 'Shopify orders flowing into the queue, and shipping status flowing back.', 'DHL tracking on every order.'],
    needs: ['Shopify and DHL API access.', 'A camera or phone at the packing table.', 'The store sending and receiving pieces with their tags.'],
    check: 'Every Shopify order marked shipped has a gate scan. A weekly stock count matches the system. Every store piece shows its visit history.',
  },
  {
    name: 'The Tally bridge',
    live: ['Vouchers posted to Tally from factory events, each with its source.', 'A daily reconciliation the accountant can read.'],
    needs: ['The accountant\'s time to agree ledgers and tax treatment.', 'The Tally version and chart of accounts.', 'The accounts PC running the bridge.'],
    check: 'Voucher counts and totals match on both sides every day. The accounts team no longer re-keys factory paperwork.',
  },
  {
    name: 'Cameras on stock, agents on routine work',
    live: ['The thread wall camera and the shelf cameras.', 'The agents drafting claims, thread orders and vouchers as daily routine.'],
    needs: ['A re-racked thread wall with one shade per slot.', 'Agreed approval rules for each agent.'],
    check: 'A month with no line stop logged for missing thread. Camera counts match spot checks. Most agent drafts are approved without changes.',
  },
];

const NEEDS = [
  ['Style master', 'Each style with its fabric, metres per piece and stitch time. If stitch times are not known, one week of timing on the bestsellers.'],
  ['Order book', 'An export of open B2B and D2C orders with quantities and due dates.'],
  ['Suppliers and ledgers', 'The supplier list and the ledger list as they are named in Tally.'],
  ['Shopify and DHL access', 'API access to the Shopify store and the DHL account.'],
  ['Floor plan', 'A plan of the factory with dimensions, so the map and the camera positions are true to the building.'],
  ['Defect rolls', 'A set of rejected rolls and photos of past defects, for the vision pilot.'],
];

// ── Rendering ────────────────────────────────────────────────────────────────

const nodesFor = (sysId) => NODES.filter((n) => (n.systems || []).includes(sysId));
const nodeButtons = (sysId) => {
  const ns = nodesFor(sysId);
  if (!ns.length) return '';
  return `<div class="sys-where"><span class="sys-where-label">On the map</span>${ns.map((n) => `<button type="button" class="sys-node" data-node="${esc(n.id)}">${esc(n.name)}</button>`).join('')}</div>`;
};
const kindTag = (kind) => `<span class="tag ${SYSTEM_KINDS[kind].tag}">${esc(SYSTEM_KINDS[kind].name)}</span>`;
const idsOf = (kind) => Object.keys(SYSTEMS).filter((id) => SYSTEMS[id].kind === kind);

function diagram() {
  const bands = [
    { cls: 'cap', title: 'Capture', sub: 'Cameras, scans and people', items: [...idsOf('vision').map((id) => SYSTEMS[id].name), 'Bundle tag scans', 'Entries by people'] },
    { cls: 'rec', title: 'The ERP record', sub: 'One record of everything physical', items: ['Rolls and dye lots', 'Thread, trims and tools', 'Orders and bundles', 'Parcels and store visits', 'Vouchers', 'Event log'] },
    { cls: 'agt', title: 'Planner and agents', sub: 'Work from the record', items: [...idsOf('agent').map((id) => SYSTEMS[id].name), 'Production room'] },
    { cls: 'con', title: 'Connectors', sub: 'Systems outside the factory', items: idsOf('connector').map((id) => SYSTEMS[id].name) },
  ];
  const W = 232, G = 112, X0 = 12, TOP = 12, HEAD = 62, STEP = 40, IH = 30;
  const rows = Math.max(...bands.map((b) => b.items.length));
  const H = HEAD + rows * STEP + 14;
  const VW = X0 * 2 + bands.length * W + (bands.length - 1) * G;
  const VH = TOP * 2 + H;
  const gaps = [
    [['Reads and scans', 1]],
    [['Events', 1], ['Plans and drafts', -1]],
    [['Status, vouchers', 1], ['Orders, tracking', -1]],
  ];
  let s = `<svg class="sys-diagram" viewBox="0 0 ${VW} ${VH}" role="img" aria-label="Capture feeds the ERP record. The planner and agents work from the record. Connectors link it to Shopify, DHL, Tally and B2B order intake.">
  <defs><marker id="sysArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="sd-head" d="M0 0 L10 5 L0 10 z"/></marker></defs>`;
  bands.forEach((b, i) => {
    const x = X0 + i * (W + G);
    s += `<g class="sd-band sd-${b.cls}">
      <rect class="sd-band-bg" x="${x}" y="${TOP}" width="${W}" height="${H}" rx="14"/>
      <circle class="sd-dot" cx="${x + 22}" cy="${TOP + 25}" r="5"/>
      <text class="sd-title" x="${x + 36}" y="${TOP + 30}">${esc(b.title)}</text>
      <text class="sd-sub" x="${x + 16}" y="${TOP + 49}">${esc(b.sub)}</text>`;
    b.items.forEach((it, j) => {
      const y = TOP + HEAD + j * STEP;
      s += `<rect class="sd-item" x="${x + 12}" y="${y}" width="${W - 24}" height="${IH}" rx="7"/><text class="sd-item-text" x="${x + 24}" y="${y + 20}">${esc(it)}</text>`;
    });
    s += '</g>';
    if (i < bands.length - 1) {
      const gx0 = x + W + 10, gx1 = x + W + G - 10, cx = x + W + G / 2;
      const set = gaps[i];
      const mid = TOP + H / 2;
      set.forEach(([label, dir], k) => {
        const y = set.length === 1 ? mid : mid + (k === 0 ? -24 : 24);
        const [a, b2] = dir > 0 ? [gx0, gx1] : [gx1, gx0];
        s += `<line class="sd-line" x1="${a}" y1="${y}" x2="${b2}" y2="${y}" marker-end="url(#sysArrow)"/><text class="sd-flow" x="${cx}" y="${y - 8}" text-anchor="middle">${esc(label)}</text>`;
      });
    }
  });
  return s + '</svg>';
}

function facet(label, text) {
  return `<div class="sys-facet"><dt>${label}</dt><dd>${text}</dd></div>`;
}

function render() {
  const counts = [
    ['vision', `${idsOf('vision').length} vision stations`],
    ['agents', `${idsOf('agent').length} agents`],
    ['connectors', `${idsOf('connector').length} connectors`],
    ['timing', 'Time per piece'],
    ['phases', 'Order of work'],
    ['needs', 'What we need'],
  ];
  return `<div class="workspace"><div class="workspace-inner sys">
  <header class="view-head">
    <div>
      <h1>Systems</h1>
      <p>What gets attached to the business map and in what order. Cameras and scans capture what happens, the ERP keeps one record of it, the planner and agents work from that record, and connectors tie it to Shopify, DHL and Tally.</p>
    </div>
    <nav class="sys-jump" aria-label="Sections on this page">
      ${counts.map(([k, label]) => `<button type="button" class="chip" data-jump="${k}">${label}</button>`).join('')}
    </nav>
  </header>

  <section class="sys-section" data-section="fit">
    <div class="sys-section-head"><h2>How it fits together</h2>
      <p>Everything on the left writes into one record. Everything on the right reads from it. Nothing is keyed in twice.</p></div>
    <div class="panel sys-diagram-wrap"><div class="sys-diagram-scroll">${diagram()}</div></div>
    <div class="sys-erp">
      <div class="eyebrow">The ERP record, by module</div>
      <ul class="sys-erp-list">
        ${idsOf('erp').map((id) => `<li><button type="button" class="sys-erp-item" data-module="${ERP_MODULE[id] || ''}">
          <span class="sys-erp-name">${esc(SYSTEMS[id].name)}</span>
          <span class="sys-erp-does">${esc(SYSTEMS[id].does)}</span>
          <span class="sys-erp-open" aria-hidden="true">Open</span></button></li>`).join('')}
        <li><button type="button" class="sys-erp-item" data-module="finance">
          <span class="sys-erp-name">Finance</span>
          <span class="sys-erp-does">Vouchers raised by factory events, ready for Tally.</span>
          <span class="sys-erp-open" aria-hidden="true">Open</span></button></li>
      </ul>
    </div>
  </section>

  <section class="sys-section" data-section="vision">
    <div class="sys-section-head"><h2>Vision stations</h2>
      <p>Five places where a camera reads material or parcels. Each one writes straight to the record, and a person still makes the judgement calls.</p></div>
    <div class="sys-note" role="note">
      <strong>Proven on Dema's fabric first.</strong>
      How well a model finds defects depends on the fabric, the lighting and the defect. The roll inspection rig starts in advise mode beside a trained checker. It is trusted to pass or fail a roll on its own only after it catches at least 9 of every 10 defects the checker finds on Dema's own rolls. Until then the checker decides and the rig keeps the photo record.
    </div>
    <div class="sys-stations">
      ${VISION.map((v) => `<article class="sys-station">
        <div class="sys-station-id">
          <h3>${esc(SYSTEMS[v.id].name)}</h3>
          ${kindTag('vision')}
          ${nodeButtons(v.id)}
        </div>
        <dl class="sys-facets">
          ${facet('Watches', v.watches)}
          ${facet('Writes to the ERP', v.writes)}
          ${facet('Problem it removes', v.removes)}
          ${facet('Hardware', v.hardware)}
          ${facet('A person still', v.person)}
        </dl>
      </article>`).join('')}
    </div>
  </section>

  <section class="sys-section" data-section="agents">
    <div class="sys-section-head"><h2>Agents</h2>
      <p>Four agents take the routine work that gets skipped today. Each one prepares; a named person approves anything that leaves the building or changes a promise.</p></div>
    <div class="sys-agents">
      ${AGENTS.map((a) => `<article class="panel sys-agent">
        <div class="sys-agent-head"><h3>${esc(SYSTEMS[a.id].name)}</h3>${kindTag('agent')}</div>
        <dl class="sys-agent-body">
          <div><dt>Starts when</dt><dd>${a.trigger}</dd></div>
          <div><dt>Does</dt><dd>${a.does}</dd></div>
          <div class="sys-never"><dt>Never without a person</dt><dd>${a.never}</dd></div>
        </dl>
        ${nodeButtons(a.id)}
      </article>`).join('')}
    </div>
  </section>

  <section class="sys-section" data-section="connectors">
    <div class="sys-section-head"><h2>Connectors</h2>
      <p>Four links to systems Dema already uses. Each one replaces a copy-and-paste step.</p></div>
    <div class="panel"><div class="table-wrap"><table class="table sys-conn-table">
      <thead><tr><th>System</th><th>Direction</th><th>What moves</th><th>How</th><th>On the map</th></tr></thead>
      <tbody>
        ${CONNECTORS.map((c) => `<tr>
          <td><strong>${esc(SYSTEMS[c.id].name)}</strong></td>
          <td><span class="pill pill-plain">${c.dir}</span></td>
          <td>${c.moves}</td>
          <td>${c.how}</td>
          <td>${nodesFor(c.id).map((n) => `<button type="button" class="sys-node" data-node="${esc(n.id)}">${esc(n.name)}</button>`).join('')}</td>
        </tr>`).join('')}
      </tbody>
    </table></div></div>
    <div class="sys-aside">
      <h3>Barcodes at the gate</h3>
      <p>Shopify parcels carry a DHL label, and Dema does not buy GS1 barcodes. That is fine. The gate reads two things: the DHL waybill barcode on the label, and Dema's own Code 128 or QR tags on bundles, pieces and cartons. The waybill number ties the parcel to the order and to DHL tracking. GS1 codes are only needed if a retailer asks for them on the product.</p>
    </div>
  </section>

  <section class="sys-section" data-section="timing">
    <div class="sys-section-head"><h2>Time per piece, without watching people</h2>
      <p>Stitching time per style comes from bundle tags. Cameras stay on material and parcels.</p></div>
    <div class="sys-timing">
      <ol class="sys-scan">
        <li><span class="sys-scan-step">Cut</span><span>Cutting prints a tag for each bundle: style, size, pieces, order.</span></li>
        <li><span class="sys-scan-step">Scan in</span><span>The tailor or supervisor scans the tag when the bundle reaches the station.</span></li>
        <li><span class="sys-scan-step">Scan out</span><span>The same tag is scanned when the bundle is done. Minutes divided by pieces is the time per piece.</span></li>
        <li><span class="sys-scan-step">Learn</span><span>The schedule uses the real minutes for that style from then on.</span></li>
      </ol>
      <ul class="sys-why">
        <li><strong>More accurate per style.</strong> The tag says exactly which style and how many pieces. A camera would have to guess.</li>
        <li><strong>Cheaper.</strong> A printed tag and a phone at each line, with no cameras over workstations.</li>
        <li><strong>Easier for the floor to accept.</strong> Tailors scan their own work. Nobody is filmed at their machine.</li>
      </ul>
    </div>
  </section>

  <section class="sys-section" data-section="phases">
    <div class="sys-section-head"><h2>Order of work</h2>
      <p>Each phase stands on the one before it. The fabric loss comes first because it costs the most and needs the least. Sizing and dates follow a site visit.</p></div>
    <ol class="sys-phases">
      ${PHASES.map((p, i) => `<li class="sys-phase">
        <div class="sys-phase-no" aria-hidden="true">${i}</div>
        <div class="sys-phase-body">
          <div class="sys-phase-head"><span class="eyebrow">Phase ${i}</span><h3>${p.name}</h3>${p.tag ? `<span class="pill pill-info">${p.tag}</span>` : ''}</div>
          <div class="sys-phase-cols">
            <div><h4>Goes live</h4><ul>${p.live.map((x) => `<li>${x}</li>`).join('')}</ul></div>
            <div><h4>Needs from Dema</h4><ul>${p.needs.map((x) => `<li>${x}</li>`).join('')}</ul></div>
            <div class="sys-phase-check"><h4>How we know it worked</h4><p>${p.check}</p></div>
          </div>
        </div>
      </li>`).join('')}
    </ol>
  </section>

  <section class="sys-section" data-section="needs">
    <div class="sys-section-head"><h2>What we need from Dema to make it real</h2>
      <p>Everything in this build runs on example data. These six things replace it.</p></div>
    <dl class="sys-needs">
      ${NEEDS.map(([t, d]) => `<div><dt>${t}</dt><dd>${d}</dd></div>`).join('')}
    </dl>
  </section>
</div></div>`;
}

export function mount(el, ctx) {
  el.innerHTML = render();
  const onClick = (e) => {
    const node = e.target.closest('[data-node]');
    if (node) { ctx.go('map', { focus: node.dataset.node }); return; }
    const mod = e.target.closest('[data-module]');
    if (mod) { ctx.go('erp', mod.dataset.module ? { module: mod.dataset.module } : {}); return; }
    const jump = e.target.closest('[data-jump]');
    if (jump) {
      const target = el.querySelector(`[data-section="${jump.dataset.jump}"]`);
      const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (target) target.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    }
  };
  el.addEventListener('click', onClick);
  return () => el.removeEventListener('click', onClick);
}
