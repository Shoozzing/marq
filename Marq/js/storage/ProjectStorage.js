(function (MARQ) {
  'use strict';
  // Strategy: localStorage = project JSON (small, sync). Export/import .marq.json = portable backup.
  // Large Excel datasets go to IndexedDB (DataStore, added in the Excel stage) and are referenced by dataBinding.datasetId.
  const PFX = 'marq.', INDEX = PFX + 'index', LAST = PFX + 'last';
  let timer = null, lastSaved = null;
  const ls = () => window.localStorage;
  const readIndex = () => { try { return JSON.parse(ls().getItem(INDEX)) || []; } catch (e) { return []; } };

  function save(project) {
    const json = JSON.stringify(MARQ.Model.serializable(project));
    ls().setItem(PFX + 'project.' + project.id, json); // throws QuotaExceededError -> caller reports
    const idx = readIndex().filter(i => i.id !== project.id);
    idx.unshift({ id: project.id, name: project.meta.name, modified: project.meta.modified });
    ls().setItem(INDEX, JSON.stringify(idx)); ls().setItem(LAST, project.id);
    lastSaved = new Date(); MARQ.Bus.emit('storage:saved', { at: lastSaved });
  }
  function load(id) { const j = ls().getItem(PFX + 'project.' + id); return j ? MARQ.Model.migrate(JSON.parse(j)) : null; }
  function loadLast() { const id = ls().getItem(LAST); try { return id ? load(id) : null; } catch (e) { console.error(e); return null; } }
  function remove(id) { ls().removeItem(PFX + 'project.' + id); ls().setItem(INDEX, JSON.stringify(readIndex().filter(i => i.id !== id))); }
  function scheduleAutosave() {
    clearTimeout(timer);
    timer = setTimeout(() => { try { save(MARQ.Store.state.project); } catch (e) { MARQ.Bus.emit('storage:error', { error: e }); } }, 600);
  }
  function exportFile(project) {
    const blob = new Blob([JSON.stringify(MARQ.Model.serializable(project), null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = (project.meta.name || 'label').replace(/[^\w\-]+/g, '_') + '.marq.json';
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function importFile(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => { try { const p = MARQ.Model.migrate(JSON.parse(r.result)); p.id = MARQ.Model.uid('prj'); res(p); } catch (e) { rej(e); } };
      r.onerror = () => rej(r.error); r.readAsText(file);
    });
  }
  MARQ.Storage = { save, load, loadLast, remove, list: readIndex, scheduleAutosave, exportFile, importFile, get lastSaved() { return lastSaved; } };
})(window.MARQ = window.MARQ || {});
