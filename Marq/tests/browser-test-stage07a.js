// Run: NODE_PATH=$(npm root -g) node tests/browser-test-stage07a.js   (needs playwright + chromium)
// Stage 07A: dynamic data mapping, driven through the real UI. vendor/xlsx.full.min.js is not shipped in the repo, so a tiny CSV-backed
// XLSX stand-in is injected ONLY if the real library is absent; the Stage 06 import dialog and everything after it is the real code.
const { chromium } = require('playwright'); const path = require('path'), fs = require('fs');
const URL = 'file://' + path.resolve(__dirname, '../index.html');
let fails = 0; const t = (n, c, extra) => { console.log(c ? 'ok  ' : 'FAIL', n, c || extra === undefined ? '' : '-> ' + JSON.stringify(extra)); if (!c) fails++; };
const settle = pg => pg.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
const CSV = 'Asset_Number,Asset_Name,Location\nAST-001,Pump A,Lobby\nAST-002,,Roof\nAST-003,Fan,\n';
// pixel signature of one element's box, rendered through the shared Renderer with the current preview record
const sig = (pg, id) => pg.evaluate(id => {
  const p = MARQ.Store.state.project, el = p.elements.find(e => e.id === id), k = 10, only = Object.assign({}, p, { elements: [Object.assign({}, el, { x: 0, y: 0, rotation: 0 })], label: Object.assign({}, p.label, { width: el.w, height: el.h }) });
  const c = document.createElement('canvas'); c.width = Math.ceil(el.w * k); c.height = Math.ceil(el.h * k); const x = c.getContext('2d'); MARQ.Renderer.draw(x, only, MARQ.Data.previewRecord(), k, {});
  const d = x.getImageData(0, 0, c.width, c.height).data; let h = 0, dark = 0; for (let i = 0; i < d.length; i += 4) { if (d[i] < 128) dark++; h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) | 0; } return { h, dark };
}, id);
const bind = (pg, id) => pg.evaluate(id => JSON.parse(JSON.stringify(MARQ.Store.state.project.elements.find(e => e.id === id).bindings)), id);
const info = pg => pg.locator('#ep-bind-info').innerText();

