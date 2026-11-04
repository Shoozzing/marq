// Run: NODE_PATH=$(npm root -g) node tests/browser-test-print-layout.js   (needs playwright + chromium)
// Print setup matrix: paper sizes / label sizes / margins / gaps / orientation / alignment / grid / scale / thermal / continuous / pagination.
// Expected layouts come from an independent integer-micrometre model; they are compared with (a) PrintPlanner cells and (b) the pixels the preview canvas actually drew.
const { chromium } = require('playwright'); const path = require('path');
const URL = 'file://' + path.resolve(__dirname, '../index.html');
let fails = 0, total = 0; const t = (n, c, extra) => { total++; console.log(c ? 'ok  ' : 'FAIL', n, c || extra === undefined ? '' : '-> ' + JSON.stringify(extra)); if (!c) fails++; };
const settle = pg => pg.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
const um = mm => Math.round(mm * 10000), mm = v => v / 10000; // 0.1 µm units: exact for inch-based values such as 4.7625 mm
const PAPER = { A4: [210, 297], Letter: [215.9, 279.4] };

function model(page, label) {
  const d = page.size === 'Custom' ? [page.width, page.height] : PAPER[page.size];
  let W = um(d[0]), H = um(d[1]);
  if (page.orientation === 'landscape' && W < H) [W, H] = [H, W]; if (page.orientation === 'portrait' && W > H) [W, H] = [H, W];
  const s = page.scale || 1, fw = Math.round(um(label.width) * s), fh = Math.round(um(label.height) * s), m = page.margin, g = page.gap;
  if (page.layout === 'thermal') { W = fw + um(m.left) + um(m.right); H = fh + um(m.top) + um(m.bottom); }
  const aw = W - um(m.left) - um(m.right), ah = H - um(m.top) - um(m.bottom);
  let c = Math.max(0, Math.floor((aw + um(g.x)) / (fw + um(g.x)))), r = Math.max(0, Math.floor((ah + um(g.y)) / (fh + um(g.y))));
  if (page.layout === 'single' || page.layout === 'thermal') { c = Math.min(c, 1); r = Math.min(r, 1); }
  if (page.layout === 'continuous' && page.columns === 'auto') c = Math.min(c, 1);
  if (typeof page.columns === 'number') c = Math.min(c, page.columns); if (typeof page.rows === 'number') r = Math.min(r, page.rows);
  const uw = c ? c * fw + (c - 1) * um(g.x) : 0, uh = r ? r * fh + (r - 1) * um(g.y) : 0;
  const ox = page.alignX === 'center' ? (aw - uw) / 2 : page.alignX === 'right' ? aw - uw : 0, oy = page.alignY === 'middle' ? (ah - uh) / 2 : page.alignY === 'bottom' ? ah - uh : 0;
  const cells = []; for (let i = 0; i < r; i++) for (let j = 0; j < c; j++) cells.push({ x: mm(um(m.left) + ox + j * (fw + um(g.x))), y: mm(um(m.top) + oy + i * (fh + um(g.y))), w: mm(fw), h: mm(fh) });
  return { sheet: { w: mm(W), h: mm(H) }, cols: c, rows: r, cells, used: { x: cells[0] ? cells[0].x : 0, y: cells[0] ? cells[0].y : 0, w: mm(uw), h: mm(uh) } };
}
const base = o => Object.assign({ size: 'A4', width: 210, height: 297, orientation: 'portrait', margin: { top: 10, bottom: 10, left: 10, right: 10 }, gap: { x: 2, y: 2 }, columns: 'auto', rows: 'auto', alignX: 'left', alignY: 'top', layout: 'sheet', scale: 1, copies: 1, scope: 'all' }, o);
const inch = v => Math.round(v * 25.4 * 1e4) / 1e4;
const CASES = [
  ['A4 portrait, 100×50 labels (default)', base({}), [100, 50]],
  ['A4 landscape, 100×50', base({ orientation: 'landscape' }), [100, 50]],
  ['A4, 38.1×21.2 mm (L7651-style) 5×13, tight gaps', base({ margin: { top: 10.7, bottom: 10.7, left: 4.7, right: 4.7 }, gap: { x: 2.5, y: 0 } }), [38.1, 21.2]],
  ['Letter portrait, Avery 5160 (66.675×25.4 mm, 3×10) exactly fills the sheet', base({ size: 'Letter', margin: { top: 12.7, bottom: 12.7, left: inch(0.1875), right: inch(0.1875) }, gap: { x: inch(0.125), y: 0 } }), [inch(2.625), 25.4]],
  ['Letter landscape, 2.5×1.5 in labels, 0.5 in margins', base({ size: 'Letter', orientation: 'landscape', margin: { top: 12.7, bottom: 12.7, left: 12.7, right: 12.7 }, gap: { x: 0, y: 0 } }), [inch(2.5), inch(1.5)]],
  ['Custom 150×100 mm sheet, 40×25 labels, asymmetric margins', base({ size: 'Custom', width: 150, height: 100, margin: { top: 3, bottom: 7, left: 11, right: 5 }, gap: { x: 3, y: 1.5 } }), [40, 25]],
  ['Custom 100×150 sheet set landscape → 150×100', base({ size: 'Custom', width: 100, height: 150, orientation: 'landscape' }), [30, 30]],
  ['Centre / middle alignment, 2×3 cap on A4', base({ columns: 2, rows: 3, alignX: 'center', alignY: 'middle' }), [60, 40]],
  ['Right / bottom alignment, cap 2×2', base({ columns: 2, rows: 2, alignX: 'right', alignY: 'bottom' }), [50, 50]],
  ['Manual grid larger than fits is clamped (5×9 asked, A4 60×40)', base({ columns: 5, rows: 9 }), [60, 40]],
  ['Large gaps 15×12 mm', base({ gap: { x: 15, y: 12 } }), [40, 30]],
  ['Zero margins, zero gaps (full bleed grid)', base({ margin: { top: 0, bottom: 0, left: 0, right: 0 }, gap: { x: 0, y: 0 } }), [70, 99]],
  ['Scale 50% → 3 columns of 100 mm labels shrink to 50×25', base({ scale: 0.5 }), [100, 50]],
  ['Scale 150%', base({ scale: 1.5 }), [40, 20]],
  ['Single label layout on A4', base({ layout: 'single' }), [100, 50]],
  ['Continuous layout, one column', base({ layout: 'continuous', alignX: 'center' }), [60, 30]],
  ['Continuous layout, 2 columns', base({ layout: 'continuous', columns: 2 }), [60, 30]],
  ['Thermal 100×150 shipping label', base({ layout: 'thermal', size: 'Custom', margin: { top: 0, bottom: 0, left: 0, right: 0 } }), [100, 150]],
  ['Thermal 57×32 mm receipt-roll label', base({ layout: 'thermal', size: 'Custom', margin: { top: 0, bottom: 0, left: 0, right: 0 } }), [57, 32]],
  ['Thermal with 2 mm margins', base({ layout: 'thermal', size: 'Custom', margin: { top: 2, bottom: 2, left: 2, right: 2 } }), [50, 30]],
  ['Label larger than the sheet → nothing placed', base({ size: 'Custom', width: 80, height: 50 }), [120, 70]]
];

