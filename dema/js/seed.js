// Example data for the demo. None of these figures are Dema's actuals: they are sized to
// behave like a resort-wear unit running close to full, so the map, the planner and the ERP
// have something realistic to work on until real feeds are connected.
// Dates are stored as working-day offsets from "today" so the demo never goes stale.

import { rng, addWorkdays, today, iso } from './util.js';

export const SEED_VERSION = 4;

export const FABRICS = {
  VOILE: { name: 'Cotton voile', cost: 210, dye: 45 },
  CREPE: { name: 'Viscose crepe', cost: 260, dye: 48 },
  LINEN: { name: 'Linen blend', cost: 420, dye: 55 },
  SILKCOT: { name: 'Silk-cotton', cost: 540, dye: 62 },
};
export const SHADES = {
  INDIGO: { name: 'Indigo', hex: '#2E3F9E', code: 'TH-4410' },
  CORAL: { name: 'Coral', hex: '#F0664F', code: 'TH-2207' },
  IVORY: { name: 'Ivory', hex: '#EFE6D2', code: 'TH-0102' },
  MARIGOLD: { name: 'Marigold', hex: '#E9A21B', code: 'TH-3318' },
  SEAGREEN: { name: 'Sea green', hex: '#2E9E8A', code: 'TH-5521' },
  FUCHSIA: { name: 'Fuchsia', hex: '#C9358A', code: 'TH-6604' },
};