(async () => {
  const browser = await chromium.launch(), ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } }), pg = await ctx.newPage(), errors = [];
  pg.on('pageerror', e => errors.push(e.message)); pg.on('console', m => { if (m.type() === 'error' && !/ERR_FILE_NOT_FOUND/.test(m.text())) errors.push(m.text()); }); // vendor/xlsx.full.min.js is absent from the repo -> harmless 404
  const shim = () => { if (!window.XLSX) window.XLSX = { read: buf => ({ SheetNames: ['Assets'], Sheets: { Assets: new TextDecoder().decode(buf).trim().split(/\r?\n/).map(l => l.split(',')) } }), utils: { sheet_to_json: ws => ws } }; };
  await pg.addInitScript(shim); await pg.goto(URL); await pg.evaluate(() => localStorage.clear()); await pg.reload(); await settle(pg);
  const importCsv = async () => { await pg.click('#btn-excel'); await pg.setInputFiles('#file-excel', { name: 'assets.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) }); await pg.click('text=Import worksheet'); await settle(pg); await pg.click('#modal-x'); await settle(pg); };

  // --- static elements, before any import ---
  const ids = await pg.evaluate(() => ({ t: MARQ.Elements.add('text'), b: MARQ.Elements.add('code128'), r: MARQ.Elements.add('rect'), h: MARQ.Elements.add('heading') }));
  await pg.evaluate(id => MARQ.Elements.select(id), ids.t); await settle(pg);
  t('text: Data source section with Static selected', await pg.locator('#ep-src-static').getAttribute('aria-pressed') === 'true' && await pg.locator('#ep-src-dynamic').getAttribute('aria-pressed') === 'false');
  t('text: static content editor unchanged', await pg.locator('#ep-text').inputValue() === 'Text');
  await pg.evaluate(id => MARQ.Elements.select(id), ids.r); await settle(pg);
  t('rect: no Data source section', await pg.locator('#ep-src-static').count() === 0);
  const staticTextSig = await sig(pg, ids.h), staticBarSig = await sig(pg, ids.b);

  // --- unavailable data ---
  await pg.evaluate(id => MARQ.Elements.select(id), ids.t); await settle(pg); await pg.click('#ep-src-dynamic'); await settle(pg);
  t('no spreadsheet: switch to dynamic works, warning shown', /No spreadsheet is loaded/.test(await info(pg)) && await pg.locator('#ep-bind-info.warn').count() === 1);
  t('no spreadsheet: column list empty (only the prompt)', await pg.locator('#ep-col option').count() === 1);
  await pg.click('#ep-src-static'); await settle(pg);

  // --- import an Excel/CSV file through the real dialog ---
  await importCsv();
  t('import: dataset loaded with 3 records', await pg.evaluate(() => { const d = MARQ.Data.active(); return !!d && d.totalRecords === 3 && d.columns.map(c => c.header).join() === 'Asset_Number,Asset_Name,Location'; }));

  // --- text element -> column ---
  await pg.evaluate(id => MARQ.Elements.select(id), ids.t); await settle(pg);
  await pg.click('#ep-src-dynamic'); await settle(pg);
  t('text: dropdown lists the spreadsheet headers', (await pg.locator('#ep-col option').allInnerTexts()).slice(1).join('|') === 'Asset_Number|Asset_Name|Location');
  t('text: dynamic keeps the existing text as template', (await bind(pg, ids.t)).text === 'Text' && await pg.locator('#ep-text').inputValue() === 'Text');
  await pg.selectOption('#ep-col', 'Asset_Number'); await settle(pg);
  t('text: mapping saved in element.bindings', (await bind(pg, ids.t)).text === '{{Asset_Number}}');
  t('text: panel shows the resolved preview', /Record 1 of 3: “AST-001”/.test(await info(pg)) && await pg.locator('#ep-bind-info.warn').count() === 0, await info(pg));
  // placeholders mixed with static text
  await pg.fill('#ep-text', 'ASSET NO: {{Asset_Number}}\nLOCATION: {{Location}}'); await settle(pg);
  t('text: mixed static + placeholders resolve', /“ASSET NO: AST-001\nLOCATION: Lobby”/.test(await info(pg)), await info(pg));
  await pg.selectOption('#ep-insert-col', 'Asset_Name'); await settle(pg);
  t('text: insert-column adds a placeholder at the caret', /\{\{Asset_Name\}\}/.test((await bind(pg, ids.t)).text) && /\{\{Asset_Name\}\}/.test(await pg.locator('#ep-text').inputValue()));
  await pg.fill('#ep-text', '{{Asset_Number}} / {{Missing_Col}}'); await settle(pg);
  t('text: missing column warns (no crash)', /Missing_Col/.test(await info(pg)) && /not found/.test(await info(pg)) && await pg.locator('#ep-bind-info.warn').count() === 1, await info(pg));
  await pg.fill('#ep-text', 'ASSET NO: {{Asset_Number}}\nLOCATION: {{Location}}'); await settle(pg);

  // --- barcode -> column ---
  await pg.evaluate(id => MARQ.Elements.select(id), ids.b); await settle(pg);
  await pg.click('#ep-src-dynamic'); await settle(pg);
  t('barcode: dynamic with no column warns and draws an error box (no crash)', /Choose a spreadsheet column/.test(await info(pg)) && (await bind(pg, ids.b)).value === '');
  t('barcode: static value input disabled while dynamic', await pg.locator('#ep-bc-value').isDisabled());
  await pg.selectOption('#ep-col', 'Asset_Number'); await settle(pg);
  t('barcode: mapping saved', (await bind(pg, ids.b)).value === '{{Asset_Number}}');
  t('barcode: panel preview shows record value, no warning', /Record 1 of 3: “AST-001”/.test(await info(pg)) && await pg.locator('#ep-bind-info.warn').count() === 0, await info(pg));
  const bar1 = await sig(pg, ids.b);
  t('barcode: renders a different symbol than the static value', bar1.h !== staticBarSig.h && bar1.dark > 50, [bar1, staticBarSig]);
  const fmt = await pg.evaluate(id => { const e = MARQ.Store.state.project.elements.find(x => x.id === id).props; return [e.format, e.moduleWidth, e.color, e.background, e.margin, e.showText]; }, ids.b);
  t('barcode: format/colours/size config untouched', JSON.stringify(fmt) === JSON.stringify(['CODE128', 0.35, '#000000', '#ffffff', 1, true]), fmt);

  // --- persistence: select other element, change record, save, reopen ---
  await pg.evaluate(id => MARQ.Elements.select(id), ids.r); await settle(pg); await pg.evaluate(id => MARQ.Elements.select(id), ids.b); await settle(pg);
  t('persist: mapping survives selecting another element', (await bind(pg, ids.b)).value === '{{Asset_Number}}' && await pg.locator('#ep-col').inputValue() === 'Asset_Number');
  await pg.evaluate(() => MARQ.Data.setPreviewIndex(1)); await settle(pg);
  const bar2 = await sig(pg, ids.b);
  t('persist: changing the record keeps mappings and re-renders the barcode', (await bind(pg, ids.b)).value === '{{Asset_Number}}' && (await bind(pg, ids.t)).text.includes('{{Location}}') && bar2.h !== bar1.h && /Record 2 of 3: “AST-002”/.test(await info(pg)), await info(pg));
  await pg.evaluate(() => MARQ.Data.setPreviewIndex(0)); await settle(pg);
  t('persist: record 1 renders the same symbol again', (await sig(pg, ids.b)).h === bar1.h);
  // empty cell (record 2 has an empty Asset_Name) -> warning
  await pg.evaluate(id => MARQ.Elements.setBinding(id, 'value', '{{Asset_Name}}'), ids.b); await pg.evaluate(() => MARQ.Data.setPreviewIndex(1)); await settle(pg);
  t('empty cell: barcode warns (is empty)', /is empty/.test(await info(pg)), await info(pg));
  // invalid barcode value for the format
  await pg.evaluate(id => { MARQ.Elements.setProp(id, 'format', 'EAN13'); MARQ.Elements.setBinding(id, 'value', '{{Asset_Number}}'); MARQ.Data.setPreviewIndex(0); }, ids.b); await settle(pg);
  t('invalid value: panel explains why it cannot be encoded', /Barcode cannot use “AST-001”/.test(await info(pg)), await info(pg));
  await pg.evaluate(id => MARQ.Elements.setProp(id, 'format', 'CODE128'), ids.b); await settle(pg);
  await pg.waitForTimeout(900); // autosave debounce
  await pg.reload(); await settle(pg);
  t('reopen: project reloaded with both mappings', await pg.evaluate(ids => { const e = id => MARQ.Store.state.project.elements.find(x => x.id === id); return !!e(ids.t) && e(ids.t).bindings.text.startsWith('ASSET NO:') && e(ids.b).bindings.value === '{{Asset_Number}}'; }, ids));
  t('reopen: spreadsheet is not loaded (imported data is not persisted)', await pg.evaluate(() => MARQ.Data.active() === null));
  await pg.evaluate(id => MARQ.Elements.select(id), ids.b); await settle(pg);
  t('reopen: panel stays dynamic, keeps the mapped column visible and warns', await pg.locator('#ep-src-dynamic').getAttribute('aria-pressed') === 'true' && await pg.locator('#ep-col').inputValue() === 'Asset_Number' && /No spreadsheet is loaded/.test(await info(pg)), await info(pg));
  t('reopen: editor did not crash with unavailable data', errors.length === 0, errors);
  await importCsv(); await pg.evaluate(id => MARQ.Elements.select(id), ids.b); await settle(pg);
  t('reopen + re-import: mapping resolves again', /Record 1 of 3: “AST-001”/.test(await info(pg)) && await pg.locator('#ep-bind-info.warn').count() === 0 && await pg.locator('#ep-col option[data-missing]').count() === 0, await info(pg));
  t('reopen + re-import: barcode renders as before', (await sig(pg, ids.b)).h === bar1.h);

  // --- missing column after a different spreadsheet is imported ---
  await pg.evaluate(() => { const d = MARQ.Data.fromAOA([['Other'], ['x']], { fileName: 'o.csv', sheetName: 'S' }); MARQ.Store.commit('import', s => { s.data[d.id] = d; s.app.activeDatasetId = d.id; }, 'data'); }); await settle(pg);
  t('missing column: flagged in dropdown and warning, no crash', await pg.locator('#ep-col option[data-missing]').count() === 1 && /not found/.test(await info(pg)), await info(pg));
  await pg.evaluate(() => MARQ.Store.commit('x', s => { s.app.activeDatasetId = null; s.data = {}; }, 'data')); await settle(pg);

  // --- static <-> dynamic ---
  await importCsv(); await pg.evaluate(id => MARQ.Elements.select(id), ids.b); await settle(pg);
  await pg.click('#ep-src-static'); await settle(pg);
  t('static again: mapping removed, static value input enabled + original barcode back', Object.keys(await bind(pg, ids.b)).length === 0 && await pg.locator('#ep-bc-value').isEnabled() && (await sig(pg, ids.b)).h !== bar1.h && await pg.locator('#ep-bind-info').innerText() === '');
  await pg.click('#ep-src-dynamic'); await settle(pg); await pg.selectOption('#ep-col', 'Location'); await settle(pg); await pg.click('#ep-src-static'); await settle(pg);
  t('static again (text): static content restored', await pg.evaluate(id => MARQ.Elements.get(id).props.text === 'Text', ids.t));
  // unchanged static heading
  const staticHeadingSig = await sig(pg, ids.h); t('static elements render exactly as before', staticHeadingSig.h === staticTextSig.h);
  // undo restores a mapping
  await pg.click('#ep-src-dynamic'); await settle(pg); await pg.selectOption('#ep-col', 'Asset_Number'); await settle(pg);
  await pg.evaluate(() => MARQ.Store.undo()); await settle(pg);
  t('undo: column pick and mode switch are separate steps', (await bind(pg, ids.b)).value === '');
  await pg.evaluate(() => MARQ.Store.undo()); await settle(pg);
  t('undo: second undo returns to static', Object.keys(await bind(pg, ids.b)).length === 0 && await pg.locator('#ep-src-static').getAttribute('aria-pressed') === 'true');
  t('no page errors during the whole run', errors.length === 0, errors);
  await browser.close(); console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