(async () => {
  const browser = await chromium.launch(), ctx = await browser.newContext({ viewport: { width: 1700, height: 1200 } }), pg = await ctx.newPage(), errors = [];
  pg.on('pageerror', e => errors.push(e.message)); pg.on('console', m => { if (m.type() === 'error' && !/ERR_FILE_NOT_FOUND|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await pg.goto(URL); await pg.evaluate(() => localStorage.clear()); await pg.reload(); await settle(pg);
  await pg.click('#btn-print'); await settle(pg);
  const last = () => pg.evaluate(() => JSON.parse(JSON.stringify(MARQ.PrintConfig.last)));
  const near = (a, b, e) => Math.abs(a - b) <= e;

  for (const [name, page, lab] of CASES) {
    await pg.evaluate(([p, l]) => { MARQ.Store.commit('t', s => { Object.assign(s.project.page, p); Object.assign(s.project.label, { width: l[0], height: l[1] }); }); }, [page, lab]);
    await settle(pg);
    const L = await last(), M = model(page, { width: lab[0], height: lab[1] });
    const geomOk = near(L.sheet.w, M.sheet.w, .002) && near(L.sheet.h, M.sheet.h, .002) && L.cols === M.cols && L.rows === M.rows && L.cells.length === M.cells.length
      && L.cells.every((c, i) => near(c.x, M.cells[i].x, .002) && near(c.y, M.cells[i].y, .002) && near(c.w, M.cells[i].w, .002) && near(c.h, M.cells[i].h, .002));
    t(name + ' — grid ' + M.cols + '×' + M.rows + ', sheet ' + M.sheet.w + '×' + M.sheet.h + ' mm: numbers match exact model', geomOk, { got: [L.sheet, L.cols, L.rows, L.cells[0]], want: [M.sheet, M.cols, M.rows, M.cells[0]] });

    // pixels: what the preview really drew
    const px = await pg.evaluate(() => {
      const c = document.getElementById('pc-canvas'), g = c.getContext('2d'), d = g.getImageData(0, 0, c.width, c.height), L = MARQ.PrintConfig.last;
      const isLabel = (r, gg, b) => (r >= 244 && gg >= 244 && b >= 244) || (Math.abs(r - 232) < 5 && Math.abs(gg - 242) < 5 && Math.abs(b - 196) < 5) || (Math.abs(r - 61) < 30 && Math.abs(gg - 74) < 30 && Math.abs(b - 42) < 30);
      let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) { const i = (y * c.width + x) * 4; if (isLabel(d.data[i], d.data[i + 1], d.data[i + 2])) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
      const at = (mx, my) => { const i = (Math.round(my * L.k * L.dpr) * c.width + Math.round(mx * L.k * L.dpr)) * 4; return [d.data[i], d.data[i + 1], d.data[i + 2]]; };
      return { cw: c.width, ch: c.height, css: [parseFloat(c.style.width), parseFloat(c.style.height)], k: L.k, dpr: L.dpr, bbox: [x0, y0, x1 + 1, y1 + 1], centres: L.cells.map(cl => at(cl.x + cl.w / 2, cl.y + cl.h / 2)), L };
    });
    const k = px.k * px.dpr;
    t('   preview canvas keeps the sheet aspect ratio (' + (M.sheet.w / M.sheet.h).toFixed(4) + ')', near(px.css[0] / px.css[1], M.sheet.w / M.sheet.h, 0.003), px.css);
    if (M.cells.length) {
      const ex = [M.used.x * k, M.used.y * k, (M.used.x + M.used.w) * k, (M.used.y + M.used.h) * k], tol = 1.6;
      t('   drawn labels occupy exactly the expected box (px ±1.6 = ±' + (tol / k).toFixed(2) + ' mm)', px.bbox.every((v, i) => near(v, ex[i], tol)), { got: px.bbox, want: ex.map(v => +v.toFixed(1)) });
      t('   every cell centre is label, not paper', px.centres.every(c => !(Math.abs(c[0] - 223) < 4 && Math.abs(c[1] - 227) < 4 && Math.abs(c[2] - 234) < 4)), px.centres.slice(0, 3));
    } else {
      t('   no cells drawn and the "does not fit" warning is shown', px.bbox[2] <= 0 && /does not fit/.test(await pg.locator('#pc-warn').innerText()), px.bbox);
    }
  }

  // ---- real UI entry in inches: Avery 5160 typed by hand, stored as exact millimetres ----
  await pg.selectOption('#pc-unit', 'in'); await settle(pg);
  const set = async (id, v) => { await pg.fill('#' + id, v); await pg.press('#' + id, 'Tab'); await settle(pg); };
  await pg.selectOption('#pc-paper', 'Letter'); await pg.selectOption('#pc-layout', 'sheet'); await settle(pg);
  await pg.click('#pc-porient button[data-v="portrait"]'); await settle(pg);
  await set('pc-lw', '2.625'); await set('pc-lh', '1'); await set('pc-m-top', '0.5'); await set('pc-m-bottom', '0.5'); await set('pc-m-left', '0.1875'); await set('pc-m-right', '0.1875'); await set('pc-gx', '0.125'); await set('pc-gy', '0');
  await pg.fill('#pc-cols', 'auto'); await pg.press('#pc-cols', 'Tab'); await pg.fill('#pc-rows', 'auto'); await pg.press('#pc-rows', 'Tab'); await settle(pg);
  const st = await pg.evaluate(() => JSON.parse(JSON.stringify({ p: MARQ.Store.state.project.page, l: MARQ.Store.state.project.label })));
  let L = await last();
  t('inch entry is stored in exact mm (2.625 in = 66.675, 0.1875 in = 4.7625)', near(st.l.width, 66.675, 1e-4) && near(st.l.height, 25.4, 1e-4) && near(st.p.margin.left, 4.7625, 1e-4) && near(st.p.gap.x, 3.175, 1e-4), st);
  t('Avery 5160 typed in inches gives 3 × 10 = 30 labels per Letter sheet', L.cols === 3 && L.rows === 10 && L.perPage === 30, [L.cols, L.rows]);
  t('first / last cell origins: (4.7625, 12.7) and (143.5125, 241.3)', near(L.cells[0].x, 4.7625, 1e-3) && near(L.cells[0].y, 12.7, 1e-3) && near(L.cells[29].x, 4.7625 + 2 * (66.675 + 3.175), 1e-3) && near(L.cells[29].y, 12.7 + 9 * 25.4, 1e-3), [L.cells[0], L.cells[29]]);
  t('fields display inches (paper Letter shows 8.5 × 11)', (await pg.inputValue('#pc-pw')) === '8.5' && (await pg.inputValue('#pc-ph')) === '11', [await pg.inputValue('#pc-pw'), await pg.inputValue('#pc-ph')]);
  await pg.selectOption('#pc-unit', 'mm'); await settle(pg);

  // ---- invalid input is rejected, state unchanged ----
  const before = await pg.evaluate(() => JSON.stringify(MARQ.Store.state.project.page));
  await set('pc-gx', '-3'); await set('pc-m-top', '99999'); await set('pc-copies', '0'); await set('pc-scale', '5000');
  t('negative gap / absurd margin / 0 copies / 5000% scale are all rejected', (await pg.evaluate(() => JSON.stringify(MARQ.Store.state.project.page))) === before);

  // ---- thermal tracks the label; paper controls lock ----
  await pg.evaluate(() => { MARQ.Store.commit('t', s => { Object.assign(s.project.label, { width: 100, height: 150 }); }); });
  await pg.selectOption('#pc-layout', 'thermal'); await settle(pg);
  L = await last();
  t('thermal: sheet equals the 100×150 label and paper controls are locked', near(L.sheet.w, 100, 1e-3) && near(L.sheet.h, 150, 1e-3) && (await pg.isDisabled('#pc-paper')) && (await pg.isDisabled('#pc-pw')), L.sheet);
  await set('pc-lw', '60'); await set('pc-lh', '40'); L = await last();
  t('thermal: editing the label to 60×40 resizes the sheet to 60×40 (was stuck at the old size)', near(L.sheet.w, 60, 1e-3) && near(L.sheet.h, 40, 1e-3) && L.perPage === 1 && L.fit, L.sheet);
  await set('pc-lw', '150'); await set('pc-lh', '100'); L = await last();
  t('thermal: growing the label to 150×100 still fits', near(L.sheet.w, 150, 1e-3) && L.fit, L.sheet);
  t('thermal: the label orientation toggle swaps 150×100 → 100×150 and the sheet follows', await (async () => { await pg.click('#pc-lorient button[data-v="portrait"]'); await settle(pg); const l = await last(); return near(l.sheet.w, 100, 1e-3) && near(l.sheet.h, 150, 1e-3); })());
  await pg.selectOption('#pc-layout', 'sheet'); await settle(pg);
  t('back to multi-label sheet re-enables the paper controls', !(await pg.isDisabled('#pc-paper')));

  // ---- bulk generator: pagination, copies, scope ----
  await pg.evaluate(() => { if (!window.XLSX) window.XLSX = { read: buf => ({ SheetNames: ['Assets'], Sheets: { Assets: new TextDecoder().decode(buf).trim().split(/\r?\n/).map(l => l.split(',')) } }), utils: { sheet_to_json: ws => ws } }; });
  const csv = ['Asset_Number,Asset_Name,Location']; for (let i = 1; i <= 23; i++) csv.push('A' + i + ',N' + i + ',L' + i);
  await pg.evaluate(() => document.getElementById('modal').close()); await settle(pg);
  await pg.click('#btn-excel'); await pg.setInputFiles('#file-excel', { name: 'a.csv', mimeType: 'text/csv', buffer: Buffer.from(csv.join('\n') + '\n') });
  await pg.click('text=Import worksheet'); await settle(pg); await pg.evaluate(() => document.getElementById('modal').close()); await settle(pg);
  await pg.evaluate(() => { MARQ.Store.commit('t', s => { Object.assign(s.project.label, { width: 100, height: 50 }); Object.assign(s.project.page, { size: 'A4', width: 210, height: 297, orientation: 'portrait', layout: 'sheet', columns: 'auto', rows: 'auto', scale: 1, copies: 1, scope: 'all', margin: { top: 10, bottom: 10, left: 10, right: 10 }, gap: { x: 2, y: 2 } }); }); });
  await pg.click('#btn-print'); await settle(pg); await settle(pg);
  L = await last();
  t('bulk: 23 records on A4 (5 per sheet) = 5 sheets', L.count === 23 && L.pageCount === 5 && L.perPage === 5, [L.count, L.pageCount, L.perPage]);
  await set('pc-copies', '2'); L = await last();
  t('bulk: 2 copies → 46 impressions, 10 sheets, copies stay together (0,0,1,1,…)', L.count === 46 && L.pageCount === 10 && L.sequence.slice(0, 6).join() === '0,0,1,1,2,2', [L.count, L.pageCount, L.sequence.slice(0, 6)]);
  await set('pc-copies', '1');
  for (let i = 0; i < 4; i++) await pg.click('#pc-next'); await settle(pg); L = await last();
  t('bulk: last sheet shows "Sheet 5 of 5" with 3 labels; next is disabled', L.pageIndex === 4 && (await pg.locator('#pc-page').innerText()) === 'Sheet 5 of 5' && (await pg.isDisabled('#pc-next')), [L.pageIndex]);
  const emptyPx = await pg.evaluate(() => { const c = document.getElementById('pc-canvas'), L = MARQ.PrintConfig.last, cl = L.cells[3]; const i = (Math.round((cl.y + cl.h / 2) * L.k * L.dpr) * c.width + Math.round((cl.x + cl.w / 2) * L.k * L.dpr)) * 4; return Array.from(c.getContext('2d').getImageData(0, 0, c.width, c.height).data.slice(i, i + 3)); });
  t('bulk: unused slots on the last sheet are drawn as empty (not as repeated labels)', Math.abs(emptyPx[0] - 232) < 5 && Math.abs(emptyPx[1] - 242) < 5 && Math.abs(emptyPx[2] - 196) < 5, emptyPx);
  await pg.evaluate(() => { const d = MARQ.Data.active(); d.records.forEach((r, i) => { r.selected = i % 2 === 0; r.excluded = false; }); MARQ.Data.recount(d); });
  await pg.click('#pc-scope button[data-v="selected"]'); await settle(pg); L = await last();
  t('bulk: print selected = 12 ticked rows (every other of 23)', L.unique === 12 && L.count === 12 && L.pageCount === 3, [L.unique, L.count, L.pageCount]);
  await set('pc-scale', '50'); L = await last();
  t('bulk: 50% scale puts 3×10 = 30 per sheet, so 12 labels need 1 sheet', L.perPage === 30 && L.pageCount === 1, [L.perPage, L.pageCount]);
  const orig = await pg.evaluate(() => [MARQ.Store.state.project.label.width, MARQ.Store.state.project.label.height]);
  t('print scale never modifies the label design itself (still 100×50 in the editor)', orig[0] === 100 && orig[1] === 50, orig);
  t('no page errors during the whole matrix', errors.length === 0, errors.slice(0, 3));
  console.log('\n' + (total - fails) + '/' + total + ' passed'); await browser.close(); process.exit(fails ? 1 : 0);
})();
