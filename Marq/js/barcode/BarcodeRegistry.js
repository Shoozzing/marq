(function (MARQ) {
  'use strict';
  const adapters = [];
  const cache = new Map();
  const MAX_CACHE = 300;

  function key(format, value, options) {
    return JSON.stringify([format, String(value || ''), options || {}]);
  }

  MARQ.Barcodes = {
    register(adapter) {
      if (!adapter || !adapter.formats) return;
      adapters.push(adapter);
    },
    adapters: () => adapters.slice(),
    formats() {
      return adapters.flatMap(adapter => adapter.formats.map(format => ({
        id: format.id,
        label: format.label,
        kind: adapter.kind,
        available: !!adapter.isAvailable && adapter.isAvailable()
      })));
    },
    find(format) {
      return adapters.find(adapter => adapter.formats.some(item => item.id === format));
    },
    validate(format, value) {
      const adapter = this.find(format);
      if (!adapter) return 'Unsupported barcode format: ' + format;
      if (!adapter.validate) return null;
      const result = adapter.validate(format, value == null ? '' : String(value));
      return result || null;
    },
    render(format, value, options) {
      const adapter = this.find(format);
      if (!adapter) {
        return { error: 'Unsupported barcode format: ' + format };
      }
      const resolvedValue = value == null ? '' : String(value);
      const validationError = adapter.validate ? adapter.validate(format, resolvedValue) : null;
      if (validationError) {
        return { error: validationError };
      }
      const cacheKey = key(format, resolvedValue, options || {});
      if (cache.has(cacheKey)) {
        return cache.get(cacheKey);
      }
      try {
        const result = adapter.render(format, resolvedValue, options || {});
        if (cache.size > MAX_CACHE) cache.clear();
        cache.set(cacheKey, result);
        return result;
      } catch (error) {
        const result = { error: error && error.message ? error.message : String(error) };
        cache.set(cacheKey, result);
        return result;
      }
    },
    // Vector-friendly access for the renderer: { widths, text, quiet } | { error }
    encode(format, value) {
      const adapter = this.find(format);
      if (!adapter || !adapter.encode) return { error: 'Unsupported barcode format: ' + format };
      const text = value == null ? '' : String(value).trim();
      const invalid = adapter.validate ? adapter.validate(format, text) : null;
      if (invalid) return { error: invalid };
      try { return adapter.encode(format, text); } catch (e) { return { error: e && e.message ? e.message : String(e) }; }
    },
    // 2D symbols: { size, isDark(row, col) } | { error }
    matrix(format, value, options) {
      const adapter = this.find(format);
      if (!adapter || !adapter.matrix) return { error: 'Unsupported barcode format: ' + format };
      const text = value == null ? '' : String(value);
      const invalid = adapter.validate ? adapter.validate(format, text) : null;
      if (invalid) return { error: invalid };
      const k = 'm' + key(format, text, options || {});
      if (cache.has(k)) return cache.get(k);
      let result;
      try { result = adapter.matrix(format, text, options || {}); } catch (e) { result = { error: e && e.message ? e.message : String(e) }; }
      if (cache.size > MAX_CACHE) cache.clear();
      cache.set(k, result); return result;
    },
    clearCache() {
      cache.clear();
    }
  };
})(window.MARQ = window.MARQ || {});
