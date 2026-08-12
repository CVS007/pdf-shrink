// compress.js — port of compress_pdf.py to the browser.
// Same method: re-render each page, re-compress as JPEG, auto-tune
// quality/scale to land just under the target (decimal MB, the way
// upload portals count).

import * as pdfjs from './vendor/pdf.min.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.mjs', import.meta.url).href;

// Best-looking settings first; the first fit wins.
const COMBOS = [
  [2.5, 95], [2.25, 92], [2.0, 90], [2.0, 85], [1.75, 85],
  [1.5, 75], [1.35, 72], [1.25, 70], [1.25, 66], [1.2, 66],
  [1.2, 62], [1.15, 66], [1.1, 64], [1.0, 66], [1.0, 58],
];

// A phone will kill the tab long before a desktop would. Scanners often
// emit pages whose point size equals their pixel size, so an unclamped
// 2.5x render can ask for 50+ megapixels — roughly 200MB for one page.
const MAX_PIXELS = 4_000_000;

const yieldToUi = () => new Promise((r) => setTimeout(r, 0));

function canvasToJpeg(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('JPEG encode failed'))),
      'image/jpeg',
      quality / 100,
    );
  });
}

// Clamp the requested scale so the canvas stays within the pixel budget.
function safeScale(page, scale) {
  const v = page.getViewport({ scale });
  const px = v.width * v.height;
  return px <= MAX_PIXELS ? scale : scale * Math.sqrt(MAX_PIXELS / px);
}

async function renderPage(doc, index, scale, canvas, ctx) {
  const page = await doc.getPage(index);
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({ scale: safeScale(page, scale) });

  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  page.cleanup();
  return base;
}

// Render every page, encode as JPEG, reassemble. Pages keep their original
// point dimensions, so the output is the same physical size as the input.
async function build(doc, scale, quality, onPage) {
  const out = await PDFLib.PDFDocument.create();
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { alpha: false });

  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const base = await renderPage(doc, i, scale, canvas, ctx);
      const jpeg = await canvasToJpeg(canvas, quality);
      const img = await out.embedJpg(await jpeg.arrayBuffer());
      const p = out.addPage([base.width, base.height]);
      p.drawImage(img, { x: 0, y: 0, width: base.width, height: base.height });
      if (onPage) onPage(i, doc.numPages);
      await yieldToUi();
    }
    return out.save();
  } finally {
    canvas.width = canvas.height = 0;   // release the bitmap
  }
}

// Encode page 1 only, to predict the whole document's size cheaply. Building
// all 15 combos in full re-renders every page 15 times, which is what kills
// the tab on a large scan.
async function probe(doc, scale, quality, cache) {
  const canvas = cache.canvas;
  if (cache.scale !== scale) {
    await renderPage(doc, 1, scale, canvas, cache.ctx);
    cache.scale = scale;
  }
  const jpeg = await canvasToJpeg(canvas, quality);
  return jpeg.size;
}

/**
 * Compress `file` to just under `targetMB`.
 * onProgress({ phase, scale, quality, bytes, page, pages, combo, combos })
 * Resolves to { blob, name, bytes, scale, quality, unchanged }.
 */
export async function compress(file, targetMB = 4.6, onProgress = () => {}) {
  const ceil = Math.floor(targetMB * 1_000_000);
  const name = file.name.replace(/\.pdf$/i, '') + '_compressed.pdf';

  // Already under target: re-encoding can only make it bigger or lower
  // quality for no benefit, so pass it through unchanged.
  if (file.size < ceil) {
    return { blob: file, name, bytes: file.size, unchanged: true };
  }

  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const pages = doc.numPages;

  const cache = { scale: null, canvas: document.createElement('canvas') };
  cache.ctx = cache.canvas.getContext('2d', { alpha: false });

  try {
    for (let c = 0; c < COMBOS.length; c++) {
      const [scale, quality] = COMBOS[c];
      const last = c === COMBOS.length - 1;
      const info = { scale, quality, combo: c + 1, combos: COMBOS.length };

      // Skip combos that page 1 says will clearly overshoot. The margin keeps
      // a combo that might still fit once the other pages are measured.
      if (pages > 1 && !last) {
        onProgress({ phase: 'probing', ...info });
        const est = (await probe(doc, scale, quality, cache)) * pages * 1.02 + pages * 1024;
        onProgress({ phase: 'probed', ...info, bytes: est, skipped: est > ceil * 1.15 });
        if (est > ceil * 1.15) continue;
      }

      onProgress({ phase: 'trying', ...info });
      const bytes = await build(doc, scale, quality, (page, total) =>
        onProgress({ phase: 'rendering', ...info, page, pages: total }),
      );
      onProgress({ phase: 'tried', ...info, bytes: bytes.length, fits: bytes.length < ceil });

      if (bytes.length < ceil) {
        return {
          blob: new Blob([bytes], { type: 'application/pdf' }),
          name,
          bytes: bytes.length,
          scale,
          quality,
          unchanged: false,
        };
      }
    }
  } finally {
    cache.canvas.width = cache.canvas.height = 0;
    await doc.destroy();
  }

  throw new Error(
    "Couldn't get under target even at the lowest setting. Raise the target or split the PDF.",
  );
}
