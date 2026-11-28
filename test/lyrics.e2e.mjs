/* LIVE lyrics test — LRCLIB asal network par.
   Tum Hi Ho ke synced lyrics milne chahiye (timestamps ke saath). */
import { getLyrics } from '../app/core/lyrics.js';

console.log('Bloomee LIVE lyrics test —', new Date().toISOString());
let failures = 0;

try {
  const l = await getLyrics({ title: 'Tum Hi Ho', artist: 'Arijit Singh', album: 'Aashiqui 2', durationMs: 262000 });
  if (l && (l.plain || l.synced?.length)) {
    console.log(`  ✓ lyrics mile: source=${l.source} synced=${l.synced?.length || 0} lines, plain=${l.plain ? l.plain.length + ' chars' : 'nahi'}`);
    if (l.synced?.length) {
      console.log(`  ✓ pehli synced line [${l.synced[0].t}s]: "${l.synced[0].text}"`);
      console.log(`  ✓ aakhri synced line [${l.synced[l.synced.length - 1].t}s]: "${l.synced[l.synced.length - 1].text}"`);
    }
  } else { failures++; console.log('  ✗ lyrics nahi mile (null)'); }
} catch (e) { failures++; console.log(`  ✗ lyrics error: ${e.message}`); }

console.log(`\n══ RESULT: ${failures === 0 ? 'ALL PASS ✓' : failures + ' FAILURES ✗'} ══`);
process.exit(failures ? 1 : 0);