export function seed() {
  const r = rng(20261110);
  const t0 = today();
  const day = (n) => iso(addWorkdays(t0, n));
  const ago = (n) => { const d = new Date(t0); d.setDate(d.getDate() - n); return iso(d); };
  const pick = (arr) => arr[Math.floor(r() * arr.length)];

  // smv = standard minutes per piece at each stage. cones = thread cones per 100 pieces.
  const styles = [
    { id: 'ISLA', name: 'Isla maxi dress', fabric: 'VOILE', shade: 'INDIGO', metres: 3.2, smv: { cut: 6, stitch: 58, finish: 9, qc: 5, pack: 4 }, cones: 9, retail: 14500, wholesale: 6200, bestseller: true },
    { id: 'CORA', name: 'Cora kaftan', fabric: 'CREPE', shade: 'CORAL', metres: 2.8, smv: { cut: 5, stitch: 42, finish: 8, qc: 5, pack: 4 }, cones: 7, retail: 11800, wholesale: 5100, bestseller: true },
    { id: 'PALM', name: 'Palmera co-ord set', fabric: 'LINEN', shade: 'IVORY', metres: 3.6, smv: { cut: 8, stitch: 74, finish: 11, qc: 6, pack: 5 }, cones: 11, retail: 16900, wholesale: 7400, bestseller: false },
    { id: 'SOLS', name: 'Sol shirt dress', fabric: 'VOILE', shade: 'MARIGOLD', metres: 2.6, smv: { cut: 6, stitch: 52, finish: 9, qc: 5, pack: 4 }, cones: 8, retail: 12400, wholesale: 5400, bestseller: true },
    { id: 'MARE', name: 'Marea wrap skirt', fabric: 'CREPE', shade: 'SEAGREEN', metres: 1.9, smv: { cut: 4, stitch: 28, finish: 6, qc: 4, pack: 3 }, cones: 5, retail: 7900, wholesale: 3400, bestseller: false },
    { id: 'LAGO', name: 'Lagoon slip dress', fabric: 'SILKCOT', shade: 'FUCHSIA', metres: 2.4, smv: { cut: 5, stitch: 46, finish: 8, qc: 5, pack: 4 }, cones: 7, retail: 15200, wholesale: 6600, bestseller: false },
  ];

  // ops = people, mins = shift minutes, eff = share of the shift that becomes standard minutes.
  const workCentres = [
    { id: 'cut', name: 'Cutting', node: 'cutting', stage: 'cut', ops: 6, mins: 480, eff: 0.8, role: 'masters and under-masters' },
    { id: 'stitch_b2b', name: 'B2B line', node: 'lineb2b', stage: 'stitch', ops: 34, mins: 480, eff: 0.7, role: 'tailors' },
    { id: 'stitch_d2c', name: 'D2C line', node: 'lined2c', stage: 'stitch', ops: 18, mins: 480, eff: 0.7, role: 'tailors' },
    { id: 'stitch_sample', name: 'Sampling room', node: 'sampling', stage: 'stitch', ops: 4, mins: 480, eff: 0.6, role: 'sample tailors' },
    { id: 'finish', name: 'Finishing', node: 'finishing', stage: 'finish', ops: 8, mins: 480, eff: 0.8, role: 'pressers and trimmers' },
    { id: 'qc', name: 'Final QC', node: 'finalqc', stage: 'qc', ops: 5, mins: 480, eff: 0.85, role: 'checkers' },
    { id: 'pack', name: 'Packing', node: 'dispatch', stage: 'pack', ops: 4, mins: 480, eff: 0.85, role: 'packers' },
  ];

  // done = pieces completed at each stage so far. due = working days from today.
  const o = (id, channel, customer, style, qty, due, done = [0, 0, 0, 0, 0], extra = {}) => ({
    id, channel, customer, style, qty, due: day(due),
    done: { cut: done[0], stitch: done[1], finish: done[2], qc: done[3], pack: done[4] }, ...extra,
  });
  const orders = [
    o('RV-4471', 'B2B', 'Revolve', 'ISLA', 1400, 8, [1400, 560, 430, 400, 380]),
    o('RV-4472', 'B2B', 'Revolve', 'CORA', 900, 12, [600, 0, 0, 0, 0]),
    o('UK-2210', 'B2B', 'UK buyers', 'PALM', 520, 15, [0, 0, 0, 0, 0]),
    o('GL-0931', 'B2B', 'Global wholesale', 'MARE', 600, 17),
    o('RV-4480', 'B2B', 'Revolve', 'LAGO', 800, 21),
    o('UK-2214', 'B2B', 'UK buyers', 'SOLS', 480, 24),
    o('GL-0934', 'B2B', 'Global wholesale', 'ISLA', 260, 27),
    o('SH-W46A', 'D2C', 'Shopify', 'ISLA', 420, 5, [420, 190, 150, 140, 120]),
    o('SH-W46B', 'D2C', 'Shopify', 'CORA', 380, 7, [380, 0, 0, 0, 0]),
    o('BOM-118', 'STORE', 'Bombay store', 'PALM', 36, 7),
    o('SH-W47A', 'D2C', 'Shopify', 'SOLS', 400, 12),
    o('SH-W47B', 'D2C', 'Shopify', 'LAGO', 360, 15),
    o('BOM-121', 'STORE', 'Bombay store', 'LAGO', 24, 13),
    o('SH-W48A', 'D2C', 'Shopify', 'ISLA', 450, 19),
    o('SH-W48B', 'D2C', 'Shopify', 'MARE', 420, 22),
    o('SH-W49A', 'D2C', 'Shopify', 'PALM', 180, 25),
    o('SMP-031', 'SAMPLE', 'Merchandising', 'CORA', 18, 6, [18, 6, 4, 4, 4], { note: 'Resort prototypes' }),
  ];

  // Fabric rolls. status: unaudited | passed | rejected | at_dyer | dyed | dye_reject | issued
  const rolls = [];
  let rollNo = 2380;
  const mills = ['Shree Laxmi Textiles', 'Kaveri Weaves', 'Northgate Mills'];
  const addRoll = (status, fabric, extra = {}) => {
    const metres = Math.round(70 + r() * 60);
    rolls.push({
      id: `R-${rollNo++}`, fabric, supplier: pick(mills), metres, status,
      received: ago(extra.age ?? Math.floor(2 + r() * 20)), points: null, shade: null, lot: null, reservedFor: null, ...extra,
    });
  };
  const fabs = Object.keys(FABRICS);
  for (let i = 0; i < 22; i++) addRoll('unaudited', pick(fabs), { age: Math.floor(40 + r() * 260), location: 'Dark room' });
  for (let i = 0; i < 5; i++) addRoll('passed', pick(fabs), { points: Math.round(6 + r() * 14), location: 'QC bay' });
  addRoll('rejected', 'VOILE', { points: 46, defects: 'Weft lines every 2–3 m', location: 'Returns bay' });
  addRoll('rejected', 'CREPE', { points: 52, defects: 'Oil stains, 9 places', location: 'Returns bay' });
  const dyedPlan = [
    ['VOILE', 'INDIGO', 7, 'RV-4471'], ['VOILE', 'INDIGO', 4, 'SH-W46A'], ['CREPE', 'CORAL', 6, 'RV-4472'], ['CREPE', 'CORAL', 3, 'SH-W46B'],
    ['LINEN', 'IVORY', 6, 'UK-2210'], ['VOILE', 'MARIGOLD', 3, 'SH-W47A'], ['CREPE', 'SEAGREEN', 3, null], ['VOILE', 'INDIGO', 2, null],
    ['SILKCOT', 'FUCHSIA', 2, null], ['CREPE', 'CORAL', 2, null],
  ];
  for (const [fabric, shade, n, res] of dyedPlan) for (let i = 0; i < n; i++) addRoll('dyed', fabric, { shade, points: Math.round(5 + r() * 12), reservedFor: res, location: `Rack ${pick(['A', 'B', 'C', 'D'])}${1 + Math.floor(r() * 6)}` });
  const atDyer = [['SILKCOT', 'FUCHSIA', 9, 'DL-0612'], ['CREPE', 'SEAGREEN', 5, 'DL-0613'], ['VOILE', 'MARIGOLD', 6, 'DL-0614']];
  for (const [fabric, shade, n, lot] of atDyer) for (let i = 0; i < n; i++) addRoll('at_dyer', fabric, { shade, lot, points: Math.round(5 + r() * 12), location: 'Dye house' });
  addRoll('dye_reject', 'LINEN', { shade: 'IVORY', lot: 'DL-0607', defects: 'Slub lines visible after dyeing', location: 'Write-off bay', age: 24 });
  addRoll('dye_reject', 'LINEN', { shade: 'IVORY', lot: 'DL-0607', defects: 'Slub lines visible after dyeing', location: 'Write-off bay', age: 24 });
  addRoll('dye_reject', 'VOILE', { shade: 'INDIGO', lot: 'DL-0604', defects: 'Stain shadows under dye', location: 'Write-off bay', age: 38 });

  const dyeLots = [
    { id: 'DL-0612', fabric: 'SILKCOT', shade: 'FUCHSIA', sent: ago(4), due: day(3), status: 'at_dyer', forOrders: ['RV-4480', 'SH-W47B', 'BOM-121'] },
    { id: 'DL-0613', fabric: 'CREPE', shade: 'SEAGREEN', sent: ago(3), due: day(4), status: 'at_dyer', forOrders: ['GL-0931', 'SH-W48B'] },
    { id: 'DL-0614', fabric: 'VOILE', shade: 'MARIGOLD', sent: ago(1), due: day(6), status: 'at_dyer', forOrders: ['UK-2214'] },
    { id: 'DL-0607', fabric: 'LINEN', shade: 'IVORY', sent: ago(30), due: ago(24), status: 'returned', note: '2 rolls failed after dyeing' },
  ];

  const threads = [
    { shade: 'INDIGO', cones: 212, min: 60 }, { shade: 'CORAL', cones: 96, min: 60 }, { shade: 'IVORY', cones: 74, min: 60 },
    { shade: 'MARIGOLD', cones: 41, min: 60 }, { shade: 'SEAGREEN', cones: 18, min: 60 }, { shade: 'FUCHSIA', cones: 6, min: 60 },
  ];
  const tools = [
    { id: 'needle11', name: 'Machine needles DB×1 #11', unit: 'boxes', onHand: 4, min: 10, where: 'Tool crib' },
    { id: 'needle14', name: 'Machine needles DB×1 #14', unit: 'boxes', onHand: 13, min: 8, where: 'Tool crib' },
    { id: 'shears', name: 'Tailor shears, sharp', unit: 'pairs', onHand: 38, min: 56, where: 'Stations', note: '18 pairs due for sharpening' },
    { id: 'forms', name: 'Dress forms in place', unit: 'forms', onHand: 9, min: 12, where: 'Lines and sampling', note: '3 not at their station' },
    { id: 'bobbins', name: 'Bobbins', unit: 'pcs', onHand: 410, min: 200, where: 'Tool crib' },
    { id: 'labels', name: 'Woven main labels', unit: 'pcs', onHand: 5200, min: 3000, where: 'Trim store' },
    { id: 'bins', name: 'Scrap bins at stations', unit: 'bins', onHand: 56, min: 56, where: 'Stations' },
  ];
  const machines = { total: 58, down: 3, downList: ['B2B-11 (motor)', 'B2B-27 (timing)', 'D2C-05 (thread cutter)'] };
  const people = { absentToday: 4 };

  // Bundle scans: actual stitch minutes per piece, by tailor station. The gap to standard is the insight.
  const punches = [];
  const drift = { ISLA: 1.12, CORA: 0.97, PALM: 1.21, SOLS: 1.04, MARE: 0.93, LAGO: 1.09 };
  for (const s of styles) {
    for (let i = 0; i < 14; i++) {
      const line = i % 3 === 0 ? 'D2C' : 'B2B';
      const station = `${line}-${String(1 + Math.floor(r() * (line === 'B2B' ? 34 : 18))).padStart(2, '0')}`;
      const pieces = 10 + Math.floor(r() * 10);
      const perPiece = s.smv.stitch * drift[s.id] * (0.85 + r() * 0.35);
      punches.push({ id: `P-${punches.length + 1}`, style: s.id, station, pieces, minutes: Math.round(perPiece * pieces), date: ago(Math.floor(r() * 12)) });
    }
  }

  // Parcels through the scan gate. Each event is one scan or one carrier update.
  const ev = (daysAgo, hour, type, text) => { const d = new Date(t0); d.setDate(d.getDate() - daysAgo); d.setHours(hour, Math.floor(r() * 60)); return { at: d.toISOString(), type, text }; };
  const parcels = [
    { id: 'PCL-9001', kind: 'shopify', ref: 'Shopify #58214', style: 'ISLA', barcode: 'JD014600009812345671', status: 'in_transit', dest: 'Dubai, UAE', events: [ev(2, 16, 'out', 'Scanned out at dispatch gate'), ev(2, 21, 'carrier', 'Picked up, Mumbai'), ev(1, 9, 'carrier', 'Departed Mumbai hub'), ev(0, 6, 'carrier', 'Arrived Dubai, clearance in progress')] },
    { id: 'PCL-9002', kind: 'shopify', ref: 'Shopify #58219', style: 'CORA', barcode: 'JD014600009812345688', status: 'delivered', dest: 'London, UK', events: [ev(6, 15, 'out', 'Scanned out at dispatch gate'), ev(6, 20, 'carrier', 'Picked up, Mumbai'), ev(4, 11, 'carrier', 'Arrived London Heathrow'), ev(3, 13, 'carrier', 'Delivered, signed')] },
    { id: 'PCL-9003', kind: 'shopify', ref: 'Shopify #58231', style: 'SOLS', barcode: 'JD014600009812345695', status: 'returned', dest: 'Sydney, Australia', events: [ev(14, 15, 'out', 'Scanned out at dispatch gate'), ev(10, 10, 'carrier', 'Delivered'), ev(3, 12, 'carrier', 'Return in transit'), ev(0, 10, 'in', 'Scanned in at gate: customer return, size exchange')] },
    { id: 'PCL-9004', kind: 'shopify', ref: 'Shopify #58240', style: 'ISLA', barcode: 'JD014600009812345701', status: 'packed', dest: 'New York, USA', events: [ev(0, 11, 'pack', 'Packed, label printed. Waiting for gate scan')] },
    { id: 'PCL-9005', kind: 'store', ref: 'BOM-109 · customer fit', style: 'PALM', barcode: 'DEMA-ST-000412', status: 'at_factory', dest: 'Bombay store', visits: 3, events: [ev(19, 12, 'out', 'Scanned out to Bombay store (new order)'), ev(12, 11, 'in', 'Scanned in: fit visit 1, take in waist 2 cm'), ev(11, 17, 'out', 'Scanned out to store. In factory 1 d 6 h, work 48 min'), ev(6, 12, 'in', 'Scanned in: fit visit 2, shorten strap'), ev(5, 16, 'out', 'Scanned out to store. In factory 1 d 4 h, work 35 min'), ev(0, 10, 'in', 'Scanned in: fit visit 3, hem length')] },
    { id: 'PCL-9006', kind: 'store', ref: 'BOM-114 · customer fit', style: 'LAGO', barcode: 'DEMA-ST-000419', status: 'at_store', dest: 'Bombay store', visits: 1, events: [ev(9, 12, 'out', 'Scanned out to Bombay store (new order)'), ev(4, 11, 'in', 'Scanned in: fit visit 1, bust dart'), ev(3, 15, 'out', 'Scanned out to store. In factory 1 d 4 h, work 55 min')] },
    { id: 'PCL-9007', kind: 'b2b', ref: 'RV-4465 · 14 cartons', style: 'CORA', barcode: 'JD014600009812300012', status: 'in_transit', dest: 'Revolve, Cerritos, USA', events: [ev(3, 17, 'out', '14 cartons scanned out, 700 pcs'), ev(3, 22, 'carrier', 'Picked up, Mumbai'), ev(1, 8, 'carrier', 'Departed Leipzig hub')] },
  ];

  // Vouchers, in Tally's own vocabulary. synced = already pushed to Tally.
  const v = (id, daysAgo, type, party, amount, dr, cr, narration, ref, synced = true) => ({ id, date: ago(daysAgo), type, party, amount, dr, cr, narration, ref, synced });
  const ledger = [
    v('PUR-0412', 21, 'Purchase', 'Kaveri Weaves', 386400, 'Fabric Purchases', 'Kaveri Weaves', 'GRN 0412: 14 rolls linen blend, 920 m', 'GRN-0412'),
    v('PUR-0418', 12, 'Purchase', 'Shree Laxmi Textiles', 248600, 'Fabric Purchases', 'Shree Laxmi Textiles', 'GRN 0418: 12 rolls cotton voile, 1,184 m', 'GRN-0418'),
    v('DN-0031', 11, 'Debit Note', 'Shree Laxmi Textiles', 21630, 'Shree Laxmi Textiles', 'Purchase Returns', 'Roll failed inspection before dyeing: weft lines, 46 points per 100 sq yd', 'R-2407'),
    v('DN-0032', 9, 'Debit Note', 'Northgate Mills', 24960, 'Northgate Mills', 'Purchase Returns', 'Roll failed inspection before dyeing: oil stains, 52 points', 'R-2408'),
    v('JW-0607', 24, 'Purchase', 'Rangrez Dye Works', 31900, 'Dyeing Charges', 'Rangrez Dye Works', 'Dye lot DL-0607: linen ivory, 580 m accepted', 'DL-0607'),
    v('JV-0019', 24, 'Journal', 'Fabric loss', 98280, 'Fabric Loss: Post-Dye Defects', 'Stock: Dyed Fabric', 'Two linen rolls failed after dyeing. Mill refused the return', 'DL-0607'),
    v('JV-0017', 38, 'Journal', 'Fabric loss', 27540, 'Fabric Loss: Post-Dye Defects', 'Stock: Dyed Fabric', 'Voile roll: stain shadows under dye. Not returnable', 'DL-0604'),
    v('SAL-1180', 3, 'Sales', 'Revolve', 3570000, 'Revolve', 'Export Sales', 'RV-4465: 700 pcs Cora kaftan, invoice in USD', 'PCL-9007'),
    v('RCT-0877', 5, 'Receipt', 'Revolve', 5240000, 'HDFC Bank', 'Revolve', 'Payment against RV-4459', 'RV-4459'),
    v('SAL-1181', 2, 'Sales', 'Shopify', 14500, 'Shopify Clearing', 'Online Sales', 'Shopify #58214: Isla maxi dress', 'PCL-9001', false),
    v('PAY-0611', 4, 'Payment', 'Kaveri Weaves', 386400, 'Kaveri Weaves', 'HDFC Bank', 'Against PUR-0412', 'PUR-0412'),
    v('PAY-0614', 1, 'Payment', 'DHL Express', 68400, 'Freight Outward', 'HDFC Bank', 'Export freight, week 45', 'DHL-W45', false),
  ];

  return {
    v: SEED_VERSION,
    styles, workCentres, orders, rolls, dyeLots, threads, tools, machines, people, punches, parcels, ledger,
    scenario: null,
    counters: { grn: 419, dn: 33, jv: 20, pcl: 9008, punch: punches.length + 1, sal: 1182, jw: 615 },
  };
}
