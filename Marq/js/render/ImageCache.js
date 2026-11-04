(function (MARQ) {
  'use strict';
  // Decoded <img> per asset id. Assets are immutable, so the cache never needs invalidating.
  // get() is synchronous (the renderer must be): it returns null until the image has decoded, then the editor repaints on 'images:loaded'.
  const map = new Map(); // assetId -> { img, state:'loading'|'ready'|'error', waiters:[] }
  function entry(project, id) {
    let e = map.get(id); if (e) return e;
    const a = project && project.assets && project.assets[id]; if (!a) return null;
    e = { img: new Image(), state: 'loading', waiters: [] }; map.set(id, e);
    const done = st => { e.state = st; e.waiters.splice(0).forEach(f => f()); MARQ.Bus.emit('images:loaded', { id }); };
    e.img.onload = () => done('ready'); e.img.onerror = () => done('error');
    e.img.src = a.dataUrl; return e;
  }
  MARQ.Images = {
    get(project, id) { const e = entry(project, id); return e && e.state === 'ready' ? e.img : null; },
    status(project, id) { const e = entry(project, id); return e ? e.state : 'missing'; },
    // Resolves when every image used by the project has finished decoding (print/export wait on this).
    ready(project) {
      return Promise.all(project.elements.filter(e => e.type === 'image' && e.props.assetId).map(e => {
        const en = entry(project, e.props.assetId); return !en || en.state !== 'loading' ? null : new Promise(r => en.waiters.push(r));
      }));
    },
    clear() { map.clear(); }
  };
})(window.MARQ = window.MARQ || {});
