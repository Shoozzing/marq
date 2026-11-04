(function (MARQ) {
  'use strict';
  // Per-type drawers. Contract (see LabelRenderer): ctx origin = element box top-left, unit = mm, rotation already applied.
  //   drawer(ctx, el, props, k, opts)   k = px per mm (only for hairline decisions), opts.project for assets.
  const R = MARQ.Renderer;

  // Path inset by half the stroke so the element box is the OUTER edge of the shape (same convention as the label border).
  function inset(el, sw) { const i = Math.min(sw / 2, el.w / 2, el.h / 2); return { x: i, y: i, w: el.w - 2 * i, h: el.h - 2 * i }; }
  function paint(ctx, p, sw) {
    if (p.fill) { ctx.fillStyle = p.fill; ctx.fill(); }
    if (p.stroke && sw > 0) { ctx.strokeStyle = p.stroke; ctx.lineWidth = sw; ctx.stroke(); }
  }
  function roundRectPath(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r); ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r); ctx.closePath();
  }

  R.registerElement('text', (ctx, el, p) => MARQ.TextLayout.draw(ctx, p, el.w, el.h));

  R.registerElement('rect', (ctx, el, p) => {
    const sw = p.stroke ? p.strokeWidth : 0, b = inset(el, sw);
    // radius is the OUTER corner radius, so the inset path gets r - sw/2
    roundRectPath(ctx, b.x, b.y, b.w, b.h, Math.max(0, p.radius - sw / 2)); paint(ctx, p, sw);
  });

  R.registerElement('ellipse', (ctx, el, p) => {
    const sw = p.stroke ? p.strokeWidth : 0, b = inset(el, sw);
    ctx.beginPath(); ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, Math.max(0.0001, b.w / 2), Math.max(0.0001, b.h / 2), 0, 0, Math.PI * 2); paint(ctx, p, sw);
  });

  R.registerElement('line', (ctx, el, p) => {
    const sw = p.strokeWidth;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(el.w, 0);
    ctx.strokeStyle = p.stroke; ctx.lineWidth = sw; ctx.lineCap = p.cap;
    // dashes are in mm; with round caps the cap adds sw/2 at each dash end, so the visible dash is trimmed to keep the pattern honest
    const grow = p.cap === 'round' ? sw : 0;
    if (p.dash === 'dashed') ctx.setLineDash([Math.max(0.001, p.dashLength - grow), p.dashGap + grow]);
    else if (p.dash === 'dotted') ctx.setLineDash([0.001, sw * 2]), ctx.lineCap = 'round';
    ctx.stroke();
  });

  R.registerElement('image', (ctx, el, p, k, opts) => {
    const img = p.assetId && MARQ.Images.get(opts.project, p.assetId);
    if (!img) { // still decoding, or the asset is missing: a neutral placeholder so the box is visible and never throws
      if (p.assetId && MARQ.Images.status(opts.project, p.assetId) === 'loading') return;
      ctx.fillStyle = '#e6e8ec'; ctx.fillRect(0, 0, el.w, el.h);
      ctx.strokeStyle = '#9aa0aa'; ctx.lineWidth = Math.max(0.15, 1 / k); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(el.w, el.h); ctx.moveTo(el.w, 0); ctx.lineTo(0, el.h); ctx.stroke();
      return;
    }
    const iw = img.naturalWidth || p.naturalW || 1, ih = img.naturalHeight || p.naturalH || 1;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    if (p.fit === 'fill') { ctx.drawImage(img, 0, 0, el.w, el.h); return; }
    const s = p.fit === 'cover' ? Math.max(el.w / iw, el.h / ih) : Math.min(el.w / iw, el.h / ih), dw = iw * s, dh = ih * s;
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, el.w, el.h); ctx.clip(); // cover crops to the box
    ctx.drawImage(img, (el.w - dw) / 2, (el.h - dh) / 2, dw, dh); ctx.restore();
  });
})(window.MARQ = window.MARQ || {});
