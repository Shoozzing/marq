(function (MARQ) {
  'use strict';
  // One renderer for editor AND print so output is WYSIWYG.
  //  draw(ctx, project, record, pxPerMM, opts)  - draws label at ctx origin (0,0), scaled by pxPerMM.
  // Element drawers register per type: MARQ.Renderer.registerElement('rect', (ctx, el, props, k) => {...})
  const drawers = {};
  MARQ.Renderer = {
    registerElement(type, fn) { drawers[type] = fn; },
    draw(ctx, project, record, k, opts) {
      const L = project.label;
      ctx.save();
      ctx.scale(k, k); // from here on, units are mm
      ctx.fillStyle = L.background; ctx.fillRect(0, 0, L.width, L.height);
      if (L.borderWidth > 0) { ctx.strokeStyle = L.borderColor; ctx.lineWidth = L.borderWidth; ctx.strokeRect(L.borderWidth / 2, L.borderWidth / 2, L.width - L.borderWidth, L.height - L.borderWidth); }
      ctx.beginPath(); ctx.rect(0, 0, L.width, L.height); ctx.clip();
      const o = Object.assign({ project }, opts);
      project.elements.forEach(el => {
        if (!el.visible || !drawers[el.type]) return;
        ctx.save();
        ctx.globalAlpha = el.opacity;
        ctx.translate(el.x + el.w / 2, el.y + el.h / 2); ctx.rotate(el.rotation * Math.PI / 180); ctx.translate(-el.w / 2, -el.h / 2);
        drawers[el.type](ctx, el, MARQ.Data.resolveProps(el, record), k, o);
        ctx.restore();
      });
      ctx.restore();
    }
  };
})(window.MARQ = window.MARQ || {});
