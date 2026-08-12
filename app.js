import { compress } from './compress.js';

const $ = (id) => document.getElementById(id);
const mb = (b) => (b / 1_000_000).toFixed(2);

let picked = null;   // File chosen or shared in
let output = null;   // { blob, name, bytes }
let objectUrl = null;

function say(line) {
  $('progress').classList.remove('hide');
  $('log').textContent += line + '\n';
  $('log').scrollTop = $('log').scrollHeight;
}

// Rewrite the last line instead of appending, so per-page progress
// doesn't flood the log on a long document.
function replaceLast(line) {
  const t = $('log').textContent.replace(/[^\n]*\n$/, '');
  $('log').textContent = t;
  say(line);
}

function setFile(file) {
  picked = file;
  output = null;
  $('result').classList.add('hide');
  $('go').disabled = !file;
  if (file) $('filenote').textContent = `${file.name} — ${mb(file.size)} MB`;
}

$('file').addEventListener('change', (e) => setFile(e.target.files[0] || null));

$('go').addEventListener('click', async () => {
  if (!picked) return;
  const target = parseFloat($('target').value) || 4.6;

  $('go').disabled = true;
  $('go').textContent = 'Working…';
  $('result').classList.add('hide');
  $('log').textContent = '';
  $('log').classList.remove('err');
  say(`Input : ${picked.name} (${mb(picked.size)} MB)`);
  say(`Target: under ${target} MB`);
  say('');

  let lastPhase = null;
  try {
    const res = await compress(picked, target, (p) => {
      const line = {
        probing: () => `  checking scale=${p.scale} q=${p.quality}…`,
        probed: () => `  scale=${p.scale} q=${p.quality} -> ~${mb(p.bytes)} MB estimated${p.skipped ? ' (skip)' : ''}`,
        rendering: () => `  scale=${p.scale} q=${p.quality} — page ${p.page}/${p.pages}`,
        tried: () => `  scale=${p.scale} q=${p.quality} -> ${mb(p.bytes)} MB  ${p.fits ? 'fits' : 'too big'}`,
      }[p.phase];
      if (!line) return;
      const overwrite = lastPhase === p.phase || (lastPhase === 'probing' && p.phase === 'probed')
        || (lastPhase === 'rendering' && p.phase === 'tried');
      overwrite ? replaceLast(line()) : say(line());
      lastPhase = p.phase;
    });

    output = res;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(res.blob);

    $('size').textContent = `${mb(res.bytes)} MB`;
    $('detail').textContent = res.unchanged
      ? 'Already under target — passed through unchanged, no re-encode.'
      : `scale ${res.scale}, quality ${res.quality} — ${(100 - (res.bytes / picked.size) * 100).toFixed(0)}% smaller`;
    $('dl').href = objectUrl;
    $('dl').download = res.name;
    $('dl').textContent = `Download ${res.name}`;
    $('result').classList.remove('hide');
    $('result').scrollIntoView({ behavior: 'smooth', block: 'center' });
    say('');
    say('Done.');
  } catch (err) {
    say('');
    say(`ERROR: ${err.message}`);
    $('log').classList.add('err');
  } finally {
    $('go').disabled = false;
    $('go').textContent = 'Compress';
  }
});

$('share').addEventListener('click', async () => {
  if (!output) return;
  const f = new File([output.blob], output.name, { type: 'application/pdf' });
  if (navigator.canShare && navigator.canShare({ files: [f] })) {
    try { await navigator.share({ files: [f] }); } catch (_) { /* user cancelled */ }
  } else {
    say('Sharing not available here — use the download link instead.');
  }
});

// A PDF shared in from WhatsApp/email is stashed by the service worker,
// which then redirects here with ?shared=1.
if (new URLSearchParams(location.search).has('shared')) {
  navigator.serviceWorker.ready.then(async () => {
    const cache = await caches.open('shared-inbox');
    const res = await cache.match('/shared-file');
    if (!res) return;
    const name = res.headers.get('x-filename') || 'shared.pdf';
    setFile(new File([await res.blob()], name, { type: 'application/pdf' }));
    await cache.delete('/shared-file');
    history.replaceState(null, '', location.pathname);
  });
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
}
