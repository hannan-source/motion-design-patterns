// Photos and documents on any record: a strip of thumbnails, an Add button that opens the camera on
// a phone, a full-size viewer, and remove. Photos are made smaller in the browser before they are
// sent, so a phone photo is well under the server's limit; PDFs go as they are.
//
//   mountPhotos(host, entity, id, { canAdd })  the strip for a record that exists
//   photoQueue(host)                           photos picked before the record exists; sendTo() later
//   addFiles(entity, id, files)                attach without any interface
//   prepare(file)                              one File made ready: { name, type, size, data, thumb }

import { api, data } from './api.js';
import { esc, info, oops, fmtStamp } from './ui.js';
import { entityById } from '../shared/schema.js';

export const PHOTO_LIMITS = { longest: 1600, quality: 0.72, bytes: 2_000_000, perRecord: 12 };
const THUMB = 320, PDF = 'application/pdf';
const ABOUT = 'Photos are made smaller before they are sent. A PDF can be up to 2 MB. A record holds up to 12 files. Whoever attached a file, or an admin of that module, can remove it.';
const size = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const why = (e) => (e?.status ? e.message : 'No network.');
const svg = (d) => `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const DOC = svg('M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6');
const CAM = svg('M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z');
const PLUS = svg('M12 5v14M5 12h14');

// ── Files in and out of base64, and making photos smaller ──
const toB64 = (blob) => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => { const s = String(r.result); res(s.slice(s.indexOf(',') + 1)); };
  r.onerror = () => rej(new Error('That file could not be read.'));
  r.readAsDataURL(blob);
});
const toBlob = (b64, type) => { const s = atob(b64), a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return new Blob([a], { type }); };

async function decode(blob) {
  if (window.createImageBitmap) { try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch { /* try the older way */ } }
  const url = URL.createObjectURL(blob);
  try { return await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('unreadable')); im.src = url; }); } finally { URL.revokeObjectURL(url); }
}
/** The picture on a canvas whose longest side is at most `longest`, on the page's own ground so clear areas do not turn black. */
function paint(img, longest) {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height, k = Math.min(1, longest / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
  const g = c.getContext('2d');
  g.fillStyle = getComputedStyle(document.body).backgroundColor; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0, c.width, c.height);
  return c;
}
const jpeg = (canvas, q) => new Promise((res) => canvas.toBlob(res, 'image/jpeg', q));

/** Make one picked file ready to send. Photos become JPEGs no longer than 1600px; PDFs are kept as they are. */
export async function prepare(file) {
  const name = String(file.name || 'photo');
  if (file.type === PDF || (!file.type && /\.pdf$/i.test(name))) {
    if (file.size > PHOTO_LIMITS.bytes) throw new Error(`${name} is ${size(file.size)}. A PDF has to be under 2 MB.`);
    return { name, type: PDF, size: file.size, data: await toB64(file), thumb: '' };
  }
  if (file.type && !file.type.startsWith('image/')) throw new Error(`${name} is not a photo or a PDF.`);
  let img;
  try { img = await decode(file); } catch { throw new Error(`${name} could not be read as a photo.`); }
  let { longest, quality } = PHOTO_LIMITS, blob = null;
  for (let i = 0; i < 6; i++) {
    blob = await jpeg(paint(img, longest), quality);
    if (blob && blob.size <= PHOTO_LIMITS.bytes) break;
    if (quality > 0.5) quality -= 0.12; else longest = Math.round(longest * 0.75);
  }
  if (!blob || blob.size > PHOTO_LIMITS.bytes) throw new Error(`${name} is too large to send.`);
  const thumb = paint(img, THUMB).toDataURL('image/jpeg', 0.7);
  img.close?.();
  return { name: `${name.replace(/\.[^.]*$/, '') || 'photo'}.jpg`, type: 'image/jpeg', size: blob.size, data: await toB64(blob), thumb };
}

// ── Small pictures of stored files: fetched once, three at a time, kept for the visit ──
const thumbs = new Map(), inflight = new Map(), waiting = [];
let active = 0;
const turn = () => new Promise((res) => { const go = () => { active++; res(); }; if (active < 3) go(); else waiting.push(go); });
function thumbOf(id) {
  if (thumbs.has(id)) return Promise.resolve(thumbs.get(id));
  if (!inflight.has(id)) inflight.set(id, (async () => {
    await turn();
    try {
      const f = await api.files.get(id), img = await decode(toBlob(f.data, f.type));
      const t = paint(img, THUMB).toDataURL('image/jpeg', 0.7);
      img.close?.();
      if (thumbs.size > 300) thumbs.delete(thumbs.keys().next().value);
      thumbs.set(id, t);
      return t;
    } finally { active--; waiting.shift()?.(); inflight.delete(id); }
  })());
  return inflight.get(id);
}

// ── Full-size viewer ──
let viewer = null;
function view(list, start, { mayRemove = () => false, onRemove } = {}) {
  viewer?.close();
  if (!list?.length) return;
  const dlg = document.createElement('dialog');
  dlg.className = 'photos-view';
  dlg.setAttribute('aria-label', 'Photo or document');
  document.body.appendChild(dlg);
  let i = start, url = '', keep = false, token = 0;
  // A blob address handed to another tab is given a minute to load before it is taken back.
  const drop = () => { if (!url) return; const u = url; url = ''; setTimeout(() => URL.revokeObjectURL(u), keep ? 60000 : 0); keep = false; };
  const close = () => { token++; drop(); window.removeEventListener('hashchange', close); if (dlg.open) dlg.close(); dlg.remove(); if (viewer?.dlg === dlg) viewer = null; };
  const stage = () => dlg.querySelector('.pv-stage');

  async function show() {
    const f = list[i], my = ++token, pdf = f.type === PDF;
    drop();
    dlg.innerHTML = `
      <div class="pv-bar">
        <div class="pv-what"><strong>${esc(f.name)}</strong><span>${esc([f.byName, f.at ? fmtStamp(f.at) : '', f.size ? size(f.size) : ''].filter(Boolean).join(' · '))}</span></div>
        <button type="button" class="icon-btn" data-pv-shut aria-label="Close">×</button>
      </div>
      <div class="pv-stage"><p class="pv-msg">Loading</p></div>
      <div class="pv-foot">
        ${list.length > 1 ? `<button type="button" class="btn btn-sm btn-quiet" data-pv-go="-1">Previous</button><span class="pv-n">${i + 1} of ${list.length}</span><button type="button" class="btn btn-sm btn-quiet" data-pv-go="1">Next</button>` : ''}
        <span class="pv-gap"></span>
        ${mayRemove(f) ? '<button type="button" class="btn btn-sm btn-quiet" data-pv-del>Remove</button>' : ''}
        <a class="btn btn-sm btn-outline" data-pv-save download="${esc(f.name)}">Download</a>
        ${pdf ? '<a class="btn btn-sm btn-primary" data-pv-open target="_blank" rel="noopener">Open to print</a>' : ''}
      </div>`;
    dlg.querySelector('[data-pv-shut]').focus();
    try {
      const blob = toBlob(f.data ?? (await api.files.get(f.id)).data, f.type);
      if (my !== token) return;
      url = URL.createObjectURL(blob);
      stage().innerHTML = pdf ? `<div class="pv-doc">${DOC}<strong>${esc(f.name)}</strong><span>PDF${f.size ? ` · ${esc(size(f.size))}` : ''}</span></div>` : `<img src="${url}" alt="${esc(f.name)}">`;
      dlg.querySelectorAll('[data-pv-save], [data-pv-open]').forEach((a) => { a.href = url; });
    } catch (e) {
      if (my !== token) return;
      stage().innerHTML = `<div class="pv-doc"><p class="pv-msg">${esc(e?.status ? e.message : 'It could not be loaded. Check the network.')}</p><button type="button" class="btn btn-outline" data-pv-retry>Try again</button></div>`;
    }
  }
  const go = (d) => { if (list.length < 2) return; i = (i + d + list.length) % list.length; show(); };

  dlg.addEventListener('click', async (e) => {
    if (e.target.closest('[data-pv-shut]')) return close();
    if (e.target.closest('[data-pv-retry]')) return show();
    if (e.target.closest('[data-pv-open]')) { keep = true; return; }
    const step = e.target.closest('[data-pv-go]'), del = e.target.closest('[data-pv-del]');
    if (step) return go(Number(step.dataset.pvGo));
    if (!del || del.getAttribute('aria-busy') === 'true') return;
    if (!del.dataset.sure) { del.dataset.sure = '1'; del.textContent = 'Tap again to remove'; return; }
    const f = list[i];
    del.setAttribute('aria-busy', 'true');
    try {
      await api.files.remove(f.id);
      thumbs.delete(f.id); list.splice(i, 1); onRemove?.(f);
      data.refresh([f.entity].filter(Boolean)).catch(() => {});
      if (!list.length) return close();
      i = Math.min(i, list.length - 1); show();
    } catch (x) {
      del.removeAttribute('aria-busy'); del.dataset.sure = ''; del.textContent = 'Remove';
      stage().querySelector('.pv-err')?.remove();
      stage().insertAdjacentHTML('beforeend', `<p class="pv-msg pv-err" role="alert">${esc(x?.status ? x.message : 'Not removed. Check the network.')}</p>`);
    }
  });
  // Escape closes the viewer only, not the drawer or screen underneath.
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } else if (e.key === 'ArrowLeft') go(-1); else if (e.key === 'ArrowRight') go(1);
  });
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  window.addEventListener('hashchange', close);   // leaving the screen takes the viewer with it
  dlg.showModal();
  viewer = { dlg, close };
  show();
}

// ── Tiles ──
const FLAG = { prep: 'Reading', wait: 'Waiting', send: 'Sending', fail: 'Not sent', sent: 'Sent' };
const fileTile = (f, i) => `<li class="ph-item">${f.type === PDF
  ? `<button type="button" class="ph-tile ph-doc" data-ph-open="${i}" aria-label="Open ${esc(f.name)}">${DOC}<span class="ph-name">${esc(f.name)}</span></button>`
  : `<button type="button" class="ph-tile" data-ph-open="${i}" aria-label="Open ${esc(f.name)}"><img alt="" ${thumbs.has(f.id) ? `src="${esc(thumbs.get(f.id))}"` : `data-ph-thumb="${esc(f.id)}"`}><span class="ph-name" hidden>${esc(f.name)}</span></button>`}</li>`;
const pendTile = (it, i, removable) => `<li class="ph-item is-${it.state}">
  <button type="button" class="ph-tile${it.thumb ? '' : ' ph-doc'}" data-ph-peek="${i}" ${it.data ? '' : 'disabled'} aria-label="Open ${esc(it.name)}">${it.thumb ? `<img alt="" src="${esc(it.thumb)}">` : `${DOC}<span class="ph-name">${esc(it.name)}</span>`}</button>
  ${it.state === 'wait' && removable ? '' : `<span class="ph-flag">${FLAG[it.state]}</span>`}
  ${removable && it.state !== 'send' && it.state !== 'sent' ? `<button type="button" class="ph-x" data-ph-drop="${i}" aria-label="Take ${esc(it.name)} off">×</button>` : ''}</li>`;
const addRow = (few) => `<div class="ph-add">
  <button type="button" class="btn btn-outline ph-btn ph-cam" data-ph-pick="cam">${CAM}<span>Take photo</span></button>
  <button type="button" class="btn btn-outline ph-btn" data-ph-pick="file">${PLUS}<span>${few ? 'Choose file' : 'Add photo or PDF'}</span></button>
  <input type="file" hidden data-ph-in="cam" accept="image/*" capture="environment">
  <input type="file" hidden data-ph-in="file" accept="image/*,application/pdf" multiple>
