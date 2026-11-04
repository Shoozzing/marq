// Run: NODE_PATH=$(npm root -g) node tests/browser-test-stage09.js   (needs playwright + chromium)
// Stage 09: print configuration UI — paper / label / margins / layout / print settings and millimetre-accurate preview.
const { chromium } = require('playwright'); const path = require('path');
const URL = 'file://' + path.resolve(__dirname, '../index.html');
let fails = 0; const t = (n, c, extra) => { console.log(c ? 'ok  ' : 'FAIL', n, c || extra === undefined ? '' : '-> ' + JSON.stringify(extra)); if (!c) fails++; };
const settle = pg => pg.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
const near = (a, b, e) => Math.abs(a - b) < e;

(async () => {
  const browser = await chromium.launch(), ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } }), pg = await ctx.newPage(), errors = [];
  pg.on('pageerror', e => errors.push(e.message)); pg.on('console', m => { if (m.type() === 'error' && !/ERR_FILE_NOT_FOUND|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await pg.goto(URL); await pg.evaluate(() => localStorage.clear()); await pg.reload(); await settle(pg);

  const open = async () => { await pg.click('#btn-print'); await settle(pg); await settle(pg); };
  const close = async () => { await pg.evaluate(() => document.getElementById('modal').close()); await settle(pg); };
  const last = () => pg.evaluate(() => JSON.parse(JSON.stringify(MARQ.PrintConfig.last)));
  const pageState = () => pg.evaluate(() => JSON.parse(JSON.stringify(MARQ.Store.state.project.page)));
  const labelState = () => pg.evaluate(() => JSON.parse(JSON.stringify(MARQ.Store.state.project.label)));
  const set = async (id, v) => { await pg.fill('#' + id, v); await pg.press('#' + id, 'Tab'); await settle(pg); };
  const mmPx = async (mmX, mmY) => pg.evaluate(([x, y]) => {
    const last = MARQ.PrintConfig.last, c = document.getElementById('pc-canvas'), dpr = last.dpr;
    const px = Math.round(x * last.k * dpr), py = Math.round(y * last.k * dpr);
    return Array.from(c.getContext('2d').getImageData(px, py, 1, 1).data);
  }, [mmX, mmY]);

  t('Print and Print Preview both open the setup dialog', await (async () => {
    await pg.click('#btn-pprev'); await settle(pg);
    const a = await pg.locator('#modal-title').innerText();
    await close(); await pg.click('#btn-print'); await settle(pg);
    const b = await pg.locator('#modal-title').innerText();
    return a === 'Print setup' && b === 'Print setup' && await pg.locator('#pc-canvas').count() === 1;
  })());

  let L = await last();
  t('default preview is A4 portrait 1×5 for 100×50 mm labels', L.sheet.w === 210 && L.sheet.h === 297 && L.cols === 1 && L.rows === 5 && L.perPage === 5 && L.cells[0].x === 10 && L.cells[0].y === 10, L);
  t('preview scale maps millimetres onto the canvas', L.k > 0 && near(L.cssW / L.sheet.w, L.k, 1e-6) && near(L.cssH / L.sheet.h, L.k, 1e-6), { k: L.k, cssW: L.cssW, cssH: L.cssH });
  let inside = await mmPx(10 + 50, 10 + 25), outside = await mmPx(5, 5);
  t('first label artwork is on the sheet; 5 mm from the corner is paper, not a label', inside[0] === 255 && inside[1] === 255 && inside[2] === 255 && !(outside[0] === 255 && outside[1] === 255 && outside[2] === 255 && outside[3] === 255), { inside, outside });

  await pg.selectOption('#pc-paper', 'Letter'); await settle(pg);
  L = await last(); let p = await pageState();
  t('Letter portrait sheet is 215.9 × 279.4 mm', p.size === 'Letter' && near(L.sheet.w, 215.9, 1e-6) && near(L.sheet.h, 279.4, 1e-6), L.sheet);

  await pg.click('#pc-porient button[data-v="landscape"]'); await settle(pg);
  L = await last();
  t('Letter landscape is 279.4 × 215.9 mm and still 1 column of 100×50 labels', near(L.sheet.w, 279.4, 1e-6) && near(L.sheet.h, 215.9, 1e-6) && L.cols === 2 && L.rows === 3, L);

  await pg.selectOption('#pc-paper', 'Custom'); await set('pc-pw', '80'); await set('pc-ph', '50');
  await pg.click('#pc-porient button[data-v="landscape"]'); await settle(pg);
  p = await pageState(); L = await last();
  t('custom 80 × 50 mm landscape sheet matches the typed size', p.size === 'Custom' && L.sheet.w === 80 && L.sheet.h === 50, { page: p, sheet: L.sheet });

  await pg.selectOption('#pc-paper', 'A4'); await pg.click('#pc-porient button[data-v="portrait"]'); await settle(pg);
  await set('pc-lw', '50'); await set('pc-lh', '30'); await settle(pg);
  let lab = await labelState(); L = await last();
  t('label size 50 × 30 mm updates the shared template and the sheet grid (3×8)', lab.width === 50 && lab.height === 30 && L.cols === 3 && L.rows === 8 && near(L.cells[1].x, 62, 1e-6) && near(L.cells[3].y, 42, 1e-6), { lab, cols: L.cols, rows: L.rows, c1: L.cells[1], c3: L.cells[3] });

  await set('pc-m-top', '20'); await set('pc-m-left', '15'); await set('pc-gx', '4'); await set('pc-gy', '6'); await settle(pg);
  L = await last();
  t('margins and gaps move cells in millimetres', near(L.cells[0].x, 15, 1e-6) && near(L.cells[0].y, 20, 1e-6) && near(L.cells[1].x, 15 + 50 + 4, 1e-6) && near(L.cells[L.cols].y, 20 + 30 + 6, 1e-6), L.cells[0]);

  await pg.click('#pc-ax button[data-v="center"]'); await pg.click('#pc-ay button[data-v="middle"]'); await settle(pg);
  L = await last(); p = await pageState();
  const expectX = p.margin.left + (L.printable.w - L.used.w) / 2, expectY = p.margin.top + (L.printable.h - L.used.h) / 2;
  t('centre alignment matches leftover space', near(L.cells[0].x, expectX, 1e-4) && near(L.cells[0].y, expectY, 1e-4), { got: L.cells[0], expectX, expectY });

  await pg.selectOption('#pc-layout', 'single'); await settle(pg);
  L = await last();
  t('single label layout is 1 per sheet', L.mode === 'single' && L.perPage === 1 && L.cols === 1 && L.rows === 1, L);

  await pg.selectOption('#pc-layout', 'continuous'); await settle(pg);
  L = await last();
  t('continuous layout is one column', L.mode === 'continuous' && L.cols === 1 && L.rows >= 1, L);

  await pg.selectOption('#pc-layout', 'thermal'); await settle(pg);
  L = await last(); p = await pageState(); lab = await labelState();
  t('thermal sheet equals the label, one impression, fits', p.size === 'Custom' && L.perPage === 1 && L.fit && near(L.sheet.w, lab.width, 1e-6) && near(L.sheet.h, lab.height, 1e-6), { sheet: L.sheet, lab, page: p });

  await pg.selectOption('#pc-layout', 'sheet'); await pg.selectOption('#pc-paper', 'A4'); await pg.click('#pc-porient button[data-v="portrait"]'); await settle(pg);
  await set('pc-lw', '100'); await set('pc-lh', '50'); await set('pc-m-top', '10'); await set('pc-m-left', '10'); await set('pc-m-right', '10'); await set('pc-m-bottom', '10');
  await set('pc-gx', '2'); await set('pc-gy', '2'); await pg.click('#pc-ax button[data-v="left"]'); await pg.click('#pc-ay button[data-v="top"]'); await settle(pg);
  await set('pc-scale', '50'); await settle(pg);
  L = await last();
  t('50% scale: footprint 50×25 mm, 3×10 on A4', near(L.footprint.w, 50, 1e-6) && near(L.footprint.h, 25, 1e-6) && L.cols === 3 && L.rows === 10, L);

  await set('pc-scale', '100'); await set('pc-copies', '2'); await settle(pg);
  L = await last();
  t('two copies of the template → 2 impressions, still 5 per A4 page so 1 sheet', L.copies === 2 && L.count === 2 && L.pageCount === 1, L);

  await pg.click('#pc-scope button[data-v="selected"]'); await settle(pg);
  p = await pageState();
  t('print-selected is stored on the page (generator scope)', p.scope === 'selected', p);

  await close();
  const canvasLabel = await pg.evaluate(() => { const L = MARQ.Store.state.project.label; return [L.width, L.height]; });
  t('closing print setup keeps the label size on the editor canvas', canvasLabel[0] === 100 && canvasLabel[1] === 50, canvasLabel);

  // Bulk generator: print-all vs print-selected counts
  const shim = () => { if (!window.XLSX) window.XLSX = { read: buf => ({ SheetNames: ['Assets'], Sheets: { Assets: new TextDecoder().decode(buf).trim().split(/\r?\n/).map(l => l.split(',')) } }), utils: { sheet_to_json: ws => ws } }; };
  await pg.evaluate(shim);
  const csv = ['Asset_Number,Asset_Name,Location']; for (let i = 1; i <= 12; i++) csv.push('A' + i + ',N' + i + ',L' + i);
  await pg.click('#btn-excel'); await pg.setInputFiles('#file-excel', { name: 'a.csv', mimeType: 'text/csv', buffer: Buffer.from(csv.join('\n') + '\n') });
  await pg.click('text=Import worksheet'); await settle(pg); await pg.evaluate(() => document.getElementById('modal').close()); await settle(pg);
  await pg.evaluate(() => { const d = MARQ.Data.active(); d.records.forEach((r, i) => { r.selected = i < 3; r.excluded = i === 10; }); MARQ.Data.recount(d); });
  await open();
  await pg.click('#pc-scope button[data-v="all"]'); await settle(pg);
  L = await last();
  t('print all uses generator scope (12 records minus 1 excluded = 11)', L.unique === 11, L);
  await pg.click('#pc-scope button[data-v="selected"]'); await settle(pg);
  L = await last();
  t('print selected uses generator scope (3 ticked, none of them excluded)', L.unique === 3 && L.count === 6, L); // copies still 2

  t('Send to printer is present and disabled (no window.print)', await pg.evaluate(() => {
    const b = document.getElementById('pc-print');
    return b && b.disabled && typeof window.print === 'function';
  }));

  await close();
  t('no page errors', errors.length === 0, errors);
  await browser.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
