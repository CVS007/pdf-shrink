import { compress } from './compress.js';

const $ = (id) => document.getElementById(id);
const mb = (b) => (b / 1_000_000).toFixed(2);

let picked = null;   // File chosen or shared in
let output = null;   // { blob, name, bytes }

function say(line) {
  $('progress').classList.remove('hide');
  $('log').textContent += line + '\n';
  $('log').scrollTop = $('log').scrollHeight;
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
  $('result').classList.add('hide');
  $('log').textContent = '';
  say(`Input : ${picked.name} (${mb(picked.size)} MB)`);
  say(`Target: under ${target} MB\n`);

  try {
    const res = await compress(picked, target, (p) => {
      if (p.phase === 'rendering') {
        $('log').textContent = $('log').textContent.replace(/ +page \d+\/\d+\n$/, '');
        say(`  page ${p.page}/${p.pages}`);
      } else if (p.phase === 'tried') {
        $('log').textContent = $('log').textContent.replace(/ +page \d+\/\d+\n$/, '');
        say(`  scale=${p.scale} q=${p.quality} -> ${mb(p.bytes)} MB  ${p.fits ? 'fits' : 'too big'}`);
      }
    });

    output = res;
    $('size').textContent = `${mb(res.bytes)} MB`;
    $('detail').textContent = res.unchanged
      ? 'Already under target — passed through unchanged, no re-encode.'
      : `scale ${res.scale}, quality ${res.quality} — ${(100 - (res.bytes / picked.size) * 100).toFixed(0)}% smaller`;
    $('result').classList.remove('hide');
  } catch (err) {
    say('');
    say(`ERROR: ${err.message}`);
    $('log').classList.add('err');
  } finally {
    $('go').disabled = false;
  }
});

$('share').addEventListener('click', async () => {
  if (!output) return;
  const f = new File([output.blob], output.name, { type: 'application/pdf' });
  if (navigator.canShare && navigator.canShare({ files: [f] })) {
    try { await navigator.share({ files: [f] }); } catch (_) { /* user cancelled */ }
  } else {
    say('Sharing not supported here — use Save instead.');
  }
});

$('save').addEventListener('click', () => {
  if (!output) return;
  const url = URL.createObjectURL(output.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = output.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
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
