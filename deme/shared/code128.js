// Code 128 (set B) barcode, as bar widths and as an SVG string. Deme's own tags (fabric rolls,
// bundles, store pieces, materials) are printed with this; any handheld scanner reads it.
// Courier labels carry the courier's own barcode and are only read, never printed here.

const PATTERNS = ['212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313', '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111', '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412', '211214', '211232', '2331112'];
const START_B = 104, STOP = 106;

/** Module widths (bar, space, bar, …) for `text`. Characters outside printable ASCII are dropped. */
export function code128(text) {
  const chars = [...String(text)].filter((c) => c >= ' ' && c <= '~');
  const codes = [START_B, ...chars.map((c) => c.charCodeAt(0) - 32)];
  const check = codes.reduce((s, c, i) => s + c * (i === 0 ? 1 : i), 0) % 103;
  return [...codes, check, STOP].map((c) => PATTERNS[c]).join('').split('').map(Number);
}

/** An SVG barcode. `height` and the module width are in px; a quiet zone of 10 modules sits on each side. */
export function barcodeSvg(text, { height = 44, module = 1.6 } = {}) {
  const widths = code128(text);
  const quiet = 10 * module;
  let x = quiet, bars = '';
  widths.forEach((w, i) => { if (i % 2 === 0) bars += `<rect x="${x.toFixed(2)}" y="0" width="${(w * module).toFixed(2)}" height="${height}" fill="#000"/>`; x += w * module; });
  const total = x + quiet;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total.toFixed(2)} ${height}" width="${total.toFixed(0)}" height="${height}" role="img" aria-label="Barcode ${String(text).replace(/[<>&"]/g, '')}"><rect width="100%" height="100%" fill="#fff"/>${bars}</svg>`;
}
