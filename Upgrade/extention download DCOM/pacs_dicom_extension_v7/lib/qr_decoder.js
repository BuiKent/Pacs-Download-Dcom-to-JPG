/**
 * High-performance QR Code Decoding Engine for PACS DICOM Downloader.
 * Combines jsQR (pure JS, 100% reliable across all browsers & platforms)
 * with multi-scale sampling, quadrant cropping, adaptive binarization,
 * and native BarcodeDetector fallback.
 */
import jsQR from './jsqr.js';

/**
 * Scan raw ImageData with jsQR.
 * @param {Uint8ClampedArray} data
 * @param {number} width
 * @param {number} height
 * @returns {string|null}
 */
export function scanRawImageData(data, width, height) {
  if (!data || !width || !height) return null;
  const qrFunc = typeof jsQR === 'function' ? jsQR : (typeof globalThis !== 'undefined' ? globalThis.jsQR : null);
  if (qrFunc) {
    try {
      const code = qrFunc(data, width, height, { inversionAttempts: 'attemptBoth' });
      if (code && code.data) return code.data;
    } catch (_) {}
  }
  return null;
}

/**
 * Scan an HTMLCanvasElement or OffscreenCanvas with jsQR.
 * @param {HTMLCanvasElement|OffscreenCanvas} canvas
 * @returns {string|null}
 */
export function scanCanvasWithJsQr(canvas) {
  if (!canvas || !canvas.width || !canvas.height) return null;
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return scanRawImageData(imgData.data, imgData.width, imgData.height);
  } catch (_) {
    return null;
  }
}

/**
 * Scan an image source with native BarcodeDetector if supported.
 * @param {any} source
 * @returns {Promise<string|null>}
 */
export async function scanWithBarcodeDetector(source) {
  if (typeof globalThis.BarcodeDetector === 'function') {
    try {
      const detector = new globalThis.BarcodeDetector({ formats: ['qr_code'] });
      const results = await detector.detect(source);
      if (results && results.length > 0 && results[0].rawValue) {
        return results[0].rawValue;
      }
    } catch (_) {}
  }
  return null;
}

/**
 * Multi-pass QR scanning from a Canvas / ImageBitmap / HTMLImageElement.
 * Tries direct, multi-scale, grid crops, and binarization passes.
 * @param {CanvasImageSource} source
 * @param {number} width
 * @param {number} height
 * @returns {Promise<string|null>}
 */
export async function scanSourceMultiPass(source, width, height) {
  if (!source || !width || !height) return null;

  // Create main canvas
  const mainCanvas = (typeof OffscreenCanvas !== 'undefined')
    ? new OffscreenCanvas(width, height)
    : document.createElement('canvas');
  mainCanvas.width = width;
  mainCanvas.height = height;
  const mainCtx = mainCanvas.getContext('2d', { willReadFrequently: true });
  mainCtx.drawImage(source, 0, 0);

  // Pass 1: Direct scan on original canvas
  let res = scanCanvasWithJsQr(mainCanvas);
  if (res) return res;

  // Pass 2: Native BarcodeDetector (if available)
  res = await scanWithBarcodeDetector(mainCanvas);
  if (res) return res;

  // Pass 3: Multi-scale downscales & upscales
  // Crucial for high-resolution camera photos (e.g. 1440x3088 or 4000x3000)
  const scales = [0.5, 0.75, 0.33, 0.25, 1.25, 1.5, 2.0];
  for (const s of scales) {
    const sw = Math.round(width * s);
    const sh = Math.round(height * s);
    if (sw < 40 || sh < 40 || sw > 4000 || sh > 4000) continue;

    const sc = (typeof OffscreenCanvas !== 'undefined')
      ? new OffscreenCanvas(sw, sh)
      : document.createElement('canvas');
    sc.width = sw;
    sc.height = sh;
    const sctx = sc.getContext('2d', { willReadFrequently: true });
    sctx.drawImage(mainCanvas, 0, 0, sw, sh);

    res = scanCanvasWithJsQr(sc);
    if (res) return res;

    res = await scanWithBarcodeDetector(sc);
    if (res) return res;
  }

  // Pass 4: Grid & Quadrant crops (for screenshots where QR is a small portion)
  const crops = [
    { x: 0, y: 0, w: width * 0.6, h: height * 0.6 },
    { x: width * 0.4, y: 0, w: width * 0.6, h: height * 0.6 },
    { x: 0, y: height * 0.4, w: width * 0.6, h: height * 0.6 },
    { x: width * 0.4, y: height * 0.4, w: width * 0.6, h: height * 0.6 },
    { x: width * 0.2, y: height * 0.2, w: width * 0.6, h: height * 0.6 },
    { x: 0, y: 0, w: width, h: height * 0.5 },
    { x: 0, y: height * 0.5, w: width, h: height * 0.5 }
  ];

  for (const c of crops) {
    const cw = Math.round(c.w);
    const ch = Math.round(c.h);
    if (cw < 40 || ch < 40) continue;

    const cc = (typeof OffscreenCanvas !== 'undefined')
      ? new OffscreenCanvas(cw, ch)
      : document.createElement('canvas');
    cc.width = cw;
    cc.height = ch;
    const cctx = cc.getContext('2d', { willReadFrequently: true });
    cctx.drawImage(mainCanvas, c.x, c.y, c.w, c.h, 0, 0, cw, ch);

    res = scanCanvasWithJsQr(cc);
    if (res) return res;

    res = await scanWithBarcodeDetector(cc);
    if (res) return res;
  }

  // Pass 5: Contrast enhancement & Binarization thresholds
  try {
    const idata = mainCtx.getImageData(0, 0, width, height);
    const d = idata.data;
    const thresholds = [100, 130, 160, 190];

    for (const thresh of thresholds) {
      const binData = new Uint8ClampedArray(d.length);
      for (let i = 0; i < d.length; i += 4) {
        const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        const val = lum > thresh ? 255 : 0;
        binData[i] = val;
        binData[i + 1] = val;
        binData[i + 2] = val;
        binData[i + 3] = 255;
      }
      res = scanRawImageData(binData, width, height);
      if (res) return res;
    }
  } catch (_) {}

  return null;
}

