/* LIVE playback test — asal network par chalta hai (CI runner).
   Har source ke liye: search → streams → pehle bytes download.
   Jo fail hoga us ki asal wajah (client/status) print hogi. */
import { jiosaavn } from '../app/core/jiosaavn.js';
import { ytmusic } from '../app/core/ytmusic.js';
import { parseMediaId } from '../app/core/model.js';

const UA_DESKTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const UA_IOS = 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)';

let failures = 0;
const fail = (msg) => { failures++; console.log(`  ✗ FAIL: ${msg}`); };
const pass = (msg) => console.log(`  ✓ ${msg}`);

async function byteCheck(url, label, ua = UA_DESKTOP) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url, {
      headers: { Range: 'bytes=0-4095', 'user-agent': ua },
      signal: ctrl.signal, redirect: 'follow',
    });
    const buf = await r.arrayBuffer();
    console.log(`    ${label}: HTTP ${r.status} type=${r.headers.get('content-type')} bytes=${buf.byteLength} (UA=${ua === UA_IOS ? 'ios' : 'desktop'})`);
    return (r.status === 200 || r.status === 206) && buf.byteLength > 100;
  } catch (e) {
    console.log(`    ${label}: FETCH ERROR ${e.message} (UA=${ua === UA_IOS ? 'ios' : 'desktop'})`);
    return false;
  } finally { clearTimeout(to); }
}

async function testSource(name, impl, query) {
  console.log(`\n══ ${name} ══`);
  let track;
  try {
    const res = await impl.search(query, 'track', 1);
    track = res?.items?.[0];
    if (!track) { fail('search ne koi track nahi diya'); return; }
    pass(`search: "${track.title}" — ${track.artists?.[0]?.name || ''} (id=${track.id}, dur=${track.durationMs}, art=${track.artwork?.url ? 'yes' : 'NO'})`);
  } catch (e) { fail(`search error: ${e.message}`); return; }

  let streams;
  try {
    const { localId } = parseMediaId(track.id);
    streams = await impl.streams(localId);
    if (!streams?.length) { fail('streams khaali list'); return; }
    pass(`streams: ${streams.length} variants — top: ${streams[0].quality} ${new URL(streams[0].url).host}`);
  } catch (e) { fail(`streams error: ${e.message}`); return; }

  const top = streams[0];
  let ok = await byteCheck(top.url, 'bytes[desktop-UA]');
  if (!ok && name === 'ytmusic') {
    console.log('    → iOS UA se retry (googlevideo UA-binding check):');
    ok = await byteCheck(top.url, 'bytes[ios-UA]', UA_IOS);
    if (ok) pass('UA-BINDING HAI: Electron mein googlevideo ke liye UA rewrite chahiye');
  }
  if (ok) pass('stream bytes download OK — playable');
  else fail('stream URL se bytes nahi aaye');
}

console.log('Bloomee LIVE playback test —', new Date().toISOString());
await testSource('jiosaavn', jiosaavn, 'Arijit Singh');
await testSource('ytmusic', ytmusic, 'Arijit Singh');

console.log(`\n══ RESULT: ${failures === 0 ? 'ALL PASS ✓' : failures + ' FAILURES ✗'} ══`);
process.exit(failures ? 1 : 0);
