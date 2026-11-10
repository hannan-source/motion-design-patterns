// The business map: a 3D model of Dema end to end. Places come from ontology.js, their
// health from the schedule and the stock, and the four flow layers animate between them.

import * as THREE from '../vendor/three.module.min.js';
import { NODES, FLOWS, LAYERS, ZONES, SYSTEMS, SYSTEM_KINDS, TOURS, nodeById } from './ontology.js';
import { buildNode, HEIGHT } from './models.js';
import { simulate, nodeHealth, isEmpty, STAGE_NAMES } from './engine.js';
import { FABRICS, SHADES } from './seed.js';
import { cssVar, esc, inr, num, sum, fmtDate, by, clamp } from './util.js';

const PLINTH = 0.6;
const ERP_FOR = {
  mills: 'inbound', dock: 'inbound', fabricqc: 'inbound', darkroom: 'inbound', fabricstore: 'inventory', threadstore: 'inventory', toolcrib: 'inventory', trims: 'inventory',
  dyer: 'dye', dyecheck: 'dye', cutting: 'floor', lineb2b: 'floor', lined2c: 'floor', sampling: 'floor', finishing: 'floor', finalqc: 'floor',
  dispatch: 'dispatch', dhl: 'dispatch', shopify: 'dispatch', bombay: 'dispatch', finance: 'finance', revolve: 'floor', ukbuyers: 'floor', global: 'floor',
};
const easeOut = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t));
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

let remembered = { layers: { material: true, goods: true, money: true, data: true }, selected: null };

