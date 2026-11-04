(function (MARQ) {
  'use strict';
  // Barcode + QR element drawers. Vector output in mm (ctx origin = element box top-left), shared by editor and print.
  //  barcode: quiet zone is reserved inside the box; module width = props.moduleWidth, shrunk to fit and centred.
  const R = MARQ.Renderer, PT = 25.4 / 72;

  function errorBox(ctx, el, p, msg, k) {
    ctx.fillStyle = '#fff4f4'; ctx.fillRect(0, 0, el.w, el.h);
    ctx.strokeStyle = '#d33'; ctx.lineWidth = Math.max(0.15, 1 / k); ctx.setLineDash([1, 0.8]); ctx.strokeRect(0.1, 0.1, el.w - 0.2, el.h - 0.2); ctx.setLineDash([]);
    const fs = Math.max(1.2, Math.min(2.6, el.h / 5, el.w / 12)); ctx.fillStyle = '#b00'; ctx.font = 'bold ' + fs + 'px Arial, sans-serif'; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    const words = ('Cannot encode: ' + msg).split(' '); let line = '', y = 0.8;
    words.forEach(w => { const t = line ? line + ' ' + w : w; if (ctx.measureText(t).width > el.w - 1.6 && line) { ctx.fillText(line, 0.8, y); y += fs * 1.25; line = w; } else line = t; });
    if (y < el.h) ctx.fillText(line, 0.8, y);
  }

  R.registerElement('barcode', (ctx, el, p, k) => {
    const enc = p._bindingIssue ? { error: p._bindingIssue } : MARQ.Barcodes.encode(p.format, p.value);
    if (enc.error) return errorBox(ctx, el, p, enc.error, k);
    const mods = enc.widths.reduce((a, b) => a + b, 0), m = Math.max(0, p.margin || 0);
    ctx.fillStyle = p.background || '#ffffff'; ctx.fillRect(0, 0, el.w, el.h);
    const fs = (p.textSize || 10) * PT, textH = p.showText ? fs * 1.15 + 0.4 : 0;
    const availW = el.w - 2 * m, barH = el.h - 2 * m - textH;
    if (availW <= 0 || barH <= 0.2) return;
    const unit = Math.min(p.moduleWidth || 0.35, availW / (mods + enc.quiet.l + enc.quiet.r));
    const x0 = m + (availW - (mods + enc.quiet.l + enc.quiet.r) * unit) / 2 + enc.quiet.l * unit;
    ctx.fillStyle = p.color || '#000000';
    let x = x0; enc.widths.forEach((w, i) => { if (i % 2 === 0) ctx.fillRect(x, m, w * unit + 0.002, barH); x += w * unit; });
    if (p.showText) {
      ctx.font = fs + 'px "Courier New", monospace'; ctx.textBaseline = 'top'; ctx.textAlign = 'center';
      let text = enc.text; const maxW = availW; while (text.length > 1 && ctx.measureText(text).width > maxW) text = text.slice(0, -1);
      ctx.fillText(text, m + availW / 2, m + barH + 0.4);
    }
  });

  R.registerElement('qr', (ctx, el, p, k) => {
    const q = MARQ.Barcodes.matrix('QR', p.value, { ecLevel: p.ecLevel });
    if (q.error) return errorBox(ctx, el, p, q.error, k);
    ctx.fillStyle = p.background || '#ffffff'; ctx.fillRect(0, 0, el.w, el.h);
    const m = Math.max(0, p.margin || 0), side = Math.min(el.w, el.h) - 2 * m;
    if (side <= 0) return;
    const u = side / q.size, ox = (el.w - side) / 2, oy = (el.h - side) / 2;
    ctx.fillStyle = p.color || '#000000';
    for (let r = 0; r < q.size; r++) for (let c = 0; c < q.size; c++) {
      if (!q.isDark(r, c)) continue;
      let n = 1; while (c + n < q.size && q.isDark(r, c + n)) n++; // merge horizontal runs: no hairline seams
      ctx.fillRect(ox + c * u, oy + r * u, n * u + 0.002, u + 0.002); c += n - 1;
    }
  });
})(window.MARQ = window.MARQ || {});
