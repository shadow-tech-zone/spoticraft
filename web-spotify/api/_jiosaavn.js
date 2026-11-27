/* ═══════════════════════════════════════════════════════════════
   Bloomee backend — JioSaavn resolver (Node port)

   Ye file BloomeeTunes ke official `jisaavn.bex` plugin
   (kojima-ui/bloom-factory → jiosaavn/src/{client,mapper,crypto}.rs)
   ka seedha JavaScript port hai — wahi endpoints, wahi params,
   wahi DES stream decryption jo Flutter app use karta hai.

   Endpoints (www.jiosaavn.com/api.php, ctx=web6dot0, api_version=4):
     home      __call=webapi.getLaunchData
     search    __call=search.getResults / getAlbumResults /
                       getArtistResults / getPlaylistResults
     track     __call=song.getDetails&pids=
     album     __call=content.getAlbumDetails&albumid=
     playlist  __call=playlist.getDetails&listid=&p=&n=
     artist    __call=artist.getArtistPageDetails&artistId=
     radio     __call=reco.getreco&pid=        (ctx=android)
   Streams: more_info.encrypted_media_url → DES-ECB decrypt
   (key "38346591") → quality suffix _320/_160/_96.
   ═══════════════════════════════════════════════════════════════ */
'use strict';

/* ── Pure-JS DES (ECB decrypt) — port of crypto.rs ─────────────
   Node/OpenSSL 3 mein DES legacy provider mein hota hai, is liye
   crypto module par depend nahi kar sakte. Ye chhoti si
   implementation standard DES tables use karti hai.          */
const IP = [58,50,42,34,26,18,10,2,60,52,44,36,28,20,12,4,62,54,46,38,30,22,14,6,64,56,48,40,32,24,16,8,57,49,41,33,25,17,9,1,59,51,43,35,27,19,11,3,61,53,45,37,29,21,13,5,63,55,47,39,31,23,15,7];
const FP = [40,8,48,16,56,24,64,32,39,7,47,15,55,23,63,31,38,6,46,14,54,22,62,30,37,5,45,13,53,21,61,29,36,4,44,12,52,20,60,28,35,3,43,11,51,19,59,27,34,2,42,10,50,18,58,26,33,1,41,9,49,17,57,25];
const ET = [32,1,2,3,4,5,4,5,6,7,8,9,8,9,10,11,12,13,12,13,14,15,16,17,16,17,18,19,20,21,20,21,22,23,24,25,24,25,26,27,28,29,28,29,30,31,32,1];
const PT = [16,7,20,21,29,12,28,17,1,15,23,26,5,18,31,10,2,8,24,14,32,27,3,9,19,13,30,6,22,11,4,25];
const PC1 = [57,49,41,33,25,17,9,1,58,50,42,34,26,18,10,2,59,51,43,35,27,19,11,3,60,52,44,36,63,55,47,39,31,23,15,7,62,54,46,38,30,22,14,6,61,53,45,37,29,21,13,5,28,20,12,4];
const PC2 = [14,17,11,24,1,5,3,28,15,6,21,10,23,19,12,4,26,8,16,7,27,20,13,2,41,52,31,37,47,55,30,40,51,45,33,48,44,49,39,56,34,53,46,42,50,36,29,32];
const SHIFTS = [1,1,2,2,2,2,2,2,1,2,2,2,2,2,2,1];
const SBOX = [
  [14,4,13,1,2,15,11,8,3,10,6,12,5,9,0,7, 0,15,7,4,14,2,13,1,10,6,12,11,9,5,3,8, 4,1,14,8,13,6,2,11,15,12,9,7,3,10,5,0, 15,12,8,2,4,9,1,7,5,11,3,14,10,0,6,13],
  [15,1,8,14,6,11,3,4,9,7,2,13,12,0,5,10, 3,13,4,7,15,2,8,14,12,0,1,10,6,9,11,5, 0,14,7,11,10,4,13,1,5,8,12,6,9,3,2,15, 13,8,10,1,3,15,4,2,11,6,7,12,0,5,14,9],
  [10,0,9,14,6,3,15,5,1,13,12,7,11,4,2,8, 13,7,0,9,3,4,6,10,2,8,5,14,12,11,15,1, 13,6,4,9,8,15,3,0,11,1,2,12,5,10,14,7, 1,10,13,0,6,9,8,7,4,15,14,3,11,5,2,12],
  [7,13,14,3,0,6,9,10,1,2,8,5,11,12,4,15, 13,8,11,5,6,15,0,3,4,7,2,12,1,10,14,9, 10,6,9,0,12,11,7,13,15,1,3,14,5,2,8,4, 3,15,0,6,10,1,13,8,9,4,5,11,12,7,2,14],
  [2,12,4,1,7,10,11,6,8,5,3,15,13,0,14,9, 14,11,2,12,4,7,13,1,5,0,15,10,3,9,8,6, 4,2,1,11,10,13,7,8,15,9,12,5,6,3,0,14, 11,8,12,7,1,14,2,13,6,15,0,9,10,4,5,3],
  [12,1,10,15,9,2,6,8,0,13,3,4,14,7,5,11, 10,15,4,2,7,12,9,5,6,1,13,14,0,11,3,8, 9,14,15,5,2,8,12,3,7,0,4,10,1,13,11,6, 4,3,2,12,9,5,15,10,11,14,1,7,6,0,8,13],
  [4,11,2,14,15,0,8,13,3,12,9,7,5,10,6,1, 13,0,11,7,4,9,1,10,14,3,5,12,2,15,8,6, 1,4,11,13,12,3,7,14,10,15,6,8,0,5,9,2, 6,11,13,8,1,4,10,7,9,5,0,15,14,2,3,12],
  [13,2,8,4,6,15,11,1,10,9,3,14,5,0,12,7, 1,15,13,8,10,3,7,4,12,5,6,11,0,14,9,2, 7,11,4,1,9,12,14,2,0,6,10,13,15,3,5,8, 2,1,14,7,4,10,8,13,15,12,9,0,3,5,6,11],
];

