/* YouTube Music source — Bloomee ke ContentResolver ki REST shakl.
   InnerTube WEB_REMIX se browse/search/next; streams ke liye
   IOS -> ANDROID -> TVHTML5 player clients + signature cipher. */
import { fetchJson, fetchText, UA_DESKTOP } from './http.js';
import { track, album, artist, playlist, durationToMs, ApiError } from './model.js';

const CLIENT = { clientName: 'WEB_REMIX', clientVersion: '1.20260222.01.00', hl: 'en', gl: 'US' };
const API_KEY = 'AIzaSyC9XL3ZjWddXya6X74dJoCTL-WEYFDNX30';
const ORIGIN = 'https://music.youtube.com';

async function innertube(endpoint, body, client = CLIENT) {
  return fetchJson(`${ORIGIN}/youtubei/v1/${endpoint}?key=${API_KEY}&prettyPrint=false`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: ORIGIN,
      referer: `${ORIGIN}/`,
      'user-agent': UA_DESKTOP,
      'x-youtube-client-name': '67',
      'x-youtube-client-version': client.clientVersion,
    },
    body: JSON.stringify({ context: { client }, ...body }),
  });
}

/* ── renderer helpers ── */
const runsText = (runs) => (runs || []).map(r => r.text || '').join('');
function bestThumb(thumbs) {
  if (!Array.isArray(thumbs) || !thumbs.length) return null;
  const sorted = [...thumbs].sort((a, b) => (b.width || 0) - (a.width || 0));
  let url = sorted[0].url;
  if (/=w\d+-h\d+/.test(url)) url = url.replace(/=w\d+-h\d+/, '=w540-h540');
  return url;
}
const itemThumb = (item) =>
  bestThumb(item?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails);
const isExplicit = (item) =>
  (item?.badges || []).some(b => b.musicInlineBadgeRenderer?.icon?.iconType === 'MUSIC_EXPLICIT_BADGE');
const isDuration = (s) => /^\d{1,2}:\d{2}(:\d{2})?$/.test(String(s || '').trim());

/** musicResponsiveListItemRenderer -> Track/Album/Playlist/Artist */
export function parseListItem(item) {
  const r = item?.musicResponsiveListItemRenderer;
  if (!r) return null;
  const col0 = r.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer;
  const col1 = r.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer;
  const titleRun = col0?.text?.runs?.[0];
  const title = titleRun?.text || '';
  const nav = titleRun?.navigationEndpoint || col0?.navigationEndpoint;
  const thumb = itemThumb(r);
  const infoRuns = col1?.text?.runs || [];

  const videoId = nav?.watchEndpoint?.videoId;
  if (videoId) {
    let artistName = null, artistId = null, albumName = null, albumId = null, duration = null;
    for (const run of infoRuns) {
      const bid = run.navigationEndpoint?.browseEndpoint?.browseId;
      if (bid?.startsWith('UC')) { artistId = bid; artistName = run.text; }
      else if (bid?.startsWith('MPRE')) { albumId = bid; albumName = run.text; }
      else if (isDuration(run.text)) duration = run.text;
      else if (!artistName && run.text && run.text !== ' • ') artistName = run.text;
    }
    return track({
      source: 'ytmusic', id: videoId, title,
      artists: artistName ? [{ id: artistId, name: artistName }] : [],
      album: albumName ? { id: albumId, title: albumName } : null,
      durationMs: durationToMs(duration), artwork: thumb, explicit: isExplicit(r),
    });
  }

  const browseId = nav?.browseEndpoint?.browseId || r.navigationEndpoint?.browseEndpoint?.browseId;
  if (!browseId) return null;
  const infoText = runsText(infoRuns);
  if (browseId.startsWith('MPRE')) {
    const parts = infoText.split(' • ').map(s => s.trim());
    const year = parts.find(p => /^\d{4}$/.test(p)) || null;
    const artistName = parts.filter(p => p !== 'Album' && p !== year)[0] || null;
    const artistRun = infoRuns.find(run => run.navigationEndpoint?.browseEndpoint?.browseId?.startsWith('UC'));
    return album({
      source: 'ytmusic', id: browseId, title,
      artists: artistName ? [{ id: artistRun?.navigationEndpoint?.browseEndpoint?.browseId || null, name: artistName }] : [],
      year, artwork: thumb,
    });
  }
  if (browseId.startsWith('VL') || browseId.startsWith('PL') || browseId.startsWith('OLAK') || browseId.startsWith('RD')) {
    const m = infoText.match(/([\d,]+)\s*songs/);
    const author = infoText.split(' • ')[0] || null;
    return playlist({
      source: 'ytmusic', id: browseId, title, artwork: thumb,
      trackCount: m ? Number(m[1].replace(/,/g, '')) : null,
      author: author && author !== 'Playlist' ? author : null,
    });
  }
  if (browseId.startsWith('UC')) {
    const subtitle = infoText.replace(/^Artist\s*•\s*/, '');
    return artist({ source: 'ytmusic', id: browseId, name: title, artwork: thumb, subtitle: subtitle || null });
  }
  return null;
}

