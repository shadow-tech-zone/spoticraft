/* Stream resolver — main process aur tests dono yahi use karte hain.
   Primary source fail (masalan YTM ka LOGIN_REQUIRED bot-check) to
   doosre source par wahi gaana dhoondh kar stream wahan se. */
import { jiosaavn } from './jiosaavn.js';
import { ytmusic } from './ytmusic.js';
import { parseMediaId } from './model.js';

const impl = (src) => (src === 'ytmusic' ? ytmusic : jiosaavn);

export async function resolveStreams(track, log = () => {}) {
  const t = typeof track === 'string' ? { id: track } : (track || {});
  const parsed = parseMediaId(t.id || '');
  const source = parsed?.source || 'jiosaavn';
  const localId = parsed?.localId || t.id;
  const primary = impl(source);
  try {
    const streams = await primary.streams(localId);
    if (!streams?.length) throw new Error('empty stream list');
    log('streams ok', source, localId, `${streams.length} variants`);
    return { streams, via: source };
  } catch (e1) {
    log('streams primary fail', source, localId, e1.message);
    const otherSrc = source === 'ytmusic' ? 'jiosaavn' : 'ytmusic';
    const other = impl(otherSrc);
    const q = [t.title, t.artists?.[0]?.name].filter(Boolean).join(' ').trim();
    if (q) {
      try {
        const res = await other.search(q, 'track', 1);
        const cand = res?.items?.[0];
        if (cand) {
          const streams = await other.streams(parseMediaId(cand.id)?.localId || cand.id);
          if (streams?.length) {
            log('streams fallback ok', otherSrc, cand.id);
            return { streams, via: `${otherSrc}-fallback`, matched: cand.title };
          }
        }
      } catch (e2) { log('streams fallback fail', e2.message); }
    }
    throw e1;
  }
}
