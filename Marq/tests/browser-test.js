// Run: NODE_PATH=$(npm root -g) node tests/browser-test.js   (needs playwright + a chromium build)
// Verifies the real page: UI wiring, physical accuracy (measured from canvas pixels), rulers, margins, persistence.
const { chromium } = require('playwright'); const path = require('path'), fs = require('fs');
const URL = 'file://' + path.resolve(__dirname, '../index.html');
let fails = 0; const t = (n, c, extra) => { console.log(c ? 'ok  ' : 'FAIL', n, c || extra === undefined ? '' : '-> ' + JSON.stringify(extra)); if (!c) fails++; };
const within = (a, b, tol) => Math.abs(a - b) <= tol;

// ---- in-page helpers (run in the browser) ----
const settle = pg => pg.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))); // canvas + rulers repaint on rAF
const scan = async (pg, axis) => { await settle(pg); return pg.evaluate(a => { // longest run of pure-white pixels through the label centre = label size on screen (CSS px)
  const c = document.getElementById('editor-canvas'), d = c.getContext('2d'), dpr = devicePixelRatio, v = MARQ.Store.state.app.view, L = MARQ.Store.state.project.label, k = MARQ.Viewport.PX_PER_MM * v.zoom;
  const horiz = a === 'x', fixed = Math.round(((horiz ? Math.round(v.panY) + L.height * k / 2 : Math.round(v.panX) + L.width * k / 2)) * dpr);
  const n = horiz ? c.width : c.height, data = horiz ? d.getImageData(0, fixed, n, 1).data : d.getImageData(fixed, 0, 1, n).data;
  let best = 0, run = 0, start = 0, bs = 0;
  for (let i = 0; i < n; i++) { const w = data[i * 4] === 255 && data[i * 4 + 1] === 255 && data[i * 4 + 2] === 255; if (w) { if (!run) start = i; run++; if (run > best) { best = run; bs = start; } } else run = 0; }
  return { len: best / dpr, start: bs / dpr };
}, axis); };
const px = async (pg, x, y) => { await settle(pg); return pg.evaluate(([x, y]) => { const c = document.getElementById('editor-canvas'); return Array.from(c.getContext('2d').getImageData(Math.round(x * devicePixelRatio), Math.round(y * devicePixelRatio), 1, 1).data); }, [x, y]); };
const view = pg => pg.evaluate(() => { const v = MARQ.Store.state.app.view, L = MARQ.Store.state.project.label; return { zoom: v.zoom, panX: Math.round(v.panX), panY: Math.round(v.panY), fitted: v.fitted, k: MARQ.Viewport.PX_PER_MM * v.zoom, L }; });
const lbl = pg => pg.evaluate(() => JSON.parse(JSON.stringify(MARQ.Store.state.project.label)));
const hasColor = async (pg, [x0, y0, x1, y1], test) => { await settle(pg); return pg.evaluate(([r, src]) => { const c = document.getElementById(r[4]), d = c.getContext('2d'), dpr = devicePixelRatio, f = new Function('p', 'return ' + src);
  const w = Math.max(1, Math.round((r[2] - r[0]) * dpr)), h = Math.max(1, Math.round((r[3] - r[1]) * dpr)), data = d.getImageData(Math.round(r[0] * dpr), Math.round(r[1] * dpr), w, h).data;
  for (let i = 0; i < data.length; i += 4) if (f([data[i], data[i + 1], data[i + 2]])) return true; return false; }, [[x0, y0, x1, y1, test.canvas || 'editor-canvas'], test.src]); };

