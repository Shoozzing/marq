(function (MARQ) {
  'use strict';
  // Canonical internal unit: millimetres. CSS px = 1/96 in.
  const MM_PER = { mm: 1, cm: 10, in: 25.4, px: 25.4 / 96 };
  const DECIMALS = { mm: 2, cm: 3, in: 4, px: 1 };
  function check(u) { if (!(u in MM_PER)) throw new Error('Unknown unit: ' + u); return u; }
  MARQ.Units = {
    list: ['mm', 'cm', 'in', 'px'],
    CSS_DPI: 96,
    toMM(v, u) { return v * MM_PER[check(u)]; },
    fromMM(mm, u) { return mm / MM_PER[check(u)]; },
    convert(v, from, to) { return v * MM_PER[check(from)] / MM_PER[check(to)]; },
    mmToPx(mm, dpi) { return mm / 25.4 * (dpi || 96); },
    pxToMM(px, dpi) { return px / (dpi || 96) * 25.4; },
    round(v, u) { const d = Math.pow(10, DECIMALS[check(u)]); return Math.round(v * d) / d; },
    display(mm, u) { return this.round(this.fromMM(mm, u), u); }, // number shown in an input for a stored mm value
    format(mm, u) { return this.round(this.fromMM(mm, u), u) + ' ' + u; },
    // "12.5", "12.5mm", "2 in" -> mm (NaN if invalid)
    parse(str, defaultUnit) {
      const m = /^\s*(-?\d+(?:[.,]\d+)?)\s*(mm|cm|in|px)?\s*$/i.exec(String(str));
      if (!m) return NaN;
      return this.toMM(parseFloat(m[1].replace(',', '.')), (m[2] || defaultUnit || 'mm').toLowerCase());
    }
  };
})(window.MARQ = window.MARQ || {});
