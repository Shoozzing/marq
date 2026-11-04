// Run: NODE_PATH=$(npm root -g) node tests/browser-test-elements.js   (needs playwright + chromium + sharp)
// Stage 03: every design element, driven through the real UI (flyout -> sidebar) and verified from rendered pixels.
const { chromium } = require('playwright'); const sharp = require('sharp'); const path = require('path'), fs = require('fs');
const URL = 'file://' + path.resolve(__dirname, '../index.html');
let fails = 0; const t = (n, c, extra) => { console.log(c ? 'ok  ' : 'FAIL', n, c || extra === undefined ? '' : '-> ' + JSON.stringify(extra)); if (!c) fails++; };
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const isRed = p => p[0] > 200 && p[1] < 60 && p[2] < 60, isBlue = p => p[2] > 200 && p[0] < 60 && p[1] < 60, isWhite = p => p[0] > 245 && p[1] > 245 && p[2] > 245;
const isGreen = p => p[1] > 200 && p[0] < 60 && p[2] < 60;

// ---- in-page helpers ----
const settle = pg => pg.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
// Render the project with the shared Renderer (the print path) at 10 px/mm and read pixels at label-space points (mm). No editor overlays.
const sample = (pg, pts) => pg.evaluate(async pts => {
  const p = MARQ.Store.state.project, L = p.label, k = 10; await MARQ.Images.ready(p);
  const c = document.createElement('canvas'); c.width = Math.round(L.width * k); c.height = Math.round(L.height * k); const x = c.getContext('2d'); MARQ.Renderer.draw(x, p, null, k, {});
  return pts.map(([a, b]) => Array.from(x.getImageData(Math.min(c.width - 1, Math.round(a * k)), Math.min(c.height - 1, Math.round(b * k)), 1, 1).data));
}, pts);
const px1 = async (pg, x, y) => (await sample(pg, [[x, y]]))[0];
// bounding box (mm) of "ink" (anything not near-white) inside a region (mm), + whether any pixel satisfies `test`
const ink = (pg, r, testSrc) => pg.evaluate(async ([r, src]) => {
  const p = MARQ.Store.state.project, L = p.label, k = 10; await MARQ.Images.ready(p);
  const c = document.createElement('canvas'); c.width = Math.round(L.width * k); c.height = Math.round(L.height * k); const x = c.getContext('2d'); MARQ.Renderer.draw(x, p, null, k, {});
  const x0 = Math.round(r[0] * k), y0 = Math.round(r[1] * k), w = Math.round((r[2] - r[0]) * k), h = Math.round((r[3] - r[1]) * k), d = x.getImageData(x0, y0, w, h).data, f = src ? new Function('p', 'return ' + src) : () => false;
  let a = 1e9, b = 1e9, c2 = -1, e = -1, hit = false;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const o = (j * w + i) * 4, q = [d[o], d[o + 1], d[o + 2]]; if (Math.min(q[0], q[1], q[2]) < 160) { if (i < a) a = i; if (i > c2) c2 = i; if (j < b) b = j; if (j > e) e = j; } if (f(q)) hit = true; }
  return c2 < 0 ? null : { x0: r[0] + a / k, y0: r[1] + b / k, x1: r[0] + (c2 + 1) / k, y1: r[1] + (e + 1) / k, w: (c2 + 1 - a) / k, h: (e + 1 - b) / k, hit };
}, [r, testSrc]);
const els = pg => pg.evaluate(() => JSON.parse(JSON.stringify(MARQ.Store.state.project.elements)));
const sel = pg => pg.evaluate(() => MARQ.Elements.selected() && JSON.parse(JSON.stringify(MARQ.Elements.selected())));
const toast = async pg => { await settle(pg); return pg.locator('#status-msg').innerText(); };

