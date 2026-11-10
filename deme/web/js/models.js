// Small procedural models for the map. Each builder draws one kind of place inside a group
// whose origin is the centre of the node's footprint (w × d), sitting on the plinth.
// Shapes stay simple on purpose: the map should read like an architect's model.

import * as THREE from '../vendor/three.module.min.js';
import { SHADES } from './seed.js';

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const unitCyl = new THREE.CylinderGeometry(0.5, 0.5, 1, 24);
const unitCone = new THREE.ConeGeometry(0.5, 1, 24);
const unitSphere = new THREE.SphereGeometry(0.5, 20, 14);
const unitPrism = (() => { // triangular roof: 1 wide (x), 1 high, 1 deep (z), ridge along z
  const s = new THREE.Shape(); s.moveTo(-0.5, 0); s.lineTo(0.5, 0); s.lineTo(0, 1); s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false });
  g.translate(0, 0, -0.5);
  return g;
})();

export const HEIGHT = { // rough height of each kind, for labels, picking and where arcs leave the roof
  mill: 8, vendor: 5.5, dye: 6, dock: 3.6, rig: 5, dark: 5.4, racks: 4.4, check: 3.4, thread: 4.2, cutting: 2.8, tools: 3.8,
  line: 2.8, sample: 3.6, finish: 3, qc: 3.6, gate: 5, hub: 5.4, shop: 7, store: 6, tower: 14, buyers: 6.6, studio: 5.4, control: 16, ledger: 7.6,
};

/** `M` is the shared material set from map.js. Returns helpers bound to a group. */
function kit(g, M) {
  const add = (geo, mat, sx, sy, sz, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.scale.set(sx, sy, sz); m.position.set(x, y, z); g.add(m); return m; };
  return {
    box: (w, h, d, mat, x = 0, y = 0, z = 0) => add(unitBox, mat, w, h, d, x, y + h / 2, z),
    cyl: (r, h, mat, x = 0, y = 0, z = 0) => add(unitCyl, mat, r * 2, h, r * 2, x, y + h / 2, z),
    cone: (r, h, mat, x = 0, y = 0, z = 0) => add(unitCone, mat, r * 2, h, r * 2, x, y + h / 2, z),
    ball: (r, mat, x = 0, y = 0, z = 0) => add(unitSphere, mat, r * 2, r * 2, r * 2, x, y + r, z),
    roof: (w, h, d, mat, x = 0, y = 0, z = 0) => add(unitPrism, mat, w, h, d, x, y, z),
    /** A fabric roll lying on its side, along x or z. */
    roll: (r, len, mat, x = 0, y = 0, z = 0, along = 'x') => { const m = add(unitCyl, mat, r * 2, len, r * 2, x, y + r, z); if (along === 'x') m.rotation.z = Math.PI / 2; else m.rotation.x = Math.PI / 2; return m; },
    /** Open room: a floor pad with low walls on the two far sides so the inside stays visible. */
    room: (w, d, wall = 1.5) => {
      add(unitBox, M.pad, w, 0.24, d, 0, 0.12, 0);
      add(unitBox, M.block, w, wall, 0.28, 0, wall / 2, -d / 2 + 0.14);
      add(unitBox, M.block, 0.28, wall, d, -w / 2 + 0.14, wall / 2, 0);
    },
    form: (x, z, mat = M.block) => { // dress form
      add(unitCyl, M.ink, 0.12, 1.3, 0.12, x, 0.9, z);
      add(unitCone, mat, 0.95, 1.5, 0.75, x, 2.0, z).rotation.x = Math.PI;
      add(unitSphere, mat, 0.5, 0.4, 0.4, x, 2.85, z);
    },
    person: (x, z, mat = M.ink) => { add(unitCyl, mat, 0.42, 0.9, 0.42, x, 0.7, z); add(unitSphere, mat, 0.4, 0.4, 0.4, x, 1.4, z); },
  };
}

const shadeMats = {};
const shade = (key) => (shadeMats[key] ||= new THREE.MeshStandardMaterial({ color: SHADES[key].hex, roughness: 0.85 }));
const SH = Object.keys(SHADES);

