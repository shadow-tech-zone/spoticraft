/* YouTube Music search/home raw structure debug.
   Renderer type tree + shelf titles print karta hai taake parse gap dikhe. */
import { fetchJson, UA_DESKTOP } from '../app/core/http.js';
import { ytmusic } from '../app/core/ytmusic.js';

const CLIENT = { clientName: 'WEB_REMIX', clientVersion: '1.20260222.01.00', hl: 'en', gl: 'US' };
const API_KEY = 'AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30';
const ORIGIN = 'https://music.youtube.com';

async function innertube(endpoint, body) {
  return fetchJson(`${ORIGIN}/youtubei/v1/${endpoint}?key=${API_KEY}&prettyPrint=false`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json', origin: ORIGIN, referer: `${ORIGIN}/`,
      'user-agent': UA_DESKTOP, 'x-youtube-client-name': '67',
      'x-youtube-client-version': CLIENT.clientVersion,
    },
    body: JSON.stringify({ context: { client: CLIENT }, ...body }),
  });
}

function walk(node, path, depth, out) {
  if (!node || typeof node !== 'object' || depth > 7) return;
  for (const [k, v] of Object.entries(node)) {
    if (k.endsWith('Renderer') || k.endsWith('Shelf')) {
      const title = v?.title?.runs?.map(r => r.text).join('') || v?.header?.musicCarouselShelfBasicHeaderRenderer?.title?.runs?.map(r => r.text).join('') || '';
      out.push(`${path}.${k}${title ? ` title="${title}"` : ''}${Array.isArray(v?.contents) ? ` contents=${v.contents.length}` : ''}`);
    }
    if (v && typeof v === 'object') walk(v, `${path}.${k}`, depth + 1, out);
  }
}

console.log('── YT search raw ("Arijit Singh") ──');
try {
  const json = await innertube('search', { query: 'Arijit Singh' });
  console.log('top keys:', Object.keys(json).join(','));
  const out = [];
  walk(json, '$', 0, out);
  console.log(out.slice(0, 40).join('\n') || '(koi renderer nahi mila)');
} catch (e) { console.log('search HTTP error:', e.message); }

console.log('\n── ytmusic.search() parsed ──');
try {
  const r = await ytmusic.search('Arijit Singh', 'all');
  console.log(`tracks=${r.tracks.length} albums=${r.albums.length} playlists=${r.playlists.length} artists=${r.artists.length}`);
  if (r.tracks[0]) console.log('first track:', r.tracks[0].id, r.tracks[0].title);
} catch (e) { console.log('parsed search error:', e.message); }

console.log('\n── known video stream test (dQw4w9WgXcQ) ──');
try {
  const s = await ytmusic.streams('dQw4w9WgXcQ');
  console.log(`streams=${s.length} top=${s[0].quality} ${new URL(s[0].url).host}`);
  const r = await fetch(s[0].url, { headers: { Range: 'bytes=0-1023', 'user-agent': UA_DESKTOP } });
  const b = await r.arrayBuffer();
  console.log(`bytes: HTTP ${r.status} type=${r.headers.get('content-type')} n=${b.byteLength}`);
} catch (e) { console.log('stream error:', e.message); }
