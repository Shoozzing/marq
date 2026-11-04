(function (MARQ) {
  'use strict';
  // Single source of truth. state = { app, project, data }
  //  app     : transient UI state (unit, view, grid, selection) - not in undo history
  //  project : persisted document (label, page, elements, dataBinding) - undoable
  //  data    : runtime datasets { [id]: dataset } - persisted separately, not in undo history
  let state = null;
  const past = [], future = [], MAX = 100;
  // Assets (image data) are immutable once added, so undo snapshots share them by reference instead of cloning megabytes per step.
  const snap = () => { const { assets, ...rest } = state.project, c = structuredClone(rest); c.assets = assets; return c; };
  let lastKey = null, lastAt = 0; // coalescing: rapid edits with the same key (typing, dragging a colour) become one undo step

  function emit(label, scope) {
    MARQ.Bus.emit('state:changed', { label, scope });
    MARQ.Bus.emit(scope + ':changed', { label });
  }
  function init(initial) {
    state = initial; lastKey = null; past.length = 0; future.length = 0;
    MARQ.Bus.emit('state:replaced', {});
  }
  // scope: 'project' (undoable, stamps modified) | 'app' | 'data'
  function commit(label, mutator, scope, mergeKey) {
    scope = scope || 'project';
    if (scope === 'project') {
      const now = Date.now(), merge = mergeKey && mergeKey === lastKey && now - lastAt < 1200 && past.length;
      if (!merge) { past.push(snap()); if (past.length > MAX) past.shift(); }
      future.length = 0; lastKey = mergeKey || null; lastAt = now;
      mutator(state);
      state.project.meta.modified = new Date().toISOString();
    } else mutator(state);
    emit(label, scope);
  }
  function undo() { lastKey = null; if (!past.length) return false; future.push(snap()); state.project = past.pop(); emit('undo', 'project'); return true; }
  function redo() { lastKey = null; if (!future.length) return false; past.push(snap()); state.project = future.pop(); emit('redo', 'project'); return true; }
  function replaceProject(p) { lastKey = null; state.project = p; past.length = 0; future.length = 0; emit('load', 'project'); }

  MARQ.Store = {
    init, commit, undo, redo, replaceProject,
    get state() { return state; },
    canUndo: () => past.length > 0, canRedo: () => future.length > 0
  };
})(window.MARQ = window.MARQ || {});