export function mount(el, ctx) {
  const { store } = ctx;
  el.innerHTML = `
    <div class="map">
      <canvas class="map-canvas" aria-label="3D map of the business. Drag to turn, scroll to zoom, select a place for detail."></canvas>
      <div class="map-labels" aria-hidden="true"></div>
      <div class="map-top">
        <div class="map-layers" role="group" aria-label="Flows shown">
          ${Object.entries(LAYERS).map(([id, l]) => `<button class="chip" type="button" data-layer="${id}" aria-pressed="true" style="--c:var(${l.var})" title="${esc(l.what)}"><span class="dot"></span>${esc(l.name)}</button>`).join('')}
        </div>
        <div class="map-banner" hidden></div>
      </div>
      <div class="map-help faint">Drag to turn · right-drag or two fingers to move · scroll or pinch to zoom</div>
      <button class="btn btn-sm map-home" type="button">Whole business</button>
      <aside class="map-inspector" aria-live="polite"></aside>
      <div class="map-tour" hidden></div>
    </div>`;
  const wrap = el.querySelector('.map');
  const canvas = el.querySelector('.map-canvas');
  const labelsEl = el.querySelector('.map-labels');
  const inspector = el.querySelector('.map-inspector');
  const tourEl = el.querySelector('.map-tour');
  const banner = el.querySelector('.map-banner');

  let state = store.get();
  let sim = simulate(state, isEmpty(state.scenario) ? null : state.scenario);
  let health = nodeHealth(state, sim);
  let layers = { ...remembered.layers };
  let selected = null;
  let tour = null; // { def, i, savedLayers }
  let sheetOpen = false;

  // ───────── Scene ─────────
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 1, 900);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.7);
  const sun = new THREE.DirectionalLight(0xffffff, 2.3);
  sun.position.set(-60, 110, 70);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -95, right: 95, top: 80, bottom: -80, near: 10, far: 320 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05;
  scene.add(hemi, sun);

  const std = (o = {}) => new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, ...o });
  const flat = (o = {}) => new THREE.MeshBasicMaterial(o);
  const M = {
    ground: std(), plinth: std(), block: std({ roughness: 0.8 }), pad: std(), ink: std({ roughness: 0.7 }), dark: std(), raw: std(), parcel: std(), staff: std(),
    material: std(), goods: std(), money: std(), data: std(), warnMat: std(), critMat: std(),
    glass: std({ transparent: true, opacity: 0.45, roughness: 0.2 }), glow: flat(), beacon: flat(),
    beam: flat({ transparent: true, opacity: 0.32, depthWrite: false }),
  };
  const layerMat = {}, dotMat = {};
  for (const id of Object.keys(LAYERS)) {
    layerMat[id] = flat({ transparent: true, opacity: 0.5, depthWrite: false });
    dotMat[id] = flat();
  }
  const ringMat = { warn: flat({ transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }), crit: flat({ transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }) };
  const selMat = flat({ transparent: true, opacity: 0.9 });

  function applyTheme() {
    const c = (v) => new THREE.Color(cssVar(v));
    const dark = getComputedStyle(document.documentElement).colorScheme.includes('dark');
    const ground = c('--scene-ground'), block = c('--scene-block');
    renderer.setClearColor(ground);
    scene.fog = new THREE.Fog(ground, 260, 520);
    M.ground.color.copy(ground); M.plinth.color.copy(c('--scene-plinth')); M.block.color.copy(block);
    M.pad.color.copy(c('--scene-plinth')).lerp(ground, dark ? -0.6 : 0.75);
    M.ink.color.copy(dark ? c('--ink-3') : c('--ink-2')); M.dark.color.copy(c('--scene-dark'));
    M.raw.color.set(dark ? '#B9B4A4' : '#E9E2CF'); M.parcel.color.set(dark ? '#A8845C' : '#C9A678'); M.staff.color.copy(dark ? c('--ink-2') : c('--ink-3'));
    for (const id of Object.keys(LAYERS)) { const col = c(LAYERS[id].var); M[id].color.copy(col); layerMat[id].color.copy(col); dotMat[id].color.copy(col); }
    M.warnMat.color.copy(c('--warn')); M.critMat.color.copy(c('--crit'));
    M.glass.color.copy(c('--data')).lerp(block, 0.55);
    M.glow.color.copy(dark ? c('--data') : c('--surface')); M.beacon.color.copy(c('--data')); M.beam.color.copy(c('--data'));
    for (const o of flowObjs) o.tube.material.color.copy(c(LAYERS[o.f.layer].var));
    ringMat.warn.color.copy(c('--warn')); ringMat.crit.color.copy(c('--crit')); selMat.color.copy(c('--accent'));
    hemi.intensity = dark ? 1.0 : 1.7; sun.intensity = dark ? 1.5 : 2.3;
    hemi.groundColor.copy(ground);
  }

  // Ground, zone plinths
  const groundMesh = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), M.ground);
  groundMesh.rotation.x = -Math.PI / 2; groundMesh.receiveShadow = true; scene.add(groundMesh);
  const zoneBoxes = {};
  for (const z of ZONES) {
    const ns = NODES.filter((n) => n.zone === z.id);
    const x0 = Math.min(...ns.map((n) => n.pos[0] - n.size[0] / 2)) - 3, x1 = Math.max(...ns.map((n) => n.pos[0] + n.size[0] / 2)) + 3;
    const z0 = Math.min(...ns.map((n) => n.pos[1] - n.size[1] / 2)) - 3, z1 = Math.max(...ns.map((n) => n.pos[1] + n.size[1] / 2)) + 3;
    zoneBoxes[z.id] = { x0, x1, z0, z1 };
    const p = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, PLINTH, z1 - z0), M.plinth);
    p.position.set((x0 + x1) / 2, PLINTH / 2, (z0 + z1) / 2); p.receiveShadow = true; p.castShadow = true; scene.add(p);
  }

  // Places
  const nodeObj = {};
  const pickables = [];
  const pulsers = [];
  NODES.forEach((n, i) => {
    const g = buildNode(n, M);
    g.position.set(n.pos[0], PLINTH, n.pos[1]);
    scene.add(g);
    g.traverse((m) => { if (m.userData.pulse) pulsers.push(m); });
    const h = HEIGHT[n.kind] || 4;
    const hit = new THREE.Mesh(new THREE.BoxGeometry(n.size[0], h, n.size[1]), new THREE.MeshBasicMaterial({ visible: false }));
    hit.position.set(n.pos[0], PLINTH + h / 2, n.pos[1]); hit.userData.id = n.id; scene.add(hit); pickables.push(hit);
    const r = Math.max(n.size[0], n.size[1]) * 0.6;
    const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.5, 56), ringMat.warn);
    const ping = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.34, 56), ringMat.warn.clone());
    for (const m of [ring, ping]) { m.rotation.x = -Math.PI / 2; m.position.set(n.pos[0], PLINTH + 0.06, n.pos[1]); m.visible = false; scene.add(m); }
    const sel = new THREE.Mesh(new THREE.BoxGeometry(n.size[0] + 1.3, 0.1, n.size[1] + 1.3), selMat);
    sel.position.set(n.pos[0], PLINTH + 0.03, n.pos[1]); sel.visible = false; scene.add(sel);
    const label = document.createElement('button');
    label.type = 'button'; label.className = 'map-label'; label.tabIndex = -1; label.dataset.id = n.id;
    label.innerHTML = `<i></i><span>${esc(n.name)}</span>`;
    labelsEl.appendChild(label);
    nodeObj[n.id] = { n, g, h, ring, ping, sel, label, phase: i * 0.37, lift: 0 };
  });
  const zoneLabels = ZONES.map((z) => {
    const d = document.createElement('div'); d.className = 'map-zone'; d.textContent = z.name; labelsEl.appendChild(d);
    const b = zoneBoxes[z.id];
    return { el: d, pos: new THREE.Vector3(b.x0 + 0.5, PLINTH, b.z1 + 0.2) };
  });

  // Flows: ground-level conveyors for material and garments, arcs for money, a high canopy for data.
  const pairCount = {};
  const flowObjs = FLOWS.map((f, idx) => {
    const a = nodeById[f.from], b = nodeById[f.to];
    const key = [f.from, f.to].sort().join('|') + (f.layer === 'data' || f.layer === 'money' ? f.layer : 'ground');
    const lane = pairCount[key] = (pairCount[key] ?? -1) + 1;
    const A = new THREE.Vector3(a.pos[0], 0, a.pos[1]), B = new THREE.Vector3(b.pos[0], 0, b.pos[1]);
    const dir = B.clone().sub(A); const dist = dir.length(); dir.normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const edge = (n, sgn) => { const t = Math.min((n.size[0] / 2) / Math.max(1e-3, Math.abs(dir.x)), (n.size[1] / 2) / Math.max(1e-3, Math.abs(dir.z))); return dir.clone().multiplyScalar(sgn * Math.min(t, dist * 0.4)); };
    let lift, y0, y1;
    if (f.layer === 'data') { y0 = PLINTH + nodeObj[a.id].h + 0.4; y1 = PLINTH + nodeObj[b.id].h + 0.4; lift = 10 + dist * 0.28; }
    else if (f.layer === 'money') { y0 = PLINTH + nodeObj[a.id].h * 0.7; y1 = PLINTH + nodeObj[b.id].h * 0.7; lift = 5 + dist * 0.2; }
    else { y0 = y1 = PLINTH + 0.75; A.add(edge(a, 1)); B.add(edge(b, -1)); lift = f.lift ?? 1.0 + dist * 0.035; }
    if (f.lift && f.layer !== 'material' && f.layer !== 'goods') lift = f.lift + dist * 0.12;
    A.y = y0; B.y = y1;
    const offset = side.clone().multiplyScalar((lane === 0 ? 0 : lane % 2 ? 1 : -1) * Math.ceil(lane / 2) * 1.7 + (f.layer === 'goods' ? 0.5 : f.layer === 'material' ? -0.5 : 0));
    A.add(offset); B.add(offset);
    const mid = A.clone().add(B).multiplyScalar(0.5); mid.y = Math.max(y0, y1) + lift; mid.add(offset.clone().multiplyScalar(0.6));
    const curve = new THREE.QuadraticBezierCurve3(A, mid, B);
    const len = curve.getLength();
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(14, Math.round(len / 2.2)), f.layer === 'data' ? 0.09 : f.layer === 'money' ? 0.13 : 0.2, 6, false), layerMat[f.layer].clone());
    tube.userData.base = f.weak ? 0.25 : f.layer === 'data' ? 0.42 : 0.62;
    scene.add(tube);
    const n = f.weak ? 1 : clamp(Math.round(len / 9), 2, 7);
    return { f, idx, curve, len, tube, n, speed: (f.layer === 'data' ? 13 : f.layer === 'money' ? 10 : 7.5) / len, on: true, dim: false };
  });
  // One instanced mesh of travelling dots per layer.
  const dotGeo = { material: new THREE.BoxGeometry(0.75, 0.55, 0.55), goods: new THREE.SphereGeometry(0.42, 12, 10), money: new THREE.CylinderGeometry(0.42, 0.42, 0.16, 14), data: new THREE.OctahedronGeometry(0.36) };
  const dots = {};
  for (const id of Object.keys(LAYERS)) {
    const count = sum(flowObjs.filter((o) => o.f.layer === id), (o) => o.n);
    dots[id] = new THREE.InstancedMesh(dotGeo[id], dotMat[id], count);
    dots[id].frustumCulled = false; scene.add(dots[id]);
  }
  const tmpM = new THREE.Matrix4(), tmpP = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), zero = new THREE.Vector3(0, 0, 0);

  function refreshFlows() {
    for (const o of flowObjs) {
      const touches = selected && (o.f.from === selected || o.f.to === selected);
      o.on = layers[o.f.layer];
      o.dim = !!selected && !touches;
      o.tube.visible = o.on;
      o.tube.material.opacity = o.dim ? 0.07 : touches ? 0.95 : o.tube.userData.base;
    }
    el.querySelectorAll('[data-layer]').forEach((b) => b.setAttribute('aria-pressed', String(layers[b.dataset.layer])));
  }

  function refreshHealth() {
    for (const id in nodeObj) {
      const o = nodeObj[id], hl = health[id];
      o.ring.visible = o.ping.visible = !!hl;
      if (hl) { o.ring.material = ringMat[hl.level]; o.ping.material.color.copy(ringMat[hl.level].color); }
      o.label.dataset.level = hl ? hl.level : '';
      o.label.classList.toggle('is-selected', selected === id);
      o.sel.visible = selected === id;
    }
  }

  // ───────── Camera ─────────
  const narrow = () => wrap.getBoundingClientRect().width <= 860;
  const HOME = narrow() ? { tx: 0, tz: -4, radius: 300, theta: -0.4, phi: 0.82 } : { tx: 5, tz: -6, radius: 206, theta: -0.4, phi: 0.9 };
  const cam = { ...HOME };
  let fly = null;
  function placeCamera() {
    const s = Math.sin(cam.phi), c = Math.cos(cam.phi);
    camera.position.set(cam.tx + cam.radius * s * Math.sin(cam.theta), cam.radius * c, cam.tz + cam.radius * s * Math.cos(cam.theta));
    camera.lookAt(cam.tx, 2, cam.tz);
  }
  function flyTo(to, dur = 1.15) {
    if (reduced()) { Object.assign(cam, to); placeCamera(); return; }
    const from = { ...cam };
    let dth = (to.theta ?? cam.theta) - cam.theta; dth = Math.atan2(Math.sin(dth), Math.cos(dth));
    fly = { from, to: { ...cam, ...to, theta: cam.theta + dth }, t: 0, dur };
  }
  const focusNode = (id, zoom = true) => {
    const n = nodeById[id]; if (!n) return;
    const big = Math.max(n.size[0], n.size[1]);
    flyTo({ tx: n.pos[0], tz: n.pos[1], ...(zoom ? { radius: clamp(58 + big * 3.2, 70, 110), phi: 0.98 } : {}) });
  };

  let W = 1, H = 1;
  function resize() {
    const r = wrap.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    // Keep the model centred in the space the inspector leaves free.
    const insp = inspector.getBoundingClientRect();
    if (W > 860) camera.setViewOffset(W, H, (insp.width + 16) / 2, 0, W, H);
    else camera.setViewOffset(W, H, 0, (sheetOpen ? insp.height : 132) / 2 - 20, W, H);
    camera.fov = W > 860 ? 30 : 38;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize); ro.observe(wrap);

  // Pointer: one finger or left button turns, right button or two fingers move, wheel or pinch zooms.
  const ptrs = new Map();
  let drag = null, moved = 0, pinch = null;
  const pan = (dx, dy) => {
    const k = cam.radius * 0.0012;
    cam.tx -= (Math.cos(cam.theta) * dx + Math.sin(cam.theta) * dy / Math.cos(cam.phi)) * k;
    cam.tz -= (-Math.sin(cam.theta) * dx + Math.cos(cam.theta) * dy / Math.cos(cam.phi)) * k;
    cam.tx = clamp(cam.tx, -80, 80); cam.tz = clamp(cam.tz, -60, 50);
  };
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    fly = null; moved = 0;
    if (ptrs.size === 1) drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey };
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }; drag = null; }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) { hover(e); return; }
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && ptrs.size === 2) {
      const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      cam.radius = clamp(cam.radius * (pinch.d / d), 45, 360); pan(cx - pinch.cx, cy - pinch.cy);
      pinch = { d, cx, cy }; moved = 99;
    } else if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y; moved += Math.abs(dx) + Math.abs(dy);
      if (drag.pan) pan(dx, dy); else { cam.theta -= dx * 0.005; cam.phi = clamp(cam.phi - dy * 0.004, 0.25, 1.36); }
      drag.x = e.clientX; drag.y = e.clientY;
    }
  });
  const up = (e) => {
    const was = ptrs.size; ptrs.delete(e.pointerId);
    if (was === 1 && moved < 6 && e.type === 'pointerup') { const id = pick(e); select(id); if (id) focusNode(id, cam.radius > 125); }
    if (ptrs.size < 2) pinch = null;
    if (ptrs.size === 0) drag = null;
  };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); fly = null; cam.radius = clamp(cam.radius * Math.exp(e.deltaY * 0.0011), 45, 300); }, { passive: false });

  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function pick(e) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(pickables, false)[0];
    return hit ? hit.object.userData.id : null;
  }
  let hovered = null;
  function hover(e) {
    if (e.pointerType !== 'mouse') return;
    const id = pick(e);
    if (id === hovered) return;
    if (hovered) nodeObj[hovered].label.classList.remove('is-hover');
    hovered = id; canvas.style.cursor = id ? 'pointer' : '';
    if (id) nodeObj[id].label.classList.add('is-hover');
  }
  labelsEl.addEventListener('click', (e) => { const b = e.target.closest('.map-label'); if (b) { select(b.dataset.id); focusNode(b.dataset.id, cam.radius > 125); } });

  // ───────── Inspector ─────────
  function select(id, { keepTour = false } = {}) {
    if (!keepTour && tour) endTour(false);
    selected = id; remembered.selected = id;
    sheetOpen = !!id;
    refreshFlows(); refreshHealth(); renderInspector();
  }

  const levelPill = (hl) => hl ? `<span class="pill pill-${hl.level}">${hl.level === 'crit' ? 'Needs action' : 'Watch'}</span>` : '<span class="pill pill-ok">Running</span>';

  function metrics(id) {
    const s = state, rolls = s.rolls, m = (f) => Math.round(sum(rolls.filter(f), (r) => r.metres));
    const value = (f) => sum(rolls.filter(f), (r) => r.metres * (FABRICS[r.fabric].cost + (r.shade ? FABRICS[r.fabric].dye : 0)));
    const wcs = s.workCentres.filter((w) => w.node === id);
    const out = [];
    for (const w of wcs) {
      const simW = sim.wcs.find((x) => x.id === w.id);
      const mine = sim.orders.filter((o) => (w.stage === 'stitch' ? o.pools.includes(w.id) : true));
      out.push([`${w.name}: people`, `${simW.opsPlanned} ${w.role}`]);
      out.push(['Standard minutes a day', num(simW.cap[0])]);
      out.push(['Load this week / next', `${Math.round(sim.weeks[0].util[w.id] * 100)}% / ${Math.round(sim.weeks[1].util[w.id] * 100)}%`]);
      if (w.stage === 'stitch') out.push(['Orders in the queue', `${mine.length}, ${mine.filter((o) => o.late > 0).length} late`]);
    }
    const chan = { shopify: (o) => o.customer === 'Shopify', bombay: (o) => o.customer === 'Bombay store', revolve: (o) => o.customer === 'Revolve', ukbuyers: (o) => o.customer === 'UK buyers', global: (o) => o.customer === 'Global wholesale', merch: (o) => o.channel === 'SAMPLE' }[id];
    if (chan) {
      const mine = sim.orders.filter(chan);
      const next = mine.slice().sort((a, b) => a.dueDay - b.dueDay)[0];
      out.push(['Open orders', `${mine.length} · ${num(sum(mine, (o) => o.qty))} pieces`]);
      if (next) out.push(['Next due', `${next.id}, ${fmtDate(next.due)}`]);
      out.push(['On track', `${mine.filter((o) => o.late === 0).length} of ${mine.length}`]);
    }
    switch (id) {
      case 'mills': out.push(['Rolls failed at inspection', rolls.filter((r) => r.status === 'rejected').length], ['Claims raised', inr(sum(s.ledger.filter((v) => v.type === 'Debit Note'), (v) => v.amount))]); break;
      case 'trims': out.push(['Thread shades below minimum', s.threads.filter((t) => t.cones < t.min).length], ['Consumables below minimum', s.tools.filter((t) => t.onHand < t.min).length]); break;
      case 'dock': out.push(['Rolls waiting for inspection', rolls.filter((r) => r.status === 'unaudited' && r.location !== 'Dark room').length]); break;
      case 'fabricqc': out.push(['Passed, waiting to be dyed', `${rolls.filter((r) => r.status === 'passed').length} rolls · ${num(m((r) => r.status === 'passed'))} m`], ['Failed, going back', `${rolls.filter((r) => r.status === 'rejected').length} rolls`], ['Pass mark', '40 points per 100 sq yd']); break;
      case 'darkroom': { const un = rolls.filter((r) => r.status === 'unaudited' && r.location === 'Dark room'); out.push(['Rolls never checked', un.length], ['Metres', num(m((r) => un.includes(r)))], ['Value at cost', inr(value((r) => un.includes(r)))]); break; }
      case 'fabricstore': out.push(['Dyed rolls on the racks', rolls.filter((r) => r.status === 'dyed').length], ['Reserved for orders', `${num(m((r) => r.status === 'dyed' && r.reservedFor))} m`], ['Free to promise', `${num(m((r) => r.status === 'dyed' && !r.reservedFor))} m`]); break;
      case 'dyer': { const lots = s.dyeLots.filter((l) => l.status === 'at_dyer'); out.push(['Lots out', lots.length], ['Metres at the dyer', num(m((r) => r.status === 'at_dyer'))], ['Lost after dyeing', `${rolls.filter((r) => r.status === 'dye_reject').length} rolls · ${inr(value((r) => r.status === 'dye_reject'))}`]); break; }
      case 'dyecheck': { const lots = s.dyeLots.filter((l) => l.status === 'at_dyer').sort((a, b) => a.due.localeCompare(b.due)); out.push(['Lots expected back', lots.length]); if (lots[0]) out.push(['Next', `${lots[0].id} ${SHADES[lots[0].shade].name}, ${fmtDate(lots[0].due)}`]); break; }
      case 'threadstore': { const low = s.threads.filter((t) => t.cones < t.min).sort((a, b) => a.cones - b.cones); out.push(['Shades below minimum', `${low.length} of ${s.threads.length}`]); if (low[0]) out.push(['Lowest', `${SHADES[low[0].shade].name}: ${low[0].cones} cones`]); break; }
      case 'toolcrib': out.push(['Items below minimum', s.tools.filter((t) => t.onHand < t.min).length], ['Machines down', `${s.machines.down} of ${s.machines.total}`], ['Absent today', s.people.absentToday]); break;
      case 'dispatch': out.push(['Packed, waiting for scan', s.parcels.filter((p) => p.status === 'packed').length], ['Store pieces in the factory', s.parcels.filter((p) => p.status === 'at_factory').length]); break;
      case 'dhl': out.push(['Shipments in transit', s.parcels.filter((p) => p.status === 'in_transit').length], ['Delivered', s.parcels.filter((p) => p.status === 'delivered').length]); break;
      case 'bombay': { const st = s.parcels.filter((p) => p.kind === 'store'); out.push(['Pieces in the fit loop', st.length], ['Most visits by one piece', Math.max(0, ...st.map((p) => p.visits || 0))]); break; }
      case 'finance': out.push(['Vouchers waiting for Tally', s.ledger.filter((v) => !v.synced).length], ['Claims recovered from mills', inr(sum(s.ledger.filter((v) => v.type === 'Debit Note'), (v) => v.amount))], ['Written off after dyeing', inr(sum(s.ledger.filter((v) => v.type === 'Journal'), (v) => v.amount))]); break;
      case 'tower': out.push(['Orders on the schedule', sim.orders.length], ['On track', `${sim.orders.filter((o) => o.late === 0).length} of ${sim.orders.length}`], ['Pieces in work', num(sum(sim.orders, (o) => o.qty))]); break;
    }
    return out;
  }

  function renderInspector() {
    if (inspector.classList.contains('is-open') !== sheetOpen) { inspector.classList.toggle('is-open', sheetOpen); resize(); }
    if (!selected) {
      const order = { crit: 0, warn: 1 };
      const issues = Object.entries(health).sort((a, b) => order[a[1].level] - order[b[1].level]);
      inspector.innerHTML = `
        <button class="sheet-grip" type="button" aria-label="Show or hide details"><i></i></button>
        <div class="insp-body">
          <p class="eyebrow">Business map</p>
          <h2>Dema, end to end</h2>
          <p class="muted">Fabric comes in on the left, garments leave on the right, money and information arc overhead. Select any place to see how it runs today, what changes, and what it connects to.</p>
          <section>
            <h3>Needs attention <span class="count">${issues.length}</span></h3>
            <ul class="issue-list">
              ${issues.map(([id, hl]) => `<li><button type="button" data-go="${id}"><span class="lvl lvl-${hl.level}"></span><span><strong>${esc(nodeById[id].name)}</strong><br><span class="muted">${esc(hl.text)}</span></span></button></li>`).join('')}
            </ul>
          </section>
          <section>
            <h3>Walk through</h3>
            <div class="tour-list">
              ${TOURS.map((t) => `<button class="btn btn-sm" type="button" data-tour="${t.id}"><span class="dot" style="background:var(${LAYERS[t.layer].var})"></span>${esc(t.name)}</button>`).join('')}
            </div>
          </section>
          <section>
            <h3>What moves</h3>
            <dl class="legend">
              ${Object.entries(LAYERS).map(([id, l]) => `<div><dt><span class="swatch" style="background:var(${l.var})"></span>${esc(l.name)}</dt><dd>${esc(l.what)} · ${FLOWS.filter((f) => f.layer === id).length} flows</dd></div>`).join('')}
            </dl>
          </section>
          <p class="faint fine">Figures are example data. They stand in for Dema's own until the ERP is fed from the floor.</p>
        </div>`;
      return;
    }
    const n = nodeById[selected], hl = health[selected];
    const zone = ZONES.find((z) => z.id === n.zone);
    const ms = metrics(selected);
    const out = FLOWS.filter((f) => f.from === selected), inn = FLOWS.filter((f) => f.to === selected);
    const flowRow = (f, dirn) => `<li><span class="tag tag-${f.layer}">${esc(LAYERS[f.layer].name)}</span><span class="flow-what">${esc(f.what)}</span><button type="button" class="link" data-go="${dirn === 'out' ? f.to : f.from}">${dirn === 'out' ? 'to' : 'from'} ${esc(nodeById[dirn === 'out' ? f.to : f.from].name)}</button></li>`;
    const isWc = state.workCentres.some((w) => w.node === selected);
    inspector.innerHTML = `
      <button class="sheet-grip" type="button" aria-label="Show or hide details"><i></i></button>
      <div class="insp-body">
        <div class="insp-top"><p class="eyebrow">${esc(zone.name)}</p><button class="btn btn-quiet btn-sm" type="button" data-go="">All places</button></div>
        <h2>${esc(n.name)}</h2>
        <p class="muted">${esc(n.blurb)}</p>
        <div class="insp-status">${levelPill(hl)}${hl ? `<span>${esc(hl.text)}</span>` : ''}</div>
        ${ms.length ? `<dl class="metrics">${ms.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd class="num">${esc(v)}</dd></div>`).join('')}</dl>` : ''}
        <div class="insp-actions">
          ${ERP_FOR[selected] ? `<button class="btn btn-sm btn-primary" type="button" data-erp="${ERP_FOR[selected]}">Open in ERP</button>` : ''}
          ${isWc || selected === 'tower' || selected === 'merch' ? '<button class="btn btn-sm" type="button" data-room>Test a change here</button>' : ''}
        </div>
        <section><h3>How it runs today</h3><ul class="plain today">${n.today.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></section>
        <section><h3>What changes</h3><ul class="plain change">${n.change.map((t) => `<li>${esc(t)}</li>`).join('')}</ul></section>
        <section><h3>Attached systems</h3>
          <ul class="sys-list">${n.systems.map((id) => { const s = SYSTEMS[id], k = SYSTEM_KINDS[s.kind]; return `<li><span class="tag ${k.tag}">${esc(k.name)}</span><div><strong>${esc(s.name)}</strong><br><span class="muted">${esc(s.does)}</span></div></li>`; }).join('')}</ul>
        </section>
        <section><h3>Connected to <span class="count">${out.length + inn.length}</span></h3>
          ${inn.length ? `<p class="eyebrow">Comes in</p><ul class="flow-list">${inn.map((f) => flowRow(f, 'in')).join('')}</ul>` : ''}
          ${out.length ? `<p class="eyebrow">Goes out</p><ul class="flow-list">${out.map((f) => flowRow(f, 'out')).join('')}</ul>` : ''}
        </section>
      </div>`;
    inspector.querySelector('.insp-body').scrollTop = 0;
  }
  inspector.addEventListener('click', (e) => {
    const go = e.target.closest('[data-go]'), t = e.target.closest('[data-tour]'), erp = e.target.closest('[data-erp]');
    if (e.target.closest('.sheet-grip')) { sheetOpen = !sheetOpen; inspector.classList.toggle('is-open', sheetOpen); resize(); return; }
    if (go) { const id = go.dataset.go || null; select(id); if (id) focusNode(id); else flyTo(HOME); }
    else if (t) startTour(t.dataset.tour);
    else if (erp) ctx.go('erp', { module: erp.dataset.erp });
    else if (e.target.closest('[data-room]')) ctx.go('room');
  });

  // ───────── Tours ─────────
  function startTour(id) {
    const def = TOURS.find((t) => t.id === id);
    tour = { def, i: 0, saved: { ...layers } };
    layers = { material: false, goods: false, money: false, data: false, [def.layer]: true };
    if (def.id === 'order' || def.id === 'samples') layers.data = layers.goods = true;
    showStep();
  }
  function showStep() {
    const [id, text] = tour.def.steps[tour.i];
    select(id, { keepTour: true }); focusNode(id);
    tourEl.hidden = false; wrap.classList.add('is-touring');
    tourEl.innerHTML = `
      <div class="tour-meta"><span class="dot" style="background:var(${LAYERS[tour.def.layer].var})"></span><strong>${esc(tour.def.name)}</strong><span class="num faint">${tour.i + 1} / ${tour.def.steps.length}</span></div>
      <p key="${tour.i}">${esc(text)}</p>
      <div class="tour-nav"><button class="btn btn-sm" type="button" data-t="prev" ${tour.i === 0 ? 'disabled' : ''}>Back</button>
      ${tour.i < tour.def.steps.length - 1 ? '<button class="btn btn-sm btn-primary" type="button" data-t="next">Next</button>' : '<button class="btn btn-sm btn-primary" type="button" data-t="end">Finish</button>'}
      <button class="btn btn-sm btn-quiet" type="button" data-t="end">Close</button></div>`;
  }
  function endTour(home = true) {
    if (!tour) return;
    layers = tour.saved; tour = null; tourEl.hidden = true; wrap.classList.remove('is-touring');
    if (home) { select(null); flyTo(HOME); } else refreshFlows();
  }
  tourEl.addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]'); if (!b || !tour) return;
    if (b.dataset.t === 'next') { tour.i++; showStep(); } else if (b.dataset.t === 'prev') { tour.i--; showStep(); } else endTour();
  });

  el.querySelector('.map-layers').addEventListener('click', (e) => {
    const b = e.target.closest('[data-layer]'); if (!b) return;
    layers[b.dataset.layer] = !layers[b.dataset.layer]; remembered.layers = { ...layers }; refreshFlows();
  });
  el.querySelector('.map-home').addEventListener('click', () => { select(null); flyTo(HOME); });
  banner.addEventListener('click', (e) => { if (e.target.closest('button')) store.update((s) => { s.scenario = null; }, 'scenario'); });

  function refreshData() {
    state = store.get();
    const sc = isEmpty(state.scenario) ? null : state.scenario;
    sim = simulate(state, sc); health = nodeHealth(state, sim);
    banner.hidden = !sc;
    if (sc) banner.innerHTML = `<span class="pill pill-info">What-if</span><span>The map is showing a scenario from the Production room.</span><button class="btn btn-sm" type="button">Back to the current plan</button>`;
    refreshHealth(); renderInspector();
  }
  const off = store.on(refreshData);

  // ───────── Frame loop ─────────
  const v = new THREE.Vector3();
  let raf = 0, last = performance.now(), time = 0, running = true;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!running) return;
    time += dt;
    if (fly) {
      fly.t += dt / fly.dur; const k = easeOut(Math.min(1, fly.t));
      for (const key of ['tx', 'tz', 'radius', 'theta', 'phi']) cam[key] = fly.from[key] + (fly.to[key] - fly.from[key]) * k;
      if (fly.t >= 1) fly = null;
    }
    placeCamera();

    // travelling dots
    const idx = { material: 0, goods: 0, money: 0, data: 0 };
    for (const o of flowObjs) {
      const mesh = dots[o.f.layer];
      for (let i = 0; i < o.n; i++) {
        const show = o.on && !o.dim;
        if (show) {
          const t = (time * o.speed + i / o.n + o.idx * 0.137) % 1;
          o.curve.getPoint(t, tmpP);
          const grow = Math.min(1, Math.min(t, 1 - t) * 12);
          tmpS.setScalar(grow); tmpM.compose(tmpP, tmpQ, tmpS);
        } else tmpM.compose(zero, tmpQ, tmpS.setScalar(0));
        mesh.setMatrixAt(idx[o.f.layer]++, tmpM);
      }
    }
    for (const id in dots) dots[id].instanceMatrix.needsUpdate = true;

    // health pings, selection lift, scanner pulses
    for (const id in nodeObj) {
      const o = nodeObj[id];
      if (o.ping.visible) { const p = ((time + o.phase) % 2.6) / 2.6; o.ping.scale.setScalar(1 + p * 0.45); o.ping.material.opacity = 0.7 * (1 - p); }
      const target = selected === id ? 0.9 : 0;
      o.lift += (target - o.lift) * Math.min(1, dt * 9); o.g.position.y = PLINTH + o.lift;
    }
    M.beam.opacity = 0.2 + 0.16 * (0.5 + 0.5 * Math.sin(time * 2.3));

    renderer.render(scene, camera);

    // labels: project, then hide the ones that would sit on top of a more important label
    const shown = [];
    for (const id in nodeObj) {
      const o = nodeObj[id];
      v.set(o.n.pos[0], PLINTH + o.h + 1.2 + o.lift, o.n.pos[1]).project(camera);
      const vis = v.z < 1 && v.x > -1.1 && v.x < 1.1 && v.y > -1.1 && v.y < 1.2;
      o.label.style.display = vis ? '' : 'none';
      if (!vis) continue;
      o.sx = (v.x * 0.5 + 0.5) * W; o.sy = (-v.y * 0.5 + 0.5) * H; o.sz = v.z;
      o.lw ||= o.label.offsetWidth; o.lh ||= o.label.offsetHeight;
      o.label.style.transform = `translate(-50%,-100%) translate(${o.sx.toFixed(1)}px,${o.sy.toFixed(1)}px)`;
      o.label.style.zIndex = String(Math.round((1 - v.z) * 100000));
      const lv = health[id]?.level;
      o.prio = (selected === id ? 8 : 0) + (hovered === id ? 4 : 0) + (lv === 'crit' ? 2 : lv === 'warn' ? 1 : 0);
      shown.push(o);
    }
    shown.sort((a, b) => b.prio - a.prio || a.sz - b.sz);
    const placed = [];
    for (const o of shown) {
      const x0 = o.sx - o.lw / 2 - 3, x1 = o.sx + o.lw / 2 + 3, y0 = o.sy - o.lh - 2, y1 = o.sy + 2;
      const clash = placed.some((p) => x0 < p[1] && x1 > p[0] && y0 < p[3] && y1 > p[2]);
      o.label.classList.toggle('is-crowded', clash);
      if (!clash) placed.push([x0, x1, y0, y1]);
    }
    const far = cam.radius > 150;
    for (const z of zoneLabels) {
      v.copy(z.pos).project(camera);
      z.el.style.display = v.z < 1 && far ? '' : 'none';
      z.el.style.transform = `translate(0,2px) translate(${((v.x * 0.5 + 0.5) * W).toFixed(1)}px,${((-v.y * 0.5 + 0.5) * H).toFixed(1)}px)`;
    }
  }
  const onVis = () => { running = !document.hidden; last = performance.now(); };
  document.addEventListener('visibilitychange', onVis);
  const onTheme = () => { applyTheme(); refreshHealth(); };
  window.addEventListener('themechange', onTheme);

  // ───────── Start ─────────
  applyTheme(); resize(); refreshFlows(); refreshData();
  const focus = ctx.opts?.focus || null;
  if (focus && nodeById[focus]) { select(focus); const n = nodeById[focus]; Object.assign(cam, { tx: n.pos[0], tz: n.pos[1], radius: 150 }); focusNode(focus); }
  else if (!reduced()) { Object.assign(cam, { radius: HOME.radius * 1.45, phi: 0.62, theta: -0.75 }); flyTo(HOME, 2.0); }
  placeCamera();
  raf = requestAnimationFrame(frame);
  // Handle for automated checks and for other views that want to drive the map.
  window.__demaMap = { select, focusNode, startTour, cam, flyTo };

  return () => {
    cancelAnimationFrame(raf); ro.disconnect(); off();
    document.removeEventListener('visibilitychange', onVis); window.removeEventListener('themechange', onTheme);
    scene.traverse((o) => { if (o.geometry && !o.isInstancedMesh && o.geometry.type === 'TubeGeometry') o.geometry.dispose(); });
    renderer.dispose(); delete window.__demaMap;
  };
}