/** musicTwoRowItemRenderer (home/album grids) */
export function parseTwoRowItem(item) {
  const r = item?.musicTwoRowItemRenderer;
  if (!r) return null;
  const title = runsText(r.title?.runs);
  const subtitle = runsText(r.subtitle?.runs);
  const browseId = r.navigationEndpoint?.browseEndpoint?.browseId;
  const videoId = r.navigationEndpoint?.watchEndpoint?.videoId;
  const thumb = bestThumb(r.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails);
  if (videoId) {
    return track({
      source: 'ytmusic', id: videoId, title,
      artists: subtitle ? [{ id: null, name: subtitle.split(' • ')[0] }] : [],
      artwork: thumb,
    });
  }
  if (!browseId) return null;
  if (browseId.startsWith('UC')) return artist({ source: 'ytmusic', id: browseId, name: title, artwork: thumb, subtitle: subtitle || null });
  if (browseId.startsWith('MPRE')) {
    const parts = subtitle.split(' • ').map(s => s.trim());
    const year = parts.find(p => /^\d{4}$/.test(p)) || null;
    const artistName = parts.filter(p => p !== 'Album' && p !== year)[0] || null;
    return album({ source: 'ytmusic', id: browseId, title, artists: artistName ? [{ name: artistName }] : [], year, artwork: thumb });
  }
  return playlist({ source: 'ytmusic', id: browseId, title, artwork: thumb, author: subtitle.split(' • ')[0] || null });
}

function shelfItems(shelf) {
  const out = [];
  for (const c of shelf?.contents || []) {
    const parsed = parseListItem(c) || parseTwoRowItem(c);
    if (parsed) out.push(parsed);
  }
  return out;
}

/** search response -> { tracks, albums, playlists, artists } shelf-wise */
export function parseSearchResponse(json) {
  const empty = { tracks: [], albums: [], playlists: [], artists: [] };
  const contents = json?.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer?.content
    ?.sectionListRenderer?.contents || [];
  const out = { ...empty };
  for (const section of contents) {
    const shelf = section.musicShelfRenderer;
    if (!shelf) continue;
    const shelfTitle = (runsText(shelf.title?.runs) || '').toLowerCase();
    const items = shelfItems(shelf);
    if (shelfTitle.includes('song')) out.tracks.push(...items.filter(i => i.kind === 'track'));
    else if (shelfTitle.includes('album')) out.albums.push(...items.filter(i => i.kind === 'album'));
    else if (shelfTitle.includes('playlist')) out.playlists.push(...items.filter(i => i.kind === 'playlist'));
    else if (shelfTitle.includes('artist')) out.artists.push(...items.filter(i => i.kind === 'artist'));
    else {
      for (const i of items) out[{ track: 'tracks', album: 'albums', playlist: 'playlists', artist: 'artists' }[i.kind]]?.push(i);
    }
  }
  return out;
}

