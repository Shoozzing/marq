(function (MARQ) {
  'use strict';
  // Element operations: the only code that mutates project.elements. Every function validates through ElementSpec, then writes inside
  // Store.commit (so it is undoable + autosaved). Setters return null on success or an ElementSpec error object (nothing is changed).
  const S = () => MARQ.Store.state, SP = () => MARQ.ElementSpec;
  const round = v => Math.round(v * 1e4) / 1e4;
  const find = id => S().project.elements.find(e => e.id === id) || null;
  const locked = el => ({ error: { label: '"' + el.name + '"', locked: true } });

  // What the "add" buttons create. type + defaults override; sizes in mm.
  const KINDS = {
    heading: { type: 'text', name: 'Heading', w: 70, props: { text: 'Heading', fontSize: 18, bold: true } },
    text:    { type: 'text', name: 'Text', w: 50, props: { text: 'Text', fontSize: 10 } },
    rect:    { type: 'rect', name: 'Rectangle', w: 30, h: 15 },
    rrect:   { type: 'rect', name: 'Rounded rectangle', w: 30, h: 15, props: { radius: 3 } },
    circle:  { type: 'ellipse', name: 'Circle', w: 15, h: 15, props: { lockAspect: true } },
    ellipse: { type: 'ellipse', name: 'Ellipse', w: 30, h: 15 },
    line:    { type: 'line', name: 'Line', w: 40, h: 0 },
    dashed:  { type: 'line', name: 'Dashed line', w: 40, h: 0, props: { dash: 'dashed' } },
    code128: { type: 'barcode', name: 'Code 128', w: 48, h: 18, props: { format: 'CODE128', value: 'ASSET-000123' } },
    code39:  { type: 'barcode', name: 'Code 39', w: 55, h: 18, props: { format: 'CODE39', value: 'ASSET123' } },
    ean13:   { type: 'barcode', name: 'EAN-13', w: 40, h: 20, props: { format: 'EAN13', value: '5901234123457' } },
    ean8:    { type: 'barcode', name: 'EAN-8', w: 32, h: 18, props: { format: 'EAN8', value: '96385074' } },
    itf14:   { type: 'barcode', name: 'ITF-14', w: 60, h: 18, props: { format: 'ITF14', value: '15400141288763' } },
    qr:      { type: 'qr', name: 'QR code', w: 22, h: 22, props: { value: 'https://example.com' } }
  };

  function nextName(base) {
    const used = new Set(S().project.elements.map(e => e.name)); let n = 1;
    while (used.has(base + ' ' + n)) n++; return base + ' ' + n;
  }
  function refit(el) { // text with "auto height" always has the height of its content
    if (el.type === 'text' && el.props.autoHeight) { // dynamic text is sized from its template, so the box does not change from record to record
      const t = el.bindings && el.bindings.text;
      el.h = round(MARQ.TextLayout.fitHeight(typeof t === 'string' ? Object.assign({}, el.props, { text: t }) : el.props, el.w));
    }
  }
  // Centre on the label; step diagonally if another element already sits exactly there.
  function place(el) {
    const L = S().project.label; let x = (L.width - el.w) / 2, y = (L.height - el.h) / 2, i = 0;
    const taken = (a, b) => S().project.elements.some(e => Math.abs(e.x - a) < 0.01 && Math.abs(e.y - b) < 0.01);
    while (taken(x, y) && i++ < 30) { x += 2; y += 2; }
    el.x = round(x); el.y = round(y);
  }
  function insert(el) {
    MARQ.Store.commit('add ' + el.name, s => { s.project.elements.push(el); });
    select(el.id); return el.id;
  }

  function add(kind) {
    const k = KINDS[kind]; if (!k) throw new Error('Unknown element kind: ' + kind);
    const L = S().project.label, over = { name: nextName(k.name), props: Object.assign({}, k.props) };
    // never larger than 90% of the label; keep proportions when both sides shrink
    let w = k.w, h = k.h == null ? MARQ.Model.TYPE_DEFAULTS[k.type].h : k.h;
    const f = Math.min(1, L.width * 0.9 / w, h > 0 ? L.height * 0.9 / h : 1); w *= f; h *= f;
    over.w = round(w); over.h = round(h);
    const el = MARQ.Model.createElement(k.type, over); refit(el); place(el);
    return insert(el);
  }

  /* ---------- images ---------- */
  const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'image/bmp'];
  const MAX_FILE = 15 * 1024 * 1024, MAX_SIDE = 2400, KEEP_BELOW = 1.5 * 1024 * 1024;
  // file -> { dataUrl, mime, w, h }. Large rasters are downscaled so the project stays small enough to autosave.
  function readImage(file) {
    return new Promise((resolve, reject) => {
      if (!file) return reject(new Error('No file chosen'));
      if (!IMAGE_TYPES.includes(file.type)) return reject(new Error('Unsupported file type. Use PNG, JPG, GIF, WebP, BMP or SVG.'));
      if (file.size > MAX_FILE) return reject(new Error('Image is larger than 15 MB.'));
      const fr = new FileReader();
      fr.onerror = () => reject(new Error('Could not read the file.'));
      fr.onload = () => {
        const url = fr.result, img = new Image();
        img.onerror = () => reject(new Error('This image could not be decoded.'));
        img.onload = () => {
          const iw = img.naturalWidth, ih = img.naturalHeight;
          if (!iw || !ih) return reject(new Error('Image has no size (an SVG needs a width/height or viewBox).'));
          if (file.type === 'image/svg+xml' || (Math.max(iw, ih) <= MAX_SIDE && file.size <= KEEP_BELOW)) return resolve({ dataUrl: url, mime: file.type, w: iw, h: ih });
          const s = Math.min(1, MAX_SIDE / Math.max(iw, ih)), cw = Math.max(1, Math.round(iw * s)), ch = Math.max(1, Math.round(ih * s));
          const c = document.createElement('canvas'); c.width = cw; c.height = ch;
          const cx = c.getContext('2d'), png = file.type !== 'image/jpeg';
          if (!png) { cx.fillStyle = '#fff'; cx.fillRect(0, 0, cw, ch); }
          cx.drawImage(img, 0, 0, cw, ch);
          const out = png ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.92);
          resolve(out.length < url.length || s < 1 ? { dataUrl: out, mime: png ? 'image/png' : 'image/jpeg', w: cw, h: ch } : { dataUrl: url, mime: file.type, w: iw, h: ih });
        };
        img.src = url;
      };
      fr.readAsDataURL(file);
    });
  }
  function assetFor(project, info, name) { // reuse an identical asset instead of storing the same bytes twice
    for (const id in project.assets) if (project.assets[id].dataUrl === info.dataUrl) return id;
    const id = MARQ.Model.uid('img'); project.assets[id] = { name, mime: info.mime, dataUrl: info.dataUrl, w: info.w, h: info.h }; return id;
  }
  function addImage(file) {
    return readImage(file).then(info => {
      const L = S().project.label, mm = 25.4 / 96, f = Math.min(1, L.width * 0.8 / (info.w * mm), L.height * 0.8 / (info.h * mm));
      const base = file.name.replace(/\.[^.]+$/, '') || 'Image';
      const el = MARQ.Model.createElement('image', { name: nextName(base), w: round(Math.max(0.5, info.w * mm * f)), h: round(Math.max(0.5, info.h * mm * f)), props: { naturalW: info.w, naturalH: info.h } });
      place(el);
      MARQ.Store.commit('add image', s => { el.props.assetId = assetFor(s.project, info, file.name); s.project.elements.push(el); });
      select(el.id); return el.id;
    });
  }
  function replaceImage(id, file) {
    return readImage(file).then(info => {
      const el = find(id); if (!el || el.type !== 'image') throw new Error('Select an image first.');
      if (el.locked) throw new Error('"' + el.name + '" is locked. Unlock it to edit.');
      MARQ.Store.commit('replace image', s => {
        const e = s.project.elements.find(x => x.id === id);
        e.props.assetId = assetFor(s.project, info, file.name); e.props.naturalW = info.w; e.props.naturalH = info.h;
        if (e.props.lockAspect) e.h = round(Math.min(5000, Math.max(0.1, e.w * info.h / info.w)));
      });
      return id;
    });
  }

  /* ---------- editing ---------- */
  function edit(id, label, mergeKey, fn) { // validates nothing itself: fn(el) runs inside the commit
    MARQ.Store.commit(label, s => { fn(s.project.elements.find(e => e.id === id)); }, 'project', mergeKey);
  }
  // patch: any of { x, y, w, h } in mm. With lockAspect, changing only w or only h moves the other so the ratio holds.
  function setGeometry(id, patch) {
    const el = find(id); if (!el) return { error: { label: 'Element', invalid: true } };
    if (el.locked) return locked(el);
    const out = {};
    for (const k of Object.keys(patch)) {
      if (k === 'h' && (el.type === 'line' || (el.type === 'text' && el.props.autoHeight))) continue; // height is derived
      const r = SP().validateGeometry(k, patch[k], el.type); if (r.error) return r; out[k] = r.value;
    }
    if (el.props.lockAspect && el.type !== 'line' && el.h > 0 && el.w > 0) {
      const ratio = el.w / el.h;
      if ('w' in out && !('h' in out)) { const r = SP().validateGeometry('h', out.w / ratio); if (r.error) return r; out.h = r.value; }
      else if ('h' in out && !('w' in out)) { const r = SP().validateGeometry('w', out.h * ratio); if (r.error) return r; out.w = r.value; }
    }
    if (!Object.keys(out).length || Object.keys(out).every(k => out[k] === el[k])) return null;
    edit(id, 'move/resize', 'geo:' + id + ':' + Object.keys(out).join(), e => { Object.assign(e, out); if ('w' in out) refit(e); });
    return null;
  }
  function setRotation(id, deg) {
    const el = find(id); if (!el) return { error: { label: 'Element', invalid: true } }; if (el.locked) return locked(el);
    const r = SP().validateRotation(deg); if (r.error) return r;
    if (r.value === el.rotation) return null;
    edit(id, 'rotate', 'rot:' + id, e => { e.rotation = r.value; }); return null;
  }
  function setOpacity(id, pct) {
    const el = find(id); if (!el) return { error: { label: 'Element', invalid: true } }; if (el.locked) return locked(el);
    const r = SP().validateOpacity(pct); if (r.error) return r;
    if (r.value === el.opacity) return null;
    edit(id, 'opacity', 'op:' + id, e => { e.opacity = r.value; }); return null;
  }
  const REFIT_KEYS = ['text', 'fontFamily', 'fontSize', 'bold', 'italic', 'letterSpacing', 'lineHeight', 'padding', 'autoHeight'];
  function setProp(id, key, value) {
    const el = find(id); if (!el) return { error: { label: 'Element', invalid: true } }; if (el.locked) return locked(el);
    if (key === 'assetId') return { error: { label: 'Image', invalid: true } }; // images change only through replaceImage
    const r = SP().validateProp(el.type, key, value, el); if (r.error) return r;
    if (el.props[key] === r.value) return null;
    edit(id, 'edit ' + key, 'prop:' + id + ':' + key, e => { e.props[key] = r.value; if (REFIT_KEYS.includes(key)) refit(e); });
    return null;
  }
  /* ---------- spreadsheet mapping (Stage 07A) ---------- */
  // bindings[prop] = template string with {{Column}} placeholders. A string (even '') = dynamic; no key = static. null removes it.
  function setBinding(id, prop, template, typing) { // typing = true coalesces rapid keystrokes into one undo step; mode/column picks are their own steps
    const el = find(id); if (!el) return { error: { label: 'Element', invalid: true } }; if (el.locked) return locked(el);
    if (MARQ.Data.BOUND[el.type] !== prop) return { error: { label: 'Data field', invalid: true } };
    if (template !== null && (typeof template !== 'string' || template.length > 5000)) return { error: { label: 'Data field', invalid: true } };
    const cur = el.bindings && el.bindings[prop];
    if (template === null ? typeof cur !== 'string' : cur === template) return null;
    edit(id, 'data mapping', typing ? 'bind:' + id + ':' + prop : null, e => { e.bindings = e.bindings || {}; if (template === null) delete e.bindings[prop]; else e.bindings[prop] = template; refit(e); });
    return null;
  }
  function setDynamic(id, on) { // static -> dynamic keeps the visible text as the template; dynamic -> static restores the static props untouched
    const el = find(id); if (!el) return { error: { label: 'Element', invalid: true } };
    const prop = MARQ.Data.BOUND[el.type]; if (!prop) return { error: { label: 'Data field', invalid: true } };
    const isDyn = typeof (el.bindings || {})[prop] === 'string';
    if (!!on === isDyn) return null;
    return setBinding(id, prop, on ? (prop === 'text' ? el.props.text : '') : null);
  }
  function setMeta(id, patch) { // name / locked / visible work even on a locked element (that is how you unlock it)
    const el = find(id); if (!el) return null;
    const out = {};
    if ('name' in patch) { const n = String(patch.name).trim().slice(0, 80); if (n && n !== el.name) out.name = n; }
    if ('locked' in patch && !!patch.locked !== el.locked) out.locked = !!patch.locked;
    if ('visible' in patch && !!patch.visible !== el.visible) out.visible = !!patch.visible;
    if (!Object.keys(out).length) return null;
    edit(id, 'element settings', 'meta:' + id + ':' + Object.keys(out).join(), e => { Object.assign(e, out); });
    return null;
  }
  function resetAspect(id) { // restore the image's own proportions, keeping the width
    const el = find(id); if (!el || el.type !== 'image' || !el.props.naturalW) return null;
    return setGeometryForce(el, { h: el.w * el.props.naturalH / el.props.naturalW });
  }
  function setGeometryForce(el, patch) { // bypasses the aspect lock (used to restore the ratio itself)
    if (el.locked) return locked(el);
    const r = SP().validateGeometry('h', patch.h); if (r.error) return r;
    if (r.value === el.h) return null;
    edit(el.id, 'reset aspect', null, e => { e.h = r.value; }); return null;
  }

  /* ---------- structure ---------- */
  function remove(id) {
    const el = find(id); if (!el) return false; if (el.locked) return false;
    MARQ.Store.commit('delete ' + el.name, s => { s.project.elements = s.project.elements.filter(e => e.id !== id); });
    return true;
  }
  function duplicate(id) {
    const el = find(id); if (!el) return null;
    const c = structuredClone(el); c.id = MARQ.Model.uid('el'); c.name = nextName(el.name.replace(/ \d+$/, '')); c.locked = false;
    c.x = round(el.x + 2); c.y = round(el.y + 2);
    const i = S().project.elements.indexOf(el);
    MARQ.Store.commit('duplicate', s => { s.project.elements.splice(i + 1, 0, c); });
    select(c.id); return c.id;
  }
  function reorder(id, dir) { // 'up' = towards the front
    const a = S().project.elements, i = a.findIndex(e => e.id === id); if (i < 0) return false;
    const j = dir === 'up' ? i + 1 : dir === 'down' ? i - 1 : dir === 'top' ? a.length - 1 : 0;
    if (j < 0 || j >= a.length || j === i) return false;
    MARQ.Store.commit('reorder', s => { const arr = s.project.elements, [e] = arr.splice(i, 1); arr.splice(j, 0, e); });
    return true;
  }

  /* ---------- selection (app state, not undoable) ---------- */
  const selectedId = () => S().app.selection[0] || null;
  function select(id) {
    const cur = selectedId(); if ((id || null) === cur) return;
    MARQ.Store.commit('select', s => { s.app.selection = id ? [id] : []; }, 'app');
  }
  function pruneSelection() { // undo/redo/open can remove the selected element
    const sel = S().app.selection; if (sel.length && !sel.every(id => find(id))) MARQ.Store.commit('select', s => { s.app.selection = s.app.selection.filter(id => find(id)); }, 'app');
  }
  // topmost visible, unlocked element under a label-space point; tol = extra reach in mm
  function hitTest(x, y, tol) {
    const a = S().project.elements;
    for (let i = a.length - 1; i >= 0; i--) { const e = a[i]; if (e.visible && !e.locked && SP().hit(e, x, y, tol)) return e.id; }
    return null;
  }
  function init() { MARQ.Bus.on('project:changed', pruneSelection); }

  MARQ.Elements = { KINDS, init, add, addImage, replaceImage, get: find, selected: () => find(selectedId()), select, remove, duplicate, reorder,
    setGeometry, setRotation, setOpacity, setProp, setBinding, setDynamic, setMeta, resetAspect, hitTest, refit };
})(window.MARQ = window.MARQ || {});
