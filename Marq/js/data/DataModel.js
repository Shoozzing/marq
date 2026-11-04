(function (MARQ) {
  'use strict';
  const PAGE_SIZE = 100;
  const ui = { page: 0, search: '', filter: 'all', sort: null, direction: 1 };
  const $ = id => document.getElementById(id);
  const text = value => value == null ? '' : String(value).replace(/\u0000/g, '');
  const dataset = () => {
    const state = MARQ.Store.state, id = state.app.activeDatasetId;
    return id && state.data[id] || null;
  };
  const status = (message, error) => MARQ.Shell.toast(message, !!error);

  function detectHeader(rows) {
    if (!Array.isArray(rows) || rows.length < 2) return false;
    const first = Array.isArray(rows[0]) ? rows[0] : [];
    const populated = first.map(text).map(value => value.trim()).filter(Boolean);
    if (!populated.length) return false;
    const unique = new Set(populated.map(value => value.toLocaleLowerCase())).size === populated.length;
    const textRatio = populated.filter(value => !/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(value)).length / populated.length;
    const followingRowsHaveData = rows.slice(1, 6).some(row => (row || []).some(value => text(value).trim()));
    return unique && textRatio >= 0.6 && followingRowsHaveData;
  }

  function fromAOA(rows, meta) {
    meta = meta || {};
    if (!Array.isArray(rows) || !rows.length) throw new Error('The worksheet is empty.');
    const width = Math.max(0, ...rows.map(row => Array.isArray(row) ? row.length : 0));
    if (!width) throw new Error('The worksheet has no columns.');
    const hasHeader = meta.hasHeader !== false;
    const header = hasHeader && Array.isArray(rows[0]) ? rows[0] : [];
    const used = new Set();
    const columns = Array.from({ length: width }, (_, index) => {
      const name = hasHeader ? text(header[index]).trim() || 'Column ' + (index + 1) : 'Column ' + (index + 1);
      let key = 'column_' + (index + 1), suffix = 2;
      while (used.has(key)) key = 'column_' + (index + 1) + '_' + suffix++;
      used.add(key);
      return { key, header: name, index };
    });
    const records = [], occurrences = new Map();
    for (let sourceIndex = hasHeader ? 1 : 0; sourceIndex < rows.length; sourceIndex++) {
      const source = Array.isArray(rows[sourceIndex]) ? rows[sourceIndex] : [];
      const values = columns.map(column => text(source[column.index]));
      if (values.every(value => !value.trim())) continue;
      const fingerprint = JSON.stringify(values), occurrence = (occurrences.get(fingerprint) || 0) + 1;
      occurrences.set(fingerprint, occurrence);
      const fields = {};
      columns.forEach((column, index) => { fields[column.key] = values[index]; });
      records.push({ id: MARQ.Model.uid('rec'), sourceRow: sourceIndex + 1, values: fields, selected: true, excluded: false, duplicate: occurrence > 1 });
    }
    const duplicateCount = [...occurrences.values()].reduce((sum, count) => sum + Math.max(0, count - 1), 0);
    return {
      id: MARQ.Model.uid('ds'), fileName: text(meta.fileName || ''), sheetName: text(meta.sheetName || ''),
      columns, records, totalRecords: records.length, duplicateRows: duplicateCount,
      selectedCount: records.length, excludedCount: 0, importedAt: new Date().toISOString()
    };
  }

  function recount(ds) {
    ds.totalRecords = ds.records.length;
    ds.selectedCount = ds.records.filter(record => record.selected && !record.excluded).length;
    ds.excludedCount = ds.records.filter(record => record.excluded).length;
  }
  /* ---------- Stage 07A: dynamic data mapping ---------- */
  // Placeholders use the spreadsheet's column HEADER ({{Asset_Number}}); matching is exact first, then case/space-insensitive, then the internal key.
  // Only these element props can be bound: text elements -> 'text' (a template that may mix static text and placeholders), barcodes/QR -> 'value'.
  const BOUND = { text: 'text', barcode: 'value', qr: 'value' };
  const TOKEN = /\{\{\s*([^}]+?)\s*\}\}/g, has = (o, k) => Object.prototype.hasOwnProperty.call(o, k), norm = v => String(v).trim().toLocaleLowerCase();
  const active = () => {
    const s = MARQ.Store && MARQ.Store.state; if (!s) return null;
    const id = s.app.activeDatasetId || (s.project.dataBinding && s.project.dataBinding.datasetId);
    return id && s.data[id] || null;
  };
  const columns = () => { const ds = active(); return ds ? [...new Set(ds.columns.map(column => column.header))] : []; };
  const signature = () => { const ds = active(); return ds ? ds.id + ':' + ds.columns.length : ''; };
  const tokens = template => { const out = []; String(template == null ? '' : template).replace(TOKEN, (_, name) => { if (!out.includes(name)) out.push(name); return ''; }); return out; };
  // The record being previewed on the canvas: the dataset's records[app.previewIndex], decorated so placeholders resolve by header.
  let memo = null; const lowerCache = new WeakMap(); // header lookup tables are built once per dataset column list, not per record
  // Stage 08: the decorated, read-only view of ANY record (the preview and the bulk generator share it); never mutates the dataset.
  function recordView(index, ds) {
    ds = ds || active(); if (!ds || !Array.isArray(ds.records) || !ds.records.length) return null;
    index = Math.min(Math.max(0, index | 0), ds.records.length - 1);
    const record = ds.records[index];
    if (memo && memo.record === record && memo.columns === ds.columns) return memo.view;
    let lower = lowerCache.get(ds.columns);
    if (!lower) { lower = Object.create(null); ds.columns.forEach(column => { if (!has(lower, norm(column.header))) lower[norm(column.header)] = column.header; }); lowerCache.set(ds.columns, lower); }
    const byHeader = Object.create(null);
    ds.columns.forEach(column => { if (!has(byHeader, column.header)) byHeader[column.header] = record.values[column.key]; });
    const view = Object.assign({}, record, { byHeader, lower, index, count: ds.records.length });
    memo = { record, columns: ds.columns, view }; return view;
  }
  const previewRecord = () => recordView(MARQ.Store.state.app.previewIndex);
  function lookup(record, name) { // -> { found, value }
    if (!record) return { found: false };
    const by = record.byHeader;
    if (by) {
      if (has(by, name)) return { found: true, value: by[name] };
      const header = record.lower && record.lower[norm(name)]; if (header !== undefined) return { found: true, value: by[header] };
    }
    const values = record.values || {};
    return has(values, name) ? { found: true, value: values[name] } : { found: false };
  }
  // -> { text, missing[], empty[] }. Unknown columns (or no record at all) keep their {{placeholder}} unless opts.blank; empty cells give ''.
  function resolveTemplate(template, record, opts) {
    const missing = [], empty = [];
    const text = String(template == null ? '' : template).replace(TOKEN, (whole, name) => {
      const hit = lookup(record, name);
      if (!hit.found) { if (!missing.includes(name)) missing.push(name); return opts && opts.blank ? '' : whole; }
      const value = hit.value == null ? '' : String(hit.value);
      if (!value.trim() && !empty.includes(name)) empty.push(name);
      return value;
    });
    return { text, missing, empty };
  }
  const resolve = (template, record) => resolveTemplate(template, record, { blank: true }).text;
  // Per-record props; never mutates the element. A bound barcode/QR that cannot get a value carries props._bindingIssue for its drawer.
  function resolveProps(element, record) {
    const props = Object.assign({}, element.props), bindings = element.bindings || {};
    for (const key in bindings) {
      if (typeof bindings[key] !== 'string') continue;
      const result = resolveTemplate(bindings[key], record, { blank: element.type !== 'text' });
      props[key] = result.text;
      if (BOUND[element.type] === 'value' && key === 'value') {
        const issue = !bindings[key].trim() ? 'No spreadsheet column is selected.' : !record ? 'No spreadsheet record is available.'
          : result.missing.length ? 'Column “' + result.missing[0] + '” was not found in the spreadsheet.' : !result.text.trim() ? 'Column “' + tokens(bindings[key])[0] + '” is empty for this record.' : '';
        if (issue) props._bindingIssue = issue;
      }
    }
    return props;
  }
  // What the properties panel tells the user about a bound element: { preview, issues[] } or null for static elements.
  function diagnose(element) {
    const prop = BOUND[element.type], template = prop && element.bindings && element.bindings[prop];
    if (typeof template !== 'string') return null;
    const ds = active(), record = previewRecord(), issues = [];
    if (!ds) issues.push('No spreadsheet is loaded. Use Import Excel (after reopening a project, import the file again) to see real values.');
    else if (!record) issues.push('The imported spreadsheet has no records to preview.');
    else {
      const result = resolveTemplate(template, record);
      result.missing.forEach(name => issues.push('Column “' + name + '” was not found in the imported spreadsheet.'));
      result.empty.forEach(name => issues.push('Column “' + name + '” is empty for the previewed record.'));
    }
    if (!tokens(template).length && element.type !== 'text') issues.push('Choose a spreadsheet column for this barcode.');
    const props = resolveProps(element, record);
    if (element.type === 'barcode' && record && !props._bindingIssue) { const error = MARQ.Barcodes.validate(props.format, props.value); if (error) issues.push('Barcode cannot use “' + props.value + '”: ' + error); }
    const where = record ? 'Record ' + (record.index + 1) + ' of ' + record.count + ': ' : 'Preview: ';
    return { preview: where + (props[prop] === '' ? '(empty)' : '“' + props[prop] + '”'), issues };
  }
  // Stage 07B: the previewed record is transient APP state (not project): switching records never touches the template, undo history, modified stamp or autosave, and never copies/mutates dataset rows.
  const recordCount = () => { const ds = active(); return ds && Array.isArray(ds.records) ? ds.records.length : 0; };
  const previewIndex = () => { const n = recordCount(); return n ? Math.min(Math.max(0, MARQ.Store.state.app.previewIndex | 0), n - 1) : 0; };
  function setPreviewIndex(index) { // -> the effective (clamped) index; no commit when nothing changes
    const n = recordCount(), next = n ? Math.min(Math.max(0, Math.trunc(Number(index)) || 0), n - 1) : 0;
    if ((MARQ.Store.state.app.previewIndex | 0) !== next) MARQ.Store.commit('preview record', s => { s.app.previewIndex = next; }, 'app');
    return next;
  }
  const stepPreview = delta => setPreviewIndex(previewIndex() + delta);
  MARQ.Data = Object.assign(MARQ.Data || {}, { fromAOA, detectHeader, resolve, resolveProps, recount, BOUND, active, columns, signature, tokens, previewRecord, recordView, resolveTemplate, diagnose, setPreviewIndex, stepPreview, previewIndex, recordCount });

  function workbookRows(workbook, name) {
    return XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: '', raw: false, blankrows: true });
  }
  function importFile(file) {
    if (!window.XLSX) return status('SheetJS is unavailable. Check vendor/xlsx.full.min.js.', true);
    const reader = new FileReader();
    reader.onerror = () => status('Could not read the selected spreadsheet.', true);
    reader.onload = event => {
      try {
        const workbook = XLSX.read(event.target.result, { type: 'array', raw: false, cellDates: true, dense: true });
        if (!workbook.SheetNames || !workbook.SheetNames.length) throw new Error('No worksheets found.');
        showWorksheetDialog(file, workbook);
      } catch (error) { status('Spreadsheet import failed: ' + (error.message || error), true); }
    };
    reader.readAsArrayBuffer(file); // The uploaded file is read only and never modified.
  }

  function showWorksheetDialog(file, workbook) {
    const dialog = $('modal'), title = $('modal-title'), body = $('modal-body');
    title.textContent = 'Import spreadsheet'; body.textContent = '';
    const intro = document.createElement('p'); intro.className = 'note';
    intro.textContent = file.name + ' · Choose a worksheet and confirm header detection.'; body.appendChild(intro);
    const controls = document.createElement('div'); controls.className = 'stage06-controls';
    const sheetLabel = document.createElement('label'); sheetLabel.className = 'fld'; sheetLabel.appendChild(document.createTextNode('Worksheet'));
    const sheetSelect = document.createElement('select'); workbook.SheetNames.forEach(name => sheetSelect.add(new Option(name, name)));
    sheetLabel.appendChild(sheetSelect); controls.appendChild(sheetLabel);
    const headerLabel = document.createElement('label'); headerLabel.className = 'chk stage06-header';
    const headerToggle = document.createElement('input'); headerToggle.type = 'checkbox';
    headerLabel.append(headerToggle, document.createTextNode('First row contains column names')); controls.appendChild(headerLabel); body.appendChild(controls);
    const sample = document.createElement('div'); sample.className = 'stage06-sample'; body.appendChild(sample);
    function updateSample(detect) {
      const aoa = workbookRows(workbook, sheetSelect.value);
      if (detect) headerToggle.checked = detectHeader(aoa);
      sample.textContent = '';
      if (!aoa.length) { sample.textContent = 'This worksheet is empty.'; return; }
      const table = document.createElement('table'); table.className = 'stage06-table';
      aoa.slice(0, 6).forEach(row => {
        const tr = document.createElement('tr');
        (row || []).slice(0, 10).forEach(value => { const td = document.createElement('td'); td.textContent = text(value); tr.appendChild(td); });
        table.appendChild(tr);
      });
      sample.appendChild(table);
    }
    sheetSelect.addEventListener('change', () => updateSample(true)); updateSample(true);
    const actions = document.createElement('div'); actions.className = 'stage06-actions';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'chip act'; cancel.textContent = 'Cancel'; cancel.onclick = () => dialog.close();
    const submit = document.createElement('button'); submit.type = 'button'; submit.className = 'chip act'; submit.textContent = 'Import worksheet';
    submit.onclick = () => {
      try {
        const name = sheetSelect.value;
        const ds = fromAOA(workbookRows(workbook, name), { fileName: file.name, sheetName: name, hasHeader: headerToggle.checked });
        if (!ds.totalRecords) throw new Error('No non-empty records were found.');
        MARQ.Store.commit('import spreadsheet', state => { state.data[ds.id] = ds; state.app.activeDatasetId = ds.id; state.app.previewIndex = 0; }, 'data');
        ui.page = 0; ui.search = ''; ui.filter = 'all'; ui.sort = null; ui.direction = 1;
        dialog.close(); showPreview(); status('Imported ' + ds.totalRecords + ' records from ' + name + '.');
      } catch (error) { status('Import failed: ' + (error.message || error), true); }
    };
    actions.append(cancel, submit); body.appendChild(actions); dialog.showModal();
  }

  function filteredRecords(ds) {
    let rows = ds.records.map((record, index) => ({ record, index }));
    const query = ui.search.trim().toLocaleLowerCase();
    if (query) rows = rows.filter(({ record }) => ds.columns.some(column => String(record.values[column.key] || '').toLocaleLowerCase().includes(query)));
    if (ui.filter === 'selected') rows = rows.filter(({ record }) => record.selected && !record.excluded);
    else if (ui.filter === 'unselected') rows = rows.filter(({ record }) => !record.selected && !record.excluded);
    else if (ui.filter === 'excluded') rows = rows.filter(({ record }) => record.excluded);
    if (ui.sort) {
      const column = ds.columns.find(item => item.key === ui.sort);
      if (column) rows.sort((a, b) => String(a.record.values[column.key] || '').localeCompare(String(b.record.values[column.key] || ''), undefined, { numeric: true, sensitivity: 'base' }) * ui.direction || a.index - b.index);
    }
    return rows;
  }

  function updateRecords(label, mutate) {
    const state = MARQ.Store.state, id = state.app.activeDatasetId;
    if (!id || !state.data[id]) return;
    MARQ.Store.commit(label, root => { mutate(root.data[id]); recount(root.data[id]); }, 'data');
    if ($('stage06-table-wrap')) renderTable(dataset());
  }

  function renderTable(ds) {
    const host = $('stage06-table-wrap'), summary = $('stage06-summary'), paging = $('stage06-paging');
    if (!host || !summary || !paging || !ds) return;
    const filtered = filteredRecords(ds), pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    ui.page = Math.min(ui.page, pageCount - 1);
    const visible = filtered.slice(ui.page * PAGE_SIZE, (ui.page + 1) * PAGE_SIZE);
    summary.textContent = ds.fileName + ' · ' + ds.sheetName + ' · ' + ds.totalRecords + ' imported · ' + ds.selectedCount + ' selected · ' + ds.excludedCount + ' excluded' + (ds.duplicateRows ? ' · ' + ds.duplicateRows + ' duplicate rows retained' : '');
    host.textContent = '';
    const table = document.createElement('table'); table.className = 'stage06-table';
    const thead = document.createElement('thead'), headRow = document.createElement('tr');
    const selectTh = document.createElement('th'), selectVisible = document.createElement('input'); selectVisible.type = 'checkbox'; selectVisible.title = 'Select visible records';
    selectVisible.checked = visible.length > 0 && visible.every(item => item.record.selected && !item.record.excluded);
    selectVisible.onchange = () => updateRecords('select visible records', data => visible.forEach(item => { const record = data.records[item.index]; record.selected = selectVisible.checked; if (selectVisible.checked) record.excluded = false; }));
    selectTh.appendChild(selectVisible); headRow.appendChild(selectTh);
    const excludeTh = document.createElement('th'); excludeTh.textContent = 'Exclude'; headRow.appendChild(excludeTh);
    ds.columns.forEach(column => {
      const th = document.createElement('th'), button = document.createElement('button'); button.type = 'button'; button.className = 'stage06-sort';
      button.textContent = column.header + (ui.sort === column.key ? (ui.direction > 0 ? ' ▲' : ' ▼') : '');
      button.onclick = () => { if (ui.sort === column.key) ui.direction *= -1; else { ui.sort = column.key; ui.direction = 1; } renderTable(ds); };
      th.appendChild(button); headRow.appendChild(th);
    });
    thead.appendChild(headRow); table.appendChild(thead);
    const tbody = document.createElement('tbody');
    visible.forEach(({ record, index }) => {
      const tr = document.createElement('tr'); if (record.excluded) tr.className = 'stage06-excluded';
      const selectTd = document.createElement('td'), selected = document.createElement('input'); selected.type = 'checkbox'; selected.checked = record.selected && !record.excluded;
      selected.setAttribute('aria-label', 'Select record ' + (index + 1));
      selected.onchange = () => updateRecords('select record', data => { const row = data.records[index]; row.selected = selected.checked; if (selected.checked) row.excluded = false; });
      selectTd.appendChild(selected); tr.appendChild(selectTd);
      const excludeTd = document.createElement('td'), excluded = document.createElement('input'); excluded.type = 'checkbox'; excluded.checked = record.excluded;
      excluded.setAttribute('aria-label', 'Exclude record ' + (index + 1));
      excluded.onchange = () => updateRecords('exclude record', data => { const row = data.records[index]; row.excluded = excluded.checked; if (excluded.checked) row.selected = false; });
      excludeTd.appendChild(excluded); tr.appendChild(excludeTd);
      ds.columns.forEach(column => { const td = document.createElement('td'); td.textContent = record.values[column.key] == null ? '' : String(record.values[column.key]); if (record.duplicate) td.title = 'Duplicate row retained from the source file'; tr.appendChild(td); });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody); host.appendChild(table);
    paging.textContent = '';
    const previous = document.createElement('button'); previous.type = 'button'; previous.className = 'chip act'; previous.textContent = 'Previous'; previous.disabled = ui.page === 0;
    previous.onclick = () => { ui.page--; renderTable(ds); };
    const pageText = document.createElement('span'); pageText.textContent = 'Page ' + (ui.page + 1) + ' of ' + pageCount + ' · ' + filtered.length + ' matching records';
    const next = document.createElement('button'); next.type = 'button'; next.className = 'chip act'; next.textContent = 'Next'; next.disabled = ui.page >= pageCount - 1;
    next.onclick = () => { ui.page++; renderTable(ds); };
    paging.append(previous, pageText, next);
  }

  function showPreview() {
    const dialog = $('modal'), title = $('modal-title'), body = $('modal-body'), ds = dataset();
    if (!dialog || !title || !body) return;
    title.textContent = 'Data Preview'; body.textContent = '';
    if (!ds) { const empty = document.createElement('div'); empty.className = 'empty'; empty.textContent = 'Import an XLSX, XLS, or CSV spreadsheet to preview its records.'; body.appendChild(empty); dialog.showModal(); return; }
    const toolbar = document.createElement('div'); toolbar.className = 'stage06-toolbar';
    const search = document.createElement('input'); search.type = 'search'; search.placeholder = 'Search records…'; search.setAttribute('aria-label', 'Search records'); search.value = ui.search;
    search.oninput = () => { ui.search = search.value; ui.page = 0; renderTable(ds); };
    const filter = document.createElement('select'); filter.setAttribute('aria-label', 'Filter records');
    [['all', 'All records'], ['selected', 'Selected'], ['unselected', 'Not selected'], ['excluded', 'Excluded']].forEach(([value, label]) => filter.add(new Option(label, value)));
    filter.value = ui.filter; filter.onchange = () => { ui.filter = filter.value; ui.page = 0; renderTable(ds); };
    const action = (label, callback) => { const button = document.createElement('button'); button.type = 'button'; button.className = 'chip act'; button.textContent = label; button.onclick = callback; return button; };
    toolbar.append(search, filter,
      action('Select all records', () => updateRecords('select all records', data => data.records.forEach(record => { if (!record.excluded) record.selected = true; }))),
      action('Clear selection', () => updateRecords('clear selection', data => data.records.forEach(record => { record.selected = false; }))),
      action('Exclude selected', () => updateRecords('exclude selected records', data => data.records.forEach(record => { if (record.selected) { record.selected = false; record.excluded = true; } }))),
      action('Include all', () => updateRecords('include all records', data => data.records.forEach(record => { record.excluded = false; }))));
    body.appendChild(toolbar);
    const summary = document.createElement('div'); summary.id = 'stage06-summary'; summary.className = 'stage06-summary'; body.appendChild(summary);
    const tableHost = document.createElement('div'); tableHost.id = 'stage06-table-wrap'; tableHost.className = 'stage06-table-wrap'; body.appendChild(tableHost);
    const paging = document.createElement('div'); paging.id = 'stage06-paging'; paging.className = 'stage06-paging'; body.appendChild(paging);
    renderTable(ds); dialog.showModal();
  }

  function init() {
    const fileInput = $('file-excel');
    if (fileInput) fileInput.onchange = event => { const file = event.target.files && event.target.files[0]; event.target.value = ''; if (file) importFile(file); };
    if ($('btn-excel') && fileInput) $('btn-excel').onclick = () => fileInput.click();
    if ($('btn-data')) $('btn-data').onclick = showPreview;
    MARQ.Bus.on('state:changed', () => { const current = dataset(); if (current && $('stage06-table-wrap')) renderTable(current); });
  }

  MARQ.Data = Object.assign(MARQ.Data || {}, { fromAOA, detectHeader, resolve, resolveProps, recount });
  MARQ.Stage06 = { init, showPreview, importFile };
})(window.MARQ = window.MARQ || {});