/* ── signature cipher (player base.js se ops nikaal kar) ── */
export function decipherWithJs(js, sig) {
  const fnMatch = js.match(/function\s*[A-Za-z0-9$_]*\s*\(a\)\{a=a\.split\(""\);([\s\S]{0,3000}?)return a\.join\(""\)\}/)
    || js.match(/\(a\)=>\{a=a\.split\(""\);([\s\S]{0,3000}?)return a\.join\(""\)\}/);
  if (!fnMatch) throw new ApiError('cipher function not found in base.js', 502, 'cipher');
  const body = fnMatch[1];
  const calls = [...body.matchAll(/([A-Za-z0-9$_]+)\.([A-Za-z0-9$_]+)\(a(?:,(\d+))?\)/g)];
  if (!calls.length) throw new ApiError('cipher ops not found', 502, 'cipher');
  const objName = calls[0][1];
  const objMatch = js.match(new RegExp(`(?:var\\s+)?${objName.replace(/\$/g, '\\$')}=\\{([\\s\\S]{0,4000}?)\\};`));
  if (!objMatch) throw new ApiError('cipher object not found', 502, 'cipher');
  const ops = {};
  for (const m of objMatch[1].matchAll(/([A-Za-z0-9$_]+):function\([^)]*\)\{([^}]*)\}/g)) {
    const b = m[2];
    ops[m[1]] = b.includes('reverse') ? 'reverse' : b.includes('splice') ? 'splice' : 'swap';
  }
  const arr = sig.split('');
  for (const [, , fn, arg] of calls) {
    const op = ops[fn];
    const n = arg ? Number(arg) : 0;
    if (op === 'reverse') arr.reverse();
    else if (op === 'splice') arr.splice(0, n);
    else if (op === 'swap') { const i = n % arr.length; [arr[0], arr[i]] = [arr[i], arr[0]]; }
  }
  return arr.join('');
}

let cipherCache = { js: null, at: 0 };
async function playerBaseJs(videoId) {
  if (cipherCache.js && Date.now() - cipherCache.at < 6 * 3600 * 1000) return cipherCache.js;
  const embed = await fetchText(`https://www.youtube.com/embed/${videoId}`);
  const m = embed.match(/"jsUrl":"([^"]+)"/);
  if (!m) throw new ApiError('player jsUrl not found', 502, 'cipher');
  const url = m[1].startsWith('http') ? m[1] : `https://www.youtube.com${m[1].replace(/\\\//g, '/')}`;
  const js = await fetchText(url);
  cipherCache = { js, at: Date.now() };
  return js;
}

const PLAYER_CLIENTS = [
  { clientName: 'IOS', clientVersion: '20.10.4', userAgent: 'com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)', deviceMake: 'Apple', deviceModel: 'iPhone16,2', osName: 'iPhone', osVersion: '18.3.2.22D82' },
  { clientName: 'ANDROID', clientVersion: '20.10.1', userAgent: 'com.google.android.youtube/20.10.1 (Linux; U; Android 14; en_US) gzip', androidSdkVersion: 34, osName: 'Android', osVersion: '14' },
  { clientName: 'TVHTML5', clientVersion: '7.20250205.16.00', userAgent: 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36' },
];

async function streamsFor(videoId) {
  let baseJs = null;
  for (const client of PLAYER_CLIENTS) {
    try {
      const body = {
        context: { client: { ...client, hl: 'en', gl: 'US' } },
        videoId,
        playbackContext: { contentPlaybackContext: { vis: 0, splay: false, lactMilliseconds: '-1', signatureTimestamp: 20000 } },
        racyCheckOk: true,
        contentCheckOk: true,
      };
      const json = await fetchJson('https://www.youtube.com/youtubei/v1/player?key=' + API_KEY + '&prettyPrint=false', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': client.userAgent, origin: 'https://www.youtube.com' },
        body: JSON.stringify(body),
      });
      const sd = json?.streamingData;
      if (!sd) continue;
      const formats = [...(sd.formats || []), ...(sd.adaptiveFormats || [])]
        .filter(f => (f.mimeType || '').startsWith('audio/'))
        .sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
      const out = [];
      for (const f of formats) {
        let url = f.url || null;
        if (!url && f.signatureCipher) {
          const params = new URLSearchParams(f.signatureCipher);
          const s = params.get('s');
          const sp = params.get('sp') || 'sig';
          const base = params.get('url');
          if (s && base) {
            baseJs = baseJs || (await playerBaseJs(videoId));
            url = `${base}&${sp}=${encodeURIComponent(decipherWithJs(baseJs, s))}`;
          }
        }
        if (url) {
          out.push({
            quality: `${Math.round((f.bitrate || 0) / 1000)}kbps`,
            url,
            format: (f.mimeType || '').split(';')[0].split('/')[1] || 'mp4',
            bitrate: f.bitrate || 0,
            audio: true,
          });
        }
      }
      if (out.length) return out;
    } catch { /* agla client */ }
  }
  throw new ApiError('no playable stream found (all player clients failed)', 502, 'no_stream');
}

