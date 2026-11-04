(function (MARQ) {
  'use strict';
  // Linear barcode adapter. Encoding is done by the built-in MARQ.LinearEncoder, so no vendor library is needed.
  // (File name kept for load-order/architecture compatibility.)

  function checkDigit(body) {
    let sum = 0;
    let weight = 3;
    for (let i = body.length - 1; i >= 0; i--) {
      sum += Number(body[i]) * weight;
      weight = weight === 3 ? 1 : 3;
    }
    return String((10 - (sum % 10)) % 10);
  }

  function normalizeValue(format, value) {
    const raw = String(value == null ? '' : value).trim();
    if (!raw) return '';
    switch (format) {
      case 'EAN13':
        return raw.replace(/[^0-9]/g, '').slice(0, 13);
      case 'EAN8':
        return raw.replace(/[^0-9]/g, '').slice(0, 8);
      case 'ITF14':
        return raw.replace(/[^0-9]/g, '').slice(0, 14);
      case 'CODE39':
        return raw.toUpperCase();
      default:
        return raw;
    }
  }

  function validateEAN(format, value, length) {
    const digits = normalizeValue(format, value).replace(/[^0-9]/g, '');
    if (!digits) return 'Enter a value for the barcode.';
    if (digits.length !== length) return format + ' requires exactly ' + length + ' digits.';
    const body = digits.slice(0, length - 1);
    const expected = checkDigit(body);
    return digits.endsWith(expected) ? null : format + ' checksum is invalid.';
  }

  function validateCode128(value) {
    const text = String(value == null ? '' : value).trim();
    if (!text) return 'Enter a value for the barcode.';
    if (!/^[\x20-\x7E]{1,80}$/.test(text)) return 'Code 128 accepts printable ASCII characters only.';
    return null;
  }

  function validateCode39(value) {
    const text = String(value == null ? '' : value).trim();
    if (!text) return 'Enter a value for the barcode.';
    if (!/^[A-Z0-9\-\. \$\/\+\%]+$/.test(text.toUpperCase())) return 'Code 39 supports A-Z, 0-9, space and - . $ / + % only.';
    return null;
  }

  function validateITF14(value) {
    const digits = normalizeValue('ITF14', value).replace(/[^0-9]/g, '');
    if (!digits) return 'Enter a value for the barcode.';
    if (digits.length !== 14) return 'ITF-14 requires exactly 14 digits.';
    return null;
  }

  const adapter = {
    id: 'native-linear',
    kind: 'linear',
    label: 'Built-in linear encoder',
    formats: [
      { id: 'CODE128', label: 'Code 128' },
      { id: 'CODE39', label: 'Code 39' },
      { id: 'EAN13', label: 'EAN-13' },
      { id: 'EAN8', label: 'EAN-8' },
      { id: 'ITF14', label: 'ITF-14' }
    ],
    isAvailable: () => !!MARQ.LinearEncoder,
    validate(format, value) {
      const text = String(value == null ? '' : value).trim();
      if (!text) return 'Enter a value for the barcode.';
      switch (format) {
        case 'CODE128': return validateCode128(text);
        case 'CODE39': return validateCode39(text);
        case 'EAN13': return validateEAN('EAN13', text, 13);
        case 'EAN8': return validateEAN('EAN8', text, 8);
        case 'ITF14': return validateITF14(text);
        default: return 'Unsupported barcode format: ' + format;
      }
    },
    encode(format, value) { return MARQ.LinearEncoder.encode(format, normalizeValue(format, String(value).trim())); },
    // Bitmap rendering (registry contract; the editor/print renderer draws vectors via encode()).
    render(format, value, options) {
      options = options || {};
      const enc = this.encode(format, value), bw = Math.max(1, Math.round(Number(options.barWidth) || 2));
      const q = enc.quiet, mods = enc.widths.reduce((a, b) => a + b, 0), h = Number(options.height) || 80;
      const canvas = document.createElement('canvas'); canvas.width = (mods + q.l + q.r) * bw; canvas.height = h;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = options.background || '#ffffff'; ctx.fillRect(0, 0, canvas.width, h);
      ctx.fillStyle = options.color || '#000000';
      let x = q.l * bw; enc.widths.forEach((w, i) => { if (i % 2 === 0) ctx.fillRect(x, 0, w * bw, h); x += w * bw; });
      return { canvas };
    }
  };

  MARQ.Barcodes.register(adapter);
})(window.MARQ = window.MARQ || {});
