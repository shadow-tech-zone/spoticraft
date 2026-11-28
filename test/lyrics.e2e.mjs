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
      console.log(`  ✓ pehli synced line [${(l.synced[0].timeMs / 1000).toFixed(1)}s]: "${l.synced[0].text}"`);
      const withText = l.synced.filter(x => x.text);
      console.log(`  ✓ aakhri synced line [${(withText[withText.length - 1].timeMs / 1000).toFixed(1)}s]: "${withText[withText.length - 1].text}"`);
    }
    /* shape guard: renderer timeMs (number) par chalta hai */
    if (l.synced?.length && !l.synced.every(x => typeof x.timeMs === 'number')) {
      failures++; console.log('  ✗ synced lines mein timeMs number nahi hai — renderer tootega');
    }
  } else { failures++; console.log('  ✗ lyrics nahi mile (null)'); }
} catch (e) { failures++; console.log(`  ✗ lyrics error: ${e.message}`); }

console.log(`\n══ RESULT: ${failures === 0 ? 'ALL PASS ✓' : failures + ' FAILURES ✗'} ══`);
process.exit(failures ? 1 : 0);