function permute(value, table, inputBits) {
  let out = 0n;
  for (const pos of table) out = (out << 1n) | ((value >> BigInt(inputBits - pos)) & 1n);
  return out;
}
function desSubkeys(keyBig) {
  const pc1 = permute(keyBig, PC1, 64);
  let c = pc1 >> 28n, d = pc1 & 0xFFFFFFFn;
  const keys = [];
  for (const s of SHIFTS) {
    const sh = BigInt(s);
    c = ((c << sh) | (c >> (28n - sh))) & 0xFFFFFFFn;
    d = ((d << sh) | (d >> (28n - sh))) & 0xFFFFFFFn;
    keys.push(permute((c << 28n) | d, PC2, 56));
  }
  return keys;
}
function feistel(r, k) {
  const x = permute(r, ET, 32) ^ k;
  let out = 0n;
  for (let i = 0; i < 8; i++) {
    const six = Number((x >> BigInt(42 - 6 * i)) & 0x3Fn);
    const row = ((six & 0x20) >> 4) | (six & 0x01);
    const col = (six >> 1) & 0x0F;
    out = (out << 4n) | BigInt(SBOX[i][row * 16 + col]);
  }
  return permute(out, PT, 32);
}
function desBlock(block, keys, decrypt) {
  const ip = permute(block, IP, 64);
  let l = ip >> 32n, r = ip & 0xFFFFFFFFn;
  const ks = decrypt ? [...keys].reverse() : keys;
  for (const k of ks) { const t = r; r = l ^ feistel(r, k); l = t; }
  return permute((r << 32n) | l, FP, 64);
}
function bufToBig(buf, off) {
  let v = 0n;
  for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(buf[off + i]);
  return v;
}
function bigToBuf(v) {
  const b = Buffer.alloc(8);
  for (let i = 7; i >= 0; i--) { b[i] = Number(v & 0xFFn); v >>= 8n; }
  return b;
}

