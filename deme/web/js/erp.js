// The ERP modules. Lists, record drawers, forms, imports and action buttons are all drawn from
// shared/schema.js, so every record type behaves the same way. Admin has its own pages.

import { api, data } from './api.js';
import { $, $$, esc, info, toast, oops, busy, show, statusTag, formHtml, readForm, drawer, parseCsv, fields, fmtStamp, inr, num } from './ui.js';
import { MODULES, ROLES, LEVELS, ENTITIES, entityById, fieldsOf, levelOf } from '../shared/schema.js';
import { titleOf } from '../shared/service.js';

// Actions that are not tied to a status but belong on a record's drawer.
const EXTRA = {
  items: [
    { id: 'stock.adjust', label: 'Adjust stock', module: 'inventory', key: 'item', form: [['onHand', 'Counted on hand', 'number', { req: true }], ['note', 'Why', 'text', {}]] },
    { id: 'stock.issue', label: 'Issue to the floor', module: 'inventory', key: 'item', form: [['qty', 'Quantity', 'number', { req: true }], ['ref', 'For (work order or station)', 'text', {}]] },
  ],
};
const ADMIN_PAGES = [['team', 'Team'], ['roles', 'Roles'], ['activity', 'Activity'], ['connections', 'Connections']];
const remembered = {}; // module -> last opened record type

