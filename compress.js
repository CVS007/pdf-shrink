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

function canvasToJpeg(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('JPEG encode failed'))),
      'image/jpeg',
      quality / 100,
    );
  });
}

// Render every page at `scale`, encode as JPEG at `quality`, reassemble.
// Pages keep their original point dimensions, so the output is the same
// physical size as the input rather than scale-times larger.
async function build(doc, scale, quality, onPage) {
  const out = await PDFLib.PDFDocument.create();
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { alpha: false });

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale });

    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;

    const jpeg = await canvasToJpeg(canvas, quality);
    const img = await out.embedJpg(await jpeg.arrayBuffer());
    const p = out.addPage([base.width, base.height]);
    p.drawImage(img, { x: 0, y: 0, width: base.width, height: base.height });

    page.cleanup();
    if (onPage) onPage(i, doc.numPages);
  }

  // Release the backing bitmap; phones are tight on memory.
  canvas.width = canvas.height = 0;
  return out.save();
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

  try {
    for (let c = 0; c < COMBOS.length; c++) {
      const [scale, quality] = COMBOS[c];
      onProgress({ phase: 'trying', scale, quality, combo: c + 1, combos: COMBOS.length });

      const bytes = await build(doc, scale, quality, (page, pages) =>
        onProgress({ phase: 'rendering', scale, quality, page, pages, combo: c + 1, combos: COMBOS.length }),
      );

      onProgress({ phase: 'tried', scale, quality, bytes: bytes.length, fits: bytes.length < ceil, combo: c + 1, combos: COMBOS.length });

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
    await doc.destroy();
  }

  throw new Error(
    "Couldn't get under target even at the lowest setting. Raise the target or split the PDF.",
  );
}