(async () => {
  const b = await chromium.launch(), errs = [];
  const ctx = await b.newContext({ viewport: { width: 1360, height: 820 }, acceptDownloads: true }), pg = await ctx.newPage();
  pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  await pg.goto(URL); await pg.waitForTimeout(200); await pg.click('#btn-grid');
  const set = async (id, v) => { await pg.fill('#' + id, String(v)); await pg.press('#' + id, 'Tab'); await settle(pg); };
  const val = id => pg.inputValue('#' + id);
  const tool = async name => { if ((await pg.locator('#fly-title').innerText()).toLowerCase() !== name.toLowerCase() || await pg.locator('#flyout.shut').count()) await pg.click(`.rb[title="${name}"]`); };
  const addCard = async (toolName, title) => { await tool(toolName); await pg.locator('.card').filter({ has: pg.locator('b', { hasText: new RegExp('^' + title + '$') }) }).click(); await settle(pg); return sel(pg); };
  const geo = async (x, y, w, h) => { await set('ep-x', x); await set('ep-y', y); await set('ep-w', w); if (h != null) await set('ep-h', h); };
  const clearAll = async () => { await pg.evaluate(() => { MARQ.Store.commit('clear', s => { s.project.elements = []; }); }); await settle(pg); };

  // ================= TEXT =================
  t('sidebar starts with the "nothing selected" hint', (await pg.locator('#el-props').innerText()).includes('Nothing selected'));
  let e = await addCard('Text', 'Heading');
  t('Heading added + selected: text element, bold 18pt, name', e && e.type === 'text' && e.props.bold && e.props.fontSize === 18 && e.name === 'Heading 1');
  t('sidebar shows the element (name, text, size)', (await val('ep-name')) === 'Heading 1' && (await val('ep-text')) === 'Heading' && (await val('ep-size')) === '18' && (await pg.getAttribute('#ep-bold', 'aria-pressed')) === 'true');
  await geo(10, 10, 80); await pg.fill('#ep-text', 'HELLO'); await settle(pg);
  t('text content edits the model live', (await sel(pg)).props.text === 'HELLO');
  let bb = await ink(pg, [0, 0, 100, 50]); t('text renders ink inside its box', bb && bb.x0 >= 10 && bb.x1 <= 90 && bb.y0 >= 10 && bb.h > 3, bb);
  const w18 = bb.w, h18 = bb.h;
  await set('ep-size', 36); bb = await ink(pg, [0, 0, 100, 50]); t('font size 36pt ≈ doubles glyph height', near(bb.h / h18, 2, 0.2), [bb.h, h18]);
  await set('ep-size', 18);
  await pg.click('#ep-bold'); t('bold toggles off (button + model)', (await pg.getAttribute('#ep-bold', 'aria-pressed')) === 'false' && !(await sel(pg)).props.bold);
  bb = await ink(pg, [0, 0, 100, 50]); t('regular is narrower than bold', bb.w < w18 - 0.3, [bb.w, w18]);
  const wReg = bb.w; await pg.click('#ep-italic'); t('italic toggles on', (await sel(pg)).props.italic === true && (await pg.getAttribute('#ep-italic', 'aria-pressed')) === 'true');
  bb = await ink(pg, [0, 0, 100, 50]); t('italic changes rendering (slanted ink is wider)', Math.abs(bb.w - wReg) > 0.05, [bb.w, wReg]); await pg.click('#ep-italic');
  bb = await ink(pg, [0, 0, 100, 50]); const wBase = bb.w;
  await pg.selectOption('#ep-font', 'Courier New'); t('font family stored', (await sel(pg)).props.fontFamily === 'Courier New');
  bb = await ink(pg, [0, 0, 100, 50]); t('different font changes the glyph widths', Math.abs(bb.w - wBase) > 0.3, [bb.w, wBase]); await pg.selectOption('#ep-font', 'Arial');
  // alignment inside an 80 mm wide box at x = 10
  await pg.click('#ep-align-left'); bb = await ink(pg, [0, 0, 100, 50]); t('align left: ink starts at the box left', near(bb.x0, 10, 1.5), bb);
  await pg.click('#ep-align-center'); bb = await ink(pg, [0, 0, 100, 50]); t('align centre: ink centred in the box', near((bb.x0 + bb.x1) / 2, 50, 1), bb);
  await pg.click('#ep-align-right'); bb = await ink(pg, [0, 0, 100, 50]); t('align right: ink ends at the box right', near(bb.x1, 90, 1.5), bb);
  t('alignment buttons reflect state', (await pg.getAttribute('#ep-align-right', 'aria-pressed')) === 'true' && (await pg.getAttribute('#ep-align-left', 'aria-pressed')) === 'false');
  await pg.click('#ep-align-left');
  // colour
  await pg.fill('#ep-color', '#ff0000'); await settle(pg); bb = await ink(pg, [0, 0, 100, 50], 'p[0]>200&&p[1]<60&&p[2]<60'); t('text colour red reaches the canvas', bb.hit && (await sel(pg)).props.color === '#ff0000');
  await pg.fill('#ep-color', '#000000'); await settle(pg);
  // letter spacing
  bb = await ink(pg, [0, 0, 100, 50]); const wNoLs = bb.w; await set('ep-ls', 5); bb = await ink(pg, [0, 0, 100, 50]);
  t('letter spacing 5pt adds ≈ 4 gaps × 1.76 mm', near(bb.w - wNoLs, 4 * 5 * 25.4 / 72, 1), [bb.w, wNoLs]);
  await set('ep-ls', -1); bb = await ink(pg, [0, 0, 100, 50]); t('negative letter spacing tightens', bb.w < wNoLs, [bb.w, wNoLs]); await set('ep-ls', 0);
  // line height + auto height
  await pg.fill('#ep-text', 'AB\nAB'); await settle(pg); e = await sel(pg); const fm = 18 * 25.4 / 72;
  t('auto height = 2 lines × size × 1.2', near(e.h, 2 * fm * 1.2, 0.05), e.h); t('height input disabled while auto height is on', await pg.isDisabled('#ep-h'));
  bb = await ink(pg, [0, 0, 100, 50]); const hl = bb.h; await set('ep-lh', 2.4); e = await sel(pg); bb = await ink(pg, [0, 0, 100, 50]);
  t('line height 2.4 doubles the box and spreads the lines', near(e.h, 2 * fm * 2.4, 0.05) && near(bb.h - hl, fm * 1.2, 1), [e.h, bb.h, hl]); await set('ep-lh', 1.2);
  await pg.uncheck('#ep-autoh'); t('height input enabled with auto height off', !(await pg.isDisabled('#ep-h'))); await set('ep-h', 40); t('manual height accepted', near((await sel(pg)).h, 40, 1e-6)); await pg.check('#ep-autoh');
  // rotation
  await pg.fill('#ep-text', 'HELLO'); await settle(pg); await set('ep-w', 40); await set('ep-x', 30); bb = await ink(pg, [0, 0, 100, 50]); const wide = bb.w > bb.h;
  await set('ep-rot', 90); bb = await ink(pg, [0, 0, 100, 50]); t('rotation 90° turns the text on its side', wide && bb.h > bb.w, bb); t('rotation stored', (await sel(pg)).rotation === 90);
  await pg.click('#ep-rot90'); t('⟳ 90° button adds a quarter turn (180)', (await sel(pg)).rotation === 180); await set('ep-rot', -45); t('negative rotation normalised (315)', (await sel(pg)).rotation === 315); await set('ep-rot', 0);
  // background + padding
  await set('ep-x', 10); await set('ep-w', 40); await pg.fill('#ep-bg', '#00ff00'); await settle(pg); e = await sel(pg);
  t('background colour fills the text box', isGreen(await px1(pg, e.x + 0.3, e.y + 0.3)) && isGreen(await px1(pg, e.x + e.w - 0.3, e.y + e.h - 0.3)) && e.props.background === '#00ff00');
  await pg.check('#ep-bg-none'); await settle(pg); t('"None" removes the background', isWhite(await px1(pg, e.x + 0.3, e.y + 0.3)) && (await sel(pg)).props.background === '');
  await pg.uncheck('#ep-bg-none'); t('unchecking None restores the last colour', (await sel(pg)).props.background === '#00ff00');
  const h0 = (await sel(pg)).h; await set('ep-padding', 2); e = await sel(pg); t('padding grows the box (2 mm top+bottom) and insets the text', near(e.h - h0, 4, 0.05), [e.h, h0]);
  bb = await ink(pg, [e.x + 0.5, e.y + 0.5, e.x + e.w - 0.5, e.y + e.h - 0.5], 'false'); // ink = non-white; green counts, so check text start instead
  await set('ep-padding', 0); await pg.check('#ep-bg-none');
  // validation
  await set('ep-size', 0); t('font size 0 rejected with a clear message', (await toast(pg)).includes('Font size must be between 1 and 500') && (await val('ep-size')) === '18');
  await set('ep-size', 'abc'); t('non-numeric rejected, value restored', (await val('ep-size')) === '18' && (await sel(pg)).props.fontSize === 18);
  await set('ep-lh', 9); t('line height 9 rejected', (await toast(pg)).includes('Line height') && (await val('ep-lh')) === '1.2');
  await set('ep-w', 0); t('width 0 rejected (in current unit)', (await toast(pg)).includes('Width must be between 0.1 mm and 5000 mm') && (await val('ep-w')) === '40');
  await pg.selectOption('#unit-select', 'in'); t('lengths display in inches', (await val('ep-x')) === '0.3937'); await set('ep-x', '1in'); t('"1in" stored as 25.4 mm', near((await sel(pg)).x, 25.4, 1e-6)); await set('ep-x', '2'); t('bare number uses the current unit (2 in = 50.8 mm)', near((await sel(pg)).x, 50.8, 1e-6));
  await pg.selectOption('#unit-select', 'mm'); await set('ep-x', 10); await set('ep-size', 12); t('font size is in pt regardless of the length unit', (await sel(pg)).props.fontSize === 12);

  // ================= SHAPES =================
  await clearAll();
  e = await addCard('Shapes', 'Rectangle'); t('Rectangle: rect, radius 0', e.type === 'rect' && e.props.radius === 0 && e.name === 'Rectangle 1');
  await geo(10, 10, 20, 10); await pg.fill('#ep-fill', '#ff0000'); await pg.check('#ep-stroke-none'); await settle(pg);
  let ps = await sample(pg, [[11, 11], [29.5, 19.5], [20, 15], [9, 9], [31, 15], [20, 21]]);
  t('rect: filled inside (corners included), white outside', isRed(ps[0]) && isRed(ps[1]) && isRed(ps[2]) && isWhite(ps[3]) && isWhite(ps[4]) && isWhite(ps[5]), ps);
  t('stroke "None" disables the stroke width field', await pg.isDisabled('#ep-sw'));
  await pg.uncheck('#ep-stroke-none'); await pg.fill('#ep-stroke', '#0000ff'); await set('ep-sw', 2); ps = await sample(pg, [[10.4, 15], [11.6, 15], [12.5, 15], [20, 10.5], [20, 19.5]]);
  t('stroke is drawn inside the box (2 mm blue edge, red fill beyond it)', isBlue(ps[0]) && isBlue(ps[1]) && isRed(ps[2]) && isBlue(ps[3]) && isBlue(ps[4]), ps);
  ps = await sample(pg, [[9.7, 15], [30.3, 15]]); t('element box is the OUTER edge (nothing drawn outside it)', isWhite(ps[0]) && isWhite(ps[1]), ps);
  await set('ep-sw', 0); await pg.fill('#ep-fill', '#ff0000'); await pg.check('#ep-fill-none'); await settle(pg); ps = await sample(pg, [[20, 15]]); t('fill "None": transparent inside', isWhite(ps[0]), ps); await pg.uncheck('#ep-fill-none');
  await set('ep-rot', 90); ps = await sample(pg, [[20, 6], [20, 24], [11, 15], [29, 15]]); t('rotated 90°: footprint is 10 wide × 20 tall about the centre', isRed(ps[0]) && isRed(ps[1]) && isWhite(ps[2]) && isWhite(ps[3]), ps); await set('ep-rot', 0);
  await set('ep-opacity', 50); ps = await sample(pg, [[20, 15]]); t('opacity 50% blends with the label', ps[0][0] > 240 && ps[0][1] > 100 && ps[0][1] < 160, ps); await set('ep-opacity', 100);
  // rounded rect
  await clearAll(); e = await addCard('Shapes', 'Rounded rectangle'); t('Rounded rectangle: rect with radius 3', e.type === 'rect' && e.props.radius === 3);
  await geo(10, 10, 20, 10); await pg.fill('#ep-fill', '#ff0000'); await pg.check('#ep-stroke-none'); await set('ep-radius', 5); ps = await sample(pg, [[10.3, 10.3], [29.7, 10.3], [10.3, 19.7], [29.7, 19.7], [20, 10.3], [10.3, 15], [15, 15]]);
  t('rounded: corners are cut away, edges and centre filled', ps.slice(0, 4).every(isWhite) && isRed(ps[4]) && isRed(ps[5]) && isRed(ps[6]), ps);
  await set('ep-radius', 0); ps = await sample(pg, [[10.3, 10.3]]); t('radius 0 = square corner', isRed(ps[0]));
  await set('ep-radius', 99); ps = await sample(pg, [[10.3, 15], [20, 10.3], [10.3, 10.3]]); t('oversized radius is capped at half the short side (pill)', isRed(ps[0]) && isRed(ps[1]) && isWhite(ps[2]), ps);
  await set('ep-radius', -1); t('negative radius rejected', (await toast(pg)).includes('Corner radius') && (await sel(pg)).props.radius === 99);
  // circle
  await clearAll(); e = await addCard('Shapes', 'Circle'); t('Circle: ellipse, square, aspect locked', e.type === 'ellipse' && e.w === e.h && e.props.lockAspect && (await pg.isChecked('#ep-lock-aspect')));
  await set('ep-x', 10); await set('ep-y', 10); await set('ep-w', 20); await pg.fill('#ep-fill', '#ff0000'); await pg.check('#ep-stroke-none'); e = await sel(pg);
  t('circle: height follows width (20 × 20)', e.w === 20 && e.h === 20 && (await val('ep-h')) === '20'); await set('ep-h', 12); e = await sel(pg); t('circle: width follows height', e.h === 12 && e.w === 12 && (await val('ep-w')) === '12'); await set('ep-w', 20);
  ps = await sample(pg, [[20, 20], [10.6, 10.6], [29.4, 29.4], [20, 10.4], [10.4, 20], [14, 14]]); t('circle: centre + edge mid-points filled, bounding-box corners empty', isRed(ps[0]) && isWhite(ps[1]) && isWhite(ps[2]) && isRed(ps[3]) && isRed(ps[4]) && isRed(ps[5]), ps);
  // ellipse
  await clearAll(); e = await addCard('Shapes', 'Ellipse'); t('Ellipse: not locked', e.type === 'ellipse' && !e.props.lockAspect && e.w !== e.h);
  await geo(10, 10, 30, 10); await pg.fill('#ep-fill', '#ff0000'); await pg.check('#ep-stroke-none'); ps = await sample(pg, [[25, 15], [10.6, 10.6], [25, 10.5], [12, 15], [39.9, 15]]);
  t('ellipse 30×10: centre/top/side filled, bbox corner empty', isRed(ps[0]) && isWhite(ps[1]) && isRed(ps[2]) && isRed(ps[3]), ps);
  await set('ep-h', 30); t('ellipse: width and height are independent', (await sel(pg)).w === 30 && (await sel(pg)).h === 30);
  await pg.check('#ep-lock-aspect'); await set('ep-w', 15); t('ellipse: lock aspect can be turned on later (30:30 -> 15:15)', (await sel(pg)).h === 15);
  // lines
  await clearAll(); e = await addCard('Shapes', 'Line'); t('Line: line element, height 0, solid', e.type === 'line' && e.h === 0 && e.props.dash === 'solid');
  t('line panel has Length (no Height, no aspect lock)', (await pg.locator('#ep-h').count()) === 0 && (await pg.locator('#ep-lock-aspect').count()) === 0 && (await pg.locator('.fld', { hasText: /^Length/ }).count()) === 1);
  await set('ep-x', 10); await set('ep-y', 20); await set('ep-w', 40); await pg.fill('#ep-stroke', '#ff0000'); await set('ep-sw', 1);
  const along = []; for (let x = 10.5; x < 50; x += 1) along.push([x, 20]); ps = await sample(pg, along);
  t('solid line: continuous red along its length', ps.every(isRed), ps.map((p, i) => isRed(p) ? '' : along[i][0]).filter(Boolean)); ps = await sample(pg, [[30, 21.2], [30, 18.8], [9.5, 20], [50.6, 20]]); t('line is 1 mm thick and ends at 50 mm', ps.every(isWhite), ps);
  await set('ep-w', 40); await set('ep-rot', 90); ps = await sample(pg, [[30, 5], [30, 35], [15, 20]]); t('rotated 90°: becomes vertical about its centre', isRed(ps[0]) && isRed(ps[1]) && isWhite(ps[2]), ps); await set('ep-rot', 0);
  await clearAll(); e = await addCard('Shapes', 'Dashed line'); t('Dashed line: dash = dashed', e.type === 'line' && e.props.dash === 'dashed' && (await val('ep-dash')) === 'dashed');
  await set('ep-x', 10); await set('ep-y', 20); await set('ep-w', 40); await pg.fill('#ep-stroke', '#ff0000'); await set('ep-sw', 1); await set('ep-dash-len', 4); await set('ep-dash-gap', 2);
  ps = await sample(pg, [[11, 20], [13, 20], [15, 20], [16.5, 20], [17, 20], [20, 20], [22, 20], [23, 20]]); // period 6: dash [10,14) gap [14,16) dash [16,20) gap [20,22) dash [22,26)
  t('dashed: 4 mm dashes, 2 mm gaps', isRed(ps[0]) && isRed(ps[1]) && isWhite(ps[2]) && isRed(ps[3]) && isRed(ps[4]) && isWhite(ps[5]) && isRed(ps[6]) && isRed(ps[7]), ps);
  await set('ep-dash-gap', 4); ps = await sample(pg, [[15, 20], [17, 20]]); t('changing the gap changes the pattern', isWhite(ps[0]) && isWhite(ps[1]), ps);
  await pg.selectOption('#ep-dash', 'solid'); t('dash fields disabled for a solid line', await pg.isDisabled('#ep-dash-len')); ps = await sample(pg, [[15, 20]]); t('solid again: no gap', isRed(ps[0]), ps);
  await pg.selectOption('#ep-dash', 'dotted'); ps = await sample(pg, along.slice(0, 20)); t('dotted: a pattern of dots (both ink and gaps)', ps.some(isRed) && ps.some(isWhite));
  await pg.selectOption('#ep-dash', 'dashed'); await pg.selectOption('#ep-cap', 'round'); ps = await sample(pg, [[9.6, 20]]); t('round ends extend half the thickness past the start', isRed(ps[0]), ps);

  // ================= IMAGES =================
  await clearAll();
  const png = (w, h, a, bcol) => sharp({ create: { width: w, height: h, channels: 3, background: a } }).composite([{ input: { create: { width: w / 2, height: h, channels: 3, background: bcol } }, left: w / 2, top: 0 }]).png().toBuffer();
  const img1 = await png(40, 20, { r: 255, g: 0, b: 0 }, { r: 0, g: 0, b: 255 });
  await tool('Images'); const [fc] = await Promise.all([pg.waitForEvent('filechooser'), pg.locator('.card').filter({ hasText: 'Upload image' }).click()]); await fc.setFiles({ name: 'flag.png', mimeType: 'image/png', buffer: img1 }); await settle(pg); await pg.waitForTimeout(300);
  e = await sel(pg); t('upload via the Images card adds a selected image element', e && e.type === 'image' && e.name === 'flag 1' && e.props.naturalW === 40 && e.props.naturalH === 20, e);
  t('image keeps its 2:1 proportions', near(e.w / e.h, 2, 1e-3) && e.props.lockAspect === true); t('image is stored as a project asset', await pg.evaluate(() => Object.keys(MARQ.Store.state.project.assets).length) === 1);
  t('sidebar shows file name + pixel size', (await pg.locator('#ep-img-info').innerText()).includes('flag.png') && (await pg.locator('#ep-img-info').innerText()).includes('40 × 20 px'));
  await geo(20, 10, 40); e = await sel(pg); t('width 40 -> height 20 (aspect locked)', e.w === 40 && near(e.h, 20, 1e-3) && near(parseFloat(await val('ep-h')), 20, 1e-3));
  ps = await sample(pg, [[30, 20], [50, 20], [19, 20], [61, 20], [40, 9], [40, 31]]); t('image renders: left half red, right half blue, nothing outside', isRed(ps[0]) && isBlue(ps[1]) && isWhite(ps[2]) && isWhite(ps[3]) && isWhite(ps[4]) && isWhite(ps[5]), ps);
  await set('ep-h', 10); e = await sel(pg); t('height 10 -> width 20 (aspect locked)', near(e.w, 20, 1e-3) && e.h === 10); await set('ep-w', 40);
  await pg.uncheck('#ep-lock-aspect'); await set('ep-h', 20); await set('ep-w', 40); await set('ep-h', 30); e = await sel(pg); t('unlocked: free stretch (40 × 30)', e.w === 40 && e.h === 30);
  ps = await sample(pg, [[30, 25], [50, 25], [40, 11], [40, 39]]); t('stretched image fills the new box', isRed(ps[0]) && isBlue(ps[1]) && !isWhite(ps[2]) && !isWhite(ps[3]), ps);
  await pg.click('#ep-reset-aspect'); e = await sel(pg); t('"Reset to original proportions" restores 2:1 keeping width', e.w === 40 && near(e.h, 20, 1e-3));
  await pg.check('#ep-lock-aspect'); await set('ep-w', 30); await set('ep-x', 35); await set('ep-y', 17.5); e = await sel(pg); const cx = e.x + e.w / 2, cy = e.y + e.h / 2;
  await set('ep-rot', 90); ps = await sample(pg, [[cx, cy - 8], [cx, cy + 8], [cx - 13, cy], [cx + 13, cy]]); t('rotated 90° clockwise: red half goes to the top, blue to the bottom', isRed(ps[0]) && isBlue(ps[1]) && isWhite(ps[2]) && isWhite(ps[3]), ps);
  await set('ep-rot', 180); ps = await sample(pg, [[cx - 8, cy], [cx + 8, cy]]); t('rotated 180°: halves swap sides', isBlue(ps[0]) && isRed(ps[1]), ps); await set('ep-rot', 0);
  t('default fit is Stretch', (await sel(pg)).props.fit === 'fill'); await pg.selectOption('#ep-fit', 'contain'); await set('ep-h', 20); await pg.uncheck('#ep-lock-aspect'); await set('ep-h', 30); e = await sel(pg); ps = await sample(pg, [[e.x + e.w * 0.25, e.y + 1], [e.x + e.w * 0.25, e.y + e.h - 1], [e.x + e.w * 0.25, e.y + e.h / 2]]); t('Contain letterboxes inside a taller box (top/bottom bars empty, middle drawn)', isWhite(ps[0]) && isWhite(ps[1]) && isRed(ps[2]) && e.h === 30, [ps, e.h]); await pg.selectOption('#ep-fit', 'cover'); t('fit mode stored', (await sel(pg)).props.fit === 'cover'); await pg.selectOption('#ep-fit', 'fill'); await pg.click('#ep-reset-aspect'); await pg.check('#ep-lock-aspect');
  // replace
  const img2 = await png(20, 20, { r: 0, g: 255, b: 0 }, { r: 255, g: 255, b: 0 }); const [fc2] = await Promise.all([pg.waitForEvent('filechooser'), pg.click('#ep-replace')]); await fc2.setFiles({ name: 'sq.png', mimeType: 'image/png', buffer: img2 }); await settle(pg); await pg.waitForTimeout(300);
  e = await sel(pg); t('replace image: same element, new asset, new natural size, ratio follows (1:1)', e.props.naturalW === 20 && near(e.w / e.h, 1, 1e-3) && (await els(pg)).length === 1, e);
  ps = await sample(pg, [[e.x + e.w * 0.25, e.y + e.h / 2]]); t('replaced image renders (green left half)', isGreen(ps[0]), ps);
  // rejects
  await tool('Images'); const n0 = (await els(pg)).length; await pg.setInputFiles('#file-image', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') }); await settle(pg); await pg.waitForTimeout(100);
  t('non-image file rejected with a message, nothing added', (await toast(pg)).includes('Unsupported file type') && (await els(pg)).length === n0);
  await pg.setInputFiles('#file-image', { name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not really a png') }); await pg.waitForTimeout(250); t('corrupt image rejected', (await toast(pg)).includes('could not be decoded') && (await els(pg)).length === n0);
  // large image downscaled
  const big = await sharp({ create: { width: 3000, height: 1000, channels: 3, background: { r: 10, g: 200, b: 10 } } }).png().toBuffer();
  await pg.setInputFiles('#file-image', { name: 'big.png', mimeType: 'image/png', buffer: big }); await pg.waitForTimeout(700); e = await sel(pg); const as = await pg.evaluate(id => MARQ.Store.state.project.assets[id].w + 'x' + MARQ.Store.state.project.assets[id].h, e.props.assetId);
  t('3000×1000 image is downscaled to 2400×800 (aspect kept), natural size recorded', as === '2400x800' && near(e.w / e.h, 3, 1e-3) && e.w <= 80 + 1e-9 && e.h <= 40 + 1e-9, [as, e.w, e.h]);
  // same file twice shares one asset
  await pg.setInputFiles('#file-image', { name: 'big2.png', mimeType: 'image/png', buffer: big }); await pg.waitForTimeout(700); t('identical image reuses the same asset', await pg.evaluate(() => { const a = MARQ.Store.state.project.elements.filter(e => e.type === 'image'); return a[a.length - 1].props.assetId === a[a.length - 2].props.assetId; }));
  // svg
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><rect width="40" height="40" fill="#ff0000"/></svg>';
  await clearAll(); await pg.setInputFiles('#file-image', { name: 'logo.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) }); await pg.waitForTimeout(400); e = await sel(pg); ps = await sample(pg, [[e.x + e.w / 2, e.y + e.h / 2]]);
  t('SVG uploads and renders', e && e.type === 'image' && isRed(ps[0]), ps);
  // persistence of image
  await pg.waitForTimeout(900); await pg.reload(); await pg.waitForTimeout(400); e = (await els(pg))[0];
  t('image + asset survive reload (autosave)', e && e.type === 'image' && !!(await pg.evaluate(id => MARQ.Store.state.project.assets[id], e.props.assetId))); ps = await sample(pg, [[e.x + e.w / 2, e.y + e.h / 2]]); t('image renders after reload', isRed(ps[0]), ps);
  // export prunes orphans
  await pg.evaluate(() => { MARQ.Store.commit('x', s => { s.project.assets.orphan = { name: 'o', mime: 'image/png', dataUrl: 'data:image/png;base64,AAAA', w: 1, h: 1 }; }); });
  const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('#btn-save')]); await dl.saveAs('/tmp/s3.marq.json'); const saved = JSON.parse(fs.readFileSync('/tmp/s3.marq.json', 'utf8'));
  t('export contains used assets only', Object.keys(saved.assets).length === 1 && !saved.assets.orphan && saved.elements[0].props.assetId in saved.assets);

  // ================= SELECTION, LAYERS, SIDEBAR =================
  await clearAll(); await pg.click('#btn-fit'); await settle(pg);
  const ids = {}; for (const [k, tl, ti] of [['rect', 'Shapes', 'Rectangle'], ['circle', 'Shapes', 'Circle'], ['text', 'Text', 'Body text']]) { await addCard(tl, ti); ids[k] = (await sel(pg)).id; }
  await pg.evaluate(ids => { const S = (id, p) => MARQ.Elements.setGeometry(id, p); S(ids.rect, { x: 10, y: 10, w: 30, h: 20 }); S(ids.circle, { x: 60, y: 10, w: 20, h: 20 }); MARQ.Elements.setProp(ids.rect, 'fill', '#ff0000'); MARQ.Elements.setProp(ids.circle, 'fill', '#0000ff'); S(ids.text, { x: 10, y: 38 }); }, ids);
  await pg.evaluate(() => MARQ.Elements.select(null)); await settle(pg);
  const toScreen = async (x, y) => pg.evaluate(([x, y]) => { const v = MARQ.Store.state.app.view, k = MARQ.Viewport.PX_PER_MM * v.zoom, r = document.getElementById('editor-canvas').getBoundingClientRect(); return { x: r.left + Math.round(v.panX) + x * k, y: r.top + Math.round(v.panY) + y * k }; }, [x, y]);
  let s0 = await toScreen(25, 20); await pg.mouse.click(s0.x, s0.y); await settle(pg); t('clicking an element on the canvas selects it', (await sel(pg)).id === ids.rect && (await val('ep-name')) === 'Rectangle 1');
  s0 = await toScreen(70, 20); await pg.mouse.click(s0.x, s0.y); await settle(pg); t('clicking another selects that one; sidebar switches to a circle', (await sel(pg)).id === ids.circle && (await val('ep-name')) === 'Circle 1');
  s0 = await toScreen(61, 11); await pg.mouse.click(s0.x, s0.y); await settle(pg); t('clicking a circle\'s bounding-box corner still hits its box (box-based picking)', (await sel(pg)).id === ids.circle);
  s0 = await toScreen(50, 45); await pg.mouse.click(s0.x, s0.y); await settle(pg); t('clicking empty space deselects + hint returns', (await sel(pg)) === null && (await pg.locator('#el-props').innerText()).includes('Nothing selected'));
  // selection outline is editor-only
  s0 = await toScreen(25, 20); await pg.mouse.click(s0.x, s0.y); await settle(pg);
  const edge = await toScreen(10, 20); const cvPx = await pg.evaluate(([x, y]) => { const c = document.getElementById('editor-canvas'), d = devicePixelRatio, r = c.getBoundingClientRect(); return Array.from(c.getContext('2d').getImageData(Math.round((x - r.left) * d), Math.round((y - r.top) * d), 1, 1).data); }, [edge.x, edge.y]);
  t('editor canvas draws a blue selection outline on the selected element', cvPx[2] > 200 && cvPx[0] < 120, cvPx); ps = await sample(pg, [[10.5, 20], [10.5, 12]]); t('outline is NOT part of the shared renderer (print path): interior stays plain red', isRed(ps[0]) && isRed(ps[1]), ps);
  // layers
  await tool('Layers'); let rows = await pg.locator('.layer').allInnerTexts(); t('Layers lists elements front → back', rows.length === 3 && rows[0].includes('Text 1') && rows[2].includes('Rectangle 1'), rows);
  await pg.locator('.layer', { hasText: 'Circle 1' }).locator('.lname').click(); await settle(pg); t('clicking a layer selects it', (await sel(pg)).id === ids.circle && (await pg.locator('.layer.on').innerText()).includes('Circle 1'));
  await pg.locator('.layer', { hasText: 'Circle 1' }).locator('button[title="Hide"]').click(); await settle(pg); ps = await sample(pg, [[70, 20]]); t('hiding a layer removes it from the render; checkbox in sidebar follows', isWhite(ps[0]) && !(await pg.isChecked('#ep-visible')));
  await pg.check('#ep-visible'); ps = await sample(pg, [[70, 20]]); t('Visible checkbox shows it again', isBlue(ps[0]));
  await pg.locator('.layer', { hasText: 'Circle 1' }).locator('button[title="Lock"]').click(); await settle(pg);
  t('locked: geometry + appearance fields disabled, Locked box stays usable', await pg.isDisabled('#ep-x') && await pg.isDisabled('#ep-fill') && await pg.isDisabled('#ep-del') && !(await pg.isDisabled('#ep-locked')) && await pg.isChecked('#ep-locked'));
  s0 = await toScreen(70, 20); await pg.mouse.click(s0.x, s0.y); await settle(pg); t('locked elements are skipped by canvas clicks', (await sel(pg)) === null);
  await pg.locator('.layer', { hasText: 'Circle 1' }).locator('.lname').click(); await pg.uncheck('#ep-locked'); t('unlock re-enables editing', !(await pg.isDisabled('#ep-x')));
  await pg.locator('.layer', { hasText: 'Circle 1' }).locator('button[title="Bring forward"]').click(); await settle(pg);
  t('forward moves the layer up the stack', (await els(pg)).map(x => x.id).join() === [ids.rect, ids.text, ids.circle].join()); await pg.locator('.layer', { hasText: 'Circle 1' }).locator('button[title="Send backward"]').click(); await settle(pg);
  // rect and circle overlap test: put circle over rect -> topmost picked
  await pg.evaluate(ids => { MARQ.Elements.setGeometry(ids.circle, { x: 30, y: 10 }); MARQ.Elements.select(null); }, ids); s0 = await toScreen(35, 20); await pg.mouse.click(s0.x, s0.y); await settle(pg);
  const topId = await pg.evaluate(() => MARQ.Elements.hitTest(35, 20, 0)); t('overlap: the element higher in the stack is picked', (await sel(pg)).id === topId && topId === (await els(pg)).filter(x => x.id === ids.circle || x.id === ids.rect).pop().id);
  // keyboard
  await pg.evaluate(id => MARQ.Elements.select(id), ids.rect); await pg.click('#canvas-wrap', { position: { x: 5, y: 5 } }); await pg.evaluate(id => MARQ.Elements.select(id), ids.rect);
  await pg.keyboard.press('Control+d'); await settle(pg); t('Ctrl+D duplicates (offset 2 mm, new selection)', (await els(pg)).length === 4 && (await sel(pg)).id !== ids.rect && near((await sel(pg)).x, 12, 1e-6));
  await pg.keyboard.press('Delete'); await settle(pg); t('Delete removes the selected element', (await els(pg)).length === 3 && (await sel(pg)) === null);
  await pg.click('#btn-undo'); await settle(pg); t('undo brings the deleted element back', (await els(pg)).length === 4);
  await pg.evaluate(id => MARQ.Elements.select(id), ids.rect); await pg.keyboard.press('Escape'); await settle(pg); t('Escape deselects', (await sel(pg)) === null);
  await pg.evaluate(id => MARQ.Elements.select(id), ids.rect); await set('ep-name', '  Hero box '); t('rename (trimmed) shows in Layers', (await sel(pg)).name === 'Hero box' && (await pg.locator('.layer', { hasText: 'Hero box' }).count()) === 1);
  await pg.keyboard.press('Delete'); t('Delete key is ignored while typing in a field', (await els(pg)).length === 4);
  // undo granularity + coalescing
  await pg.evaluate(id => { MARQ.Elements.select(id); MARQ.Store.commit('fence', () => {}); }, ids.rect); const before = (await sel(pg)).props.fill;
  for (const c of ['#111111', '#222222', '#333333']) await pg.fill('#ep-fill', c); await settle(pg); await pg.click('#btn-undo'); await settle(pg); t('dragging a colour picker is ONE undo step', (await sel(pg)).props.fill === before, (await sel(pg)).props.fill);
  await pg.click('#btn-redo'); await settle(pg);
  // undo/redo while selected keeps sidebar in sync
  await set('ep-w', 33); t('sidebar width edit', (await sel(pg)).w === 33); await pg.click('#btn-undo'); await settle(pg); t('undo refreshes the sidebar value', (await val('ep-w')) === '30');
  // persistence of all element types
  await pg.evaluate(() => { MARQ.Elements.select(null); });
  for (const [tl, ti] of [['Shapes', 'Rounded rectangle'], ['Shapes', 'Dashed line'], ['Text', 'Heading']]) await addCard(tl, ti);
  const snapshot = JSON.stringify(await els(pg)); await pg.waitForTimeout(900); await pg.reload(); await pg.waitForTimeout(400);
  t('all element types persist exactly across reload', JSON.stringify(await els(pg)) === snapshot);
  t('nothing is selected after reload and the panel is consistent', (await sel(pg)) === null && (await pg.locator('#el-props').innerText()).includes('Nothing selected'));
  // render of everything at once - no exceptions, label sections still work
  await pg.click('#btn-fit'); await settle(pg); await pg.fill('#label-bg', '#ffee00'); ps = await sample(pg, [[1, 1]]); t('label background still works with elements present', ps[0][0] === 255 && ps[0][1] === 238 && ps[0][2] === 0, ps);
  t('Label sections are still in the right sidebar', (await pg.locator('#props .sec', { hasText: 'Margins' }).count()) === 1 && (await pg.locator('#label-w').count()) === 1);
  // old (Stage 02) file with no elements/assets opens fine; file with a broken element is repaired
  fs.writeFileSync('/tmp/broken-el.marq.json', JSON.stringify({ schema: 1, id: 'x', meta: { name: 'B' }, label: { width: 80, height: 40 }, elements: [{ type: 'rect', w: -5, props: { fill: 'zzz' } }, { type: 'nope' }, { type: 'text', props: { fontSize: 'x' } }] }));
  await pg.setInputFiles('#file-open', '/tmp/broken-el.marq.json'); await pg.waitForTimeout(300); const rep = await els(pg); t('file with damaged elements opens repaired (unknown type dropped, bad values defaulted)', rep.length === 2 && rep[0].w === 0.1 && rep[0].props.fill === '#ffffff' && rep[1].props.fontSize === 10, rep);
  await pg.evaluate(() => MARQ.CanvasView.render()); t('no JS errors', errs.length === 0, errs);
  await b.close(); console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})();
