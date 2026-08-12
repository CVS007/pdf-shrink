# PDF Shrink

Shrink a PDF to just under an upload limit — SARS, CIPC, FICA, court portals, medical aid.
Runs entirely in the browser on your own device. Nothing is uploaded, and there is no server.

**Live: <https://cvs007.github.io/pdf-shrink/>**

Install it by opening that URL in Chrome on Android and choosing **Add to Home screen**. It
then works offline and accepts PDFs shared to it from WhatsApp or email.

## How it works

Each page is re-rendered to an image, re-compressed as JPEG, and the pages are reassembled
into a new PDF. Scale and quality are auto-tuned against an ordered list of settings — best
looking first — and the first result that fits under the target wins.

The target is measured in **decimal MB** (`× 1,000,000`), which is how upload portals count,
not the MiB your file manager shows. The default of 4.6 MB sits safely under a 5 MB cap.

A file that is already under target is passed through unchanged rather than re-encoded, since
re-encoding could only make it larger or worse.

This is a browser port of a Python tool (`compress_pdf.py`, using pypdfium2 + Pillow) that does
the same thing on the desktop.

### Notes for anyone changing it

- **Renders are clamped to 4 megapixels** (`MAX_PIXELS` in `compress.js`). Scanners often emit
  PDFs whose page box equals the pixel size — 1863×2572 pt is common — and rendering one of
  those at 2.5× asks for ~46 megapixels, about 200 MB for a single page. That kills the tab on
  a phone, and the symptom is misleading: the tab reloads, so it looks like the app restarted
  mid-run.
- **Page 1 is probed before each full build** to estimate the whole document's size, so combos
  that clearly overshoot are skipped instead of re-rendering every page 15 times.
- Output pages keep the source page dimensions, so the result is the same physical size as the
  input.

## Files

| | |
|---|---|
| `compress.js` | the compression logic |
| `app.js`, `index.html` | UI |
| `sw.js`, `manifest.json` | offline caching, installability, share target |
| `vendor/` | pdf.js and pdf-lib, bundled so no network is needed |
| `test/` | local static server and a browser-vs-Python comparison harness |

Run it locally with `node test/serve.mjs` and open <http://localhost:8099>.

## Licence

MIT — see [LICENSE](LICENSE). The bundled libraries in `vendor/` keep their own licences
(pdf.js is Apache-2.0, pdf-lib is MIT); see
[THIRD-PARTY-LICENSES.txt](THIRD-PARTY-LICENSES.txt).
