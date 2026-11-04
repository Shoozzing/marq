(function (MARQ) {
  'use strict';
  // Stage 09 — print configuration. Physical layout only: no window.print().
  // Reuses the shared template + Renderer for artwork, and Generator.scope() for which records print.
  const $ = id => document.getElementById(id);
  const S = () => MARQ.Store.state;
  const P = () => MARQ.PrintPlanner;
  const LS = () => MARQ.LabelSpec;
  const U = () => MARQ.Units;
  const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const ui = { open: false, page: 0, raf: 0, last: null };

  const unit = () => S().app.unit;
  // Print dialog shows the stored value, not a 2-decimal approximation (66.675 mm must not read 66.68): up to 4 decimals, zeros trimmed.
  const shown = mm => Math.round(U().fromMM(mm, unit()) * 1e4) / 1e4;
  const exact = mm => shown(mm) + ' ' + unit();
  const range = (lo, hi) => U().format(lo, unit()) + ' and ' + U().format(hi, unit());

  function toast(msg, err) { if (MARQ.Shell && MARQ.Shell.toast) MARQ.Shell.toast(msg, err); }
  function reject(input, msg) {
    toast(msg, true);
    const f = input && input.closest && input.closest('.fld');
    if (f) { f.classList.add('err'); setTimeout(() => f.classList.remove('err'), 1600); }
    sync(true);
  }

  function commit(label, fn) { MARQ.Store.commit(label, fn); }
  function dataset() { return MARQ.Data && MARQ.Data.active ? MARQ.Data.active() : null; }
  function indices() {
    const ds = dataset(), page = S().project.page;
    if (!ds || !ds.records.length) return [null];
    const mode = page.scope === 'selected' ? 'selected' : 'all';
    return MARQ.Generator.scope(ds, mode);
  }

  function fld(lbl, id, onSet, extra) {
    const w = mk('label', 'fld' + (extra && extra.full ? ' full' : ''), lbl), i = mk('input');
    i.type = 'text'; i.id = id; i.inputMode = 'decimal'; i.autocomplete = 'off'; i.spellcheck = false;
    i.onchange = e => onSet(U().parse(e.target.value, unit()), e.target);
    w.append(i); return w;
  }
  function sel(lbl, id, opts, onSet, extra) {
    const w = mk('label', 'fld' + (extra && extra.full ? ' full' : ''), lbl), s = mk('select');
    s.id = id; opts.forEach(([v, t]) => s.add(new Option(t, v))); s.onchange = e => onSet(e.target.value);
    w.append(s); return w;
  }
  function seg(lbl, id, items, onPick) {
    const w = mk('div', 'fld full', lbl), g = mk('div', 'seg'); g.id = id;
    items.forEach(([v, t]) => { const b = mk('button', 'chip', t); b.type = 'button'; b.dataset.v = v; b.onclick = () => onPick(v); g.append(b); });
    w.append(g); return w;
  }

  function setPaper(size) {
    commit('paper', s => { P().setPaper(s.project.page, size); });
  }
  function setCustom(axis, mm, input) {
    const err = P().validateSize(mm);
    if (err) return reject(input, 'Enter a size between ' + range(err.min, err.max));
    commit('paper size', s => {
      const p = s.project.page;
      P().setCustomSize(p, axis === 'width' ? mm : p.width, axis === 'height' ? mm : p.height);
    });
  }
  function setPageOrient(o) { commit('page orientation', s => { P().setOrientation(s.project.page, o); }); }
  function setPageMargin(side, mm, input) {
    const err = P().validateNonNeg(mm);
    if (err) return reject(input, 'Margin must be between ' + range(0, err.max));
    commit('page margin', s => { P().setMargin(s.project.page, side, mm); });
  }
  function setGap(axis, mm, input) {
    const err = P().validateNonNeg(mm);
    if (err) return reject(input, 'Gap must be between ' + range(0, err.max));
    commit('label gap', s => { P().setGap(s.project.page, axis, mm); });
  }
  function setGrid(which, raw, input) {
    if (raw === 'auto' || raw === '') { commit('labels per page', s => { which === 'columns' ? P().setColumns(s.project.page, 'auto') : P().setRows(s.project.page, 'auto'); }); return; }
    const n = Math.trunc(Number(raw));
    const err = P().validateGrid(n);
    if (err) return reject(input, 'Enter auto, or a whole number between ' + err.min + ' and ' + err.max);
    commit('labels per page', s => { which === 'columns' ? P().setColumns(s.project.page, n) : P().setRows(s.project.page, n); });
  }
  function setAlign(axis, v) { commit('print align', s => { P().setAlign(s.project.page, axis, v); }); }
  function setLayout(mode) { commit('print layout', s => { P().setLayout(s.project.page, mode, s.project.label); }); }
  function setScale(v, input) {
    const err = P().validateScale(v);
    if (err) return reject(input, 'Print scale must be between ' + Math.round(err.min * 100) + '% and ' + Math.round(err.max * 100) + '%');
    commit('print scale', s => { P().setScale(s.project.page, v); });
  }
  function setCopies(raw, input) {
    const err = P().validateCopies(raw);
    if (err) return reject(input, 'Copies must be a whole number between ' + err.min + ' and ' + err.max);
    commit('print copies', s => { P().setCopies(s.project.page, raw); });
  }
  function setScope(v) { commit('print scope', s => { P().setScope(s.project.page, v); }); }
  function setLabelSize(axis, mm, input) {
    const err = LS().validateSize(mm);
    if (err) return reject(input, 'Enter a size between ' + range(LS().MIN_MM, LS().MAX_MM));
    const L = S().project.label;
    commit('label size', s => { LS().setSize(s.project.label, axis === 'width' ? mm : L.width, axis === 'height' ? mm : L.height); });
  }
  function setLabelOrient(o) {
    if (S().project.label.orientation === o) return;
    commit('orientation', s => { LS().setOrientation(s.project.label, o); });
  }

  function buildForm(host) {
    const paper = mk('section', 'print-sec'); paper.append(mk('h4', null, 'Paper'));
    paper.append(
      sel('Size', 'pc-paper', P().PAPERS.map(p => [p.id, p.name]), setPaper, { full: true }),
      fld('Width', 'pc-pw', (mm, i) => setCustom('width', mm, i)),
      fld('Height', 'pc-ph', (mm, i) => setCustom('height', mm, i)),
      seg('Page orientation', 'pc-porient', [['portrait', '▯ Portrait'], ['landscape', '▭ Landscape']], setPageOrient)
    );
    const label = mk('section', 'print-sec'); label.append(mk('h4', null, 'Label'));
    label.append(
      fld('Width', 'pc-lw', (mm, i) => setLabelSize('width', mm, i)),
      fld('Height', 'pc-lh', (mm, i) => setLabelSize('height', mm, i)),
      seg('Orientation', 'pc-lorient', [['portrait', '▯ Portrait'], ['landscape', '▭ Landscape']], setLabelOrient)
    );
    const margins = mk('section', 'print-sec'); margins.append(mk('h4', null, 'Page margins'));
    [['Top', 'top'], ['Bottom', 'bottom'], ['Left', 'left'], ['Right', 'right']].forEach(([t, s]) => {
      margins.append(fld(t, 'pc-m-' + s, (mm, i) => setPageMargin(s, mm, i)));
    });
    const lay = mk('section', 'print-sec'); lay.append(mk('h4', null, 'Layout'));
    lay.append(
      sel('Arrangement', 'pc-layout', [
        ['single', 'Single label'],
        ['sheet', 'Multiple labels per sheet'],
        ['continuous', 'Continuous / roll'],
        ['thermal', 'Thermal / custom die-cut']
      ], setLayout, { full: true }),
      fld('Labels per row', 'pc-cols', (v, i) => setGrid('columns', i.value.trim(), i)),
      fld('Labels per column', 'pc-rows', (v, i) => setGrid('rows', i.value.trim(), i)),
      fld('Horizontal gap', 'pc-gx', (mm, i) => setGap('x', mm, i)),
      fld('Vertical gap', 'pc-gy', (mm, i) => setGap('y', mm, i)),
      seg('Horizontal alignment', 'pc-ax', [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']], v => setAlign('x', v)),
      seg('Vertical alignment', 'pc-ay', [['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']], v => setAlign('y', v))
    );
    const print = mk('section', 'print-sec'); print.append(mk('h4', null, 'Print'));
    print.append(
      seg('Records', 'pc-scope', [['all', 'Print all'], ['selected', 'Print selected']], setScope),
      fld('Number of copies', 'pc-copies', (v, i) => setCopies(i.value, i)),
      fld('Print scale', 'pc-scale', (v, i) => {
        const n = parseFloat(String(i.value).replace(',', '.').replace('%', ''));
        setScale(n / 100, i);
      }, { full: true })
    );
    const unitRow = mk('label', 'fld full', 'Display unit'), us = mk('select'); us.id = 'pc-unit';
    U().list.forEach(x => us.add(new Option(x, x)));
    us.onchange = e => MARQ.Store.commit('unit', st => { st.app.unit = e.target.value; }, 'app');
    unitRow.append(us); paper.appendChild(unitRow);
    const note = mk('div', 'hint', 'Dimensions are physical (stored in millimetres). Browser printing is not sent yet — this screen only configures and previews the layout.');
    host.append(paper, label, margins, lay, print, note);
  }

  function press(id, value) {
    const g = $(id); if (!g) return;
    Array.prototype.forEach.call(g.querySelectorAll('.chip'), b => b.setAttribute('aria-pressed', b.dataset.v === value));
  }
  function setv(id, v, force) {
    const e = $(id); if (!e) return;
    if (!force && document.activeElement === e) return;
    e.value = v;
  }

  function sync(force) {
    if (!ui.open || !$('pc-paper')) return;
    const st = S(), page = st.project.page, L = st.project.label, u = unit();
    setv('pc-paper', page.size === 'A4' || page.size === 'Letter' || page.size === 'Custom' ? page.size : 'Custom', force);
    const raw = page.size === 'Custom' ? { w: page.width, h: page.height } : P().paperDims(page.size, page.width, page.height);
    setv('pc-pw', shown(raw.w), force); setv('pc-ph', shown(raw.h), force);
    const thermal = page.layout === 'thermal';
    if (thermal) { const sh = P().layout(page, L).sheet; setv('pc-pw', shown(sh.w), force); setv('pc-ph', shown(sh.h), force); }
    $('pc-pw').disabled = $('pc-ph').disabled = thermal || page.size !== 'Custom';
    $('pc-paper').disabled = thermal;
    Array.prototype.forEach.call($('pc-porient').querySelectorAll('.chip'), b => { b.disabled = thermal; });
    press('pc-porient', page.orientation);
    setv('pc-lw', shown(L.width), force); setv('pc-lh', shown(L.height), force);
    press('pc-lorient', L.orientation);
    P().SIDES.forEach(s => setv('pc-m-' + s, shown(page.margin[s]), force));
    setv('pc-layout', page.layout || 'sheet', force);
    const gridTxt = v => v === 'auto' ? 'auto' : String(v);
    setv('pc-cols', gridTxt(page.columns), force); setv('pc-rows', gridTxt(page.rows), force);
    const lockedGrid = page.layout === 'single' || page.layout === 'thermal';
    $('pc-cols').disabled = $('pc-rows').disabled = lockedGrid;
    setv('pc-gx', shown(page.gap.x), force); setv('pc-gy', shown(page.gap.y), force);
    press('pc-ax', page.alignX || 'left'); press('pc-ay', page.alignY || 'top');
    press('pc-scope', page.scope === 'selected' ? 'selected' : 'all');
    setv('pc-copies', String(page.copies || 1), force);
    setv('pc-scale', String(U().round((page.scale || 1) * 100, 'mm')), force); // percent, unit-independent
    $('pc-unit').value = u;
    paintPreview();
  }

  function paintPreview() {
    const cv = $('pc-canvas'), meta = $('pc-meta'), warn = $('pc-warn'); if (!cv) return;
    const st = S(), page = st.project.page, L = st.project.label, u = unit();
    const lay = P().layout(page, L);
    const idx = indices();
    const job = P().plan(page, L, idx[0] === null && idx.length === 1 && !dataset() ? [null] : idx);
    const pageCount = Math.max(1, job.pageCount);
    ui.page = Math.min(Math.max(0, ui.page), pageCount - 1);
    const sheet = lay.sheet;
    const box = cv.parentElement.getBoundingClientRect();
    const pad = 16, maxW = Math.max(80, box.width - pad), maxH = Math.max(80, box.height - pad);
    const k = Math.min(maxW / sheet.w, maxH / sheet.h);
    const dpr = window.devicePixelRatio || 1;
    const cssW = Math.max(1, sheet.w * k), cssH = Math.max(1, sheet.h * k);
    cv.style.width = cssW + 'px'; cv.style.height = cssH + 'px';
    cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssH * dpr);
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cssW, cssH);
    g.fillStyle = '#dfe3ea'; g.fillRect(0, 0, cssW, cssH);
    // page margin
    g.save();
    g.strokeStyle = '#8aa3c0'; g.lineWidth = 1; g.setLineDash([4, 3]);
    g.strokeRect(lay.printable.x * k, lay.printable.y * k, Math.max(0, lay.printable.w * k), Math.max(0, lay.printable.h * k));
    g.restore();
    const slots = job.pages[ui.page] || [];
    const ds = dataset();
    lay.cells.forEach((cell, i) => {
      const x = cell.x * k, y = cell.y * k, w = cell.w * k, h = cell.h * k;
      g.save();
      g.beginPath(); g.rect(x, y, w, h); g.clip();
      const slot = slots[i];
      const recIndex = slot ? slot.index : undefined;
      if (recIndex == null && !(slot && slot.index === null)) {
        g.fillStyle = '#e8f2c4'; g.fillRect(x, y, w, h);
      } else {
        g.translate(x, y);
        try {
          const rec = recIndex == null || !ds ? null : MARQ.Data.recordView(recIndex, ds);
          MARQ.Renderer.draw(g, st.project, rec, k * (lay.footprint.scale || 1), {});
        } catch (e) {
          g.fillStyle = '#fff4f4'; g.fillRect(0, 0, w, h);
          g.fillStyle = '#b00'; g.font = '11px sans-serif'; g.fillText(String(e && e.message || e), 4, 14);
        }
      }
      g.restore();
      g.strokeStyle = '#3d4a2a'; g.lineWidth = 1; g.strokeRect(x, y, w, h);
    });
    ui.last = {
      k, dpr, cssW, cssH, sheet, cells: lay.cells, printable: lay.printable, used: lay.used,
      cols: lay.cols, rows: lay.rows, perPage: lay.perPage, fit: lay.fit, mode: lay.mode,
      pageIndex: ui.page, pageCount, count: job.count, unique: idx[0] === null ? 1 : idx.length, copies: job.copies,
      sequence: job.sequence, footprint: lay.footprint
    };
    const fmt = exact;
    const src = !ds ? 'template (no spreadsheet)' : (page.scope === 'selected' ? 'selected generated labels' : 'all generated labels');
    meta.textContent = fmt(sheet.w) + ' × ' + fmt(sheet.h) + ' sheet · ' + lay.cols + ' × ' + lay.rows + ' = ' + lay.perPage + ' labels/page · '
      + job.count + ' impression' + (job.count === 1 ? '' : 's') + ' from ' + src
      + (job.copies > 1 ? ' × ' + job.copies + ' copies' : '')
      + ' · ' + pageCount + ' sheet' + (pageCount === 1 ? '' : 's')
      + ' · label ' + fmt(lay.footprint.w) + ' × ' + fmt(lay.footprint.h)
      + (lay.footprint.scale !== 1 ? ' at ' + Math.round(lay.footprint.scale * 100) + '%' : '')
      + ' · origin of first cell ' + (lay.cells[0] ? fmt(lay.cells[0].x) + ', ' + fmt(lay.cells[0].y) : '—');
    warn.textContent = '';
    const over = [];
    if (lay.mode !== 'single' && lay.mode !== 'thermal') {
      if (typeof page.columns === 'number' && page.columns > lay.auto.cols) over.push(page.columns + ' per row requested, only ' + lay.auto.cols + ' fit');
      if (typeof page.rows === 'number' && page.rows > lay.auto.rows) over.push(page.rows + ' per column requested, only ' + lay.auto.rows + ' fit');
    }
    if (!lay.fit) warn.textContent = 'The label does not fit this sheet. Reduce the label size, margins, or scale, or choose a larger paper.';
    else if (over.length) warn.textContent = 'Layout limited by the sheet: ' + over.join('; ') + '. Reduce label size, gaps or margins to fit more.';
    else if (ds && idx.length === 0) warn.textContent = 'No records in scope. Tick rows in Generate Labels, or switch to Print all.';
    $('pc-prev').disabled = ui.page <= 0;
    $('pc-next').disabled = ui.page >= pageCount - 1;
    $('pc-page').textContent = 'Sheet ' + (ui.page + 1) + ' of ' + pageCount;
  }

  function show() {
    const dialog = $('modal'), body = $('modal-body');
    if (dialog.open) dialog.close();
    ui.open = true; ui.page = 0;
    $('modal-title').textContent = 'Print setup';
    body.textContent = ''; dialog.classList.add('print-wide');
    const grid = mk('div', 'print-grid'), form = mk('div', 'print-form'); form.id = 'pc-form';
    buildForm(form);
    const right = mk('div', 'print-right'), stage = mk('div', 'print-stage'), cv = mk('canvas');
    cv.id = 'pc-canvas'; cv.setAttribute('aria-label', 'Print layout preview'); stage.appendChild(cv);
    const nav = mk('div', 'print-nav');
    const prev = mk('button', 'chip act', '◀'); prev.id = 'pc-prev'; prev.type = 'button'; prev.onclick = () => { ui.page--; paintPreview(); };
    const next = mk('button', 'chip act', '▶'); next.id = 'pc-next'; next.type = 'button'; next.onclick = () => { ui.page++; paintPreview(); };
    const lab = mk('span', 'note'); lab.id = 'pc-page';
    nav.append(prev, lab, next);
    const meta = mk('div', 'print-meta'); meta.id = 'pc-meta';
    const warn = mk('div', 'hint warn'); warn.id = 'pc-warn';
    const later = mk('button', 'chip act', 'Send to printer'); later.type = 'button'; later.disabled = true; later.title = 'Browser printing is not implemented in this stage.'; later.id = 'pc-print';
    right.append(stage, nav, meta, warn, later);
    grid.append(form, right); body.appendChild(grid);
    dialog.showModal();
    sync(true);
  }

  function onState() { if (ui.open) sync(false); }
  function init() {
    const a = $('btn-pprev'), b = $('btn-print');
    if (a) a.onclick = show; if (b) b.onclick = show;
    const dialog = $('modal');
    if (dialog) dialog.addEventListener('close', () => {
      if (!dialog.classList.contains('print-wide') && !ui.open) return;
      ui.open = false; cancelAnimationFrame(ui.raf); dialog.classList.remove('print-wide');
    });
    MARQ.Bus.on('state:changed', onState); MARQ.Bus.on('state:replaced', onState);
    MARQ.Bus.on('images:loaded', () => { if (ui.open) paintPreview(); });
    window.addEventListener('resize', () => { if (ui.open) paintPreview(); });
  }

  MARQ.PrintConfig = { init, show, sync, paintPreview, indices, ui, get last() { return ui.last; } };
})(window.MARQ = window.MARQ || {});
