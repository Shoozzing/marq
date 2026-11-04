(function (MARQ) {
  'use strict';
  // Pure layout math in millimetres. page = project.page, label = project.label.
  // Default behaviour (sheet + auto grid + top/left) is unchanged so existing 1×5 A4 tests still hold.
  const SIZES = { A3: [297, 420], A4: [210, 297], A5: [148, 210], Letter: [215.9, 279.4], Legal: [215.9, 355.6] };
  const PAPERS = [
    { id: 'A4', name: 'A4 (210 × 297 mm)' },
    { id: 'Letter', name: 'Letter (8.5 × 11 in)' },
    { id: 'Custom', name: 'Custom' }
  ];
  const LAYOUTS = ['single', 'sheet', 'continuous', 'thermal'];
  const ALIGN_X = ['left', 'center', 'right'];
  const ALIGN_Y = ['top', 'middle', 'bottom'];
  const SIDES = ['top', 'bottom', 'left', 'right'];
  const MIN_MM = 1, MAX_MM = 2000, MIN_SCALE = 0.1, MAX_SCALE = 4, MAX_COPIES = 99, MAX_GRID = 50;
  const PRECISION = 1e4;
  const EPS_RATIO = 1e-9, EPS_MM = 1e-6; // float tolerance for 'does it fit' decisions
  const snap = v => Math.round(v * PRECISION) / PRECISION;
  const finite = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);

  function paperDims(size, fallbackW, fallbackH) {
    if (size !== 'Custom' && SIZES[size]) return { w: SIZES[size][0], h: SIZES[size][1] };
    return { w: finite(fallbackW, 210), h: finite(fallbackH, 297) };
  }
  function orientSheet(w, h, orientation) {
    if (orientation === 'landscape' && w < h) return { w: h, h: w };
    if (orientation === 'portrait' && w > h) return { w: h, h: w };
    return { w, h };
  }
  function sheet(page) { // effective printable sheet size honouring orientation
    const d = paperDims(page.size, page.width, page.height);
    return orientSheet(d.w, d.h, page.orientation);
  }
  function scaleOf(page) {
    const s = finite(page.scale, 1);
    return s >= MIN_SCALE && s <= MAX_SCALE ? s : 1;
  }
  function copiesOf(page) {
    const n = Math.trunc(finite(page.copies, 1));
    return n >= 1 && n <= MAX_COPIES ? n : 1;
  }
  function footprint(label, page) {
    const s = scaleOf(page);
    return { w: snap((label.width || 0) * s), h: snap((label.height || 0) * s), scale: s };
  }
  function gridCap(v) {
    if (v === 'auto' || v == null || v === '') return 'auto';
    const n = Math.trunc(Number(v));
    return n >= 1 && n <= MAX_GRID ? n : 'auto';
  }
  function layoutMode(page) {
    return LAYOUTS.indexOf(page.layout) >= 0 ? page.layout : 'sheet';
  }

  function layout(page, label) {
    page = page || {};
    const mode = layoutMode(page);
    let s = sheet(page); const m = page.margin || { top: 0, right: 0, bottom: 0, left: 0 };
    const g = page.gap || { x: 0, y: 0 };
    const gx = Math.max(0, finite(g.x, 0)), gy = Math.max(0, finite(g.y, 0));
    const ml = Math.max(0, finite(m.left, 0)), mr = Math.max(0, finite(m.right, 0));
    const mt = Math.max(0, finite(m.top, 0)), mb = Math.max(0, finite(m.bottom, 0));
    const fp = footprint(label || {}, page);
    // Thermal / die-cut stock IS the label: the sheet follows the (scaled) label size plus margins, so editing the label never leaves a stale sheet.
    if (mode === 'thermal') s = { w: snap(fp.w + ml + mr), h: snap(fp.h + mt + mb) };
    const aw = s.w - ml - mr, ah = s.h - mt - mb;
    // EPS: labels that exactly fill the printable area (3 × 2.5 in on a Letter row) must count; plain floor() loses them to float noise.
    const autoC = fp.w > 0 ? Math.floor((aw + gx) / (fp.w + gx) + EPS_RATIO) : 0;
    const autoR = fp.h > 0 ? Math.floor((ah + gy) / (fp.h + gy) + EPS_RATIO) : 0;
    let wantC = gridCap(page.columns), wantR = gridCap(page.rows);
    if (mode === 'single' || mode === 'thermal') { wantC = 1; wantR = 1; }
    else if (mode === 'continuous' && wantC === 'auto') wantC = 1;
    const cols = Math.max(0, wantC === 'auto' ? autoC : Math.min(wantC, Math.max(0, autoC)));
    const rows = Math.max(0, wantR === 'auto' ? autoR : Math.min(wantR, Math.max(0, autoR)));
    const usedW = cols > 0 ? cols * fp.w + (cols - 1) * gx : 0;
    const usedH = rows > 0 ? rows * fp.h + (rows - 1) * gy : 0;
    const ax = ALIGN_X.indexOf(page.alignX) >= 0 ? page.alignX : 'left';
    const ay = ALIGN_Y.indexOf(page.alignY) >= 0 ? page.alignY : 'top';
    const spareX = Math.max(0, aw - usedW), spareY = Math.max(0, ah - usedH);
    const offX = ax === 'center' ? spareX / 2 : ax === 'right' ? spareX : 0;
    const offY = ay === 'middle' ? spareY / 2 : ay === 'bottom' ? spareY : 0;
    const cells = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++)
      cells.push({
        x: snap(ml + offX + c * (fp.w + gx)),
        y: snap(mt + offY + r * (fp.h + gy)),
        w: fp.w,
        h: fp.h,
        col: c,
        row: r
      });
    const fit = cols > 0 && rows > 0 && fp.w > 0 && fp.h > 0 && aw >= fp.w - EPS_MM && ah >= fp.h - EPS_MM;
    return {
      sheet: s, cols, rows, perPage: cols * rows, cells,
      printable: { x: ml, y: mt, w: aw, h: ah },
      used: { w: usedW, h: usedH, x: snap(ml + offX), y: snap(mt + offY) },
      gap: { x: gx, y: gy }, footprint: fp, mode, alignX: ax, alignY: ay, fit,
      auto: { cols: autoC, rows: autoR }
    };
  }

  // Split `count` records into pages -> [[recordIndex,...], ...]
  function paginate(count, perPage) {
    if (perPage < 1) return [];
    const pages = [];
    for (let i = 0; i < count; i += perPage) { const p = []; for (let j = i; j < Math.min(i + perPage, count); j++) p.push(j); pages.push(p); }
    return pages;
  }
  // Each index is emitted `copies` times in a row (two copies of label 1, then two of label 2, …).
  function sequence(indices, copies) {
    const n = Math.max(1, Math.trunc(finite(copies, 1)));
    const src = Array.isArray(indices) ? indices : [];
    if (n === 1) return src.slice();
    const out = [];
    for (let i = 0; i < src.length; i++) for (let c = 0; c < n; c++) out.push(src[i]);
    return out;
  }
  function plan(page, label, indices) {
    const lay = layout(page, label);
    const seq = sequence(indices, copiesOf(page));
    const slots = paginate(seq.length, lay.perPage);
    const pages = slots.map(slot => slot.map((seqI, cellI) => Object.assign({ index: seq[seqI], seq: seqI }, lay.cells[cellI] || {})));
    return { layout: lay, sequence: seq, pages, pageCount: pages.length, count: seq.length, copies: copiesOf(page) };
  }

  // ---- mutators (call inside Store.commit) ----
  function setPaper(page, size) {
    if (size !== 'Custom' && !SIZES[size]) return page;
    page.size = size;
    if (size !== 'Custom') { const d = SIZES[size]; page.width = d[0]; page.height = d[1]; }
    return page;
  }
  function setCustomSize(page, w, h) {
    page.size = 'Custom';
    page.width = snap(w); page.height = snap(h);
    return page;
  }
  function setOrientation(page, orientation) {
    if (orientation !== 'portrait' && orientation !== 'landscape') return page;
    page.orientation = orientation;
    return page;
  }
  function setMargin(page, side, mm) { if (SIDES.indexOf(side) >= 0) page.margin[side] = snap(Math.max(0, mm)); return page; }
  function setGap(page, axis, mm) { page.gap[axis === 'y' ? 'y' : 'x'] = snap(Math.max(0, mm)); return page; }
  function setColumns(page, v) { page.columns = gridCap(v); return page; }
  function setRows(page, v) { page.rows = gridCap(v); return page; }
  function setAlign(page, axis, value) {
    if (axis === 'x' && ALIGN_X.indexOf(value) >= 0) page.alignX = value;
    if (axis === 'y' && ALIGN_Y.indexOf(value) >= 0) page.alignY = value;
    return page;
  }
  function setLayout(page, mode, label) {
    if (LAYOUTS.indexOf(mode) < 0) return page;
    page.layout = mode;
    if (mode === 'single') { page.columns = 1; page.rows = 1; }
    else if (mode === 'sheet') { page.columns = 'auto'; page.rows = 'auto'; }
    else if (mode === 'continuous') { page.columns = page.columns === 'auto' ? 1 : page.columns; page.rows = 'auto'; }
    else if (mode === 'thermal') {
      page.columns = 1; page.rows = 1;
      page.margin = { top: 0, right: 0, bottom: 0, left: 0 };
      if (label) {
        page.size = 'Custom';
        const a = Math.min(label.width, label.height), b = Math.max(label.width, label.height);
        page.width = snap(a); page.height = snap(b);
        page.orientation = label.orientation === 'landscape' ? 'landscape' : 'portrait';
      }
    }
    return page;
  }
  function setScale(page, v) { page.scale = snap(Math.min(MAX_SCALE, Math.max(MIN_SCALE, v))); return page; }
  function setCopies(page, v) { const n = Math.trunc(Number(v)); page.copies = Math.min(MAX_COPIES, Math.max(1, isFinite(n) ? n : 1)); return page; } // accepts typed text ("2") as well as numbers
  function setScope(page, v) { page.scope = v === 'selected' ? 'selected' : 'all'; return page; }

  function validateSize(mm) {
    return typeof mm === 'number' && isFinite(mm) && mm >= MIN_MM && mm <= MAX_MM ? null : { code: 'size', min: MIN_MM, max: MAX_MM };
  }
  function validateNonNeg(mm, max) {
    max = max == null ? MAX_MM : max;
    return typeof mm === 'number' && isFinite(mm) && mm >= 0 && mm <= max ? null : { code: 'range', min: 0, max };
  }
  function validateScale(v) {
    return typeof v === 'number' && isFinite(v) && v >= MIN_SCALE && v <= MAX_SCALE ? null : { code: 'scale', min: MIN_SCALE, max: MAX_SCALE };
  }
  function validateCopies(v) {
    const n = Math.trunc(Number(v));
    return n >= 1 && n <= MAX_COPIES ? null : { code: 'copies', min: 1, max: MAX_COPIES };
  }
  function validateGrid(v) {
    if (v === 'auto' || v == null || v === '') return null;
    const n = Math.trunc(Number(v));
    return n >= 1 && n <= MAX_GRID ? null : { code: 'grid', min: 1, max: MAX_GRID };
  }

  function normalize(page) {
    page = page || {};
    const size = page.size && (page.size === 'Custom' || SIZES[page.size]) ? page.size : 'A4';
    const d = paperDims(size, page.width, page.height);
    page.size = size;
    page.width = size === 'Custom'
      ? (validateSize(page.width) ? Math.min(MAX_MM, Math.max(MIN_MM, finite(page.width, 210))) : snap(page.width))
      : d.w;
    page.height = size === 'Custom'
      ? (validateSize(page.height) ? Math.min(MAX_MM, Math.max(MIN_MM, finite(page.height, 297))) : snap(page.height))
      : d.h;
    page.orientation = page.orientation === 'landscape' ? 'landscape' : 'portrait';
    const m = page.margin && typeof page.margin === 'object' ? page.margin : {};
    page.margin = {};
    SIDES.forEach(s => { page.margin[s] = Math.max(0, finite(m[s], 10)); });
    const g = page.gap && typeof page.gap === 'object' ? page.gap : {};
    page.gap = { x: Math.max(0, finite(g.x, 2)), y: Math.max(0, finite(g.y, 2)) };
    page.columns = gridCap(page.columns);
    page.rows = gridCap(page.rows);
    page.alignX = ALIGN_X.indexOf(page.alignX) >= 0 ? page.alignX : 'left';
    page.alignY = ALIGN_Y.indexOf(page.alignY) >= 0 ? page.alignY : 'top';
    page.layout = layoutMode(page);
    page.scale = scaleOf(page);
    page.copies = copiesOf(page);
    page.scope = page.scope === 'selected' ? 'selected' : 'all';
    page.cropMarks = !!page.cropMarks;
    return page;
  }

  MARQ.PrintPlanner = {
    SIZES, PAPERS, LAYOUTS, ALIGN_X, ALIGN_Y, SIDES,
    MIN_MM, MAX_MM, MIN_SCALE, MAX_SCALE, MAX_COPIES, MAX_GRID,
    sheet, layout, paginate, sequence, plan, footprint, paperDims, orientSheet,
    setPaper, setCustomSize, setOrientation, setMargin, setGap, setColumns, setRows,
    setAlign, setLayout, setScale, setCopies, setScope, normalize,
    validateSize, validateNonNeg, validateScale, validateCopies, validateGrid
  };
  // Print pipeline (implemented in the print stage): build #print-root with one <section class="sheet"> per page
  // (CSS mm sizes + @page), each label rendered by MARQ.Renderer into a 300-600 dpi canvas -> <img>, then window.print().
})(window.MARQ = window.MARQ || {});
