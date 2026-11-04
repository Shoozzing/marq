// Run: NODE_PATH=$(npm root -g) node tests/browser-test-stage07b.js   (needs playwright + chromium)
// Stage 07B: live data preview + record navigation, driven through the real UI (import dialog, nav buttons, record box, canvas pixels).
const { chromium } = require('playwright'); const path = require('path'), fs = require('fs');
const URL = 'file://' + path.resolve(__dirname, '../index.html');
let fails = 0; const t = (n, c, extra) => { console.log(c ? 'ok  ' : 'FAIL', n, c || extra === undefined ? '' : '-> ' + JSON.stringify(extra)); if (!c) fails++; };
const settle = pg => pg.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
const rows = ['Asset_Number,Asset_Name,Location']; for (let i = 1; i <= 300; i++) rows.push('AST-' + String(i).padStart(3, '0') + ',' + (i === 2 ? '' : 'Pump ' + i) + ',' + (i === 3 ? '' : 'Loc ' + i));
const CSV = rows.join('\n') + '\n';
// pixel hash of the label canvas area for one element through the shared renderer (current preview record)
const sig = (pg, id) => pg.evaluate(id => {
  const p = MARQ.Store.state.project, el = p.elements.find(e => e.id === id), k = 10, only = Object.assign({}, p, { elements: [Object.assign({}, el, { x: 0, y: 0, rotation: 0 })], label: Object.assign({}, p.label, { width: el.w, height: el.h, borderWidth: 0 }) });
  const c = document.createElement('canvas'); c.width = Math.ceil(el.w * k); c.height = Math.ceil(el.h * k); const x = c.getContext('2d'); MARQ.Renderer.draw(x, only, MARQ.Data.previewRecord(), k, {});
  const d = x.getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i += 4) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) | 0; return h;
}, id);
const canvasHash = pg => pg.evaluate(() => { const c = document.getElementById('editor-canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i += 4) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) | 0; return h; });
const project = pg => pg.evaluate(() => JSON.stringify(MARQ.Store.state.project).replace(/"modified":"[^"]*"/, ''));
const counter = pg => pg.evaluate(() => ({ num: document.getElementById('rec-num').value, total: document.getElementById('rec-total').textContent, hidden: document.getElementById('rec-nav').hidden, prev: document.getElementById('rec-prev').disabled, next: document.getElementById('rec-next').disabled }));

(async () => {
  const browser = await chromium.launch(), ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } }), pg = await ctx.newPage(), errors = [];
  pg.on('pageerror', e => errors.push(e.message)); pg.on('console', m => { if (m.type() === 'error' && !/ERR_FILE_NOT_FOUND/.test(m.text())) errors.push(m.text()); });
    const shim = () => { if (!window.XLSX) window.XLSX = { read: buf => ({ SheetNames: ['Assets'], Sheets: { Assets: new TextDecoder().decode(buf).trim().split(/\r?\n/).map(l => l.split(',')) } }), utils: { sheet_to_json: ws => ws } }; };
  await pg.addInitScript(shim); await pg.goto(URL); await pg.evaluate(() => localStorage.clear()); await pg.reload(); await settle(pg);
    const importCsv = async () => { await pg.click('#btn-excel'); await pg.setInputFiles('#file-excel', { name: 'assets.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV) }); await pg.click('text=Import worksheet'); await settle(pg); await pg.click('#modal-x'); await settle(pg); };

  // static elements + dynamic elements BEFORE import
  const ids = await pg.evaluate(() => ({ t1: MARQ.Elements.add('text'), t2: MARQ.Elements.add('text'), t3: MARQ.Elements.add('text'), b: MARQ.Elements.add('code128'), q: MARQ.Elements.add('qr'), s: MARQ.Elements.add('text'), r: MARQ.Elements.add('rect') }));
  await pg.evaluate(ids => { const E = MARQ.Elements; E.setGeometry(ids.t1, { x: 2, y: 2, w: 40, h: 6 }); E.setGeometry(ids.t2, { x: 2, y: 9, w: 40, h: 6 }); E.setGeometry(ids.t3, { x: 2, y: 16, w: 40, h: 6 }); E.setGeometry(ids.b, { x: 2, y: 23, w: 40, h: 12 }); E.setGeometry(ids.q, { x: 44, y: 2, w: 12, h: 12 }); E.setGeometry(ids.s, { x: 44, y: 20, w: 20, h: 6 });
    E.setDynamic(ids.t1, true); E.setBinding(ids.t1, 'text', 'NO: {{Asset_Number}}'); E.setDynamic(ids.t2, true); E.setBinding(ids.t2, 'text', '{{Asset_Name}}'); E.setDynamic(ids.t3, true); E.setBinding(ids.t3, 'text', '{{Location}}');
    E.setDynamic(ids.b, true); E.setBinding(ids.b, 'value', '{{Asset_Number}}'); E.setDynamic(ids.q, true); E.setBinding(ids.q, 'value', '{{Asset_Number}}'); }, ids);
  t('no spreadsheet: navigation hidden, editor alive', (await counter(pg)).hidden === true);
  const staticBefore = await sig(pg, ids.s), rectBefore = await sig(pg, ids.r);

  await importCsv();
  await pg.evaluate(() => document.getElementById('modal').close()); await settle(pg);
  let c = await counter(pg);
  t('after import: "Record 1 of 300", Previous disabled, Next enabled', !c.hidden && c.num === '1' && c.total === '300' && c.prev === true && c.next === false, c);
  const layoutBefore = await project(pg), h1 = await canvasHash(pg), b1 = await sig(pg, ids.b), t1a = await sig(pg, ids.t1), q1 = await sig(pg, ids.q);
  t('first record resolved', await pg.evaluate(ids => { const r = MARQ.Data.previewRecord(), p = id => MARQ.Data.resolveProps(MARQ.Elements.get(id), r); return r.index === 0 && p(ids.t1).text === 'NO: AST-001' && p(ids.t2).text === 'Pump 1' && p(ids.b).value === 'AST-001'; }, ids));

  // --- Next ---
  await pg.click('#rec-next'); await settle(pg);
  c = await counter(pg);
  t('Next: counter 2 of 300, both buttons enabled', c.num === '2' && c.total === '300' && !c.prev && !c.next, c);
  t('Next: canvas pixels changed', (await canvasHash(pg)) !== h1);
  t('Next: barcode + QR + text pixels changed', (await sig(pg, ids.b)) !== b1 && (await sig(pg, ids.q)) !== q1 && (await sig(pg, ids.t1)) !== t1a);
  t('Next: empty Asset_Name renders as empty text (record 2)', await pg.evaluate(ids => MARQ.Data.resolveProps(MARQ.Elements.get(ids.t2), MARQ.Data.previewRecord()).text === '', ids));
  await pg.click('#rec-next'); await settle(pg);
  t('record 3: empty Location is empty, no crash', await pg.evaluate(ids => MARQ.Data.resolveProps(MARQ.Elements.get(ids.t3), MARQ.Data.previewRecord()).text === '', ids));
  // --- Previous ---
  await pg.click('#rec-prev'); await pg.click('#rec-prev'); await settle(pg);
  c = await counter(pg);
  t('Previous x2: back at record 1, Previous disabled', c.num === '1' && c.prev === true, c);
  t('Previous: canvas identical to first view', (await canvasHash(pg)) === h1 && (await sig(pg, ids.b)) === b1);
  await pg.click('#rec-prev', { force: true }).catch(() => {}); await settle(pg);
  t('cannot navigate before first record', (await counter(pg)).num === '1');

  // --- direct selection ---
  await pg.fill('#rec-num', '250'); await pg.press('#rec-num', 'Enter'); await settle(pg);
  t('direct entry 250 -> record 250', await pg.evaluate(ids => MARQ.Data.previewRecord().index === 249 && MARQ.Data.resolveProps(MARQ.Elements.get(ids.b), MARQ.Data.previewRecord()).value === 'AST-250', ids) && (await counter(pg)).num === '250');
  await pg.fill('#rec-num', '9999'); await pg.press('#rec-num', 'Enter'); await settle(pg);
  c = await counter(pg); t('direct entry beyond the end clamps to last (300), Next disabled', c.num === '300' && c.next === true, c);
  await pg.fill('#rec-num', '0'); await pg.press('#rec-num', 'Enter'); await settle(pg);
  t('direct entry 0 clamps to first', (await counter(pg)).num === '1');
  await pg.fill('#rec-num', ''); await pg.press('#rec-num', 'Enter'); await settle(pg);
  t('empty / invalid entry keeps the current record', (await counter(pg)).num === '1');
  await pg.keyboard.press('Alt+ArrowRight'); await settle(pg); t('Alt+Right = next', (await counter(pg)).num === '2'); await pg.keyboard.press('Alt+ArrowLeft'); await settle(pg);

  // --- integrity ---
  await pg.click('#rec-next'); await pg.click('#rec-next'); await pg.click('#rec-prev'); await settle(pg);
  t('layout/template/bindings unchanged after navigating', (await project(pg)) === layoutBefore);
  t('navigation made no undo step', await pg.evaluate(() => { const u = MARQ.Store.canUndo(); return u; }) === true && await pg.evaluate(() => { const before = MARQ.Store.state.project.elements.length; MARQ.Store.undo(); const changed = MARQ.Store.state.project.elements.length !== before; MARQ.Store.redo(); return !changed; }));
  t('static text + rect render exactly as before', (await sig(pg, ids.s)) === staticBefore && (await sig(pg, ids.r)) === rectBefore);
  t('imported rows untouched', await pg.evaluate(() => { const d = MARQ.Data.active(); return d.records.length === 300 && d.records[0].values.column_1 === 'AST-001' && d.records[1].values.column_2 === ''; }));
  t('element geometry unchanged (positions/sizes)', await pg.evaluate(ids => { const e = MARQ.Elements.get(ids.b); return e.x === 2 && e.y === 23 && e.w === 40 && e.h === 12; }, ids));

  // --- barcode validation + missing column on the live canvas ---
  await pg.evaluate(ids => { MARQ.Elements.setProp(ids.b, 'format', 'EAN13'); }, ids); await settle(pg);
  t('invalid value for EAN13: warning in the panel, canvas alive', await pg.evaluate(ids => { MARQ.Elements.select(ids.b); return true; }, ids) && (await settle(pg), /cannot use/.test(await pg.locator('#ep-bind-info').innerText())));
  await pg.evaluate(ids => { MARQ.Elements.setProp(ids.b, 'format', 'CODE128'); MARQ.Elements.setBinding(ids.b, 'value', '{{Location}}'); MARQ.Data.setPreviewIndex(2); }, ids); await settle(pg);
  t('empty barcode cell: flagged, no invalid barcode generated', await pg.evaluate(ids => /empty/.test(MARQ.Data.resolveProps(MARQ.Elements.get(ids.b), MARQ.Data.previewRecord())._bindingIssue), ids) && /empty/.test(await pg.locator('#ep-bind-info').innerText()));
  await pg.evaluate(ids => { MARQ.Elements.setBinding(ids.b, 'value', '{{No_Such_Column}}'); }, ids); await settle(pg);
  t('missing column: warning shown, editor still responsive', /not found/.test(await pg.locator('#ep-bind-info').innerText()));
  await pg.click('#rec-next'); await settle(pg);
  t('navigation still works with a broken mapping', (await counter(pg)).num === '4');
  t('panel preview follows the record', /Record 4 of 300/.test(await pg.locator('#ep-bind-info').innerText()));
  await pg.evaluate(ids => { MARQ.Elements.setBinding(ids.b, 'value', '{{Asset_Number}}'); MARQ.Data.setPreviewIndex(0); }, ids); await settle(pg);

  // --- performance: 300 rapid clicks ---
  const ms = await pg.evaluate(async () => { const t0 = performance.now(); for (let i = 0; i < 299; i++) { document.getElementById('rec-next').click(); await new Promise(r => requestAnimationFrame(r)); } return performance.now() - t0; });
  t('299 Next clicks, each repainted (' + Math.round(ms) + ' ms total, ' + (ms / 299).toFixed(1) + ' ms/record)', (await counter(pg)).num === '300' && ms / 299 < 40);
  t('panel not rebuilt by navigation (same DOM nodes)', await pg.evaluate(ids => { MARQ.Elements.select(ids.t1); return true; }, ids) && await (async () => { await settle(pg); await pg.evaluate(() => { window.__n = document.getElementById('ep-bind-info'); }); await pg.click('#rec-prev'); await settle(pg); return pg.evaluate(() => window.__n === document.getElementById('ep-bind-info')); })());
  // --- a project reopened without data does not crash ---
  await pg.evaluate(() => { MARQ.Store.state.app.activeDatasetId = null; MARQ.Store.commit('x', () => {}, 'app'); }); await settle(pg);
  t('dataset unavailable: navigation hides, canvas still draws', (await counter(pg)).hidden === true && (await canvasHash(pg)) !== 0);
  t('no page errors during the whole run', errors.length === 0, errors);
  await browser.close(); console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})();
