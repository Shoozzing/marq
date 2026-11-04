(function (MARQ) {
  'use strict';
  let cv, ctx, wrap, W = 0, H = 0, raf = 0, dims = null, gesture = null, guides = [], clipboard = [];
  const V = () => MARQ.Store.state.app.view;
  const PX = () => MARQ.Viewport.PX_PER_MM;
  const S = () => MARQ.Store.state;
  const round = v => Math.round(v * 1e4) / 1e4;
  const get = id => S().project.elements.find(e => e.id === id) || null;

  function resize() {
    const r = wrap.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    W = r.width; H = r.height; cv.width = Math.round(W * d); cv.height = Math.round(H * d);
    cv.style.width = W + 'px'; cv.style.height = H + 'px'; ctx.setTransform(d, 0, 0, d, 0, 0);
    if (V().fitted) fit(); else render();
  }
  function fit() {
    if (!W || !H) return;
    const L = S().project.label; dims = { w: L.width, h: L.height };
    MARQ.Store.commit('view', s => { s.app.view = Object.assign(MARQ.Viewport.fit(L.width, L.height, W, H), { fitted: true }); }, 'app');
  }
  function zoomTo(z) { MARQ.Store.commit('zoom', s => { s.app.view = MARQ.Viewport.zoomAt(s.app.view, z, W / 2, H / 2); }, 'app'); }
  function zoomBy(f) { zoomTo(V().zoom * f); }
  function schedule() { cancelAnimationFrame(raf); raf = requestAnimationFrame(render); }
  function onLabelChange() {
    const L = S().project.label;
    if (!dims) { dims = { w: L.width, h: L.height }; return; }
    if (dims.w === L.width && dims.h === L.height) return;
    const old = dims; dims = { w: L.width, h: L.height };
    if (V().fitted) fit();
    else MARQ.Store.commit('view', s => {
      const k = PX() * s.app.view.zoom; s.app.view.panX += (old.w - L.width) / 2 * k; s.app.view.panY += (old.h - L.height) / 2 * k;
    }, 'app');
  }
  function render() {
    if (!ctx) return;
    const st = S(), v = V(), L = st.project.label, k = PX() * v.zoom, o = MARQ.Viewport.snap(v);
    ctx.clearRect(0, 0, W, H); ctx.fillStyle = '#d9dce1'; ctx.fillRect(0, 0, W, H);
    ctx.save(); ctx.translate(o.x, o.y);
    const pw = L.width * k, ph = L.height * k;
    ctx.shadowColor = 'rgba(0,0,0,.3)'; ctx.shadowBlur = 12; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, pw, ph); ctx.shadowColor = 'transparent';
    MARQ.Renderer.draw(ctx, st.project, currentRecord(), k, { editor: true });
    if (st.app.grid.show) drawGrid(L, k, st.app.grid.size);
    drawMargins(L, k); drawSelection(k); drawGuides(k, L);
    ctx.strokeStyle = '#4a6cf7'; ctx.lineWidth = 1; ctx.strokeRect(-.5, -.5, pw + 1, ph + 1); ctx.restore();
  }
  function currentRecord() {
    try { return MARQ.Data.previewRecord(); } catch (e) { return null; } // never let a bad dataset break the editor
  }
  function gridColor(bg) {
    const n = parseInt(String(bg).slice(1), 16), r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255;
    return (0.299 * r + 0.587 * g + 0.114 * b) < 128 ? 'rgba(255,255,255,.28)' : 'rgba(74,108,247,.28)';
  }
  function drawGrid(L, k, sizeMM) {
    let step = sizeMM * k; if (!(step > 0)) return;
    const mult = step >= 8 ? 1 : [2, 5, 10, 20, 50, 100, 200, 500, 1000].find(m => step * m >= 8) || 1000; step *= mult;
    ctx.strokeStyle = gridColor(L.background); ctx.lineWidth = 1; ctx.beginPath();
    for (let x = step; x < L.width * k; x += step) { ctx.moveTo(Math.round(x) + .5, 0); ctx.lineTo(Math.round(x) + .5, L.height * k); }
    for (let y = step; y < L.height * k; y += step) { ctx.moveTo(0, Math.round(y) + .5); ctx.lineTo(L.width * k, Math.round(y) + .5); }
    ctx.stroke();
  }
  function drawMargins(L, k) {
    const m = L.margin; if (!(m.top > 0 || m.right > 0 || m.bottom > 0 || m.left > 0)) return;
    ctx.save(); ctx.strokeStyle = '#e0457b'; ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
    ctx.strokeRect(m.left * k, m.top * k, (L.width - m.left - m.right) * k, (L.height - m.top - m.bottom) * k); ctx.restore();
  }
  function selectionBox(ids) {
    const els = S().project.elements.filter(e => ids.includes(e.id) && e.visible);
    if (!els.length) return null;
    const points = els.flatMap(e => MARQ.ElementSpec.corners(e));
    return { x: Math.min(...points.map(p => p.x)), y: Math.min(...points.map(p => p.y)), r: Math.max(...points.map(p => p.x)), b: Math.max(...points.map(p => p.y)), els };
  }
  function handle(x, y, radius, fill) {
    ctx.beginPath(); ctx.arc(x, y, radius || 4, 0, Math.PI * 2); ctx.fillStyle = fill || '#fff'; ctx.fill();
    ctx.strokeStyle = '#4a6cf7'; ctx.lineWidth = 1.5; ctx.stroke();
  }
  function rotationPoint(e, k) {
    const c = MARQ.ElementSpec.corners(e), top = { x: (c[0].x + c[1].x) / 2, y: (c[0].y + c[1].y) / 2 };
    const cx = e.x + e.w / 2, cy = e.y + e.h / 2, dx = top.x - cx, dy = top.y - cy, len = Math.hypot(dx, dy) || 1;
    return { x: top.x + dx / len * 12 / k, y: top.y + dy / len * 12 / k, top };
  }
  function drawSelection(k) {
    const ids = S().app.selection || [], box = selectionBox(ids); if (!box) return;
    box.els.forEach(e => {
      const c = MARQ.ElementSpec.corners(e); ctx.save(); ctx.lineJoin = 'round'; ctx.strokeStyle = '#4a6cf7'; ctx.lineWidth = 1.5;
      ctx.setLineDash(e.type === 'line' ? [4, 3] : []); ctx.beginPath(); c.forEach((p, i) => i ? ctx.lineTo(p.x * k, p.y * k) : ctx.moveTo(p.x * k, p.y * k)); ctx.closePath(); ctx.stroke(); ctx.restore();
    });
    if (ids.length !== 1 || box.els.length !== 1 || box.els[0].locked) return;
    const e = box.els[0], corners = MARQ.ElementSpec.corners(e), mids = [
      { x: (corners[0].x + corners[1].x) / 2, y: (corners[0].y + corners[1].y) / 2 },
      { x: (corners[1].x + corners[2].x) / 2, y: (corners[1].y + corners[2].y) / 2 },
      { x: (corners[2].x + corners[3].x) / 2, y: (corners[2].y + corners[3].y) / 2 },
      { x: (corners[3].x + corners[0].x) / 2, y: (corners[3].y + corners[0].y) / 2 }
    ];
    if (e.type !== 'line') { corners.forEach(p => handle(p.x * k, p.y * k)); mids.forEach(p => handle(p.x * k, p.y * k)); }
    const rp = rotationPoint(e, k); ctx.save(); ctx.strokeStyle = '#4a6cf7'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(rp.top.x * k, rp.top.y * k); ctx.lineTo(rp.x * k, rp.y * k); ctx.stroke(); ctx.restore(); handle(rp.x * k, rp.y * k, 4, '#c8ff3d');
  }
  function drawGuides(k, L) {
    if (!guides.length) return; ctx.save(); ctx.strokeStyle = '#e0457b'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
    guides.forEach(g => { ctx.beginPath(); if (g.axis === 'x') { ctx.moveTo(g.value * k, 0); ctx.lineTo(g.value * k, L.height * k); } else { ctx.moveTo(0, g.value * k); ctx.lineTo(L.width * k, g.value * k); } ctx.stroke(); }); ctx.restore();
  }
  function point(e) { const r = cv.getBoundingClientRect(); return MARQ.Viewport.screenToMm(V(), e.clientX - r.left, e.clientY - r.top); }
  function localPoint(e) { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
  function setSelection(ids) {
    const next = [...new Set(ids)].filter(id => get(id)), current = S().app.selection || [];
    if (next.length === current.length && next.every((id, i) => id === current[i])) return;
    MARQ.Store.commit('select', s => { s.app.selection = next; }, 'app');
  }
  function toggleSelection(id) { const a = S().app.selection || []; setSelection(a.includes(id) ? a.filter(x => x !== id) : a.concat(id)); }
  function selectedHandle(p, e) {
    const k = PX() * V().zoom, near = q => Math.hypot((p.x - q.x) * k, (p.y - q.y) * k) <= 8;
    const c = MARQ.ElementSpec.corners(e), mids = [
      { x: (c[0].x + c[1].x) / 2, y: (c[0].y + c[1].y) / 2 }, { x: (c[1].x + c[2].x) / 2, y: (c[1].y + c[2].y) / 2 },
      { x: (c[2].x + c[3].x) / 2, y: (c[2].y + c[3].y) / 2 }, { x: (c[3].x + c[0].x) / 2, y: (c[3].y + c[0].y) / 2 }
    ];
    if (near(rotationPoint(e, k))) return 'rotate';
    if (e.type === 'line') return null;
    for (let i = 0; i < c.length; i++) if (near(c[i])) return ['nw', 'ne', 'se', 'sw'][i];
    for (let i = 0; i < mids.length; i++) if (near(mids[i])) return ['n', 'e', 's', 'w'][i];
    return null;
  }
  function snapDelta(dx, dy, ids, alt) {
    guides = []; const st = S(), grid = st.app.grid, box = selectionBox(ids);
    if (!box || alt || grid.snap === false) return { dx, dy };
    const k = PX() * V().zoom, tolerance = 7 / k;
    const targets = st.project.elements.filter(e => !ids.includes(e.id) && e.visible).flatMap(e => MARQ.ElementSpec.corners(e));
    const snapAxis = (axis, delta, min, max, center, list) => {
      const values = [min + delta, center + delta, max + delta]; let best = null;
      values.forEach(v => list.forEach(t => { const diff = t - v; if (Math.abs(diff) <= tolerance && (!best || Math.abs(diff) < Math.abs(best.diff))) best = { diff, value: t }; }));
      if (best) { guides.push({ axis, value: best.value }); return delta + best.diff; }
      const size = grid.size || 5, snapped = Math.round((center + delta) / size) * size, diff = snapped - (center + delta);
      return Math.abs(diff) <= tolerance ? delta + diff : delta;
    };
    const xs = targets.map(p => p.x).concat(st.project.label.width / 2), ys = targets.map(p => p.y).concat(st.project.label.height / 2);
    return { dx: snapAxis('x', dx, box.x, box.r, (box.x + box.r) / 2, xs), dy: snapAxis('y', dy, box.y, box.b, (box.y + box.b) / 2, ys) };
  }
  function begin(e) {
    if (e.button !== 0) return;
    const p = point(e), ids = S().app.selection || [], selected = ids.length === 1 ? get(ids[0]) : null;
    if (selected && !selected.locked) {
      const mode = selectedHandle(p, selected);
      if (mode) {
        gesture = { mode, id: selected.id, start: p, original: structuredClone(selected), startAngle: Math.atan2(p.y - (selected.y + selected.h / 2), p.x - (selected.x + selected.w / 2)) * 180 / Math.PI };
        cv.setPointerCapture(e.pointerId); e.preventDefault(); return;
      }
    }
    const hit = MARQ.Elements.hitTest(p.x, p.y, 5 / (PX() * V().zoom));
    if (hit && (e.shiftKey || e.ctrlKey || e.metaKey)) {
      toggleSelection(hit); if (!(S().app.selection || []).includes(hit)) return;
    } else if (hit && !ids.includes(hit)) setSelection([hit]);
    if (hit) {
      const current = S().app.selection || [], movable = current.map(get).filter(x => x && !x.locked);
      if (!movable.length) return;
      gesture = { mode: 'move', ids: movable.map(x => x.id), start: p, originals: Object.fromEntries(movable.map(x => [x.id, { x: x.x, y: x.y }])) };
      cv.setPointerCapture(e.pointerId); e.preventDefault();
    } else if (!e.shiftKey && !e.ctrlKey && !e.metaKey) setSelection([]);
  }
  function commitPatches(patches, label, key) {
    const items = Object.entries(patches).map(([id, patch]) => ({ el: get(id), patch })).filter(x => x.el && !x.el.locked);
    if (!items.length) return;
    MARQ.Store.commit(label, s => {
      items.forEach(({ el, patch }) => {
        const target = s.project.elements.find(x => x.id === el.id); if (!target) return;
        Object.assign(target, patch); if ('w' in patch) MARQ.Elements.refit(target);
      });
    }, 'project', key);
  }
  function resizePatch(g, p) {
    const o = g.original, q = MARQ.ElementSpec.toLocal(o, p.x, p.y); let l = 0, t = 0, r = o.w, b = o.h, h = g.mode;
    if (h.includes('w')) l = Math.min(q.x, r - .1); if (h.includes('e')) r = Math.max(q.x, l + .1);
    if (h.includes('n')) t = Math.min(q.y, b - .1); if (h.includes('s')) b = Math.max(q.y, t + .1);
    if (h === 'n') { t = Math.min(q.y, o.h - .1); b = o.h; } if (h === 's') { t = 0; b = Math.max(q.y, .1); }
    if (h === 'w') { l = Math.min(q.x, o.w - .1); r = o.w; } if (h === 'e') { l = 0; r = Math.max(q.x, .1); }
    let w = r - l, height = o.type === 'line' ? 0 : b - t;
    if (o.props.lockAspect && o.type !== 'line' && o.h > 0 && height > 0) { const ratio = o.w / o.h; if (w / height > ratio) w = height * ratio; else height = w / ratio; }
    const lx = (l + r) / 2 - o.w / 2, ly = (t + b) / 2 - o.h / 2, a = o.rotation * Math.PI / 180;
    const cx = o.x + o.w / 2 + lx * Math.cos(a) - ly * Math.sin(a), cy = o.y + o.h / 2 + lx * Math.sin(a) + ly * Math.cos(a);
    const patch = { x: cx - w / 2, y: cy - height / 2, w }; if (o.type !== 'line' && !(o.type === 'text' && o.props.autoHeight)) patch.h = height;
    return patch;
  }
  function move(e) {
    const p = point(e);
    if (gesture) {
      const g = gesture;
      if (g.mode === 'move') {
        const d = snapDelta(p.x - g.start.x, p.y - g.start.y, g.ids, e.altKey), patches = {};
        g.ids.forEach(id => { const o = g.originals[id]; patches[id] = { x: round(o.x + d.dx), y: round(o.y + d.dy) }; }); commitPatches(patches, 'move elements', 'editor:drag');
      } else if (g.mode === 'rotate') {
        const o = g.original, angle = Math.atan2(p.y - (o.y + o.h / 2), p.x - (o.x + o.w / 2)) * 180 / Math.PI;
        let rotation = o.rotation + angle - g.startAngle; if (e.shiftKey) rotation = Math.round(rotation / 15) * 15;
        commitPatches({ [g.id]: { rotation: MARQ.ElementSpec.normalizeRotation(rotation) } }, 'rotate', 'editor:rotate');
      } else commitPatches({ [g.id]: resizePatch(g, p) }, 'resize', 'editor:resize');
      schedule(); return;
    }
    MARQ.Bus.emit('cursor:moved', p);
  }
  function end(e) {
    if (!gesture) return; gesture = null; guides = [];
    if (cv.hasPointerCapture(e.pointerId)) cv.releasePointerCapture(e.pointerId); schedule();
  }
  function removeSelection() {
    const ids = new Set(S().app.selection || []), removable = S().project.elements.filter(e => ids.has(e.id) && !e.locked).map(e => e.id);
    if (!removable.length) return;
    MARQ.Store.commit('delete elements', s => { s.project.elements = s.project.elements.filter(e => !removable.includes(e.id)); });
    setSelection((S().app.selection || []).filter(id => !removable.includes(id)));
  }
  function copySelection() { clipboard = S().project.elements.filter(e => (S().app.selection || []).includes(e.id)).map(e => structuredClone(e)); }
  function pasteSelection() {
    if (!clipboard.length) return;
    const copies = clipboard.map(e => { const c = structuredClone(e); c.id = MARQ.Model.uid('el'); c.name = e.name + ' copy'; c.locked = false; c.x = round(c.x + 2); c.y = round(c.y + 2); return c; });
    MARQ.Store.commit('paste elements', s => { s.project.elements.push(...copies); }); setSelection(copies.map(e => e.id));
  }
  function duplicateSelection() { copySelection(); pasteSelection(); }
  function reorder(where) {
    const ids = new Set(S().app.selection || []), a = S().project.elements, selected = a.filter(e => ids.has(e.id)); if (!selected.length) return;
    const rest = a.filter(e => !ids.has(e.id)); let next;
    if (where === 'front') next = rest.concat(selected);
    else if (where === 'back') next = selected.concat(rest);
    else {
      const indices = a.map((e, i) => ids.has(e.id) ? i : -1).filter(i => i >= 0), idx = where === 'forward' ? Math.min(rest.length, Math.max(...indices) + 1) : Math.max(0, Math.min(...indices) - 1);
      next = rest.slice(); next.splice(idx, 0, ...selected);
    }
    if (next.every((e, i) => e === a[i])) return;
    MARQ.Store.commit('reorder elements', s => { s.project.elements = next; });
  }
  function shortcuts(e) {
    const t = document.activeElement, typing = t && (/INPUT|SELECT|TEXTAREA/.test(t.tagName) || t.isContentEditable);
    if (typing || document.getElementById('modal').open) return;
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase(), ids = S().app.selection || [];
    if (mod && k === 'a') { e.preventDefault(); setSelection(S().project.elements.filter(x => x.visible).map(x => x.id)); }
    else if (mod && k === 'c') { e.preventDefault(); copySelection(); }
    else if (mod && k === 'v') { e.preventDefault(); pasteSelection(); }
    else if (mod && k === 'd') { e.preventDefault(); duplicateSelection(); }
    else if (mod && e.key === ']') { e.preventDefault(); reorder(e.shiftKey ? 'front' : 'forward'); }
    else if (mod && e.key === '[') { e.preventDefault(); reorder(e.shiftKey ? 'back' : 'backward'); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && ids.length) { e.preventDefault(); removeSelection(); }
    else if (e.key === 'Escape' && ids.length) setSelection([]);
    else if (ids.length && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault(); const step = e.shiftKey ? 1 : .2, dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0, dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0, patches = {};
      ids.forEach(id => { const el = get(id); if (el && !el.locked) patches[id] = { x: el.x + dx, y: el.y + dy }; }); commitPatches(patches, 'nudge elements', 'editor:nudge');
    }
  }
  function init() {
    cv = document.getElementById('editor-canvas'); wrap = document.getElementById('canvas-wrap'); ctx = cv.getContext('2d'); cv.style.touchAction = 'none';
    new ResizeObserver(resize).observe(wrap);
    cv.addEventListener('wheel', e => {
      e.preventDefault(); const r = cv.getBoundingClientRect();
      MARQ.Store.commit('view', s => {
        if (e.ctrlKey || e.metaKey) s.app.view = MARQ.Viewport.zoomAt(s.app.view, s.app.view.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1), e.clientX - r.left, e.clientY - r.top);
        else { s.app.view.panX -= e.deltaX; s.app.view.panY -= e.deltaY; s.app.view.fitted = false; }
      }, 'app');
    }, { passive: false });
    cv.addEventListener('pointerdown', begin); cv.addEventListener('pointermove', move); cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
    cv.addEventListener('mouseleave', () => { if (!gesture) MARQ.Bus.emit('cursor:moved', null); });
    document.addEventListener('keydown', shortcuts);
    MARQ.Bus.on('state:changed', schedule); MARQ.Bus.on('state:replaced', schedule); MARQ.Bus.on('images:loaded', schedule); MARQ.Bus.on('project:changed', onLabelChange);
    resize(); fit();
  }
  MARQ.CanvasView = { init, render, fit, zoomBy, zoomTo, size: () => ({ w: W, h: H }), copy: copySelection, paste: pasteSelection, duplicate: duplicateSelection, removeSelection, reorder };
})(window.MARQ = window.MARQ || {});
