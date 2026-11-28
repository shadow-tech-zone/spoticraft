/* APP-PATH test — bilkul wahi resolveStreams jo Electron app use karta hai.
   Pass = dono sources ke gaane (direct ya rescue se) bytes dete hain,
   yani user ke liye gaana bajega. */
import { resolveStreams } from '../app/core/resolve.js';
import { jiosaavn } from '../app/core/jiosaavn.js';
import { ytmusic } from '../app/core/ytmusic.js';
import { parseMediaId } from '../app/core/model.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
let failures = 0;

async function bytesOk(url) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url, { headers: { Range: 'bytes=0-4095', 'user-agent': UA }, signal: ctrl.signal, redirect: 'follow' });
    const b = await r.arrayBuffer();
    console.log(`    bytes: HTTP ${r.status} type=${r.headers.get('content-type')} n=${b.byteLength}`);
    return (r.status === 200 || r.status === 206) && b.byteLength > 100;
  } catch (e) { console.log(`    bytes ERROR: ${e.message}`); return false; }
  finally { clearTimeout(to); }
}

async function playLikeApp(label, track) {
  console.log(`\n── ${label}: "${track.title}" (${track.id})`);
  try {
    const res = await resolveStreams(track, (...a) => console.log('    log:', ...a));
    console.log(`    resolved via=${res.via}${res.matched ? ` matched="${res.matched}"` : ''} variants=${res.streams.length}`);
    if (await bytesOk(res.streams[0].url)) { console.log('  ✓ PLAYABLE'); return; }
    failures++; console.log('  ✗ bytes fail');
  } catch (e) { failures++; console.log(`  ✗ resolve fail: ${e.message}`); }
}

console.log('Bloomee APP-PATH (resolver) test —', new Date().toISOString());

const s = await jiosaavn.search('Arijit Singh', 'track', 1);
await playLikeApp('JioSaavn gaana (app jaisa)', s.items[0]);

const y = await ytmusic.search('Arijit Singh', 'track', 1);
await playLikeApp('YT Music gaana (app jaisa)', y.items[0]);

/* radio sanity (warn-only — station kabhi kabhi moody hota hai) */
for (const [name, impl, trk] of [['jiosaavn', jiosaavn, s.items[0]], ['ytmusic', ytmusic, y.items[0]]]) {
  try {
    const r = await impl.radio(parseMediaId(trk.id).localId);
    const n = r?.items?.length || 0;
    console.log(`  ${n >= 3 ? '✓' : '⚠'} radio ${name}: ${n} items${n >= 3 ? '' : ' (warn-only)'}`);
  } catch (e) { console.log(`  ⚠ radio ${name} warn: ${e.message}`); }
}

console.log(`\n══ RESULT: ${failures === 0 ? 'ALL PASS ✓' : failures + ' FAILURES ✗'} ══`);
process.exit(failures ? 1 : 0);