const DES_KEY = '38346591'; // crypto.rs: const DES_KEY: &[u8; 8] = b"38346591"

/** crypto.rs `decode_media_url` ka port. */
function decryptMediaUrl(encryptedB64) {
  const data = Buffer.from(String(encryptedB64), 'base64');
  if (!data.length || data.length % 8 !== 0) throw new Error('Invalid encrypted data length');
  const keys = desSubkeys(bufToBig(Buffer.from(DES_KEY, 'utf8'), 0));
  const blocks = [];
  for (let off = 0; off < data.length; off += 8) {
    blocks.push(bigToBuf(desBlock(bufToBig(data, off), keys, true)));
  }
  let plain = Buffer.concat(blocks);
  // PKCS#7 unpadding (same validation as Rust code)
  const last = plain[plain.length - 1];
  if (last > 0 && last <= 8 && plain.length >= last) {
    let ok = true;
    for (let i = plain.length - last; i < plain.length; i++) if (plain[i] !== last) { ok = false; break; }
    if (ok) plain = plain.subarray(0, plain.length - last);
  }
  let url = plain.toString('utf8');
  for (const ext of ['.mp4', '.m4a']) {           // clean_extension()
    const idx = url.indexOf(ext);
    if (idx >= 0 && idx + ext.length < url.length) url = url.slice(0, idx + ext.length);
  }
  return url.replace('http:', 'https:');
}

/* ── JioSaavn HTTP client (client.rs `make_request`) ── */
const BASE_URL = 'https://www.jiosaavn.com/api.php';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

