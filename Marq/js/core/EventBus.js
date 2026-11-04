(function (MARQ) {
  'use strict';
  const map = new Map();
  MARQ.Bus = {
    on(evt, fn) { if (!map.has(evt)) map.set(evt, new Set()); map.get(evt).add(fn); return () => this.off(evt, fn); },
    off(evt, fn) { const s = map.get(evt); if (s) s.delete(fn); },
    emit(evt, payload) {
      const s = map.get(evt); if (!s) return;
      s.forEach(fn => { try { fn(payload); } catch (e) { console.error('[MARQ.Bus]', evt, e); } });
    }
  };
})(window.MARQ = window.MARQ || {});
