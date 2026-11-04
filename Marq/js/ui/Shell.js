(function (MARQ) {
  'use strict';
  const $ = id => document.getElementById(id), S = () => MARQ.Store.state;
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const NEXT = 'Soon';

  function toast(msg, err) {
    const t = $('status-msg'); t.textContent = msg; t.className = err ? 'err' : '';
    clearTimeout(toast.t); toast.t = setTimeout(() => { t.textContent = ''; }, 4000);
  }

  /* ---------- left rail + flyout ---------- */
  const TOOLS = [
    ['templates', '▦', 'Templates'], ['text', 'T', 'Text'], ['barcode', '▌▌', 'Barcode'],
    ['qr', '▣', 'QR Code'], ['shapes', '◆', 'Shapes'], ['images', '▨', 'Images'], ['layers', '☰', 'Layers']
  ];
  const PRESETS = [
    ['Asset tag', 50, 25], ['Cable flag', 80, 20], ['Mini tag', 30, 15], ['Shelf label', 76, 38], ['Shipping', 100, 150]
  ];
  let tool = 'templates', open = true;

  function card(glyph, title, sub, tag, onclick) {
    const c = el(onclick ? 'button' : 'div', 'card');
    c.append(el('span', 'g', glyph));
    const d = el('div'); d.append(el('b', null, title)); d.append(el('small', null, sub)); c.append(d);
    if (tag) c.append(el('span', 'tag' + (onclick ? ' ok' : ''), tag));
    if (onclick) c.onclick = onclick; else c.setAttribute('aria-disabled', 'true');
    return c;
  }
  function renderRail() {
    const r = $('rail'); r.textContent = '';
    TOOLS.forEach(([id, g, name]) => {
      const b = el('button', 'rb' + (open && tool === id ? ' on' : '')); b.title = name;
      b.append(el('span', null, g), document.createTextNode(name.split(' ')[0]));
      b.onclick = () => { if (tool === id) open = !open; else { tool = id; open = true; } renderRail(); renderFlyout(); };
      r.appendChild(b);
    });
  }
  function renderFlyout() {
    const f = $('flyout'), b = $('fly-body'); b.textContent = '';
    f.classList.toggle('shut', !open);
    $('fly-title').textContent = TOOLS.find(t => t[0] === tool)[2];
    const st = S(), cur = st.project.label;
    if (tool === 'templates') {
      PRESETS.forEach(([n, w, h]) => {
        const on = Math.abs(cur.width - w) < .01 && Math.abs(cur.height - h) < .01;
        b.append(card('▭', n, w + ' × ' + h + ' mm', on ? 'Current' : 'Apply', () => setLabel(w, h)));
      });
      b.append(el('p', 'note', 'Presets set the label size. Design templates arrive with the editor.'));
    } else if (tool === 'text') {
      b.append(card('T', 'Heading', 'Bold, 18 pt', 'Add', () => addEl('heading')), card('t', 'Body text', 'Regular, 10 pt', 'Add', () => addEl('text')));
      b.append(card('{ }', 'Data field', '{{Column}} placeholder', NEXT));
      b.append(el('p', 'note', 'Select text on the canvas, then edit font, size, colour and spacing on the right.'));
    } else if (tool === 'barcode') {
      const KIND = { CODE128: 'code128', CODE39: 'code39', EAN13: 'ean13', EAN8: 'ean8', ITF14: 'itf14' };
      MARQ.Barcodes.formats().filter(f => f.kind === 'linear').forEach(f => b.append(card('▌▌', f.label || f.id, f.available ? 'Linear barcode' : 'Unavailable', f.available ? 'Add' : 'Off', f.available ? () => addEl(KIND[f.id]) : null)));
      b.append(el('p', 'note', 'Select a barcode, then type the value to encode on the right. Quiet zones are added automatically.'));
    } else if (tool === 'qr') {
      b.append(card('▣', 'QR Code', 'Link or text', 'Add', () => addEl('qr')));
    } else if (tool === 'shapes') {
      [['▭', 'Rectangle', 'rect', 'Square corners'], ['▢', 'Rounded rectangle', 'rrect', 'Soft corners'], ['◯', 'Circle', 'circle', 'Keeps 1 : 1'], ['⬭', 'Ellipse', 'ellipse', 'Free width and height'],
       ['╱', 'Line', 'line', 'Straight, solid'], ['┄', 'Dashed line', 'dashed', 'Straight, dashed']].forEach(x => b.append(card(x[0], x[1], x[3], 'Add', () => addEl(x[2]))));
    } else if (tool === 'images') {
      b.append(card('▨', 'Upload image', 'PNG, JPG, GIF, WebP, SVG', 'Choose', () => pickImage()));
      b.append(el('p', 'note', 'Images are stored inside the project. Resize and rotate them in the sidebar; keep “Lock aspect ratio” on to avoid distortion.'));
    } else {
      MARQ.ElementPanel.layers(b);
    }
  }
  function addEl(kind) { try { MARQ.Elements.add(kind); } catch (e) { toast(e.message, true); } }
  // one hidden file input serves both "add image" and "replace image" (replaceId set)
  let imageTarget = null;
  function pickImage(replaceId) { imageTarget = replaceId || null; const i = $('file-image'); i.value = ''; i.click(); }
  function onImageFile(f) {
    if (!f) return;
    const job = imageTarget ? MARQ.Elements.replaceImage(imageTarget, f) : MARQ.Elements.addImage(f);
    imageTarget = null; job.then(() => toast('Image added'), e => toast(e.message, true));
  }

  /* ---------- right properties panel ---------- */
  // Element sections are built by ElementPanel into #el-props; the label sections below are always available.
  const SECTIONS = [['Label', 'label'], ['Canvas', 'canvas'], ['Margins', 'margins']];
  const LS = () => MARQ.LabelSpec, U = () => MARQ.Units, unit = () => S().app.unit;
  const shown = mm => U().display(mm, unit());                       // stored mm -> number in the current unit
  const range = (lo, hi) => U().format(lo, unit()) + ' and ' + U().format(hi, unit());

  // text input holding a length in the current display unit; accepts "12", "12.5", "1,5", "2in", "10 mm"
  function numField(lbl, id, onSet, cls) {
    const w = el('label', 'fld ' + (cls || ''), lbl), i = el('input');
    i.type = 'text'; i.id = id; i.inputMode = 'decimal'; i.autocomplete = 'off'; i.spellcheck = false;
    i.onchange = e => onSet(U().parse(e.target.value, unit()), e.target);
    w.append(i); return w;
  }
  function colorField(lbl, id, onSet) {
    const w = el('label', 'fld', lbl), i = el('input'); i.type = 'color'; i.id = id; i.onchange = e => onSet(e.target.value); w.append(i); return w;
  }
  function reject(input, msg) { // bad input: explain, flash the field, put the real value back
    toast(msg, true);
    const f = input.closest('.fld'); if (f) { f.classList.add('err'); setTimeout(() => f.classList.remove('err'), 1600); }
    syncProps(true);
  }

  function setLabel(w, h) { MARQ.Store.commit('label size', s => { LS().setSize(s.project.label, w, h); }); }
  function setSize(axis, mm, input) {
    const L = S().project.label;
    if (LS().validateSize(mm)) return reject(input, 'Enter a size between ' + range(LS().MIN_MM, LS().MAX_MM));
    MARQ.Store.commit('label size', s => { LS().setSize(s.project.label, axis === 'width' ? mm : L.width, axis === 'height' ? mm : L.height); });
  }
  function setPreset(id) {
    MARQ.Store.commit('label preset', s => { LS().setPreset(s.project.label, id); });
    if (id === 'custom') { const i = $('label-w'); i.focus(); i.select(); }
  }
  function setOrientation(o) {
    if (S().project.label.orientation === o) return; // orientation always mirrors width/height (squares keep their flag)
    MARQ.Store.commit('orientation', s => { LS().setOrientation(s.project.label, o); });
  }
  function setBorderWidth(mm, input) {
    const err = LS().validateBorder(S().project.label, mm);
    if (err) return reject(input, 'Border must be between ' + range(0, err.max));
    MARQ.Store.commit('border', s => { s.project.label.borderWidth = Math.round(mm * 1e4) / 1e4; });
  }
  function setMargin(side, mm, input) {
    const err = LS().validateMargin(S().project.label, side, mm);
    if (err) return reject(input, 'Margin must be between ' + range(0, err.max));
    MARQ.Store.commit('margin', s => { LS().setMargin(s.project.label, side, mm); });
  }
  function setGridSize(mm, input) {
    if (!(mm >= 0.1 && mm <= 500)) return reject(input, 'Grid size must be between ' + range(0.1, 500));
    MARQ.Store.commit('grid', s => { s.app.grid.size = Math.round(mm * 1e4) / 1e4; }, 'app');
  }

  function buildLabel(inn) {
    const pw = el('label', 'fld full', 'Preset'), ps = el('select'); ps.id = 'label-preset';
    LS().PRESETS.forEach(p => ps.add(new Option(p.name, p.id))); ps.add(new Option('Custom', 'custom'));
    ps.onchange = e => setPreset(e.target.value); pw.append(ps);
    const u = el('select'); u.id = 'unit-select'; U().list.forEach(x => u.add(new Option(x, x)));
    u.onchange = e => MARQ.Store.commit('unit', st => { st.app.unit = e.target.value; }, 'app');
    const uw = el('label', 'fld full', 'Unit'); uw.append(u);
    const seg = el('div', 'seg');
    [['portrait', '▯ Portrait'], ['landscape', '▭ Landscape']].forEach(([id, t]) => {
      const b = el('button', 'chip', t); b.type = 'button'; b.id = 'orient-' + id; b.onclick = () => setOrientation(id); seg.append(b);
    });
    const ow = el('div', 'fld full', 'Orientation'); ow.append(seg);
    inn.append(pw, numField('Width', 'label-w', (mm, i) => setSize('width', mm, i)), numField('Height', 'label-h', (mm, i) => setSize('height', mm, i)), uw, ow);
  }
  function buildCanvas(inn) {
    inn.append(
      colorField('Background', 'label-bg', v => MARQ.Store.commit('background', s => { s.project.label.background = v; })),
      colorField('Border colour', 'label-border-color', v => MARQ.Store.commit('border', s => { s.project.label.borderColor = v; })),
      numField('Border width', 'label-border-w', setBorderWidth),
      numField('Grid spacing', 'grid-size', setGridSize));
  }
  function buildMargins(inn) {
    [['Top', 'top'], ['Bottom', 'bottom'], ['Left', 'left'], ['Right', 'right']].forEach(([l, side]) => inn.append(numField(l, 'm-' + side, (mm, i) => setMargin(side, mm, i))));
    inn.append(el('div', 'hint', 'Margins mark the safe area. The dashed guide is for the editor only and never prints.'));
  }
  function renderProps() {
    const p = $('props'); p.textContent = '';
    const box = el('div'); box.id = 'el-props'; p.append(box); MARQ.ElementPanel.init(box);
    SECTIONS.forEach(([title, kind]) => {
      const s = el('section', 'sec'), h = el('button', null, title), inn = el('div', 'in');
      h.onclick = () => s.classList.toggle('closed');
      if (kind === 'label') buildLabel(inn); else if (kind === 'canvas') buildCanvas(inn); else buildMargins(inn);
      s.append(h, inn); p.append(s);
    });
  }
  // push model values into the panel; never overwrite the field the user is typing in (unless force)
  function syncProps(force) {
    const st = S(), L = st.project.label, set = (id, v) => { const e = $(id); if (e && (force || document.activeElement !== e)) e.value = v; };
    set('label-preset', L.preset); $('unit-select').value = unit();
    set('label-w', shown(L.width)); set('label-h', shown(L.height));
    set('label-bg', L.background); set('label-border-color', L.borderColor); set('label-border-w', shown(L.borderWidth));
    set('grid-size', shown(st.app.grid.size));
    LS().SIDES.forEach(side => set('m-' + side, shown(L.margin[side])));
    ['portrait', 'landscape'].forEach(o => $('orient-' + o).setAttribute('aria-pressed', L.orientation === o));
  }

  /* ---------- state refresh ---------- */
  function refresh() {
    const st = S(), u = st.app.unit, L = st.project.label;
    $('project-name').value = st.project.meta.name;
    syncProps(false); MARQ.ElementPanel.sync(false);
    $('btn-grid').setAttribute('aria-pressed', st.app.grid.show); $('btn-rulers').setAttribute('aria-pressed', st.app.rulers);
    $('btn-undo').disabled = !MARQ.Store.canUndo(); $('btn-redo').disabled = !MARQ.Store.canRedo();
    $('zoom-label').textContent = Math.round(st.app.view.zoom * 100) + '%';
    $('btn-zoom-in').disabled = st.app.view.zoom >= MARQ.Viewport.MAX_ZOOM - 1e-9; $('btn-zoom-out').disabled = st.app.view.zoom <= MARQ.Viewport.MIN_ZOOM + 1e-9;
    $('st-size').textContent = MARQ.Units.format(L.width, u) + ' × ' + MARQ.Units.format(L.height, u);
    const lay = MARQ.PrintPlanner.layout(st.project.page, L);
    $('st-sheet').textContent = st.project.page.size + ': ' + lay.cols + '×' + lay.rows + ' = ' + lay.perPage + ' labels/page';
    syncRecordNav();
    const ds = currentData(); $('btn-data').disabled = false; $('btn-data').title = ds ? ds.rowCount + ' rows loaded' : 'No data imported yet';
    if (tool === 'templates' || tool === 'layers') renderFlyout();
  }
  function refreshLibs() {
    const f = MARQ.Barcodes.formats(), has = id => f.some(x => x.id === id && x.available);
    $('st-libs').textContent = 'SheetJS ' + (window.XLSX ? '✓' : '✗') + '  Barcode ' + (has('CODE128') ? '✓' : '✗') + '  QR ' + (has('QR') ? '✓' : '✗');
  }
  // Stage 07B: record navigation. Only touches the DOM when a value changed, so pan/zoom/other state changes cost nothing.
  function syncRecordNav() {
    const n = MARQ.Data.recordCount(), i = MARQ.Data.previewIndex(), box = $('rec-nav'), num = $('rec-num');
    box.hidden = $('rec-sep').hidden = !n;
    if (!n) return;
    if ($('rec-total').textContent !== String(n)) { $('rec-total').textContent = n; num.max = n; }
    if (document.activeElement !== num && num.value !== String(i + 1)) num.value = i + 1;
    $('rec-prev').disabled = i <= 0; $('rec-next').disabled = i >= n - 1;
  }
  const currentData = () => { const s = S(), id = s.project.dataBinding && s.project.dataBinding.datasetId; return id && s.data[id]; };

  /* ---------- modals ---------- */
  function modal(title, build) { $('modal-title').textContent = title; const b = $('modal-body'); b.textContent = ''; build(b); $('modal').showModal(); }
  function dataPreview() {
    modal('Data Preview', b => {
      const ds = currentData();
      if (!ds) { b.append(el('div', 'empty', 'No data yet. Use Import Excel to load a spreadsheet.')); return; }
      b.append(el('p', 'note', ds.fileName + ' · ' + ds.sheetName + ' · ' + ds.rowCount + ' rows'));
      const t = el('table'), hr = el('tr'); ds.columns.forEach(c => hr.append(el('th', null, c.header))); t.append(hr);
      ds.rows.slice(0, 200).forEach(r => { const tr = el('tr'); ds.columns.forEach(c => tr.append(el('td', null, r[c.key]))); t.append(tr); });
      b.append(t);
    });
  }
  function printPreview() { if (MARQ.PrintConfig) MARQ.PrintConfig.show(); }
  function importExcel(f) {
    if (!window.XLSX) { toast('SheetJS missing: add vendor/xlsx.full.min.js', true); return; }
    f.arrayBuffer().then(buf => {
      const wb = XLSX.read(buf, { type: 'array' }), name = wb.SheetNames[0];
      const ds = MARQ.Data.fromAOA(XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', raw: false }), { fileName: f.name, sheetName: name });
      MARQ.Store.commit('data', s => { s.data[ds.id] = ds; s.project.dataBinding = Object.assign(s.project.dataBinding || {}, { datasetId: ds.id }); s.app.activeDatasetId = ds.id; s.app.previewIndex = 0; });
      toast('Imported ' + ds.rowCount + ' rows from ' + f.name); dataPreview();
    }).catch(e => toast('Import failed: ' + e.message, true));
  }

  function init() {
    renderRail(); renderFlyout(); renderProps();
    $('project-name').onchange = e => MARQ.Store.commit('rename', s => { s.project.meta.name = e.target.value.trim() || 'Untitled Label'; });
    $('btn-grid').onclick = () => MARQ.Store.commit('grid', s => { s.app.grid.show = !s.app.grid.show; }, 'app');
    $('btn-rulers').onclick = () => MARQ.Store.commit('rulers', s => { s.app.rulers = !s.app.rulers; }, 'app');
    $('btn-undo').onclick = () => MARQ.Store.undo(); $('btn-redo').onclick = () => MARQ.Store.redo();
    $('btn-zoom-in').onclick = () => MARQ.CanvasView.zoomBy(1.25); $('btn-zoom-out').onclick = () => MARQ.CanvasView.zoomBy(0.8);
    $('btn-zoom-100').onclick = () => MARQ.CanvasView.zoomTo(1); $('btn-fit').onclick = () => MARQ.CanvasView.fit();
    $('btn-new').onclick = () => {
      if (!confirm('Start a new project? The current one is autosaved and can be reopened later.')) return;
      MARQ.Store.replaceProject(MARQ.Model.createProject()); MARQ.CanvasView.fit(); MARQ.Storage.scheduleAutosave(); toast('New project created');
    };
    $('btn-save').onclick = () => { try { MARQ.Storage.save(S().project); MARQ.Storage.exportFile(S().project); toast('Saved'); } catch (e) { toast('Save failed: ' + e.message, true); } };
    $('btn-open').onclick = () => $('file-open').click();
    $('file-open').onchange = e => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      MARQ.Storage.importFile(f).then(p => { MARQ.Store.replaceProject(p); MARQ.CanvasView.fit(); MARQ.Storage.scheduleAutosave(); toast('Opened ' + f.name); }).catch(err => toast('Open failed: ' + err.message, true));
    };
    $('file-image').onchange = e => { const f = e.target.files[0]; e.target.value = ''; onImageFile(f); };
    $('btn-excel').onclick = () => $('file-excel').click();
    $('file-excel').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) importExcel(f); };
    $('btn-data').onclick = dataPreview; $('btn-pprev').onclick = printPreview; $('btn-print').onclick = printPreview;
    $('rec-prev').onclick = () => MARQ.Data.stepPreview(-1); $('rec-next').onclick = () => MARQ.Data.stepPreview(1);
    const jump = () => { const v = parseInt($('rec-num').value, 10); MARQ.Data.setPreviewIndex(Number.isFinite(v) ? v - 1 : MARQ.Data.previewIndex()); $('rec-num').value = MARQ.Data.previewIndex() + 1; };
    $('rec-num').onchange = jump; $('rec-num').onkeydown = e => { if (e.key === 'Enter') { jump(); e.target.blur(); } else if (e.key === 'Escape') { e.target.value = MARQ.Data.previewIndex() + 1; e.target.blur(); } };
    document.addEventListener('keydown', e => { if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) && !$('modal').open) { e.preventDefault(); MARQ.Data.stepPreview(e.key === 'ArrowLeft' ? -1 : 1); } });
    $('modal-x').onclick = () => $('modal').close();
    $('modal').onclick = e => { if (e.target === $('modal')) $('modal').close(); };
    document.addEventListener('keydown', e => {
      if (!(e.ctrlKey || e.metaKey) || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
      const k = e.key.toLowerCase();
      if (k === 'z') { e.preventDefault(); e.shiftKey ? MARQ.Store.redo() : MARQ.Store.undo(); }
      else if (k === 'y') { e.preventDefault(); MARQ.Store.redo(); }
      else if (k === 's') { e.preventDefault(); $('btn-save').click(); }
      else if (k === '=' || k === '+') { e.preventDefault(); MARQ.CanvasView.zoomBy(1.25); }
      else if (k === '-') { e.preventDefault(); MARQ.CanvasView.zoomBy(0.8); }
      else if (k === '0') { e.preventDefault(); MARQ.CanvasView.fit(); }
      else if (k === '1') { e.preventDefault(); MARQ.CanvasView.zoomTo(1); }
    });
    document.addEventListener('keydown', e => { // element shortcuts: Delete, Esc, Ctrl+D
      const t = document.activeElement, typing = t && (/INPUT|SELECT|TEXTAREA/.test(t.tagName) || t.isContentEditable), sel = MARQ.Elements.selected();
      if (typing || !sel || $('modal').open) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); MARQ.Elements.remove(sel.id); }
      else if (e.key === 'Escape') MARQ.Elements.select(null);
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); MARQ.Elements.duplicate(sel.id); }
    });
    MARQ.Bus.on('cursor:moved', pt => { const u = unit(); $('st-cursor').textContent = pt ? 'X ' + U().display(pt.x, u) + '   Y ' + U().display(pt.y, u) + ' ' + u : ''; });
    MARQ.Bus.on('state:changed', refresh); MARQ.Bus.on('state:replaced', refresh);
    MARQ.Bus.on('storage:saved', e => { $('st-saved').textContent = 'Autosaved ' + e.at.toLocaleTimeString(); });
    MARQ.Bus.on('storage:error', e => toast('Autosave failed: ' + e.error.message, true));
    refresh(); refreshLibs();
  }
  MARQ.Shell = { init, toast, pickImage };
})(window.MARQ = window.MARQ || {});