/* ── source ── */
export const ytmusic = {
  id: 'ytmusic',
  name: 'YouTube Music',

  async home() {
    const json = await innertube('browse', { browseId: 'FEmusic_home' });
    const sections = json?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content
      ?.sectionListRenderer?.contents || [];
    const out = [];
    for (const s of sections) {
      const carousel = s.musicCarouselShelfRenderer;
      const shelf = s.musicShelfRenderer;
      const title = carousel
        ? runsText(carousel.header?.musicCarouselShelfBasicHeaderRenderer?.title?.runs)
        : runsText(shelf?.title?.runs);
      const items = shelfItems(carousel || shelf || {});
      if (title && items.length) out.push({ title, items });
    }
    return out;
  },

  async search(query, filter = 'all', pageToken = null) {
    const body = pageToken ? { continuation: pageToken } : { query };
    const json = await innertube('search', body);
    const parsed = parseSearchResponse(json);
    if (filter === 'track') return { items: parsed.tracks, page: null };
    if (filter === 'album') return { items: parsed.albums, page: null };
    if (filter === 'playlist') return { items: parsed.playlists, page: null };
    if (filter === 'artist') return { items: parsed.artists, page: null };
    return parsed;
  },

  async suggestions(query) {
    const json = await innertube('music/get_search_suggestions', { input: query });
    const out = [];
    for (const c of json?.contents?.[0]?.searchSuggestionsSectionRenderer?.contents || []) {
      const text = runsText(c.searchSuggestionRenderer?.suggestion?.runs);
      if (text) out.push(text);
    }
    return out.slice(0, 10);
  },

  async trackDetails(id) {
    const json = await innertube('next', { videoId: id, isAudioOnly: true });
    const item = json?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer
      ?.watchNextTabbedResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.musicQueueRenderer
      ?.content?.playlistPanelRenderer?.contents?.[0]?.playlistPanelVideoRenderer;
    const radio = await this.radio(id).catch(() => ({ items: [] }));
    const first = radio.items?.[0];
    if (first && first.id === `ytmusic::${id}`) return first;
    if (!item) throw new ApiError('track not found', 404, 'not_found');
    return track({
      source: 'ytmusic', id,
      title: runsText(item.title?.runs),
      artists: runsText(item.longBylineText?.runs).split(' • ')[0]
        ? [{ id: null, name: runsText(item.longBylineText?.runs).split(' • ')[0] }] : [],
      durationMs: durationToMs(runsText(item.lengthText?.runs)),
      artwork: bestThumb(item.thumbnail?.thumbnails),
    });
  },

  streams: (id) => streamsFor(id),

  async albumDetails(id) {
    const browseId = id.startsWith('MPRE') ? id : `MPRE${id}`;
    const json = await innertube('browse', { browseId });
    const header = json?.header?.musicResponsiveHeaderRenderer || json?.header?.musicDetailHeaderRenderer;
    const title = runsText(header?.title?.runs) || '';
    const subtitleRuns = header?.subtitle?.runs || [];
    const artistRun = subtitleRuns.find(r => r.navigationEndpoint?.browseEndpoint?.browseId?.startsWith('UC'));
    const artistName = artistRun?.text || subtitleRuns.map(r => r.text).filter(t => t !== ' • ' && t !== 'Album')[0] || null;
    const yearRun = subtitleRuns.find(r => /^\d{4}$/.test(r.text || ''));
    const sections = json?.contents?.twoColumnBrowseResultsRenderer?.secondaryContents?.sectionListRenderer?.contents
      || json?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];
    const tracks = [];
    for (const s of sections) tracks.push(...shelfItems(s.musicShelfRenderer || {}).filter(i => i.kind === 'track'));
    const albumObj = album({
      source: 'ytmusic', id: browseId, title,
      artists: artistName ? [{ id: artistRun?.navigationEndpoint?.browseEndpoint?.browseId || null, name: artistName }] : [],
      year: yearRun?.text || null,
      artwork: bestThumb(header?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails),
      trackCount: tracks.length || null,
    });
    // album ke tracks mein album reference bhar do
    for (const t of tracks) if (!t.album) t.album = { id: albumObj.id, title: albumObj.title };
    return { ...albumObj, tracks };
  },

  async playlistDetails(id) {
    const browseId = id.startsWith('VL') ? id : `VL${id}`;
    const json = await innertube('browse', { browseId });
    const header = json?.header?.musicResponsiveHeaderRenderer || json?.header?.musicDetailHeaderRenderer;
    const title = runsText(header?.title?.runs) || runsText(header?.title?.runs) || '';
    const sections = json?.contents?.twoColumnBrowseResultsRenderer?.secondaryContents?.sectionListRenderer?.contents
      || json?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];
    const tracks = [];
    for (const s of sections) {
      tracks.push(...shelfItems(s.musicPlaylistShelfRenderer || s.musicShelfRenderer || {}).filter(i => i.kind === 'track'));
      const cont = s.musicPlaylistShelfRenderer?.contents;
      if (Array.isArray(cont)) for (const c of cont) { const p = parseListItem(c); if (p?.kind === 'track') tracks.push(p); }
    }
    return {
      ...playlist({
        source: 'ytmusic', id: browseId, title,
        artwork: bestThumb(header?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails),
        trackCount: tracks.length || null,
      }),
      tracks: [...new Map(tracks.map(t => [t.id, t])).values()],
    };
  },

  async artistDetails(id) {
    const json = await innertube('browse', { browseId: id });
    const header = json?.header?.musicImmersiveHeaderRenderer || json?.header?.musicResponsiveHeaderRenderer;
    const name = runsText(header?.title?.runs) || '';
    const sections = json?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content
      ?.sectionListRenderer?.contents
      || json?.contents?.twoColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.sectionListRenderer?.contents || [];
    const topTracks = [];
    const albums = [];
    for (const s of sections) {
      if (s.musicShelfRenderer) topTracks.push(...shelfItems(s.musicShelfRenderer).filter(i => i.kind === 'track'));
      if (s.musicCarouselShelfRenderer) albums.push(...shelfItems(s.musicCarouselShelfRenderer).filter(i => i.kind !== 'track'));
    }
    return {
      ...artist({
        source: 'ytmusic', id, name,
        artwork: bestThumb(header?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails),
        subtitle: runsText(header?.description?.runs)?.slice(0, 200) || null,
      }),
      topTracks: topTracks.slice(0, 10),
      albums,
      bio: runsText(header?.description?.runs)?.slice(0, 500) || null,
    };
  },

  async radio(id) {
    const json = await innertube('next', { videoId: id, playlistId: `RDAMVM${id}`, isAudioOnly: true });
    const contents = json?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer
      ?.watchNextTabbedResultsRenderer?.tabs?.[0]?.tabRenderer?.content?.musicQueueRenderer
      ?.content?.playlistPanelRenderer?.contents || [];
    const items = [];
    for (const c of contents) {
      const v = c.playlistPanelVideoRenderer;
      if (!v?.videoId) continue;
      const byline = runsText(v.longBylineText?.runs);
      items.push(track({
        source: 'ytmusic', id: v.videoId,
        title: runsText(v.title?.runs),
        artists: byline ? [{ id: null, name: byline.split(' • ')[0] }] : [],
        durationMs: durationToMs(runsText(v.lengthText?.runs)),
        artwork: bestThumb(v.thumbnail?.thumbnails),
      }));
    }
    return { items, page: null };
  },

  async charts() {
    const sections = await this.home();
    return sections.flatMap(s => s.items.filter(i => i.kind === 'playlist'));
  },

  async chartDetails(id) {
    const p = await this.playlistDetails(id);
    return p.tracks;
  },
};