</div>`;
/** The two Add buttons: each opens its own hidden file input; the camera one goes straight to the camera on a phone. */
function wirePick(root, take) {
  root.addEventListener('click', (e) => { const b = e.target.closest('[data-ph-pick]'); if (b && !b.disabled) root.querySelector(`[data-ph-in="${b.dataset.phPick}"]`)?.click(); });
  root.addEventListener('change', (e) => { const inp = e.target.closest('[data-ph-in]'); if (!inp) return; const picked = [...inp.files]; inp.value = ''; if (picked.length) take(picked); });
}

// ── Sending: one queue per record, so a strip drawn again picks up what is still going ──
const jobs = new Map(), strips = new Set();
const jobOf = (entity, id) => { const key = `${entity}:${id}`; if (!jobs.has(key)) jobs.set(key, { key, entity, id, items: [], total: 0, done: 0, running: false, subs: new Set() }); return jobs.get(key); };
const tell = (job, meta) => job.subs.forEach((fn) => { try { fn(meta); } catch (e) { console.error(e); } });
async function pump(job) {
  if (job.running) return;
  job.running = true;
  for (;;) {
    const it = job.items.find((x) => x.state === 'wait');
    if (!it) break;
    it.state = 'send'; tell(job);
    try {
      const meta = await api.files.add(job.entity, job.id, { name: it.name, type: it.type, data: it.data });
      if (it.thumb) thumbs.set(meta.id, it.thumb);
      job.items.splice(job.items.indexOf(it), 1); job.done++; tell(job, meta);
    } catch (e) { it.state = 'fail'; it.error = why(e); tell(job); }
  }
  job.running = false;
  if (!job.items.length) { job.total = 0; job.done = 0; if (!job.subs.size) jobs.delete(job.key); }
  tell(job);
}
function enqueue(job, picked, room, onError = oops) {
  if (picked.length > room) { onError(new Error(room > 0 ? `A record holds ${PHOTO_LIMITS.perRecord} files. Only the first ${room} were taken.` : `This record already has ${PHOTO_LIMITS.perRecord} files.`)); picked = picked.slice(0, Math.max(0, room)); }
  return Promise.all(picked.map((file) => {
    const it = { name: file.name || 'photo', type: file.type, state: 'prep' };
    job.items.push(it); job.total++; tell(job);
    return prepare(file).then((p) => { Object.assign(it, p, { state: 'wait' }); tell(job); }, (e) => { job.items.splice(job.items.indexOf(it), 1); job.total--; tell(job); onError(e); });
  })).then(() => pump(job));
}

/** Attach files to a record without any interface. Resolves to { sent, failed: [{ name, error }] }. */
export async function addFiles(entity, id, files) {
  const job = jobOf(entity, id), before = job.done, failed = [];
  await enqueue(job, [...files], PHOTO_LIMITS.perRecord, (e) => failed.push({ name: '', error: e.message }));
  while (job.running) await new Promise((r) => setTimeout(r, 60));
  job.items.filter((x) => x.state === 'fail').forEach((x) => failed.push({ name: x.name, error: x.error }));
  return { sent: Math.max(0, job.done - before), failed };
}

/**
 * The strip for one record. `canAdd` shows the Add buttons; `bare` leaves the heading out;
 * `big` makes the buttons and tiles larger for a phone held in one hand.
 * Returns { refresh, destroy }.
 */
export function mountPhotos(host, entity, id, { canAdd = true, bare = false, big = false, title = 'Photos and documents' } = {}) {
  for (const s of strips) if (!s.root.isConnected) s.destroy();
  if (!host) return null;
  const job = jobOf(entity, id);
  host.innerHTML = `<section class="photos${big ? ' photos-big' : ''}" aria-label="${esc(title)}">
    ${bare ? '' : `<div class="ph-head"><p class="eyebrow">${esc(title)}</p>${info(ABOUT, title)}<span class="ph-count"></span></div>`}
    <ul class="ph-grid"></ul>
    <div class="ph-status" role="status" aria-live="polite"></div>
    ${canAdd ? addRow(false) : ''}
  </section>`;
  const root = host.firstElementChild, grid = root.querySelector('.ph-grid'), status = root.querySelector('.ph-status');
  let files = null, failed = false;
  const mayRemove = (f) => !!f.id && (f.by === data.user?.id || data.can(entityById[entity]?.module, 'admin'));

  const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      io.unobserve(en.target);
      if (en.target === root) refresh(); else loadThumb(en.target);
    }
  }, { rootMargin: '200px' }) : null;
  function loadThumb(img) {
    thumbOf(img.dataset.phThumb).then((src) => { img.src = src; img.removeAttribute('data-ph-thumb'); }, () => {
      const tile = img.closest('.ph-tile'); if (!tile) return;
      tile.classList.add('ph-doc'); img.remove(); tile.insertAdjacentHTML('afterbegin', DOC); tile.querySelector('.ph-name')?.removeAttribute('hidden');
    });
  }
  function draw() {
    const n = (files || []).length, bad = job.items.filter((x) => x.state === 'fail').length;
    grid.innerHTML = (files || []).map(fileTile).join('') + job.items.map((it, i) => pendTile(it, i, it.state === 'fail')).join('');
    grid.querySelectorAll('img[data-ph-thumb]').forEach((img) => (io ? io.observe(img) : loadThumb(img)));
    const count = root.querySelector('.ph-count'); if (count) count.textContent = files ? `${n} of ${PHOTO_LIMITS.perRecord}` : '';
    const going = job.items.some((x) => x.state !== 'fail');
    status.innerHTML = failed ? '<span>Photos could not be loaded.</span><button type="button" class="link" data-ph-reload>Try again</button>'
      : going ? `<span>Sending ${Math.min(job.done + 1, job.total)} of ${job.total}</span><span class="bar" style="--v:${job.total ? Math.round((job.done / job.total) * 100) : 0}%"><i></i></span>`
        : bad ? `<span class="ph-bad">${bad} not sent. ${esc(job.items.find((x) => x.state === 'fail')?.error || '')}</span><button type="button" class="link" data-ph-retry>Try again</button>`
          : files && !n && !bare ? '<span class="ph-none">None yet</span>' : '';
    const full = n + job.items.length >= PHOTO_LIMITS.perRecord;
    root.querySelectorAll('[data-ph-pick]').forEach((b) => { b.disabled = full; });
  }
  async function refresh() {
    try { files = (await api.files.list(entity, id)).map((f) => ({ ...f, entity })); failed = false; } catch { failed = !files; }
    if (root.isConnected) draw();
  }
  const sub = (meta) => {
    if (meta && !files) refresh();   // sent before the list was ever loaded (the strip was off screen, or the network was down)
    else if (meta && !files.some((f) => f.id === meta.id)) files.push({ ...meta, entity });
    if (root.isConnected) draw();
  };
  job.subs.add(sub);

  wirePick(root, (picked) => enqueue(job, picked, PHOTO_LIMITS.perRecord - (files || []).length - job.items.length));
  root.addEventListener('click', (e) => {
    const open = e.target.closest('[data-ph-open]'), peek = e.target.closest('[data-ph-peek]'), dropIt = e.target.closest('[data-ph-drop]');
    if (open) view(files, Number(open.dataset.phOpen), { mayRemove, onRemove: draw });
    else if (peek) view([job.items[Number(peek.dataset.phPeek)]].filter((x) => x?.data), 0);
    else if (dropIt) { job.items.splice(Number(dropIt.dataset.phDrop), 1); job.total = Math.max(job.done, job.total - 1); if (!job.items.length) { job.total = 0; job.done = 0; } draw(); }
    else if (e.target.closest('[data-ph-retry]')) { job.items.forEach((x) => { if (x.state === 'fail') x.state = 'wait'; }); draw(); pump(job); }
    else if (e.target.closest('[data-ph-reload]')) refresh();
  });

  const strip = { root, refresh, destroy() { io?.disconnect(); job.subs.delete(sub); strips.delete(strip); if (!job.items.length && !job.subs.size) jobs.delete(job.key); } };
  strips.add(strip);
  draw();
  if (io) io.observe(root); else refresh();
  return strip;
}

/**
 * Photos picked before the record they belong to exists. Shows what is queued; `sendTo(entity, id)`
 * sends whatever has not gone yet and can be called again after a failure.
 * Returns { count, unsent, sendTo, destroy }.
 */
export function photoQueue(host, { onChange } = {}) {
  const items = [];
  let sending = false;
  host.innerHTML = `<div class="photos photos-big photos-queue"><ul class="ph-grid"></ul><div class="ph-status" role="status" aria-live="polite"></div>${addRow(true)}</div>`;
  const root = host.firstElementChild, grid = root.querySelector('.ph-grid'), status = root.querySelector('.ph-status');
  function draw() {
    grid.innerHTML = items.map((it, i) => pendTile(it, i, !sending)).join('');
    const total = items.length, done = items.filter((x) => x.state === 'sent').length;
    status.innerHTML = sending ? `<span>Sending ${Math.min(done + 1, total)} of ${total}</span><span class="bar" style="--v:${total ? Math.round((done / total) * 100) : 0}%"><i></i></span>` : '';
    root.querySelectorAll('[data-ph-pick]').forEach((b) => { b.disabled = sending || total >= PHOTO_LIMITS.perRecord; });
    onChange?.();
  }
  wirePick(root, (picked) => {
    const room = PHOTO_LIMITS.perRecord - items.length;
    if (picked.length > room) { oops(new Error(room > 0 ? `A report holds ${PHOTO_LIMITS.perRecord} photos. Only the first ${room} were taken.` : `A report holds ${PHOTO_LIMITS.perRecord} photos.`)); picked = picked.slice(0, Math.max(0, room)); }
    for (const file of picked) {
      const it = { name: file.name || 'photo', type: file.type, state: 'prep' };
      items.push(it);
      prepare(file).then((p) => { Object.assign(it, p, { state: 'wait' }); draw(); }, (e) => { items.splice(items.indexOf(it), 1); draw(); oops(e); });
    }
    draw();
  });
  root.addEventListener('click', (e) => {
    const peek = e.target.closest('[data-ph-peek]'), dropIt = e.target.closest('[data-ph-drop]');
    if (peek) { const ready = items.filter((x) => x.data); view(ready, Math.max(0, ready.indexOf(items[Number(peek.dataset.phPeek)]))); }
    else if (dropIt && !sending) { items.splice(Number(dropIt.dataset.phDrop), 1); draw(); }
  });
  draw();
  return {
    get count() { return items.length; },
    get unsent() { return items.filter((x) => x.state !== 'sent').length; },
    /** Send every photo that has not gone yet to this record. Never rejects: resolves to { sent, failed: [{ name, error }] }. */
    async sendTo(entity, id) {
      while (items.some((x) => x.state === 'prep')) await new Promise((r) => setTimeout(r, 60));
      sending = true; items.forEach((x) => { if (x.state === 'fail') x.state = 'wait'; }); draw();
      for (const it of items.filter((x) => x.state === 'wait')) {
        it.state = 'send'; draw();
        try { const meta = await api.files.add(entity, id, { name: it.name, type: it.type, data: it.data }); if (it.thumb) thumbs.set(meta.id, it.thumb); it.state = 'sent'; }
        catch (e) { it.state = 'fail'; it.error = why(e); }
        if (root.isConnected) draw();
      }
      sending = false; if (root.isConnected) draw();
      return { sent: items.filter((x) => x.state === 'sent').length, failed: items.filter((x) => x.state === 'fail').map((x) => ({ name: x.name, error: x.error })) };
    },
    destroy() { items.length = 0; },
  };
}