export function mount(el, ctx) {
  const module = ctx.route.module;
  const ents = ENTITIES.filter((e) => e.module === module && data.canRead(e.id));
  let current = module === 'admin' ? (remembered.admin || 'team') : (ctx.route.entity && ents.some((e) => e.id === ctx.route.entity) ? ctx.route.entity : remembered[module] && ents.some((e) => e.id === remembered[module]) ? remembered[module] : ents[0]?.id);
  let q = '', statusFilter = '', open = null; // open: { close, id, mode }

  el.innerHTML = `<div class="workspace erp"><div class="workspace-inner">
    <div class="view-head"><div class="title-row"><h1 class="reveal">${esc(MODULES[module].name)}</h1>${info(MODULES[module].info, MODULES[module].name)}</div></div>
    <nav class="tabs" aria-label="${esc(MODULES[module].name)}"></nav>
    <section class="erp-body"></section>
  </div></div>`;
  const tabs = $('.tabs', el), body = $('.erp-body', el);

  function renderTabs() {
    const list = module === 'admin' ? ADMIN_PAGES : ents.map((e) => [e.id, e.name, data.all(e.id).length]);
    tabs.innerHTML = list.map(([id, name, n]) => `<button type="button" data-tab="${id}" aria-pressed="${id === current}">${esc(name)}${n !== undefined ? `<span class="n">${n}</span>` : ''}</button>`).join('');
  }
  tabs.addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (!b) return; current = b.dataset.tab; remembered[module] = current; q = ''; statusFilter = ''; renderTabs(); render(); });

  function render() {
    if (module === 'admin') return renderAdmin();
    if (!current) { body.innerHTML = '<div class="empty"><h3>Nothing here for your role</h3></div>'; return; }
    renderList();
  }

  // ───────── List ─────────
  function rows() {
    const e = entityById[current], fs = fieldsOf(e);
    const needle = q.trim().toLowerCase();
    return data.all(current).filter((d) => (!statusFilter || d.status === statusFilter) && (!needle || [d.no, ...fs.map((f) => (f.type === 'ref' ? data.title(f.ref, d[f.k]) : f.type === 'user' ? data.title('users', d[f.k]) : f.type === 'lines' ? '' : d[f.k]))].some((v) => String(v ?? '').toLowerCase().includes(needle))))
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  }
  function renderList() {
    const e = entityById[current], fs = fieldsOf(e), cols = fs.filter((f) => f.list);
    const all = data.all(current), list = rows(), canAdd = data.canWrite(current);
    const head = `<div class="toolbar">
        <div class="title-row"><h2>${esc(e.name)}</h2>${info(e.info, e.name)}</div>
        <div class="spacer"></div>
        ${all.length ? `<input class="input search" id="erpSearch" type="search" placeholder="Search" value="${esc(q)}" aria-label="Search ${esc(e.name)}">` : ''}
        ${e.statuses && all.length ? `<select class="select status" id="erpStatus" aria-label="Status"><option value="">All</option>${Object.entries(e.statuses).map(([k, s]) => `<option value="${k}" ${k === statusFilter ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>` : ''}
        ${current === 'vouchers' && all.length ? '<button class="btn btn-outline" type="button" data-act="tally">Tally export</button>' : ''}
        ${canAdd ? `<button class="btn btn-outline" type="button" data-act="import">Import</button><button class="btn btn-primary" type="button" data-act="add">Add ${esc(e.one.toLowerCase())}</button>` : ''}
      </div>`;
    if (!all.length) {
      body.innerHTML = `${head}<div class="panel empty"><h3>No ${esc(e.name.toLowerCase())} yet</h3>${canAdd ? `<div class="row"><button class="btn btn-primary" type="button" data-act="add">Add ${esc(e.one.toLowerCase())}</button><button class="btn btn-outline" type="button" data-act="import">Import from a spreadsheet</button></div>` : e.readonly ? '<p>These are written by the system as work happens.</p>' : '<p>Your role can view these but not add them.</p>'}</div>`;
      return;
    }
    body.innerHTML = `${head}<div class="panel"><div class="table-wrap"><table class="table"><thead><tr>${e.no ? '<th>No.</th>' : ''}${cols.map((f) => `<th class="${f.type === 'number' || f.type === 'money' ? 'num' : ''}">${esc(f.label)}</th>`).join('')}${e.statuses ? '<th>Status</th>' : ''}</tr></thead>
      <tbody>${list.map((d) => `<tr data-open="${d.id}" tabindex="0">${e.no ? `<td class="mono">${esc(d.no || '')}</td>` : ''}${cols.map((f) => `<td class="${f.type === 'number' || f.type === 'money' ? 'num' : ''}">${show(f, d[f.k])}</td>`).join('')}${e.statuses ? `<td>${statusTag(current, d.status)}</td>` : ''}</tr>`).join('')}</tbody></table></div>
      ${list.length ? '' : '<div class="empty"><p>Nothing matches.</p></div>'}</div>
      <p class="faint count-line">${list.length} of ${all.length}</p>`;
  }
  body.addEventListener('input', (e) => { if (e.target.id === 'erpSearch') { q = e.target.value; const pos = e.target.selectionStart; renderList(); const s = $('#erpSearch', body); s.focus(); s.setSelectionRange(pos, pos); } });
  body.addEventListener('change', (e) => { if (e.target.id === 'erpStatus') { statusFilter = e.target.value; renderList(); } });
  body.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act, row = e.target.closest('[data-open]');
    if (act === 'add') openForm(null); else if (act === 'import') openImport(); else if (act === 'tally') openTally(); else if (row && module !== 'admin') openRecord(row.dataset.open);
  });
  body.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('[data-open]') && module !== 'admin') openRecord(e.target.dataset.open); });

  // ───────── Record drawer ─────────
  function allowedActions(e, doc) {
    const lvl = (m) => LEVELS.indexOf(levelOf(data.user, m));
    const ok = (a) => lvl(a.module || e.module) >= LEVELS.indexOf(a.level || 'write') || (!a.module && (e.alsoWrite || []).some((m) => lvl(m) >= LEVELS.indexOf(a.level || 'write')));
    return [...(e.actions || []).filter((a) => !a.when || a.when.includes(doc.status)), ...(EXTRA[e.id] || [])].filter(ok);
  }
  function recordHtml(e, doc) {
    const fs = fieldsOf(e), acts = allowedActions(e, doc);
    const editable = data.canWrite(e.id) && (!e.statuses || doc.status === (e.initial || Object.keys(e.statuses)[0]) || data.can(e.module, 'admin'));
    const plain = fs.filter((f) => f.type !== 'lines' && !(f.type === 'long'));
    const lines = fs.filter((f) => f.type === 'lines' && (doc[f.k] || []).length);
    const longs = fs.filter((f) => f.type === 'long' && doc[f.k]);
    return `<header class="drawer-head"><div><p class="eyebrow">${esc(e.one)}</p><h2>${esc(titleOf(e, doc))}</h2></div><button class="icon-btn" type="button" data-close aria-label="Close">×</button></header>
      <div class="drawer-body">
        <div class="row">${statusTag(e.id, doc.status)}${acts.map((a) => `<button class="btn btn-sm ${a === acts[0] ? 'btn-primary' : 'btn-outline'}" type="button" data-action="${a.id}">${esc(a.label)}</button>`).join('')}</div>
        <div class="action-form" hidden></div>
        <dl class="facts">${plain.map((f) => `<div><dt>${esc(f.label)}</dt><dd>${show(f, doc[f.k])}</dd></div>`).join('')}</dl>
        ${longs.map((f) => `<div class="long"><p class="eyebrow">${esc(f.label)}</p><p>${esc(doc[f.k])}</p></div>`).join('')}
        ${lines.map((f) => { const cols = f.cols.map(([k, label, type, o = {}]) => ({ k, label, type, ...o })); return `<div><p class="eyebrow">${esc(f.label)}</p><div class="table-wrap"><table class="table"><thead><tr>${cols.map((c) => `<th class="${c.type === 'number' || c.type === 'money' ? 'num' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${doc[f.k].map((r) => `<tr>${cols.map((c) => `<td class="${c.type === 'number' || c.type === 'money' ? 'num' : ''}">${show(c, r[c.k])}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`; }).join('')}
        <div class="row">${editable ? '<button class="btn btn-sm btn-outline" type="button" data-edit>Edit</button>' : ''}${!e.readonly && data.can(e.module, 'admin') ? '<button class="btn btn-sm btn-quiet" type="button" data-delete>Delete</button>' : ''}</div>
        <div class="trail"><p class="eyebrow">Activity</p><ul class="trail-list"><li class="faint">Loading</li></ul></div>
      </div>`;
  }
  function openRecord(id) {
    const e = entityById[current], doc = data.get(current, id);
    if (!doc) return;
    const d = drawer(recordHtml(e, doc), { onClose: () => { open = null; } });
    open = { ...d, id, mode: 'view', entity: current };
    wireRecord(d, e, id);
  }
  function wireRecord(d, e, id) {
    api.audit(e.id, id).then((logs) => { const ul = $('.trail-list', d.el); if (ul) ul.innerHTML = logs.length ? logs.map((l) => `<li><span class="mono faint">${esc(fmtStamp(l.at))}</span><span>${esc(l.text)}</span><span class="faint">${esc(l.userName || '')}</span></li>`).join('') : '<li class="faint">Nothing yet</li>'; }).catch(() => {});
    d.el.onclick = (ev) => {
      const ab = ev.target.closest('[data-action]');
      const doc = data.get(e.id, id);
      if (ab) {
        const a = [...(e.actions || []), ...(EXTRA[e.id] || [])].find((x) => x.id === ab.dataset.action);
        const go = (payload, btn) => busy(btn, async () => {
          const out = a.key ? await api.act(a.id, { ...payload, [a.key]: id }) : await api.act(a.id, payload, { entity: e.id, id });
          toast(out.message || `${a.label}: done`);
          if (data.get(e.id, id)) { d.set(recordHtml(e, data.get(e.id, id))); wireRecord(d, e, id); } else d.close();
        });
        if (!a.form) return go({}, ab);
        const fsA = a.form.map(([k, label, type, o = {}]) => ({ k, label, type, ...o }));
        const box = $('.action-form', d.el);
        box.hidden = false;
        box.innerHTML = `<form class="form-grid"><p class="eyebrow wide">${esc(a.label)}</p>${formHtml(fsA, {}, doc)}<div class="row wide"><button class="btn btn-primary" type="submit">${esc(a.label)}</button><button class="btn btn-quiet" type="button" data-cancel>Cancel</button></div></form>`;
        box.querySelector('input,select,textarea')?.focus();
        box.querySelector('form').onsubmit = (s) => { s.preventDefault(); go(readForm(box, fsA), box.querySelector('[type="submit"]')); };
        box.querySelector('[data-cancel]').onclick = () => { box.hidden = true; box.innerHTML = ''; };
        return;
      }
      if (ev.target.closest('[data-edit]')) { d.close(); openForm(id); }
      if (ev.target.closest('[data-delete]')) {
        const btn = ev.target.closest('[data-delete]');
        if (btn.dataset.sure) busy(btn, async () => { await api.remove(e.id, id); toast(`${e.one} deleted`); d.close(); });
        else { btn.dataset.sure = '1'; btn.textContent = 'Tap again to delete'; }
      }
    };
  }
  function openForm(id) {
    const e = entityById[current], fs = fieldsOf(e), doc = id ? data.get(current, id) : null;
    const d = drawer(`<header class="drawer-head"><div><p class="eyebrow">${doc ? 'Edit' : 'New'}</p><h2>${esc(doc ? titleOf(e, doc) : e.one)}</h2></div><button class="icon-btn" type="button" data-close aria-label="Close">×</button></header>
      <form class="drawer-body form-grid" novalidate>${formHtml(fs, doc || Object.fromEntries(fs.filter((f) => f.def !== undefined).map((f) => [f.k, f.def === 'today' ? new Date().toLocaleDateString('en-CA') : f.def])))}
        <p class="error wide" role="alert" hidden></p>
        <div class="row wide"><button class="btn btn-primary" type="submit">${doc ? 'Save' : `Add ${esc(e.one.toLowerCase())}`}</button><button class="btn btn-quiet" type="button" data-close>Cancel</button></div></form>`, { onClose: () => { open = null; } });
    open = { ...d, id, mode: 'form', entity: current };
    const form = $('form', d.el), err = $('.error', form);
    form.querySelector('input,select,textarea')?.focus();
    form.onsubmit = (ev) => {
      ev.preventDefault(); err.hidden = true;
      busy(form.querySelector('[type="submit"]'), async () => {
        try {
          const input = readForm(form, fs);
          const out = doc ? await api.update(e.id, id, input) : await api.create(e.id, input);
          toast(doc ? 'Saved' : `${e.one} added`); d.close(); openRecord(out.doc.id);
        } catch (ex) { err.textContent = ex.message; err.hidden = false; err.scrollIntoView({ block: 'nearest' }); }
      });
    };
  }

  // ───────── Import ─────────
  function openImport() {
    const e = entityById[current], fs = fieldsOf(e).filter((f) => !f.ro && f.type !== 'lines');
    const heads = fs.map((f) => f.label).join(',');
    const d = drawer(`<header class="drawer-head"><div><p class="eyebrow">Import</p><h2>${esc(e.name)}</h2></div><button class="icon-btn" type="button" data-close aria-label="Close">×</button></header>
      <div class="drawer-body stack">
        <div class="field"><label for="impHeads">Column headings ${info('Put these headings in the first row of a spreadsheet, one record per row, then save or export it as CSV. Headings can be in any order and extra columns are ignored. Dates are written as 2026-03-31. Where a column refers to another record, such as a supplier or a style, type its name or code exactly as it appears in Deme.', 'Preparing the file')}</label>
          <textarea class="input mono" id="impHeads" readonly rows="3">${esc(heads)}</textarea>
          <div class="row"><button class="btn btn-sm btn-outline" type="button" data-copy>Copy headings</button><span class="faint">${fs.filter((f) => f.req).length ? `Needed: ${esc(fs.filter((f) => f.req).map((f) => f.label).join(', '))}` : ''}</span></div></div>
        <div class="field"><label for="impFile">CSV file</label><input class="input" id="impFile" type="file" accept=".csv,text/csv,text/plain"></div>
        <div class="field"><label for="impText">Or paste rows here</label><textarea class="input mono" id="impText" rows="7" placeholder="${esc(heads)}"></textarea></div>
        <div class="row"><button class="btn btn-primary" type="button" data-run>Import</button><span class="faint" id="impCount"></span></div>
        <div id="impResult"></div>
      </div>`, { onClose: () => { open = null; } });
    open = { ...d, mode: 'import' };
    const text = $('#impText', d.el);
    const count = () => { const n = parseCsv(text.value).length; $('#impCount', d.el).textContent = n ? `${n} row${n === 1 ? '' : 's'} ready` : ''; };
    $('#impFile', d.el).onchange = (ev) => { const f = ev.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = () => { text.value = String(r.result); count(); }; r.readAsText(f); };
    text.oninput = count;
    $('[data-copy]', d.el).onclick = async () => { try { await navigator.clipboard.writeText(heads); toast('Headings copied'); } catch { $('#impHeads', d.el).select(); } };
    $('[data-run]', d.el).onclick = (ev) => busy(ev.currentTarget, async () => {
      const rowsIn = parseCsv(text.value);
      if (!rowsIn.length) return toast('Add a heading row and at least one row of data.', 'crit');
      const out = await api.importRows(e.id, rowsIn);
      $('#impResult', d.el).innerHTML = `<div class="panel panel-pad stack"><p><strong>${out.created}</strong> added${out.errors.length ? `, <strong>${out.errors.length}</strong> not added` : ''}.</p>${out.errors.length ? `<ul class="err-list">${out.errors.slice(0, 50).map((x) => `<li><span class="mono">Row ${x.row}</span> ${esc(x.error)}</li>`).join('')}</ul>` : ''}</div>`;
    });
  }

  // ───────── Tally export ─────────
  async function openTally() {
    const openOnes = data.all('vouchers').filter((v) => v.status === 'open');
    const d = drawer(`<header class="drawer-head"><div><p class="eyebrow">Finance</p><h2>Tally export</h2></div><button class="icon-btn" type="button" data-close aria-label="Close">×</button></header>
      <div class="drawer-body stack">
        <p>${openOnes.length} voucher${openOnes.length === 1 ? '' : 's'} not yet in Tally, ${esc(inr(openOnes.reduce((s, v) => s + (v.amount || 0), 0)))}. ${info('This is Tally Prime import XML. In Tally, use Import > Transactions and choose the file, or post it to Tally\'s HTTP port from the accounts computer. Ledger names must match Tally exactly: check Finance > Ledgers first. After a successful import, mark the vouchers as in Tally so they are not sent twice.', 'Importing into Tally')}</p>
        <textarea class="input mono" id="tallyXml" rows="16" readonly>Building</textarea>
        <div class="row"><button class="btn btn-outline" type="button" data-copy>Copy XML</button>${api.mode === 'server' ? '<a class="btn btn-outline" href="/api/export/tally" download="deme-vouchers.xml">Download file</a>' : ''}<button class="btn btn-primary" type="button" data-mark ${openOnes.length ? '' : 'disabled'}>Mark as in Tally</button></div>
      </div>`, { onClose: () => { open = null; } });
    open = { ...d, mode: 'tally' };
    try { $('#tallyXml', d.el).value = openOnes.length ? await api.tallyXml(openOnes.map((v) => v.id)) : 'Nothing to export.'; } catch (e) { oops(e); }
    $('[data-copy]', d.el).onclick = async () => { try { await navigator.clipboard.writeText($('#tallyXml', d.el).value); toast('XML copied'); } catch { $('#tallyXml', d.el).select(); } };
    $('[data-mark]', d.el).onclick = (ev) => busy(ev.currentTarget, async () => { const out = await api.act('vouchers.markSynced', { ids: openOnes.map((v) => v.id) }); toast(out.message || 'Marked'); d.close(); });
  }

  // ───────── Admin ─────────
  function renderAdmin() {
    const isAdmin = data.can('admin', 'admin');
    if (current === 'team') {
      body.innerHTML = `<div class="toolbar"><div class="title-row"><h2>Team</h2>${info('Each person signs in with their own email and password. The role decides which modules they can open and whether they can add, approve or only look. "Also allow" gives one person write access to extra modules without changing their role, for example purchase orders for one marketing manager.', 'Team and access')}</div><div class="spacer"></div>${isAdmin ? '<button class="btn btn-primary" type="button" data-user="new">Add team member</button>' : ''}</div>
        <div class="panel"><div class="table-wrap"><table class="table"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Also allowed</th><th>Login</th></tr></thead><tbody>
        ${data.users.map((u) => `<tr ${isAdmin ? `data-user="${u.id}" tabindex="0" data-open` : ''}><td>${esc(u.name)}</td><td>${esc(u.email || '')}</td><td>${esc(ROLES[u.role]?.name || u.role)}</td><td>${esc((u.extra || []).map((m) => MODULES[m].name).join(', '))}</td><td>${u.active ? '<span class="tag tag-ok">Active</span>' : '<span class="tag tag-plain">Off</span>'}</td></tr>`).join('')}
        </tbody></table></div></div>
        ${api.mode === 'local' ? '<div class="row"><button class="btn btn-sm btn-quiet" type="button" data-reset>Erase this preview\'s data</button></div>' : ''}`;
    } else if (current === 'roles') {
      const mods = Object.keys(MODULES);
      const word = { none: '', scan: 'Scan', read: 'View', write: 'Edit', admin: 'Full' };
      body.innerHTML = `<div class="toolbar"><div class="title-row"><h2>Roles</h2>${info('View: can open and read. Edit: can add and change records and run everyday steps. Full: can also approve, cancel and delete. Scan: can scan bundles in and out on the floor and nothing else. Everyone can use My day for attendance, leave and their own KRAs.', 'Access levels')}</div></div>
        <div class="panel"><div class="table-wrap"><table class="table matrix"><thead><tr><th>Role</th>${mods.map((m) => `<th>${esc(MODULES[m].name)}</th>`).join('')}</tr></thead><tbody>
        ${Object.entries(ROLES).map(([, r]) => `<tr><td>${esc(r.name)}</td>${mods.map((m) => { const l = r.perms[m] || 'none'; return `<td>${l === 'none' ? '<span class="faint">·</span>' : `<span class="lvl lvl-${l}">${word[l]}</span>`}</td>`; }).join('')}</tr>`).join('')}
        </tbody></table></div></div>`;
    } else if (current === 'activity') {
      body.innerHTML = `<div class="toolbar"><div class="title-row"><h2>Activity</h2>${info('Every addition, change, deletion and business step, with who did it and when. Entries cannot be edited.', 'Audit trail')}</div></div><div class="panel"><div class="empty"><p>Loading</p></div></div>`;
      api.audit().then((logs) => { if (current !== 'activity') return; $('.panel', body).innerHTML = logs.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead><tbody>${logs.map((l) => `<tr><td class="mono">${esc(fmtStamp(l.at))}</td><td>${esc(l.userName || '')}</td><td>${esc(l.text)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty"><p>Nothing has happened yet.</p></div>'; }).catch(oops);
    } else {
      const C = [
        ['Shopify', 'Orders in; stock and shipping status back.', 'Until this is connected, import the Shopify orders export as a CSV under B2C sales. Connecting needs a Shopify custom app with read access to orders and write access to fulfilments and inventory.'],
        ['DHL', 'Tracking events against each parcel.', 'Until this is connected, add tracking updates on the parcel by hand. Connecting needs DHL Express API credentials for the Deme account; the tracking number on the label is the key.'],
        ['Tally', 'Vouchers and ledgers, both directions.', 'Until this is connected, use Finance > Vouchers > Tally export and import the XML in Tally. The live bridge is a small program on the accounts computer that posts vouchers to Tally\'s local port; see docs/TALLY-CONNECTOR.md.'],
        ['Fabric inspection camera', 'Defect score per roll from the inspection frame.', 'Until a camera is installed, a checker enters the penalty points for each roll under Inventory > Fabric rolls > Inspect. The camera will write the same inspection record.'],
        ['Gate and floor scanners', 'Barcodes typed into the scan screens.', 'Any handheld scanner that types like a keyboard already works on the Scan station and Dispatch gate screens. Nothing to connect.'],
      ];
      body.innerHTML = `<div class="toolbar"><div class="title-row"><h2>Connections</h2>${info('Links to systems outside Deme ERP. None is switched on yet; each note says how the work is done in the meantime and what the connection needs.', 'Connections')}</div></div>
        <div class="panel"><ul class="conn">${C.map(([name, what, how], i) => `<li><div><strong>${esc(name)}</strong> ${info(how, name)}<br><span class="muted">${esc(what)}</span></div><span class="tag ${i === 4 ? 'tag-ok' : 'tag-plain'}">${i === 4 ? 'Works now' : 'Not connected'}</span></li>`).join('')}</ul></div>`;
    }
  }
  body.addEventListener('click', (e) => {
    if (module !== 'admin') return;
    if (e.target.closest('[data-reset]')) { const b = e.target.closest('[data-reset]'); if (b.dataset.sure) api.resetPreview(); else { b.dataset.sure = '1'; b.textContent = 'Tap again to erase everything in this browser'; } return; }
    const t = e.target.closest('[data-user]'); if (!t || !data.can('admin', 'admin')) return;
    openUser(t.dataset.user === 'new' ? null : t.dataset.user);
  });
  function openUser(id) {
    const u = id ? data.users.find((x) => x.id === id) : null;
    const d = drawer(`<header class="drawer-head"><div><p class="eyebrow">${u ? 'Team member' : 'New team member'}</p><h2>${esc(u?.name || 'Add to the team')}</h2></div><button class="icon-btn" type="button" data-close aria-label="Close">×</button></header>
      <form class="drawer-body form-grid" novalidate>
        <div class="field"><label for="uName">Name <span class="req">*</span></label><input class="input" id="uName" value="${esc(u?.name || '')}"></div>
        <div class="field"><label for="uEmail">Work email <span class="req">*</span></label><input class="input" id="uEmail" type="email" value="${esc(u?.email || '')}"></div>
        <div class="field"><label for="uRole">Role <span class="req">*</span></label><select class="select" id="uRole">${Object.entries(ROLES).map(([k, r]) => `<option value="${k}" ${k === (u?.role || 'staff') ? 'selected' : ''}>${esc(r.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="uPass">${u ? 'New password' : 'Password'} ${u ? '' : '<span class="req">*</span>'}</label><input class="input" id="uPass" type="password" autocomplete="new-password"><span class="hint">${u ? 'Leave empty to keep the current one. ' : ''}At least 8 characters. Tell them in person.</span></div>
        <div class="field wide"><span class="label">Also allow</span><div class="checks" id="uExtra">${Object.entries(MODULES).filter(([k]) => k !== 'admin').map(([k, m]) => `<label><input type="checkbox" value="${k}" ${(u?.extra || []).includes(k) ? 'checked' : ''}> ${esc(m.name)}</label>`).join('')}</div></div>
        ${u ? `<div class="field wide"><label><input type="checkbox" id="uActive" ${u.active ? 'checked' : ''}> Can sign in</label></div>` : ''}
        <p class="error wide" role="alert" hidden></p>
        <div class="row wide"><button class="btn btn-primary" type="submit">${u ? 'Save' : 'Add team member'}</button><button class="btn btn-quiet" type="button" data-close>Cancel</button></div>
      </form>`, { onClose: () => { open = null; } });
    open = { ...d, mode: 'user' };
    const form = $('form', d.el), err = $('.error', form);
    form.onsubmit = (ev) => {
      ev.preventDefault(); err.hidden = true;
      busy(form.querySelector('[type="submit"]'), async () => {
        try {
          const input = { name: $('#uName', form).value, email: $('#uEmail', form).value, role: $('#uRole', form).value, extra: $$('#uExtra input:checked', form).map((c) => c.value) };
          if ($('#uPass', form).value) input.password = $('#uPass', form).value;
          if (u) { if (u.id !== data.user.id) input.active = $('#uActive', form).checked; else { delete input.role; } await api.updateUser(u.id, input); } else await api.createUser(input);
          toast(u ? 'Saved' : 'Team member added'); d.close(); render();
        } catch (ex) { err.textContent = ex.message; err.hidden = false; }
      });
    };
  }

  const off = data.on((touched) => {
    renderTabs();
    if (module === 'admin') { if (!open) render(); return; }
    if (touched.includes('*') || touched.includes(current) || touched.some((t) => fieldsOf(entityById[current]).some((f) => f.ref === t))) renderList();
  });

  renderTabs(); render();
  if (module !== 'admin' && current) { if (ctx.opts?.id && data.get(current, ctx.opts.id)) openRecord(ctx.opts.id); else if (ctx.opts?.add && data.canWrite(current)) openForm(null); }
  return () => { off(); open?.close?.(); };
}
