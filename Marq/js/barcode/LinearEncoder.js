(function (MARQ) {
  'use strict';
  // Dependency-free linear barcode encoders (replaces the JsBarcode vendor file that was never shipped).
  // encode(format, value) -> { widths:[bar,space,bar,...] in modules (starts with a bar), text, quiet:{l,r} (modules) }
  const C128 = '212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112'.split(' ').map(s => s.split('').map(Number));
  const C39 = {'0':'111331311','1':'311311113','2':'113311113','3':'313311111','4':'111331113','5':'311331111','6':'113331111','7':'111311313','8':'311311311','9':'113311311','A':'311113113','B':'113113113','C':'313113111','D':'111133113','E':'311133111','F':'113133111','G':'111113313','H':'311113311','I':'113113311','J':'111133311','K':'311111133','L':'113111133','M':'313111131','N':'111131133','O':'311131131','P':'113131131','Q':'111111333','R':'311111331','S':'113111331','T':'111131331','U':'331111113','V':'133111113','W':'333111111','X':'131131113','Y':'331131111','Z':'133131111','-':'131111313','.':'331111311',' ':'133111311','$':'131313111','/':'131311131','+':'131113131','%':'111313131','*':'131131311'};
  const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
  const R = L.map(s => s.replace(/[01]/g, d => d === '0' ? '1' : '0'));
  const G = R.map(s => s.split('').reverse().join(''));
  const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
  const ITF = ['11331', '31113', '13113', '33111', '11313', '31311', '13311', '11133', '31131', '13131'];

  function bitsToWidths(bits) { // '1' = bar, '0' = space; must start with a bar
    const out = []; let cur = '1', n = 0;
    for (const b of bits) { if (b === cur) n++; else { out.push(n); cur = b; n = 1; } }
    out.push(n); return out;
  }
  const digitsOnly = (v, len, name) => { const d = String(v).replace(/[^0-9]/g, ''); if (d.length !== len) throw new Error(name + ' requires exactly ' + len + ' digits.'); return d; };
  function eanCheck(body) { let s = 0, w = 3; for (let i = body.length - 1; i >= 0; i--) { s += +body[i] * w; w = w === 3 ? 1 : 3; } return (10 - s % 10) % 10; }

  function code128(value) {
    const v = String(value), codes = []; let mode = null, i = 0;
    for (const ch of v) if (ch < ' ' || ch > '~') throw new Error('Code 128 accepts printable ASCII characters only.');
    while (i < v.length) {
      let n = 0; while (i + n < v.length && v[i + n] >= '0' && v[i + n] <= '9') n++;
      if (n >= 4) {
        if (n % 2) { if (mode !== 'B') { codes.push(mode ? 100 : 104); mode = 'B'; } codes.push(v.charCodeAt(i) - 32); i++; n--; }
        codes.push(mode ? 99 : 105); mode = 'C';
        for (let k = 0; k < n; k += 2) codes.push(+v.substr(i + k, 2));
        i += n;
      } else {
        if (mode !== 'B') { codes.push(mode ? 100 : 104); mode = 'B'; }
        codes.push(v.charCodeAt(i) - 32); i++;
      }
    }
    let sum = codes[0]; for (let k = 1; k < codes.length; k++) sum += codes[k] * k;
    codes.push(sum % 103, 106);
    const widths = []; codes.forEach(cd => widths.push.apply(widths, C128[cd]));
    return { widths, text: v, quiet: { l: 10, r: 10 } };
  }
  function code39(value) {
    const v = String(value).toUpperCase(), widths = [];
    const seq = '*' + v + '*';
    for (let k = 0; k < seq.length; k++) {
      const p = C39[seq[k]]; if (!p || (seq[k] === '*' && k > 0 && k < seq.length - 1)) throw new Error('Code 39 does not support the character "' + seq[k] + '".');
      for (const d of p) widths.push(+d);
      if (k < seq.length - 1) widths.push(1); // inter-character gap
    }
    return { widths, text: v, quiet: { l: 10, r: 10 } };
  }
  function ean13(value) {
    const d = digitsOnly(value, 13, 'EAN-13'); if (eanCheck(d.slice(0, 12)) !== +d[12]) throw new Error('EAN13 checksum is invalid.');
    const par = PARITY[+d[0]]; let bits = '101';
    for (let k = 0; k < 6; k++) bits += (par[k] === 'L' ? L : G)[+d[k + 1]];
    bits += '01010'; for (let k = 7; k < 13; k++) bits += R[+d[k]];
    return { widths: bitsToWidths(bits + '101'), text: d, quiet: { l: 11, r: 7 } };
  }
  function ean8(value) {
    const d = digitsOnly(value, 8, 'EAN-8'); if (eanCheck(d.slice(0, 7)) !== +d[7]) throw new Error('EAN8 checksum is invalid.');
    let bits = '101'; for (let k = 0; k < 4; k++) bits += L[+d[k]];
    bits += '01010'; for (let k = 4; k < 8; k++) bits += R[+d[k]];
    return { widths: bitsToWidths(bits + '101'), text: d, quiet: { l: 7, r: 7 } };
  }
  function itf14(value) {
    const d = digitsOnly(value, 14, 'ITF-14'), widths = [1, 1, 1, 1];
    for (let k = 0; k < 14; k += 2) for (let j = 0; j < 5; j++) widths.push(+ITF[+d[k]][j], +ITF[+d[k + 1]][j]);
    widths.push(3, 1, 1); // stop: wide bar, narrow space, narrow bar
    return { widths, text: d, quiet: { l: 10, r: 10 } };
  }
  const FORMATS = { CODE128: code128, CODE39: code39, EAN13: ean13, EAN8: ean8, ITF14: itf14 };
  MARQ.LinearEncoder = {
    formats: Object.keys(FORMATS),
    encode(format, value) { if (!FORMATS[format]) throw new Error('Unsupported barcode format: ' + format); return FORMATS[format](value); }
  };
})(window.MARQ = window.MARQ || {});
