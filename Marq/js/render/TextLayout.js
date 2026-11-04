(function (MARQ) {
  'use strict';
  // Text layout shared by the drawer (editor + print) and by Elements (auto height), so what is measured is what is drawn.
  // Glyphs are measured at a large reference size and scaled, so results do not depend on tiny-font hinting or on zoom.
  // All outputs are millimetres. Font size is stored in pt (1 pt = 25.4/72 mm).
  const REF = 100, PT = 25.4 / 72;
  const sizeMM = p => p.fontSize * PT;
  const fontAt = (p, px) => (p.italic ? 'italic ' : '') + (p.bold ? 'bold ' : '') + px + 'px ' + MARQ.ElementSpec.fontStack(p.fontFamily || 'Arial');

  // measurer(font, str) -> { width, ascent, descent } in px at that font. Default uses a shared canvas; tests inject their own.
  let measurer = null, mctx = null;
  function domMeasurer(font, str) {
    if (!mctx) mctx = document.createElement('canvas').getContext('2d');
    mctx.font = font; const m = mctx.measureText(str);
    return { width: m.width, ascent: m.fontBoundingBoxAscent || REF * 0.8, descent: m.fontBoundingBoxDescent || REF * 0.2 };
  }
  const measure = (font, str) => (measurer || domMeasurer)(font, str);
  const cache = new Map(); // font|char -> width (px @ REF)
  function charW(font, ch) {
    const k = font + '|' + ch; let w = cache.get(k);
    if (w === undefined) { w = measure(font, ch).width; if (cache.size > 5000) cache.clear(); cache.set(k, w); }
    return w;
  }

  // width of one string in mm, including letter spacing between glyphs
  function widthOf(str, p, font) {
    if (!str) return 0;
    const f = sizeMM(p) / REF, ls = p.letterSpacing * PT;
    if (!ls) return measure(font, str).width * f;
    let w = 0, n = 0; for (const ch of str) { w += charW(font, ch) * f; n++; }
    return w + ls * (n - 1);
  }
  // Greedy word wrap into maxW mm; explicit newlines kept; words longer than a line are split by character.
  function wrap(text, maxW, p, font) {
    const out = [], fits = str => widthOf(str, p, font) <= maxW, trimEnd = str => str.replace(/\s+$/, '');
    String(text).replace(/\r\n?/g, '\n').split('\n').forEach(par => {
      let line = '';
      par.split(/(\s+)/).forEach(tok => {
        if (tok === '') return;
        if (/^\s+$/.test(tok)) { line += tok; return; }
        if (fits(line + tok)) { line += tok; return; }
        if (trimEnd(line) !== '') { out.push(trimEnd(line)); line = ''; }
        if (fits(tok)) { line = tok; return; }
        let piece = ''; // single over-long word: break by character
        for (const ch of tok) { if (piece !== '' && !fits(piece + ch)) { out.push(piece); piece = ch; } else piece += ch; }
        line = piece;
      });
      out.push(trimEnd(line));
    });
    return out;
  }

  // -> { lines:[{text,width}], lineH, fontMM, ascent, descent, contentH, font(ref px) }
  function layout(p, boxW) {
    const font = fontAt(p, REF), f = sizeMM(p) / REF, fm = measure(font, 'Hg');
    const ascent = fm.ascent * f, descent = fm.descent * f, lineH = sizeMM(p) * p.lineHeight;
    const maxW = Math.max(0.01, boxW - 2 * (p.padding || 0));
    const lines = wrap(p.text == null ? '' : p.text, maxW, p, font).map(t => ({ text: t, width: widthOf(t, p, font) }));
    return { lines, lineH, fontMM: sizeMM(p), ascent, descent, contentH: lines.length * lineH, font, scale: f };
  }
  // height of the box that exactly fits the text (never below 1 line)
  function fitHeight(p, boxW) { const L = layout(p, boxW); return Math.max(0.1, L.contentH + 2 * (p.padding || 0)); }

  // Draw into ctx whose origin is the box top-left and whose unit is mm.
  function draw(ctx, p, w, h) {
    if (p.background) { ctx.fillStyle = p.background; ctx.fillRect(0, 0, w, h); }
    const L = layout(p, w), pad = p.padding || 0, inner = h - 2 * pad;
    let y = pad + (p.valign === 'middle' ? (inner - L.contentH) / 2 : p.valign === 'bottom' ? inner - L.contentH : 0);
    const ls = p.letterSpacing * PT;
    ctx.save(); ctx.fillStyle = p.color; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    ctx.scale(L.scale, L.scale); ctx.font = L.font; // draw at the reference size, scaled: no tiny-font rounding at any zoom
    const inv = 1 / L.scale;
    L.lines.forEach(line => {
      const base = (y + (L.lineH - (L.ascent + L.descent)) / 2 + L.ascent) * inv;
      let x = pad;
      if (p.align === 'center') x = (w - line.width) / 2; else if (p.align === 'right') x = w - pad - line.width;
      if (line.text) {
        if (!ls) ctx.fillText(line.text, x * inv, base);
        else { let cx = x * inv; for (const ch of line.text) { ctx.fillText(ch, cx, base); cx += charW(L.font, ch) + ls * inv; } }
      }
      y += L.lineH;
    });
    ctx.restore();
  }

  MARQ.TextLayout = { PT, layout, fitHeight, draw, widthOf, wrap, setMeasurer(fn) { measurer = fn; cache.clear(); } };
})(window.MARQ = window.MARQ || {});
