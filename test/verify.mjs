// verify.mjs — run the browser port and the original Python tool over the
// same PDFs and compare. Usage: node test/verify.mjs <pdf-dir> [targetMB]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const ROOT = path.resolve(import.meta.dirname, '..');
const PY = '/home/christo/.local/share/compress-pdf-venv/bin/python';
const SCRIPT = '/home/christo/.local/bin/compress_pdf.py';
const PORT = 8099;

const dir = process.argv[2];
const target = parseFloat(process.argv[3] ?? '4.6');
if (!dir) { console.error('usage: node test/verify.mjs <pdf-dir> [targetMB]'); process.exit(1); }

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.pdf': 'application/pdf', '.png': 'image/png' };

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const file = rel.startsWith('/pdfs/')
    ? path.join(path.resolve(dir), rel.slice(6))
    : path.join(ROOT, rel);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, r));

const mb = (b) => (b / 1e6).toFixed(2);
const pdfs = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.pdf')).sort();
if (!pdfs.length) { console.error(`no PDFs in ${dir}`); process.exit(1); }

// Spawn Chrome directly and attach; puppeteer's own launcher is unreliable here.
const tmp = process.env.TMPDIR ?? '/tmp';
const profile = path.join(tmp, 'chrome-profile');
fs.rmSync(profile, { recursive: true, force: true });

const chrome = spawn('/usr/bin/google-chrome', [
  '--headless', '--no-sandbox', '--disable-gpu',
  `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });

// Chrome prints its endpoint on stderr. It must be read from the live pipe —
// redirecting it to a file yields nothing, and HTTP probing is intercepted here.
const wsEndpoint = await new Promise((resolve, reject) => {
  let seen = '';
  const timer = setTimeout(
    () => reject(new Error(`Chrome never printed a debug endpoint. Output was:\n${seen || '(nothing)'}`)),
    20_000,
  );
  const scan = (d) => {
    seen += d.toString();
    const m = seen.match(/ws:\/\/\S+/);
    if (m) { clearTimeout(timer); resolve(m[0]); }
  };
  chrome.stderr.on('data', scan);
  chrome.stdout.on('data', scan);
  chrome.on('error', (e) => { clearTimeout(timer); reject(e); });
  chrome.on('exit', (code, sig) => {
    clearTimeout(timer);
    reject(new Error(`Chrome exited early (code=${code} sig=${sig}). Output was:\n${seen || '(nothing)'}`));
  });
});

const browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('  [page error]', e.message));
await page.goto(`http://localhost:${PORT}/test/harness.html`, { waitUntil: 'networkidle0' });
await page.waitForFunction('window.ready === true');

const ceil = Math.floor(target * 1e6);
const rows = [];
let failures = 0;

for (const name of pdfs) {
  const src = path.join(path.resolve(dir), name);
  const inBytes = fs.statSync(src).size;

  const web = await page.evaluate((u, t) => window.runCompress(u, t), `/pdfs/${name}`, target);

  const out = path.join(process.env.TMPDIR ?? '/tmp', `ref_${name}`);
  execFileSync(PY, [SCRIPT, src, String(target), out], { stdio: 'pipe' });
  const pyBytes = fs.statSync(out).size;
  fs.unlinkSync(out);

  const problems = [];
  if (web.bytes >= ceil) problems.push('OVER TARGET');
  if (web.outPages !== web.inPages) problems.push(`pages ${web.inPages}->${web.outPages}`);
  if (web.header !== '%PDF-') problems.push('not a PDF');
  if (pyBytes >= ceil) problems.push('python over target');
  if (problems.length) failures++;

  rows.push({ name, inBytes, web, pyBytes, problems });
}

await browser.disconnect();
chrome.kill();
server.close();

console.log(`\ntarget: under ${target} MB (${ceil.toLocaleString()} bytes)\n`);
const pad = (s, n) => String(s).padEnd(n);
console.log(pad('file', 34) + pad('in', 8) + pad('python', 9) + pad('pwa', 8) + pad('combo', 12) + pad('pages', 7) + pad('time', 8) + 'status');
console.log('-'.repeat(100));
for (const r of rows) {
  console.log(
    pad(r.name.slice(0, 32), 34) +
    pad(mb(r.inBytes), 8) +
    pad(mb(r.pyBytes), 9) +
    pad(mb(r.web.bytes), 8) +
    pad(r.web.unchanged ? 'unchanged' : `${r.web.scale}/${r.web.quality}`, 12) +
    pad(r.web.outPages, 7) +
    pad(`${(r.web.ms / 1000).toFixed(1)}s`, 8) +
    (r.problems.length ? 'FAIL: ' + r.problems.join(', ') : 'ok'),
  );
}
console.log(`\n${rows.length - failures}/${rows.length} passed`);
process.exit(failures ? 1 : 0);