/**
 * Decode QR code from a File or Blob object.
 * @param {Blob|File} blob
 * @returns {Promise<string|null>}
 */
export async function decodeQrFromBlob(blob) {
  if (!blob) return null;
  let bitmap = null;
  try {
    bitmap = await createImageBitmap(blob);
    return await scanSourceMultiPass(bitmap, bitmap.width, bitmap.height);
  } catch (err) {
    // Fallback via Image element if createImageBitmap is not supported
    return await new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = async () => {
          try {
            const res = await scanSourceMultiPass(img, img.naturalWidth, img.naturalHeight);
            resolve(res);
          } catch {
            resolve(null);
          }
        };
        img.onerror = () => resolve(null);
        img.src = reader.result;
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } finally {
    if (bitmap && typeof bitmap.close === 'function') {
      bitmap.close();
    }
  }
}

/**
 * Decode QR code from an image URL or Data URL.
 * @param {string} dataUrl
 * @returns {Promise<string|null>}
 */
export async function decodeQrFromDataUrl(dataUrl) {
  if (!dataUrl) return null;
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    return await decodeQrFromBlob(blob);
  } catch (err) {
    return await new Promise(resolve => {
      const img = new Image();
      img.onload = async () => {
        try {
          const r = await scanSourceMultiPass(img, img.naturalWidth, img.naturalHeight);
          resolve(r);
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  }
}

/**
 * Clean and format detected QR text.
 * @param {string} raw
 * @returns {{ text: string, isUrl: boolean, url: string }}
 */
export function parseQrResult(raw) {
  const text = String(raw || '').trim();
  let isUrl = false;
  let url = '';
  try {
    const u = new URL(text);
    if (['http:', 'https:', 'ftp:'].includes(u.protocol)) {
      isUrl = true;
      url = u.href;
    }
  } catch {
    if (/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(\/.*)?$/.test(text)) {
      isUrl = true;
      url = `https://${text}`;
    }
  }
  return { text, isUrl, url: isUrl ? url : text };
}

/**
 * Check if the URL looks like a medical imaging, PACS, DICOM, or patient portal URL.
 * @param {string} urlStr
 * @returns {boolean}
 */
export function isLikelyPacsViewerUrl(urlStr) {
  if (!urlStr) return false;
  return /(?:pacs|dicom|wado|qido|viewer|vrviewer|sharestudy|pportal|portal|ketqua|cdha|ris|radiology|cornerstone|ohif|studyuid|stoken)/i.test(urlStr);
}