(async () => {
  const b = await chromium.launch(); const errs = [];
  async function open(opts) {
    const ctx = await b.newContext(Object.assign({ viewport: { width: 1280, height: 760 }, acceptDownloads: true }, opts || {}));
    const pg = await ctx.newPage(); pg.on('pageerror', e => errs.push(e.message));
    pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
    await pg.goto(URL); await pg.waitForTimeout(150); return pg;
  }
  const pg = await open(), txt = async id => { await settle(pg); return pg.locator('#' + id).innerText(); }, val = id => pg.inputValue('#' + id);
  const set = async (id, v) => { await pg.fill('#' + id, v); await pg.press('#' + id, 'Tab'); };
  await pg.click('#btn-grid'); // grid off for clean pixel measurements

  // ---------- boot ----------
  t('title', (await pg.title()).includes('Marq'));
  t('default label 100 × 50 mm', (await txt('st-size')).includes('100 mm') && (await val('label-w')) === '100' && (await val('label-h')) === '50');
  t('preset select shows 100 × 50', (await val('label-preset')) === '100x50');
  t('orientation = landscape', (await pg.getAttribute('#orient-landscape', 'aria-pressed')) === 'true' && (await pg.getAttribute('#orient-portrait', 'aria-pressed')) === 'false');

  // ---------- physical accuracy @100% (measured from pixels) ----------
  await pg.click('#btn-zoom-100');
  let sx = await scan(pg, 'x'), sy = await scan(pg, 'y');
  t('100mm @100% = 377.95 css px', within(sx.len, 377.95, 1.6), sx);
  t('50mm @100% = 188.98 css px', within(sy.len, 188.98, 1.6), sy);
  await pg.selectOption('#unit-select', 'in'); await set('label-w', '3'); await set('label-h', '1.5'); await pg.click('#btn-zoom-100');
  sx = await scan(pg, 'x'); sy = await scan(pg, 'y');
  t('3in @100% = 288px, 1.5in = 144px', within(sx.len, 288, 1.6) && within(sy.len, 144, 1.6), [sx, sy]);
  await pg.selectOption('#unit-select', 'px'); await set('label-w', '400'); await set('label-h', '200'); await pg.click('#btn-zoom-100');
  sx = await scan(pg, 'x'); sy = await scan(pg, 'y');
  t('400px × 200px @100% = exactly 400 × 200 css px', within(sx.len, 400, 1.6) && within(sy.len, 200, 1.6), [sx, sy]);
  await pg.selectOption('#unit-select', 'cm'); await set('label-w', '8'); await set('label-h', '4'); await pg.click('#btn-zoom-100');
  sx = await scan(pg, 'x'); t('8cm @100% = 302.36px', within(sx.len, 302.36, 1.6), sx);
  t('cm entry stored as mm', (await lbl(pg)).width === 80 && (await lbl(pg)).height === 40);
  await pg.selectOption('#unit-select', 'mm');

  // ---------- presets + proportions at Fit ----------
  const cases = [['50x30', 'landscape', 50, 30], ['60x40', 'landscape', 60, 40], ['70x50', 'landscape', 70, 50], ['100x50', 'landscape', 100, 50], ['A4', 'portrait', 210, 297], ['A4', 'landscape', 297, 210], ['50x30', 'portrait', 30, 50]];
  for (const [id, o, w, h] of cases) {
    await pg.click('#orient-' + o); await pg.selectOption('#label-preset', id); await pg.click('#btn-fit');
    const L = await lbl(pg), x = await scan(pg, 'x'), y = await scan(pg, 'y');
    t(`preset ${id} ${o}: model ${w}×${h}`, L.width === w && L.height === h && L.orientation === o && L.preset === id, L);
    t(`preset ${id} ${o}: pixel aspect = ${w}:${h}`, within(x.len / y.len, w / h, w / h * 0.02), [x, y]);
    t(`preset ${id} ${o}: inputs show ${w} × ${h}`, (await val('label-w')) === String(w) && (await val('label-h')) === String(h));
  }
  await pg.selectOption('#label-preset', '100x50'); await pg.click('#orient-landscape');

  // ---------- orientation toggle ----------
  await pg.selectOption('#label-preset', '60x40'); await pg.click('#orient-portrait');
  let L = await lbl(pg); t('portrait swaps to 40 × 60', L.width === 40 && L.height === 60 && L.orientation === 'portrait');
  t('portrait button pressed', (await pg.getAttribute('#orient-portrait', 'aria-pressed')) === 'true');
  await pg.click('#orient-landscape'); L = await lbl(pg); t('landscape swaps to 60 × 40', L.width === 60 && L.height === 40);
  await set('label-w', '30'); await set('label-h', '90'); L = await lbl(pg);
  t('typing taller than wide flips orientation + preset=custom', L.orientation === 'portrait' && L.preset === 'custom' && (await val('label-preset')) === 'custom');
  await set('label-w', '60'); await set('label-h', '40'); t('typing a preset size selects that preset', (await val('label-preset')) === '60x40');
  await pg.selectOption('#label-preset', 'custom'); t('choosing Custom focuses width and keeps size', (await pg.evaluate(() => document.activeElement.id)) === 'label-w' && (await val('label-preset')) === 'custom' && (await lbl(pg)).width === 60);
  await pg.selectOption('#label-preset', '100x50');

  // ---------- validation ----------
  await set('label-w', 'abc'); t('invalid width rejected + field restored', (await txt('status-msg')).includes('Enter a size') && (await val('label-w')) === '100');
  await set('label-w', '5000'); t('too large rejected', (await txt('status-msg')).includes('Enter a size') && (await lbl(pg)).width === 100);
  await set('label-w', '0'); t('zero rejected', (await lbl(pg)).width === 100);
  await set('label-w', '10cm'); t('unit suffix honoured (10cm = 100mm)', (await lbl(pg)).width === 100);
  await set('label-w', '2,5in'); t('decimal comma + suffix (2,5in = 63.5mm)', within((await lbl(pg)).width, 63.5, 1e-6));
  await pg.click('#btn-undo'); t('undo restores size', (await lbl(pg)).width === 100);
  await pg.click('#btn-redo'); t('redo reapplies', within((await lbl(pg)).width, 63.5, 1e-6)); await pg.click('#btn-undo');

  // ---------- background + border ----------
  await pg.click('#btn-fit'); let vw = await view(pg);
  await pg.fill('#label-bg', '#ffee00'); L = await lbl(pg); t('background stored', L.background === '#ffee00');
  let p = await px(pg, vw.panX + 30, vw.panY + 30); t('canvas paints background colour', p[0] === 255 && p[1] === 238 && p[2] === 0, p);
  await pg.fill('#label-bg', '#ffffff');
  await set('label-border-w', '2'); await pg.fill('#label-border-color', '#cc0000'); vw = await view(pg);
  p = await px(pg, vw.panX + 3, vw.panY + vw.L.height * vw.k / 2); t('border drawn in border colour (2mm)', p[0] === 204 && p[1] === 0 && p[2] === 0, p);
  p = await px(pg, vw.panX + 2 * vw.k + 4, vw.panY + vw.L.height * vw.k / 2); t('inside the border is background', p[0] === 255 && p[1] === 255, p);
  await set('label-border-w', '30'); t('oversized border rejected', (await txt('status-msg')).includes('Border must be') && (await lbl(pg)).borderWidth === 2);
  await set('label-border-w', '0');

  // ---------- margins ----------
  await set('m-top', '5'); await set('m-bottom', '4'); await set('m-left', '3'); await set('m-right', '6'); L = await lbl(pg);
  t('4 margins stored (mm)', L.margin.top === 5 && L.margin.bottom === 4 && L.margin.left === 3 && L.margin.right === 6, L.margin);
  vw = await view(pg);
  const guide = (src, box) => hasColor(pg, box, { src });
  t('top margin guide drawn at 5mm', await guide('Math.abs(p[0]-224)<12&&Math.abs(p[1]-69)<12&&Math.abs(p[2]-123)<12', [vw.panX + 20 * vw.k, vw.panY + 5 * vw.k - 1, vw.panX + 90 * vw.k, vw.panY + 5 * vw.k + 2]));
  t('NOT drawn where there is no margin guide (1mm)', !(await guide('Math.abs(p[0]-224)<12&&Math.abs(p[1]-69)<12&&Math.abs(p[2]-123)<12', [vw.panX + 20 * vw.k, vw.panY + 1 * vw.k - 1, vw.panX + 90 * vw.k, vw.panY + 1 * vw.k + 1])));
  t('ruler shows margin markers', await hasColor(pg, [vw.panX + 3 * vw.k - 5, 8, vw.panX + 3 * vw.k + 5, 22], { canvas: 'ruler-h', src: 'Math.abs(p[0]-224)<14&&Math.abs(p[1]-69)<14&&Math.abs(p[2]-123)<14' }));
  await pg.selectOption('#unit-select', 'in'); t('margins shown in inches', (await val('m-top')) === '0.1969' && (await val('m-left')) === '0.1181');
  await set('m-top', '0.5in'); t('margin typed in inches stored as mm', within((await lbl(pg)).margin.top, 12.7, 1e-6));
  await pg.selectOption('#unit-select', 'mm');
  await set('m-top', '49'); t('margin that leaves < 1mm rejected', (await txt('status-msg')).includes('Margin must be') && within((await lbl(pg)).margin.top, 12.7, 1e-6));
  await set('m-top', '-2'); t('negative margin rejected', within((await lbl(pg)).margin.top, 12.7, 1e-6));
  await set('m-left', '60'); await set('m-right', '50'); t('left+right cannot swallow the label', (await lbl(pg)).margin.left + (await lbl(pg)).margin.right <= 99);
  await pg.click('#orient-portrait'); L = await lbl(pg); t('margins survive orientation change', L.margin.top === 12.7 || within(L.margin.top, 12.7, 1e-6));
  await pg.click('#orient-landscape');
  for (const s of ['top', 'bottom', 'left', 'right']) await set('m-' + s, '0');

  // ---------- grid ----------
  await pg.click('#btn-fit'); vw = await view(pg);
  t('grid starts hidden here', (await pg.getAttribute('#btn-grid', 'aria-pressed')) === 'false');
  const gridBox = [vw.panX + 5 * vw.k - 1, vw.panY + 8, vw.panX + 5 * vw.k + 2, vw.panY + 30], isGrid = 'p[2]>p[0]+20';
  t('no grid line while off', !(await guide(isGrid, gridBox)));
  await pg.click('#btn-grid'); t('grid on', (await pg.getAttribute('#btn-grid', 'aria-pressed')) === 'true' && await guide(isGrid, gridBox));
  await set('grid-size', '10'); t('grid spacing 10mm: no line at 5mm', !(await guide(isGrid, [vw.panX + 5 * vw.k - 1, vw.panY + 8, vw.panX + 5 * vw.k + 1, vw.panY + 30])) && await guide(isGrid, [vw.panX + 10 * vw.k - 1, vw.panY + 8, vw.panX + 10 * vw.k + 2, vw.panY + 30]));
  await set('grid-size', '0'); t('grid spacing 0 rejected', (await txt('status-msg')).includes('Grid size'));
  await set('grid-size', '5'); await pg.click('#btn-grid');

  // ---------- zoom / fit ----------
  await pg.click('#btn-fit'); vw = await view(pg);
  const box = await pg.locator('#canvas-wrap').boundingBox(), lw = vw.L.width * vw.k, lh = vw.L.height * vw.k;
  t('fit: label fully inside viewport', vw.panX >= 0 && vw.panY >= 0 && vw.panX + lw <= box.width && vw.panY + lh <= box.height, [vw, box]);
  t('fit: label centred', within(vw.panX * 2 + lw, box.width, 2) && within(vw.panY * 2 + lh, box.height, 2));
  t('fit: label as large as possible (touches one axis padding)', within(Math.min(box.width - lw, box.height - lh), 80, 2));
  const z0 = vw.zoom; await pg.click('#btn-zoom-in'); let v2 = await view(pg); t('zoom in ×1.25', within(v2.zoom, z0 * 1.25, 1e-9) && !v2.fitted);
  await pg.click('#btn-zoom-out'); await pg.click('#btn-zoom-out'); v2 = await view(pg); t('zoom out ×0.8 twice (net 0.8)', within(v2.zoom, z0 * 1.25 * 0.64, 1e-9));
  await pg.click('#btn-zoom-100'); t('100% button', (await txt('zoom-label')) === '100%');
  await pg.click('#editor-canvas'); await pg.keyboard.press('Control+Equal'); t('Ctrl + zooms in', (await txt('zoom-label')) === '125%');
  await pg.keyboard.press('Control+Minus'); t('Ctrl − zooms out', (await txt('zoom-label')) === '100%');
  await pg.keyboard.press('Control+0'); t('Ctrl 0 = fit', (await view(pg)).fitted === true);
  await pg.keyboard.press('Control+1'); t('Ctrl 1 = 100%', (await txt('zoom-label')) === '100%');
  for (let i = 0; i < 40; i++) await pg.evaluate(() => MARQ.CanvasView.zoomBy(1.25));
  t('zoom clamps at 3200% and disables +', (await txt('zoom-label')) === '3200%' && await pg.isDisabled('#btn-zoom-in'));
  const t0 = Date.now(); await pg.evaluate(() => MARQ.CanvasView.render()); t('3200% render is fast (visible-area grid)', Date.now() - t0 < 250, Date.now() - t0);
  for (let i = 0; i < 60; i++) await pg.evaluate(() => MARQ.CanvasView.zoomBy(0.8));
  t('zoom clamps at 5% and disables −', (await txt('zoom-label')) === '5%' && await pg.isDisabled('#btn-zoom-out'));
  await pg.click('#btn-fit');
  // ctrl+wheel zoom anchors on the cursor
  await pg.click('#btn-zoom-100'); const cb = await pg.locator('#editor-canvas').boundingBox(); vw = await view(pg);
  const mx = cb.x + vw.panX + 20 * vw.k, my = cb.y + vw.panY + 10 * vw.k; await pg.mouse.move(mx, my);
  await pg.keyboard.down('Control'); await pg.mouse.wheel(0, -200); await pg.keyboard.up('Control'); await pg.waitForTimeout(80);
  v2 = await view(pg); const under = { x: (mx - cb.x - v2.panX) / v2.k, y: (my - cb.y - v2.panY) / v2.k };
  t('ctrl+wheel zoom keeps point under cursor fixed', v2.zoom > 1 && within(under.x, 20, 0.6) && within(under.y, 10, 0.6), under);
  await pg.mouse.wheel(0, 120); await pg.waitForTimeout(60); t('plain wheel pans and un-fits', (await view(pg)).fitted === false);

  // ---------- canvas follows size changes ----------
  await pg.click('#btn-fit'); await set('label-w', '200'); vw = await view(pg);
  t('fitted view refits when width changes', vw.fitted && vw.panX >= 0 && vw.panX + 200 * vw.k <= (await pg.locator('#canvas-wrap').boundingBox()).width);
  const x_ = await scan(pg, 'x'), y_ = await scan(pg, 'y'); t('canvas pixels follow new 200 × 50 size (ratio 4:1)', within(x_.len / y_.len, 4, 0.08), [x_, y_]);
  await pg.click('#btn-zoom-100'); const before = await view(pg), cx0 = before.panX + before.L.width * before.k / 2;
  await set('label-w', '100'); const after = await view(pg), cx1 = after.panX + after.L.width * after.k / 2;
  t('zoomed view keeps zoom + label centre when size changes', after.zoom === 1 && within(cx0, cx1, 1.5), [cx0, cx1]);
  await set('label-w', '100'); await pg.click('#btn-fit');
  // window resize keeps fitted view fitted
  await pg.setViewportSize({ width: 900, height: 600 }); await pg.waitForTimeout(250); vw = await view(pg); const b2 = await pg.locator('#canvas-wrap').boundingBox();
  t('window resize re-fits a fitted view', vw.fitted && vw.panX >= 0 && vw.panX + vw.L.width * vw.k <= b2.width + 0.5 && vw.panY + vw.L.height * vw.k <= b2.height + 0.5, [vw, b2]);
  await pg.setViewportSize({ width: 1280, height: 760 }); await pg.waitForTimeout(200);

  // ---------- rulers ----------
  await pg.click('#btn-fit'); vw = await view(pg);
  t('corner shows unit', (await txt('corner')) === 'mm');
  await pg.selectOption('#unit-select', 'in'); const cn = await txt('corner'); t('corner follows unit', cn === 'in', [cn, await pg.evaluate(() => [MARQ.Store.state.app.unit, document.getElementById('unit-select').value])]); await pg.selectOption('#unit-select', 'mm');
  const hb = await pg.locator('#ruler-h').boundingBox(), cvb = await pg.locator('#canvas-wrap').boundingBox();
  t('ruler-h aligned with canvas, 22px tall', within(hb.x, cvb.x, 0.5) && hb.height === 22 && within(hb.width, cvb.width, 0.5));
  await pg.mouse.move(cb.x + vw.panX + 25 * vw.k, cb.y + vw.panY + 10 * vw.k); await pg.waitForTimeout(120);
  const cur = await txt('st-cursor'); t('status shows cursor in label mm', /X 25(\.\d+)?\s+Y 10(\.\d+)? mm/.test(cur.replace(/\s+/g, ' ').replace('  ', ' ')) || /X 2[45]\.\d+\s+Y (9\.\d+|10)/.test(cur), cur);
  const isBlue = 'Math.abs(p[0]-74)<8&&Math.abs(p[1]-108)<8&&Math.abs(p[2]-247)<8';
  t('ruler-h has cursor indicator at the cursor', await hasColor(pg, [vw.panX + 25 * vw.k - 3, 0, vw.panX + 25 * vw.k + 3, 22], { canvas: 'ruler-h', src: isBlue }));
  t('ruler-v has cursor indicator', await hasColor(pg, [0, vw.panY + 10 * vw.k - 3, 22, vw.panY + 10 * vw.k + 3], { canvas: 'ruler-v', src: isBlue }));
  await pg.mouse.move(5, 5); await pg.waitForTimeout(120); t('cursor readout clears when leaving canvas', (await txt('st-cursor')) === '');
  await pg.click('#btn-rulers'); await pg.waitForTimeout(120);
  t('rulers can be hidden', !(await pg.locator('#ruler-h').isVisible()) && (await pg.getAttribute('#btn-rulers', 'aria-pressed')) === 'false');
  const cb2 = await pg.locator('#canvas-wrap').boundingBox(); t('canvas gains the ruler space', cb2.width > cvb.width + 20 && cb2.x < cvb.x);
  vw = await view(pg); t('hidden rulers: view stays fitted', vw.fitted && vw.panX >= 0);
  await pg.click('#btn-rulers'); await pg.waitForTimeout(120); t('rulers back', await pg.locator('#ruler-h').isVisible());

  // ---------- existing Templates flyout still drives the label size ----------
  await pg.locator('.card', { hasText: 'Shipping' }).click(); L = await lbl(pg);
  t('Templates flyout "Shipping" = 100 × 150, portrait, custom', L.width === 100 && L.height === 150 && L.orientation === 'portrait' && L.preset === 'custom' && (await val('label-preset')) === 'custom');
  await pg.locator('.card', { hasText: 'Asset tag' }).click(); L = await lbl(pg); t('flyout "Asset tag" = 50 × 25 landscape', L.width === 50 && L.height === 25 && L.orientation === 'landscape');
  await pg.selectOption('#label-preset', '100x50');

  // ---------- persistence + legacy files ----------
  await set('m-left', '4'); await set('label-border-w', '1'); await pg.selectOption('#label-preset', '70x50'); await pg.click('#orient-portrait');
  await pg.fill('#project-name', 'My Labels'); await pg.press('#project-name', 'Tab'); await pg.waitForTimeout(900);
  await pg.reload(); await pg.waitForTimeout(200); L = await lbl(pg);
  t('autosave restores label geometry', L.width === 50 && L.height === 70 && L.orientation === 'portrait' && L.preset === '70x50' && L.margin.left === 4 && L.borderWidth === 1, L);
  t('panel restored after reload', (await val('label-preset')) === '70x50' && (await val('m-left')) === '4');
  const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('#btn-save')]); const file = '/tmp/exp.marq.json'; await dl.saveAs(file);
  t('export filename', dl.suggestedFilename() === 'My_Labels.marq.json'); const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  t('export contains new label fields', saved.label.orientation === 'portrait' && saved.label.margin.left === 4 && saved.label.preset === '70x50');
  pg.once('dialog', d => d.accept()); await pg.click('#btn-new'); t('new project resets to 100 × 50', (await txt('st-size')).includes('100 mm') && (await val('label-preset')) === '100x50' && (await val('m-left')) === '0');
  await pg.setInputFiles('#file-open', file); await pg.waitForTimeout(250); L = await lbl(pg); t('re-open restores geometry', L.width === 50 && L.margin.left === 4 && (await val('project-name')) === 'My Labels');
  const legacy = { schema: 1, id: 'old', meta: { name: 'Legacy' }, label: { width: 80, height: 120, background: '#ffffff', cornerRadius: 0, borderWidth: 0, borderColor: '#000000' }, elements: [] };
  fs.writeFileSync('/tmp/legacy.marq.json', JSON.stringify(legacy)); await pg.setInputFiles('#file-open', '/tmp/legacy.marq.json'); await pg.waitForTimeout(250); L = await lbl(pg);
  t('legacy (Stage 01) file opens and is upgraded', L.orientation === 'portrait' && L.preset === 'custom' && L.margin.top === 0 && (await val('label-preset')) === 'custom');
  fs.writeFileSync('/tmp/bad.json', '{"x":1}'); await pg.setInputFiles('#file-open', '/tmp/bad.json'); await pg.waitForTimeout(250); t('bad file reported', (await txt('status-msg')).includes('Open failed'));
  await pg.keyboard.press('Control+z'); t('libs status shown', (await txt('st-libs')).includes('Barcode'));

  // ---------- Hi-DPI (dpr 2): physical size must not change ----------
  const hi = await open({ deviceScaleFactor: 2 }); await hi.click('#btn-grid'); await hi.click('#btn-zoom-100');
  const hx = await scan(hi, 'x'), hy = await scan(hi, 'y'); t('dpr 2: 100mm @100% still 377.95 css px', within(hx.len, 377.95, 1.2) && within(hy.len, 188.98, 1.2), [hx, hy]);
  const dims = await hi.evaluate(() => { const c = document.getElementById('editor-canvas'); return [c.width / c.clientWidth, parseFloat(c.style.width) === c.clientWidth]; }); t('dpr 2: backing store is 2× CSS size', dims[0] === 2 && dims[1]);

  t('no JS errors', errs.length === 0, errs);
  await b.close(); console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})();