export function buildNode(node, M) {
  const g = new THREE.Group();
  const [w, d] = node.size;
  const k = kit(g, M);
  const hw = w / 2, hd = d / 2;

  switch (node.kind) {
    case 'mill': {
      k.box(w * 0.82, 3.4, d * 0.62, M.block, 0, 0, -d * 0.12);
      for (let i = 0; i < 4; i++) k.roof(w * 0.82 / 4, 1.5, d * 0.62, M.material, -w * 0.41 + (i + 0.5) * (w * 0.82 / 4), 3.4, -d * 0.12);
      k.cyl(0.55, 7.2, M.block, hw - 1.2, 0, -hd + 1.4);
      k.cyl(0.62, 0.5, M.material, hw - 1.2, 6.9, -hd + 1.4);
      for (let i = 0; i < 5; i++) k.roll(0.55, 2.6, M.raw, -hw + 2 + i * 1.25, 0, hd - 1.4, 'z');
      for (let i = 0; i < 4; i++) k.roll(0.55, 2.6, M.raw, -hw + 2.6 + i * 1.25, 0.95, hd - 1.4, 'z');
      break;
    }
    case 'vendor': {
      k.box(w * 0.7, 2.6, d * 0.6, M.block, -w * 0.08, 0, -d * 0.1);
      k.roof(w * 0.7, 1.4, d * 0.6, M.material, -w * 0.08, 2.6, -d * 0.1);
      SH.forEach((s, i) => { k.cone(0.42, 1.0, shade(s), -hw + 1.3 + i * 1.15, 0.3, hd - 1.2); k.cyl(0.5, 0.3, M.ink, -hw + 1.3 + i * 1.15, 0, hd - 1.2); });
      k.box(1.4, 1.1, 1.4, M.pad, hw - 1.4, 0, 0.4); k.box(1.1, 0.9, 1.1, M.pad, hw - 1.5, 1.1, 0.3);
      break;
    }
    case 'dye': {
      k.box(w * 0.5, 3.6, d * 0.55, M.block, -w * 0.2, 0, -d * 0.16);
      k.roof(w * 0.5, 1.5, d * 0.55, M.material, -w * 0.2, 3.6, -d * 0.16);
      k.cyl(0.45, 5.6, M.block, -hw + 1.2, 0, hd - 1.6);
      ['INDIGO', 'CORAL', 'MARIGOLD', 'FUCHSIA'].forEach((s, i) => {
        const x = hw - 2 - (i % 2) * 2.9, z = -hd + 2.2 + Math.floor(i / 2) * 3;
        k.cyl(1.25, 1.3, M.block, x, 0, z); k.cyl(1.05, 0.12, shade(s), x, 1.26, z);
      });
      k.box(3.4, 0.14, 0.2, M.ink, -w * 0.2, 1.9, hd - 1.2);
      ['SEAGREEN', 'INDIGO', 'CORAL'].forEach((s, i) => k.box(0.95, 1.5, 0.08, shade(s), -w * 0.2 - 1.1 + i * 1.1, 0.45, hd - 1.2));
      break;
    }
    case 'dock': {
      k.room(w, d);
      k.box(w * 0.5, 0.9, 2.2, M.block, -hw + w * 0.3, 0.24, hd - 1.6);
      k.box(4.2, 2.3, 2.1, M.block, -hw - 3.2, -0.5, 1.2); k.box(1.5, 1.7, 2.1, M.material, -hw - 6.1, -0.5, 1.2);
      for (let i = 0; i < 4; i++) k.cyl(0.36, 0.3, M.ink, -hw - 6.1 + i * 1.7, -0.6, 1.2 + (i % 2 ? 1.05 : -1.05)).rotation.x = Math.PI / 2;
      for (let i = 0; i < 4; i++) k.roll(0.5, 2.4, M.raw, 0.4 + (i % 2) * 1.2, 0.24 + Math.floor(i / 2) * 0.9, -1.2, 'z');
      k.person(hw - 1.6, 1.4);
      break;
    }
    case 'rig': {
      k.room(w, d);
      for (const x of [-2.6, 2.6]) { k.box(0.3, 3.6, 0.3, M.ink, x, 0.24, -1.3); k.box(0.3, 3.6, 0.3, M.ink, x, 0.24, 1.3); k.box(0.3, 0.3, 2.9, M.ink, x, 3.6, 0); }
      k.roll(0.32, 5.6, M.block, 0, 1.2, -1.3); k.roll(0.32, 5.6, M.block, 0, 2.9, 0); k.roll(0.32, 5.6, M.block, 0, 1.2, 1.3);
      const up = k.box(4.4, 0.06, 2.4, M.raw, 0, 2.35, -0.72); up.rotation.x = -0.93;
      const dn = k.box(4.4, 0.06, 2.4, M.raw, 0, 2.35, 0.72); dn.rotation.x = 0.93;
      k.roll(0.7, 4.4, M.raw, 0, 0.3, -2.9); k.roll(0.55, 4.4, M.raw, 0, 0.3, 2.9);
      k.box(1.2, 0.5, 0.6, M.ink, 0, 4.2, 0);                       // camera head
      const beam = k.cone(1.5, 1.2, M.beam, 0, 3.05, 0); beam.userData.pulse = true;
      k.person(hw - 1.4, hd - 1.6);
      break;
    }
    case 'dark': {
      k.box(w * 0.92, 4.6, d * 0.92, M.dark);
      k.box(w * 0.96, 0.3, d * 0.96, M.dark, 0, 4.6, 0);
      k.box(1.5, 2.3, 0.14, M.ink, hw * 0.92 - 0.02, 0, 1.4).rotation.y = Math.PI / 2;
      for (let i = 0; i < 3; i++) k.roll(0.5, 2.2, M.raw, hw + 1.1, i === 2 ? 0.9 : 0, -1.6 + (i === 2 ? 0.5 : i), 'x');
      break;
    }
    case 'racks': {
      k.room(w, d);
      for (let r = 0; r < 3; r++) {
        const z = -hd + 2 + r * 3.2;
        k.box(w * 0.74, 3.4, 0.16, M.ink, 0, 0.24, z - 0.75);
        for (let lv = 0; lv < 3; lv++) {
          k.box(w * 0.74, 0.1, 1.5, M.block, 0, 0.5 + lv * 1.1, z);
          for (let i = 0; i < 5; i++) k.roll(0.42, 1.35, shade(SH[(r * 2 + lv + i) % SH.length]), -w * 0.3 + i * (w * 0.15), 0.6 + lv * 1.1, z, 'z');
        }
      }
      break;
    }
    case 'check': {
      k.room(w, d);
      k.box(w * 0.55, 1.0, 2.6, M.block, -0.6, 0.24, 0.2);
      k.box(w * 0.5, 0.08, 2.2, M.glow, -0.6, 1.25, 0.2);
      k.box(1.4, 0.06, 1.6, shade('IVORY'), -1.8, 1.34, 0.2); k.box(1.4, 0.06, 1.6, shade('CORAL'), -0.1, 1.34, 0.2);
      k.box(0.2, 2.2, 0.2, M.ink, -0.6, 0.24, -1.3); k.box(1.0, 0.4, 0.5, M.ink, -0.6, 2.4, -1.0);
      k.roll(0.5, 2.4, shade('SEAGREEN'), hw - 1.6, 0.24, -1.2, 'z'); k.roll(0.5, 2.4, shade('FUCHSIA'), hw - 1.6, 0.24, 1.3, 'z');
      k.person(1.9, 1.8);
      break;
    }
    case 'thread': {
      k.room(w, d, 3.4);
      for (let r = 0; r < 4; r++) for (let c = 0; c < 9; c++) {
        const empty = (r === 0 && c > 5) || (r === 1 && c > 7);
        if (!empty) k.cone(0.3, 0.62, shade(SH[(c + r * 2) % SH.length]), -hw + 1.2 + c * 0.95, 0.5 + r * 0.72, -hd + 0.55).rotation.x = Math.PI / 2;
      }
      k.box(w * 0.6, 0.9, 1.3, M.block, 0, 0.24, hd - 1.5);
      k.box(0.8, 0.4, 0.5, M.ink, hw - 1.2, 3.0, 0.6);
      break;
    }
    case 'cutting': {
      k.room(w, d);
      for (const [z, s] of [[-2.8, 'INDIGO'], [2.8, 'CORAL']]) {
        k.box(w * 0.68, 0.95, 3.4, M.block, 0.3, 0.24, z);
        k.box(w * 0.62, 0.16, 2.8, shade(s), 0.3, 1.19, z);
        k.box(1.5, 0.2, 0.9, M.pad, 2.1, 1.35, z + 0.4);
        k.person(-hw + 1.2, z); k.person(0.4, z + (z < 0 ? 2.2 : -2.2));
      }
      break;
    }
    case 'tools': {
      k.room(w, d, 2.6);
      k.box(w * 0.55, 0.9, 1.4, M.block, -0.8, 0.24, -hd + 1.3);
      for (let i = 0; i < 6; i++) k.box(0.14, 0.7, 0.1, M.ink, -hw + 1.4 + i * 0.8, 1.5, -hd + 0.36);
      k.form(hw - 1.3, -0.4); k.form(hw - 2.6, 1.4, M.pad); k.form(hw - 1.3, 2.2);
      k.box(1.3, 1.1, 1.0, M.ink, -hw + 1.6, 0.24, 1.6); k.box(0.5, 0.5, 0.5, M.warnMat, -hw + 1.6, 1.34, 1.6);
      break;
    }
    case 'line': {
      k.room(w, d);
      const cols = node.id === 'lineb2b' ? 7 : 5, rows = 4;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const x = -hw + 1.4 + c * ((w - 2.4) / (cols - 1)), z = -hd + 1.5 + r * ((d - 2.6) / (rows - 1));
        k.box(1.05, 0.7, 0.7, M.block, x, 0.24, z);
        const down = (node.id === 'lineb2b' && ((r === 1 && c === 3) || (r === 2 && c === 5))) || (node.id === 'lined2c' && r === 0 && c === 4);
        k.box(0.5, 0.42, 0.3, down ? M.critMat : M.ink, x + 0.15, 0.94, z);
        if (!down && (r + c) % 5 !== 4) k.person(x - 0.1, z + 0.62, M.staff);
        k.box(0.5, 0.05, 0.4, shade(SH[(c + r + (node.id === 'lined2c' ? 3 : 0)) % SH.length]), x - 0.25, 0.94, z);
      }
      break;
    }
    case 'sample': {
      k.room(w, d);
      for (let i = 0; i < 4; i++) { const x = -hw + 1.6 + i * 1.9; k.box(1.1, 0.7, 0.7, M.block, x, 0.24, -0.9); k.box(0.5, 0.42, 0.3, M.ink, x + 0.15, 0.94, -0.9); k.person(x - 0.1, -0.25, M.staff); }
      k.box(0.14, 2.3, 0.14, M.ink, hw - 4.2, 0.24, 1.9); k.box(0.14, 2.3, 0.14, M.ink, hw - 0.8, 0.24, 1.9); k.box(3.6, 0.12, 0.12, M.ink, hw - 2.5, 2.5, 1.9);
      SH.forEach((s, i) => k.box(0.42, 1.5, 0.1, shade(s), hw - 4.0 + i * 0.6, 1.0, 1.9));
      k.form(-hw + 1.6, 2.0); k.form(-hw + 3.2, 2.0, M.pad);
      break;
    }
    case 'finish': {
      k.room(w, d);
      for (let i = 0; i < 3; i++) {
        const z = -hd + 1.9 + i * 2.6;
        k.box(3.2, 0.85, 1.1, M.block, -0.4, 0.24, z);
        k.box(0.6, 0.28, 0.36, M.ink, 0.4, 1.1, z);
        k.box(1.6, 0.06, 0.9, shade(SH[i * 2]), -1.0, 1.1, z);
        k.person(-0.4, z + 0.95, M.staff);
      }
      k.box(0.14, 2.2, d * 0.7, M.ink, hw - 0.9, 0.24, 0);
      for (let i = 0; i < 6; i++) k.box(0.1, 1.5, 0.5, shade(SH[i]), hw - 1.25, 0.9, -d * 0.3 + i * (d * 0.12));
      break;
    }
    case 'qc': {
      k.room(w, d);
      k.box(w * 0.55, 0.9, 1.5, M.block, -0.4, 0.24, -1.2);
      k.box(1.8, 0.06, 1.0, shade('CORAL'), -0.4, 1.15, -1.2);
      k.box(0.2, 2.6, 0.2, M.ink, -2.6, 0.24, 1.6); k.box(0.2, 2.6, 0.2, M.ink, 0.4, 0.24, 1.6); k.box(3.2, 0.2, 0.2, M.ink, -1.1, 2.84, 1.6);
      k.form(-1.1, 1.6); k.person(1.9, -0.2); k.person(-2.6, -0.2);
      k.box(1.2, 0.9, 1.2, M.critMat, hw - 1.3, 0.24, hd - 1.4);
      break;
    }
    case 'gate': {
      k.room(w, d);
      k.box(w * 0.86, 0.5, 1.3, M.ink, 0.2, 0.24, 0.4);
      for (let i = 0; i < 4; i++) k.box(0.95, 0.7, 0.95, i === 1 ? M.goods : M.parcel, -hw + 1.8 + i * 1.75, 0.74, 0.4);
      k.box(0.3, 3.9, 0.3, M.ink, 1.1, 0.24, -0.7); k.box(0.3, 3.9, 0.3, M.ink, 1.1, 0.24, 1.5); k.box(0.34, 0.34, 2.5, M.ink, 1.1, 4.0, 0.4);
      const scan = k.box(0.06, 3.0, 1.9, M.beam, 1.1, 0.9, 0.4); scan.userData.pulse = true;
      for (let i = 0; i < 5; i++) k.box(1.0, 0.8, 1.0, M.parcel, hw - 1.3 - (i % 2) * 1.1, 0.24 + Math.floor(i / 2) * 0.8, -hd + 1.3);
      k.person(-0.8, hd - 1.2);
      break;
    }
    case 'hub': {
      k.box(w * 0.8, 3.4, d * 0.6, M.block, 0, 0, -d * 0.14);
      k.box(w * 0.84, 0.5, d * 0.64, M.goods, 0, 3.4, -d * 0.14);
      for (let i = 0; i < 3; i++) k.box(1.5, 1.9, 0.1, M.ink, -w * 0.25 + i * (w * 0.25), 0, d * 0.16 + 0.04);
      k.box(3.0, 1.7, 1.6, M.block, 0.6, 0.35, hd - 0.9); k.box(1.0, 1.3, 1.6, M.goods, 2.6, 0.35, hd - 0.9);
      for (const x of [-0.3, 2.4]) for (const z of [hd - 1.7, hd - 0.1]) k.cyl(0.33, 0.24, M.ink, x, 0.02, z).rotation.x = Math.PI / 2;
      k.box(1, 0.8, 1, M.parcel, -hw + 1.4, 0, hd - 1.2); k.box(0.9, 0.7, 0.9, M.parcel, -hw + 1.5, 0.8, hd - 1.2);
      break;
    }
    case 'shop': { // an online store: a screen you can walk up to
      k.box(w * 0.7, 0.4, d * 0.5, M.ink, 0, 0, 0.6);
      const scr = k.box(w * 0.74, 5.0, 0.36, M.ink, 0, 0.9, -1.2); scr.rotation.x = -0.16;
      const face = k.box(w * 0.68, 4.4, 0.1, M.glow, 0, 1.2, -0.96); face.rotation.x = -0.16;
      for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) { const t = k.box(1.7, 1.7, 0.08, shade(SH[r * 3 + c]), -2.1 + c * 2.1, 1.75 + r * 2.0, -0.86 - r * 0.33); t.rotation.x = -0.16; }
      for (let i = 0; i < 3; i++) k.box(1.0, 0.8, 1.0, M.parcel, -hw + 1.6 + i * 1.5, 0, hd - 1.2);
      k.person(hw - 1.6, hd - 1.3); k.person(hw - 2.9, hd - 0.9);
      break;
    }
    case 'store': {
      k.box(w * 0.8, 4.2, d * 0.62, M.block, 0, 0, -d * 0.1);
      k.box(w * 0.84, 0.36, d * 0.66, M.ink, 0, 4.2, -d * 0.1);
      const aw = k.box(w * 0.8, 0.16, 2.0, M.goods, 0, 2.9, d * 0.21 + 0.8); aw.rotation.x = 0.36;
      k.box(w * 0.5, 2.3, 0.1, M.glass, -w * 0.1, 0.3, d * 0.21 + 0.06);
      k.box(1.3, 2.5, 0.12, M.ink, w * 0.28, 0, d * 0.21 + 0.06);
      k.form(-w * 0.22, d * 0.21 + 1.3, shade('CORAL')); k.form(-w * 0.02, d * 0.21 + 1.3, shade('INDIGO'));
      k.person(w * 0.28, hd - 0.9);
      break;
    }
    case 'tower': {
      k.box(w * 0.72, 5, d * 0.66, M.block); k.box(w * 0.56, 4.6, d * 0.52, M.block, 0, 5, 0); k.box(w * 0.4, 3.6, d * 0.38, M.block, 0, 9.6, 0);
      for (let i = 0; i < 4; i++) k.box(w * 0.73, 0.16, d * 0.67, M.goods, 0, 1 + i * 1.1, 0);
      for (let i = 0; i < 3; i++) k.box(w * 0.57, 0.16, d * 0.53, M.goods, 0, 6 + i * 1.1, 0);
      k.box(0.2, 1.6, 0.2, M.ink, 0, 13.2, 0);
      for (let i = 0; i < 3; i++) k.box(1.0, 0.8, 1.0, M.parcel, hw - 1.2, i === 2 ? 0.8 : 0, hd - 1.1 - (i === 2 ? 0.5 : i * 1.1));
      break;
    }
    case 'buyers': {
      [[-2.6, 4.2, 'INDIGO'], [0, 5.0, 'CORAL'], [2.6, 3.6, 'SEAGREEN']].forEach(([x, h, s]) => {
        k.box(2.4, h, d * 0.5, M.block, x, 0, -d * 0.1); k.roof(2.4, 1.2, d * 0.5, M.goods, x, h, -d * 0.1);
        k.box(1.2, 1.3, 0.1, M.glass, x, 0.5, d * 0.15 + 0.06); k.box(0.9, 1.0, 0.08, shade(s), x, 0.65, d * 0.15 + 0.12);
      });
      k.person(-1.2, hd - 1); k.person(1.4, hd - 1.3);
      break;
    }
    case 'studio': {
      k.box(w * 0.8, 3.2, d * 0.6, M.block, 0, 0, -d * 0.12);
      k.box(w * 0.86, 0.3, d * 0.66, M.data, 0, 3.2, -d * 0.12);
      k.box(w * 0.6, 1.9, 0.1, M.glass, 0, 0.6, d * 0.18 + 0.06);
      k.box(0.12, 2.2, 0.12, M.ink, -3, 0, hd - 1); k.box(0.12, 2.2, 0.12, M.ink, 0.6, 0, hd - 1); k.box(3.7, 0.1, 0.1, M.ink, -1.2, 2.2, hd - 1);
      SH.forEach((s, i) => k.box(0.42, 1.5, 0.1, shade(s), -2.7 + i * 0.6, 0.65, hd - 1));
      k.form(2.6, hd - 1.2, shade('MARIGOLD'));
      break;
    }
    case 'control': {
      k.cyl(2.3, 9.5, M.block); k.cyl(3.4, 0.5, M.block, 0, 9.5, 0);
      k.cyl(3.1, 2.1, M.glass, 0, 10, 0); k.cyl(3.5, 0.4, M.block, 0, 12.1, 0);
      const ring = k.cyl(3.7, 0.22, M.beacon, 0, 12.5, 0); ring.userData.pulse = true;
      k.cyl(0.14, 3, M.ink, 0, 12.5, 0); k.ball(0.45, M.beacon, 0, 15.3, 0);
      for (let i = 0; i < 4; i++) k.cyl(2.34, 0.16, M.data, 0, 1.6 + i * 2, 0);
      break;
    }
    case 'ledger': {
      k.box(w * 0.86, 0.7, d * 0.72, M.block); k.box(w * 0.72, 3.6, d * 0.5, M.block, 0, 0.7, -0.4);
      for (let i = 0; i < 5; i++) k.cyl(0.36, 3.6, M.block, -w * 0.3 + i * (w * 0.15), 0.7, d * 0.24);
      k.box(w * 0.8, 0.5, d * 0.66, M.block, 0, 4.3, 0);
      k.roof(w * 0.8, 1.7, d * 0.66, M.money, 0, 4.8, 0);
      for (let i = 0; i < 3; i++) k.cyl(0.7, 0.24, M.money, hw - 1.1, i * 0.26, hd - 0.9);
      break;
    }
  }
  g.traverse((m) => { if (m.isMesh) { m.castShadow = !m.material.transparent; m.receiveShadow = true; } });
  return g;
}