async function jio(params, { ctx = 'web6dot0', v4 = true, timeoutMs = 15000 } = {}) {
  let url = `${BASE_URL}?_format=json&_marker=0&ctx=${ctx}`;
  if (v4) url += '&api_version=4';
  url += '&' + params;
  const res = await fetch(url, {
    headers: { 'Accept': 'application/json, text/plain, */*', 'User-Agent': UA },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`JioSaavn API returned status ${res.status}`);
  return res.json();
}

/* ── Mappers (mapper.rs ka port) ── */
const cleanHtml = s => String(s ?? '')
  .replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#039;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const fixImage = u => u ? String(u).replace('150x150', '500x500').replace('50x50', '500x500').replace('http:', 'https:') : '';
const str = v => (v === undefined || v === null) ? '' : String(v);

function extractArtists(item) {
  const mi = item.more_info || {};
  const map = mi.artistMap || mi.artist_map;
  const out = [];
  if (map && Array.isArray(map.primary_artists)) {
    for (const a of map.primary_artists) {
      out.push({ id: str(a.id), name: cleanHtml(a.name || ''), image: fixImage(a.image) });
    }
  }
  if (Array.isArray(mi.artist_name) && out.length === 0) {
    for (const n of mi.artist_name) out.push({ id: '', name: cleanHtml(n) });
  }
  if (!out.length && item.subtitle) out.push({ id: '', name: cleanHtml(item.subtitle) });
  return out;
}
const artistNames = item => extractArtists(item).map(a => a.name).filter(Boolean).join(', ');

function mapTrack(item) {
  const mi = item.more_info || {};
  const artists = extractArtists(item);
  const duration = parseInt(mi.duration, 10);
  return {
    kind: 'track',
    id: str(item.id),
    title: cleanHtml(item.title || item.name || ''),
    artist: artists.map(a => a.name).filter(Boolean).join(', ') || cleanHtml(item.subtitle || ''),
    artists,
    album: mi.album ? { id: str(mi.album_id), title: cleanHtml(mi.album) } : null,
    duration: Number.isFinite(duration) ? duration : null,   // seconds
    image: fixImage(item.image),
    year: item.year ? parseInt(item.year, 10) || null : null,
    language: item.language || mi.language || null,
    explicit: str(item.explicit_content) === '1',
    hasLyrics: mi.has_lyrics === 'true',
    permaUrl: item.perma_url || null,
  };
}
function mapAlbum(item) {
  return {
    kind: 'album',
    id: str(item.id),
    title: cleanHtml(item.title || item.name || ''),
    artist: artistNames(item) || cleanHtml(item.subtitle || ''),
    artists: extractArtists(item),
    image: fixImage(item.image),
    year: item.year ? parseInt(item.year, 10) || null : null,
    subtitle: item.subtitle ? cleanHtml(item.subtitle) : null,
    permaUrl: item.perma_url || null,
  };
}
function mapPlaylist(item) {
  const mi = item.more_info || {};
  return {
    kind: 'playlist',
    id: str(item.id),
    title: cleanHtml(item.title || item.name || ''),
    image: fixImage(item.image),
    owner: mi.firstname || null,
    subtitle: item.subtitle ? cleanHtml(item.subtitle) : (mi.firstname || null),
    count: item.list_count ? parseInt(item.list_count, 10) || null : null,
    permaUrl: item.perma_url || null,
  };
}
function mapArtist(item) {
  return {
    kind: 'artist',
    id: str(item.artistId || item.id),
    name: cleanHtml(item.name || item.title || ''),
    image: fixImage(item.image),
    subtitle: item.subtitle ? cleanHtml(item.subtitle) : 'Artist',
    permaUrl: item.perma_url || (item.urls && item.urls.overview) || null,
  };
}
/** mapper.rs `map_to_media_item` — type field se dispatch. */
function mapMediaItem(item) {
  if (!item || typeof item !== 'object') return null;
  switch (item.type || 'song') {
    case 'song': return mapTrack(item);
    case 'album': return mapAlbum(item);
    case 'playlist': case 'radio_station': case 'radio': case 'channel': return mapPlaylist(item);
    case 'artist': return mapArtist(item);
    default: return null;
  }
}
const mapList = arr => (Array.isArray(arr) ? arr : []).map(mapMediaItem).filter(Boolean);

/** client.rs `get_stream_source` — encrypted URL se quality sources. */
function streamSources(songObj) {
  const mi = songObj.more_info || {};
  const enc = mi.encrypted_media_url || songObj.encrypted_media_url;
  if (!enc) return [];
  let base;
  try { base = decryptMediaUrl(enc); } catch { return []; }
  return [['320 kbps', '_320'], ['160 kbps', '_160'], ['96 kbps', '_96']].map(([quality, suffix]) => {
    let url = base;
    for (const s of ['_96', '_160', '_320']) {
      if (base.includes(s + '.')) { url = base.replace(s + '.', suffix + '.'); break; }
    }
    return { quality, url, format: 'mp4' };
  });
}

/* ── Handler helpers ── */
function sendJson(res, status, obj, cache = 'public, s-maxage=120, stale-while-revalidate=600') {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (cache) res.setHeader('Cache-Control', cache);
  res.end(JSON.stringify(obj));
}
function handler(fn) {
  return async (req, res) => {
    try {
      const q = req.query || {};
      const out = await fn(q, req);
      sendJson(res, out.status || 200, out.body, out.cache);
    } catch (e) {
      sendJson(res, 502, { error: 'Bloomee backend (JioSaavn resolver) se jawab nahi mila', detail: String(e && e.message || e) }, null);
    }
  };
}
const badRequest = msg => ({ status: 400, body: { error: msg }, cache: null });

module.exports = {
  jio, decryptMediaUrl, streamSources,
  mapTrack, mapAlbum, mapPlaylist, mapArtist, mapMediaItem, mapList,
  handler, sendJson, badRequest,
};
