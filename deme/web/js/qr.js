// QR codes as SVG, for slips. The code holds a link to the slip, so any phone camera opens it,
// and the scan screens read the same code. Drawn as one path, crisp at any print size.
import qrcode from '../vendor/qrcode.js';

/** The link a slip's QR code carries. */
export const slipLink = (no) => `${location.origin}${location.pathname}#slip-${no}`;

/** `text` as an SVG string. `size` is the width in px on screen; the quiet zone is included. */
export function qrSvg(text, { size = 120, level = 'M', label = 'QR code' } = {}) {
  const qr = qrcode(0, level); qr.addData(String(text)); qr.make();
  const n = qr.getModuleCount(), quiet = 4, w = n + quiet * 2;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
  return `<svg class="qr" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${w}" width="${size}" height="${size}" role="img" aria-label="${label}" shape-rendering="crispEdges"><rect width="${w}" height="${w}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
