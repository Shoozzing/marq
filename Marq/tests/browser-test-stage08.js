// Run: NODE_PATH=$(npm root -g) node tests/browser-test-stage08.js   (needs playwright + chromium)
// Stage 08: bulk label generator driven through the real UI (import dialog, Generate Labels dialog, checkboxes, search, navigation, canvas pixels).
const { chromium } = require('playwright'); const path = require('path'), fs = require('fs');
const URL = 'file://' + path.resolve(__dirname, '../index.html');
let fails = 0; const t = (n, c, extra) => { console.log(c ? 'ok  ' : 'FAIL', n, c || extra === undefined ? '' : '-> ' + JSON.stringify(extra)); if (!c) fails++; };
const settle = pg => pg.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
const mkCsv = n => { const r = ['Asset_Number,Asset_Name,Location']; for (let i = 1; i <= n; i++) r.push((i === 5 ? '' : i === 11 ? 'AST-00010' : 'AST-' + String(i).padStart(5, '0')) + ',' + (i === 3 ? '' : 'Pump ' + i) + ',Loc ' + (i % 7)); return r.join('\n') + '\n'; };
const stats = pg => pg.evaluate(() => { const o = {}; document.querySelectorAll('#gen-sum .gen-stat').forEach(s => { o[s.textContent.replace(/^[\d,]+\s*/, '').trim()] = parseInt(s.querySelector('b').textContent, 10); }); return o; });
const waitDone = pg => pg.waitForFunction(() => /Finished|Cancelled/.test((document.getElementById('gen-prog') || {}).textContent || ''), null, { timeout: 60000 });
const canvasHash = pg => pg.evaluate(() => { const c = document.getElementById('gen-canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i += 4) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) | 0; return h; });
const project = pg => pg.evaluate(() => JSON.stringify(MARQ.Store.state.project).replace(/"modified":"[^"]*"/, ''));
const nav = pg => pg.evaluate(() => ({ num: document.getElementById('gen-num').value, count: document.getElementById('gen-count').textContent, prev: document.getElementById('gen-prev').disabled, next: document.getElementById('gen-next').disabled, info: document.getElementById('gen-info').innerText }));

(async () => {
  const browser = await chromium.launch(), ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } }), pg = await ctx.newPage(), errors = [];
  pg.on('pageerror', e => errors.push(e.message)); pg.on('console', m => { if (m.type() === 'error' && !/ERR_FILE_NOT_FOUND/.test(m.text())) errors.push(m.text()); });
      const shim = () => { if (!window.XLSX) window.XLSX = { read: buf => ({ SheetNames: ['Assets'], Sheets: { Assets: new TextDecoder().decode(buf).trim().split(/\r?\n/).map(l => l.split(',')) } }), utils: { sheet_to_json: ws => ws } }; };
  await pg.addInitScript(shim); await pg.goto(URL); await pg.evaluate(() => localStorage.clear()); await pg.reload(); await settle(pg);
  const importCsv = async (csv) => { await pg.click('#btn-excel'); await pg.setInputFiles('#file-excel', { name: 'assets.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) }); await pg.click('text=Import worksheet'); await settle(pg); await pg.evaluate(() => document.getElementById('modal').close()); await settle(pg); };

  t('no spreadsheet: dialog explains what to do, no crash', await (async () => { await pg.click('#btn-generate'); const txt = await pg.locator('#modal-body').innerText(); await pg.evaluate(() => document.getElementById('modal').close()); return /Import a spreadsheet/.test(txt); })());
  const ids = await pg.evaluate(() => { const E = MARQ.Elements, o = { t1: E.add('text'), t2: E.add('text'), b: E.add('code128'), q: E.add('qr'), s: E.add('text') };
    E.setGeometry(o.t1, { x: 2, y: 2, w: 40, h: 6 }); E.setGeometry(o.t2, { x: 2, y: 9, w: 40, h: 6 }); E.setGeometry(o.b, { x: 2, y: 16, w: 40, h: 12 }); E.setGeometry(o.q, { x: 44, y: 2, w: 12, h: 12 }); E.setGeometry(o.s, { x: 44, y: 20, w: 20, h: 6 });
    E.setDynamic(o.t1, true); E.setBinding(o.t1, 'text', 'NO: {{Asset_Number}}'); E.setDynamic(o.t2, true); E.setBinding(o.t2, 'text', '{{Asset_Name}} / {{Location}}');
    E.setDynamic(o.b, true); E.setBinding(o.b, 'value', '{{Asset_Number}}'); E.setDynamic(o.q, true); E.setBinding(o.q, 'value', '{{Asset_Number}}'); return o; });
  await importCsv(mkCsv(400));
  const layout0 = await project(pg);

  // --- open + auto generate all ---
  await pg.click('#btn-generate'); await waitDone(pg); await settle(pg);
  let st = await stats(pg);
  t('opens wide, generates everything: 400 total, 399 completed, 1 failed (row 5 empty barcode)', st['total labels'] === 400 && st['completed'] === 399 && st['failed'] === 1, st);
  t('warnings counted (empty name row 3, duplicate pair rows 10/11)', st['with warnings'] === 3, st);
  t('progress bar finished', await pg.evaluate(() => { const b = document.getElementById('gen-bar'); return b.value === b.max && /Finished 400 of 400/.test(document.getElementById('gen-prog').textContent); }));
  t('template-level notice for duplicates shown', /share a barcode/.test(await pg.locator('#gen-notes').innerText()));
  let n = await nav(pg);
  t('preview: Label 1 of 400, Previous disabled', n.num === '1' && n.count === '400' && n.prev === true && n.next === false, n);
  const h1 = await canvasHash(pg);
  await pg.click('#gen-next'); await settle(pg); await settle(pg); const h2 = await canvasHash(pg);
  n = await nav(pg); t('Next: Label 2 of 400, canvas differs', n.num === '2' && h2 !== h1, n);
  await pg.click('#gen-next'); await settle(pg); n = await nav(pg);
  t('label 3 (empty name) shows a warning, still previews', /warnings/.test(n.info) && /Asset_Name/.test(n.info) && n.num === '3', n.info);
  await pg.click('#gen-prev'); await pg.click('#gen-prev'); await settle(pg); await settle(pg);
  t('Previous x2 returns to label 1 with identical pixels', (await canvasHash(pg)) === h1 && (await nav(pg)).prev === true);
  await pg.fill('#gen-num', '5'); await pg.press('#gen-num', 'Enter'); await settle(pg); await settle(pg);
  n = await nav(pg); t('direct entry 5: failed label shows the barcode problem', n.num === '5' && /Failed/.test(n.info) && /empty/.test(n.info), n.info);
  t('failed label still draws an error box instead of crashing', (await canvasHash(pg)) !== h1);
  await pg.fill('#gen-num', '9999'); await pg.press('#gen-num', 'Enter'); await settle(pg); n = await nav(pg); t('entry beyond the end clamps to the last label', n.num === '400' && n.next === true, n);

  // --- search ---
  await pg.fill('#gen-search', 'AST-00042'); await settle(pg); await settle(pg);
  t('search by asset number: one row, navigation limited to it', await pg.locator('#gen-list tbody tr').count() === 1 && (await nav(pg)).count === '1');
  await pg.fill('#gen-search', 'AST-0001'); await settle(pg); t('search matches a range (AST-0001x = 10: row 11 is a duplicate of 00010)', await pg.locator('#gen-list tbody tr').count() === 10 && (await nav(pg)).count === '10');
  await pg.fill('#gen-search', 'zzz-nothing'); await settle(pg); t('search with no match: message, no crash', await pg.locator('#gen-list tbody tr').count() === 0 && /No generated labels match/.test(await pg.locator('#gen-info').innerText()));
  await pg.fill('#gen-search', ''); await settle(pg);

  // --- exclude / select through the list: regenerates automatically ---
  await pg.fill('#gen-search', 'AST-00002'); await settle(pg); // rows AST-00002, AST-00020..29 ... (11)
  await pg.locator('#gen-list tbody tr').first().locator('input').nth(1).check(); await pg.waitForTimeout(500); await waitDone(pg); await settle(pg);
  st = await stats(pg); t('excluding a record regenerates: 399 total', st['total labels'] === 399 && st['completed'] === 398, st);
  await pg.fill('#gen-search', ''); await settle(pg);
  t('excluded row marked skipped', await pg.locator('#gen-list tr.stage06-excluded td.gen-st').first().innerText() === 'skipped');
  await pg.selectOption('.gen-top select >> nth=1', 'failed'); await settle(pg); t('filter: failed only = 1 row', await pg.locator('#gen-list tbody tr').count() === 1);
  await pg.selectOption('.gen-top select >> nth=1', 'all'); await settle(pg);
  await pg.click('text=Clear'); await pg.waitForTimeout(500); await waitDone(pg); await settle(pg); st = await stats(pg);
  t('Clear (shown rows) -> nothing selected: 0 labels, clear message', st['total labels'] === 0 && /Nothing to generate/.test(await pg.locator('#gen-info').innerText()), st);
  await pg.selectOption('.gen-top select >> nth=0', 'all'); await pg.waitForTimeout(500); await waitDone(pg); await settle(pg); st = await stats(pg);
  t('"All records" ignores ticks but still skips excluded: 399', st['total labels'] === 399, st);
  await pg.selectOption('.gen-top select >> nth=0', 'selected'); await pg.waitForTimeout(300);
  await pg.click('text=Use all'); await pg.waitForTimeout(500); await waitDone(pg); await settle(pg); st = await stats(pg);
  t('Use all -> selected again: 399', st['total labels'] === 399, st);
  await pg.locator('#gen-list tbody tr').nth(2).locator('input').first().uncheck(); await pg.waitForTimeout(500); await waitDone(pg); await settle(pg); st = await stats(pg);
  t('unticking one record: 398', st['total labels'] === 398, st);
  await pg.click('text=Unskip'); await pg.click('text=Use all'); await pg.waitForTimeout(500); await waitDone(pg); await settle(pg); st = await stats(pg); t('Unskip + Use all restores 400', st['total labels'] === 400, st);

  // --- integrity ---
  await pg.evaluate(() => document.getElementById('modal').close()); await settle(pg);
  t('template unchanged (layout, bindings, static content)', (await project(pg)) === layout0);
  t('no undo steps added by generating', await pg.evaluate(() => { const b = MARQ.Elements.get; const before = JSON.stringify(MARQ.Store.state.project.elements); MARQ.Store.undo(); const after = JSON.stringify(MARQ.Store.state.project.elements); MARQ.Store.redo(); return before !== after; }));
  t('dialog closed: wide class removed so other dialogs keep their size', await pg.evaluate(() => !document.getElementById('modal').classList.contains('gen-wide')));
  t('editor canvas still works afterwards (next record in main editor)', await pg.click('#rec-next').then(() => true).catch(() => false));

  // --- missing column / template change while closed -> regenerates on reopen ---
  await pg.evaluate(ids => { MARQ.Elements.setBinding(ids.b, 'value', '{{No_Such_Column}}'); }, ids);
  await pg.click('#btn-generate'); await waitDone(pg); await settle(pg); st = await stats(pg);
  t('missing mapped column: notice + all fail, dialog alive', /No_Such_Column/.test(await pg.locator('#gen-notes').innerText()) && st['failed'] === 400, st);
  await pg.evaluate(() => document.getElementById('modal').close());
  await pg.evaluate(ids => { MARQ.Elements.setBinding(ids.b, 'value', '{{Asset_Number}}'); }, ids);

  // --- large dataset through the real import dialog ---
  await importCsv(mkCsv(5000));
  const t0 = Date.now(); await pg.click('#btn-generate'); await pg.waitForSelector('#gen-list tbody tr'); const firstPaint = Date.now() - t0; await waitDone(pg); const total = Date.now() - t0; st = await stats(pg);
  t('5000 records: 5000 total, 4999 completed, 1 failed (' + firstPaint + ' ms to first paint, ' + total + ' ms to finish)', st['total labels'] === 5000 && st['completed'] === 4999 && st['failed'] === 1 && total < 15000, st);
  t('list renders one page only (<=100 rows), not 5000', await pg.locator('#gen-list tbody tr').count() <= 100);
  const navMs = await pg.evaluate(async () => { const t0 = performance.now(); for (let i = 0; i < 100; i++) { document.getElementById('gen-next').click(); await new Promise(r => requestAnimationFrame(r)); } return performance.now() - t0; });
  t('100 label navigations at 5000 records: ' + (navMs / 100).toFixed(1) + ' ms each', navMs / 100 < 35 && (await nav(pg)).num === '101');
  await pg.evaluate(() => { const c = document.getElementById('gen-search'); c.value = 'AST-04999'; c.dispatchEvent(new Event('input')); }); await settle(pg);
  t('search in 5000 records', await pg.locator('#gen-list tbody tr').count() === 1);
  await pg.fill('#gen-search', ''); await settle(pg);
  // cancel a run
  await pg.selectOption('.gen-top select >> nth=0', 'all'); await pg.click('#gen-run'); await pg.click('#gen-cancel', { timeout: 500 }).catch(() => {}); await pg.waitForTimeout(300);
  t('Cancel (or an already finished run) leaves the dialog usable', await pg.locator('#gen-list tbody tr').count() > 0);
  await pg.evaluate(() => document.getElementById('modal').close());
  t('no page errors during the whole run', errors.length === 0, errors);
  await browser.close(); console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); process.exit(fails ? 1 : 0);
})();
