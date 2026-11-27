/* ═══════════════════════════════════════════════════════════════
   Bloomee backend — YouTube Music response parsers (Node port)

   BloomeeTunes ke `ytmusic.bex` plugin ke parser.rs + mapper.rs
   ka seedha JavaScript port: InnerTube JSON → web shapes.
   _ytmusic.js (client/streams) isay use karta hai.
   ═══════════════════════════════════════════════════════════════ */
'use strict';

/* ── JSON navigation helpers (parser.rs ka port) ── */
function nav(root, path) {
  let cur = root;
  for (const key of path.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    cur = /^\d+$/.test(key) ? cur[Number(key)] : cur[key];
  }
  return cur;
}
const arr = v => (Array.isArray(v) ? v : undefined);
function getText(obj, key) {
  const c = obj && obj[key];
  if (!c || typeof c !== 'object') return undefined;
  if (typeof c.simpleText === 'string') return c.simpleText;
  if (Array.isArray(c.runs)) {
    const text = c.runs.map(r => (r && typeof r.text === 'string') ? r.text : '').join('');
    if (text) return text;
  }
  return undefined;
}
const getRunsText = obj => (obj && Array.isArray(obj.runs) && obj.runs[0] && typeof obj.runs[0].text === 'string') ? obj.runs[0].text : undefined;
function cleanThumbUrl(url) {
  let full = url.startsWith('//') ? 'https:' + url : url;
  if (full.includes('ytimg.com')) full = full.split('?')[0];
  return full;
}
function getThumbnails(obj) {
  if (!obj || typeof obj !== 'object') return [];
  const t = obj.thumbnail || obj.thumbnailRenderer || obj.thumbnails;
  let list;
  if (t && typeof t === 'object') {
    list = arr(t.thumbnails)
      || arr(nav(t, 'musicThumbnailRenderer.thumbnail.thumbnails'))
      || arr(nav(t, 'croppedSquareThumbnailRenderer.thumbnail.thumbnails'))
      || arr(t);
  }
  const out = [];
  for (const th of list || []) {
    if (th && typeof th.url === 'string') out.push([cleanThumbUrl(th.url), th.width || 0]);
  }
  out.sort((a, b) => a[1] - b[1]);
  return out;
}
/** mapper.rs thumbnail_to_artwork: googleusercontent = square (576 upgrade), ytimg = landscape. */
function bestImage(thumbnails) {
  if (!thumbnails || !thumbnails.length) return '';
  let url = thumbnails[thumbnails.length - 1][0];
  if (/googleusercontent\.com|ggpht\.com/.test(url)) {
    url = url.replace(/=w\d+-h\d+/, '=w576-h576');
  }
  return url;
}
function getBrowseId(obj) {
  const id = nav(obj, 'navigationEndpoint.browseEndpoint.browseId');
  return typeof id === 'string' ? id : undefined;
}
function getVideoId(obj) {
  let id = nav(obj, 'navigationEndpoint.watchEndpoint.videoId');
  if (typeof id === 'string') return id;
  id = nav(obj, 'overlay.musicItemThumbnailOverlayRenderer.content.musicPlayButtonRenderer.playNavigationEndpoint.watchEndpoint.videoId');
  return typeof id === 'string' ? id : undefined;
}
function parseDurationMs(s) {
  const parts = String(s).trim().split(':');
  if (parts.length !== 2 && parts.length !== 3) return undefined;
  const nums = parts.map(p => (/^\d+$/.test(p) ? Number(p) : NaN));
  if (nums.some(Number.isNaN)) return undefined;
  const secs = parts.length === 2 ? nums[0] * 60 + nums[1] : nums[0] * 3600 + nums[1] * 60 + nums[2];
  return secs * 1000;
}
function extractContinuation(data) {
  const token = nav(data, 'continuations.0.nextContinuationData.continuation');
  if (typeof token === 'string') return token;
  const contents = arr(data && data.contents);
  if (contents && contents.length) {
    const token2 = nav(contents[contents.length - 1], 'continuationItemRenderer.continuationEndpoint.continuationCommand.token');
    if (typeof token2 === 'string') return token2;
  }
  return undefined;
}
function isExplicit(renderer) {
  return arr(renderer && renderer.badges)?.some(b => nav(b, 'musicInlineBadgeRenderer.icon.iconType') === 'MUSIC_EXPLICIT_BADGE') || false;
}
const runBrowseId = run => {
  const id = nav(run, 'navigationEndpoint.browseEndpoint.browseId');
  return typeof id === 'string' ? id : undefined;
};

/* ── ParsedItem → web shape (frontend ke JioSaavn shapes se match) ── */
const SRC = 'ytmusic';
const trackId = videoId => `yt_${videoId}`;
function ytThumbFallback(videoId) { return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`; }

function mapParsedItem(p, fallbackImage) {
  if (!p) return null;
  if (p.type === 'track') {
    return {
      kind: 'track', source: SRC,
      id: trackId(p.videoId), vid: p.videoId,
      title: p.title,
      artist: p.artists.map(a => a.name).filter(Boolean).join(', ') || 'Unknown Artist',
      artists: p.artists.map(a => ({ id: a.id || '', name: a.name, image: '' })),
      album: p.album ? { id: p.album.id || '', title: p.album.title } : null,
      duration: p.durationMs != null ? Math.round(p.durationMs / 1000) : null,
      image: bestImage(p.thumbnails) || fallbackImage || ytThumbFallback(p.videoId),
      year: null, language: null, explicit: !!p.isExplicit, hasLyrics: true,
      permaUrl: `https://music.youtube.com/watch?v=${p.videoId}`,
    };
  }
  if (p.type === 'album') {
    return {
      kind: 'album', source: SRC, id: p.browseId,
      title: p.title,
      artist: p.artists.map(a => a.name).filter(Boolean).join(', '),
      artists: p.artists.map(a => ({ id: a.id || '', name: a.name, image: '' })),
      image: bestImage(p.thumbnails),
      year: p.year ?? null,
      subtitle: 'Album',
      permaUrl: `https://music.youtube.com/browse/${p.browseId}`,
    };
  }
  if (p.type === 'artist') {
    return {
      kind: 'artist', source: SRC, id: p.browseId,
      name: p.title,
      image: bestImage(p.thumbnails),
      subtitle: 'Artist',
      permaUrl: `https://music.youtube.com/channel/${p.browseId}`,
    };
  }
  if (p.type === 'playlist') {
    return {
      kind: 'playlist', source: SRC, id: p.browseId,
      title: p.title,
      image: bestImage(p.thumbnails),
      owner: p.owner || null,
      subtitle: p.owner || 'Playlist',
      count: p.trackCount ?? null,
      permaUrl: `https://music.youtube.com/playlist?list=${p.browseId.replace(/^VL/, '')}`,
    };
  }
  return null;
}
/** AlbumTrack (album/playlist/radio pages) → web track. */
function mapAlbumTrack(t, albumCtx, fallbackImage) {
  return mapParsedItem({
    type: 'track', videoId: t.videoId, title: t.title, artists: t.artists,
    album: albumCtx || undefined, durationMs: t.durationMs,
    thumbnails: t.thumbnails, isExplicit: t.isExplicit,
  }, fallbackImage);
}
const mapItems = (items, fb) => (items || []).map(p => mapParsedItem(p, fb)).filter(Boolean);

/* ── Item parsers (parser.rs ka port) ── */
function getSubtitleRuns(renderer) {
  const runs = arr(nav(renderer, 'flexColumns.1.musicResponsiveListItemFlexColumnRenderer.text.runs')) || [];
  const out = [];
  for (const run of runs) {
    const text = (run && run.text) || '';
    if (text === ' • ' || text === ' & ' || text === ', ') continue;
    const bid = runBrowseId(run);
    out.push({ text, browseId: bid, isLink: !!bid });
  }
  return out;
}
function parseDurationLastPart(parts) {
  const last = parts[parts.length - 1];
  return last !== undefined ? parseDurationMs(String(last).trim()) : undefined;
}
function parseTrackSubtitle(subtitle, runs) {
  let artists = [], album, durationMs;
  if (runs.length) {
    for (const run of runs) {
      if (!run.browseId) continue;
      if (run.browseId.startsWith('UC')) artists.push({ name: run.text, id: run.browseId });
      else if (run.browseId.startsWith('MPRE')) album = { title: run.text, id: run.browseId };
    }
    const last = runs[runs.length - 1];
    if (last && !last.browseId) durationMs = parseDurationMs(last.text);
  }
  if (!artists.length) {
    const parts = String(subtitle || '').split(' • ');
    if (parts.length >= 2) {
      const artistStr = parts[0].includes(':') ? parts[0] : (parts.length >= 3 ? parts[1] : parts[0]);
      artists = artistStr.split(' & ').map(a => ({ name: a.trim(), id: undefined })).filter(a => a.name);
    }
    if (durationMs === undefined) durationMs = parseDurationLastPart(parts);
  }
  return { artists, album, durationMs };
}
function parseSubtitleArtists(subtitle) {
  const parts = String(subtitle || '').split(' • ');
  const artistPart = parts.length >= 2 ? parts[1] : (parts[0] || '');
  return artistPart.split(' & ').map(a => ({ name: a.trim(), id: undefined })).filter(a => a.name);
}
function extractYear(subtitle) {
  for (const part of String(subtitle || '').split(' • ')) {
    const trimmed = part.trim();
    if (trimmed.length === 4 && /^\d{4}$/.test(trimmed)) {
      const y = Number(trimmed);
      if (y >= 1900 && y <= 2100) return y;
    }
  }
  return undefined;
}
/** musicResponsiveListItemRenderer → ParsedItem */
function parseResponsiveItem(renderer) {
  const flexColumns = arr(renderer && renderer.flexColumns);
  if (!flexColumns || !flexColumns.length) return null;
  const title = getText(flexColumns[0].musicResponsiveListItemFlexColumnRenderer, 'text');
  if (!title) return null;
  const subtitleText = (flexColumns[1] && getText(flexColumns[1].musicResponsiveListItemFlexColumnRenderer, 'text')) || '';
  const thumbnails = getThumbnails(renderer);
  const videoId = getVideoId(renderer);
  const browseId = getBrowseId(renderer);
  const subtitleRuns = getSubtitleRuns(renderer);

  if (videoId) {
    const { artists, album, durationMs } = parseTrackSubtitle(subtitleText, subtitleRuns);
    return { type: 'track', videoId, title, artists, album, durationMs, thumbnails, isExplicit: isExplicit(renderer) };
  }
  if (browseId) {
    if (browseId.startsWith('MPRE')) {
      return { type: 'album', browseId, title, artists: parseSubtitleArtists(subtitleText), year: extractYear(subtitleText), thumbnails };
    }
    if (browseId.startsWith('UC')) return { type: 'artist', browseId, title, thumbnails };
    if (browseId.startsWith('VL') || browseId.startsWith('PL')) {
      const ownerRun = subtitleRuns.find(r => !r.isLink);
      const owner = ownerRun ? ownerRun.text : (subtitleText.split(' • ')[0] || undefined);
      return { type: 'playlist', browseId: browseId.startsWith('VL') ? browseId : 'VL' + browseId, title, owner, trackCount: undefined, thumbnails };
    }
  }
  return null;
}
/** musicTwoRowItemRenderer → ParsedItem */
function parseTwoRowItem(renderer) {
  const title = getText(renderer, 'title');
  if (!title) return null;
  const subtitle = getText(renderer, 'subtitle') || '';
  const thumbnails = getThumbnails(renderer);
  const browseId = getBrowseId(renderer);
  const videoId = getVideoId(renderer);
  if (videoId) return { type: 'track', videoId, title, artists: parseSubtitleArtists(subtitle), album: undefined, durationMs: undefined, thumbnails, isExplicit: false };
  if (browseId) {
    if (browseId.startsWith('MPRE')) return { type: 'album', browseId, title, artists: parseSubtitleArtists(subtitle), year: extractYear(subtitle), thumbnails };
    if (browseId.startsWith('UC')) return { type: 'artist', browseId, title, thumbnails };
    if (browseId.startsWith('VL') || browseId.startsWith('PL')) {
      return { type: 'playlist', browseId: browseId.startsWith('VL') ? browseId : 'VL' + browseId, title, owner: undefined, trackCount: undefined, thumbnails };
    }
  }
  return null;
}
function parseItemArray(contents) {
  const out = [];
  for (const item of contents || []) {
    if (!item) continue;
    if (item.musicResponsiveListItemRenderer) { const p = parseResponsiveItem(item.musicResponsiveListItemRenderer); if (p) out.push(p); }
    else if (item.musicTwoRowItemRenderer) { const p = parseTwoRowItem(item.musicTwoRowItemRenderer); if (p) out.push(p); }
  }
  return out;
}
/** musicResponsiveListItemRenderer (fixedColumns duration wali) → AlbumTrack */
function parseAlbumTrackItem(renderer, trackNum) {
  const flexColumns = arr(renderer && renderer.flexColumns);
  if (!flexColumns || !flexColumns.length) return null;
  const title = getText(flexColumns[0].musicResponsiveListItemFlexColumnRenderer, 'text');
  if (!title) return null;
  const videoId = getVideoId(renderer);
  if (!videoId) return null;
  const thumbnails = getThumbnails(renderer);
  const artists = [];
  const runs = arr(nav(flexColumns[1], 'musicResponsiveListItemFlexColumnRenderer.text.runs')) || [];
  for (const run of runs) {
    const text = (run && run.text) || '';
    if (text === ' & ' || text === ', ') continue;
    const bid = runBrowseId(run);
    if ((bid && bid.startsWith('UC')) || text.length > 1) artists.push({ name: text, id: bid });
  }
  const durationText = getText(nav(renderer, 'fixedColumns.0.musicResponsiveListItemFixedColumnRenderer'), 'text');
  return {
    videoId, title, artists, thumbnails,
    durationMs: durationText ? parseDurationMs(durationText) : undefined,
    trackNumber: trackNum, isExplicit: isExplicit(renderer),
  };
}
function parseAlbumTrackArray(contents, startNum = 1) {
  const out = [];
  (contents || []).forEach((item, i) => {
    const r = item && item.musicResponsiveListItemRenderer;
    if (r) { const t = parseAlbumTrackItem(r, startNum + i); if (t) out.push(t); }
  });
  return out;
}

/* ── Search ── */
const SEARCH_PATHS = [
  'contents.tabbedSearchResultsRenderer.tabs.0.tabRenderer.content.sectionListRenderer.contents',
  'contents.sectionListRenderer.contents',
];
function findSearchContents(data) {
  for (const path of SEARCH_PATHS) {
    const sections = arr(nav(data, path));
    if (!sections) continue;
    for (const section of sections) {
      if (section.musicShelfRenderer) return arr(section.musicShelfRenderer.contents);
    }
  }
  const cont = nav(data, 'continuationContents.musicShelfContinuation');
  if (cont) return arr(cont.contents);
  return undefined;
}
function findContinuationToken(data) {
  for (const path of SEARCH_PATHS) {
    const sections = arr(nav(data, path));
    if (!sections) continue;
    for (const section of sections) {
      if (section.musicShelfRenderer) {
        const token = extractContinuation(section.musicShelfRenderer);
        if (token) return token;
      }
    }
  }
  const shelf = nav(data, 'continuationContents.musicShelfContinuation');
  return shelf ? extractContinuation(shelf) : undefined;
}
function findCardShelf(data) {
  for (const path of SEARCH_PATHS) {
    const sections = arr(nav(data, path));
    if (!sections) continue;
    for (const section of sections) if (section.musicCardShelfRenderer) return section.musicCardShelfRenderer;
  }
  return undefined;
}
function parseCardShelfItem(card) {
  const title = getText(card, 'title');
  if (!title) return null;
  const thumbnails = getThumbnails(card);
  const videoId = getVideoId(card);
  if (videoId) {
    const subtitle = getText(card, 'subtitle') || '';
    return { type: 'track', videoId, title, artists: parseSubtitleArtists(subtitle), album: undefined, durationMs: undefined, thumbnails, isExplicit: false };
  }
  const browseId = getBrowseId(card);
  if (browseId && browseId.startsWith('MPRE')) {
    const subtitle = getText(card, 'subtitle') || '';
    return { type: 'album', browseId, title, artists: parseSubtitleArtists(subtitle), year: extractYear(subtitle), thumbnails };
  }
  if (browseId && browseId.startsWith('UC')) return { type: 'artist', browseId, title, thumbnails };
  return null;
}
function parseSearchResults(data) {
  let items = [];
  let continuation;
  const contents = findSearchContents(data);
  if (contents) {
    items = parseItemArray(contents);
    continuation = findContinuationToken(data);
  } else {
    for (const path of SEARCH_PATHS) {
      const sections = arr(nav(data, path));
      if (!sections) continue;
      for (const section of sections) {
        const inner = arr(nav(section, 'itemSectionRenderer.contents'));
        if (inner) items.push(...parseItemArray(inner));
      }
      continuation = findContinuationToken(data);
      break;
    }
  }
  const card = findCardShelf(data);
  if (card) { const p = parseCardShelfItem(card); if (p) items.unshift(p); }
  return { items, continuation };
}

/* ── Home ── */
const HOME_SECTIONS_PATH = 'contents.singleColumnBrowseResultsRenderer.tabs.0.tabRenderer.content.sectionListRenderer';
function parseHomeSectionsPage(data, offset = 0, fromContinuation = false) {
  const listRenderer = fromContinuation
    ? nav(data, 'continuationContents.sectionListContinuation')
    : nav(data, HOME_SECTIONS_PATH);
  const list = arr(listRenderer && listRenderer.contents) || [];
  const sections = [];
  list.forEach((section, idx) => {
    const carousel = section.musicCarouselShelfRenderer;
    if (carousel) {
      const header = nav(carousel, 'header.musicCarouselShelfBasicHeaderRenderer');
      const title = (header && getText(header, 'title')) || 'Unknown';
      const subtitle = header ? getText(header, 'strapline') : undefined;
      const items = parseItemArray(arr(carousel.contents));
      if (!items.length) return;
      sections.push({ id: `yt_home_${offset + idx}`, title, subtitle: subtitle || null, layout: 'carousel', items, moreToken: extractContinuation(carousel) });
      return;
    }
    const shelf = section.musicShelfRenderer;
    if (shelf) {
      const title = getRunsText(shelf.title) || 'Unknown';
      const subtitle = getRunsText(shelf.subtitle);
      const items = parseItemArray(arr(shelf.contents));
      if (!items.length) return;
      sections.push({ id: `yt_home_${offset + idx}`, title, subtitle: subtitle || null, layout: 'vlist', items, moreToken: extractContinuation(shelf) });
    }
  });
  return { sections, nextPageToken: listRenderer ? extractContinuation(listRenderer) : undefined };
}

/* ── Headers / detail pages ── */
function parseRunsLinked(runs) {
  const artists = [];
  let year;
  for (const run of runs || []) {
    const text = (run && run.text) || '';
    if (text === ' • ' || text === ', ' || text === ' & ' || !text.trim()) continue;
    const bid = runBrowseId(run);
    if (bid && bid.startsWith('UC')) artists.push({ name: text, id: bid });
    else if (/^\d{4}$/.test(text)) { const y = Number(text); if (y >= 1900 && y <= 2100) year = y; }
  }
  return { artists, year };
}
function findHeader(data, keys, twoColPath) {
  for (const k of keys) {
    const h = data && data.header && data.header[k];
    if (h) return h;
  }
  return twoColPath ? nav(data, twoColPath) : undefined;
}
function parseAlbumHeader(data) {
  const header = findHeader(data,
    ['musicImmersiveHeaderRenderer', 'musicResponsiveHeaderRenderer', 'musicDetailHeaderRenderer'],
    'contents.twoColumnBrowseResultsRenderer.tabs.0.tabRenderer.content.sectionListRenderer.contents.0.musicResponsiveHeaderRenderer');
  if (!header) return null;
  const title = getText(header, 'title');
  if (!title) return null;
  const thumbnails = getThumbnails(header);
  const description = getText(header, 'description')
    || getText(nav(header, 'description.musicDescriptionShelfRenderer'), 'description');
  const subtitle = getText(header, 'subtitle') || '';
  let { artists, year } = parseRunsLinked(arr(header.subtitle && header.subtitle.runs));
  if (!artists.length) {
    const fromStrap = parseRunsLinked(arr(header.straplineTextOne && header.straplineTextOne.runs));
    artists = fromStrap.artists;
    if (year === undefined) year = fromStrap.year;
  }
  if (!artists.length) artists = parseSubtitleArtists(subtitle);
  return { title, artists, year, thumbnails, description };
}
function parseAlbumTracks(data) {
  const shelf = nav(data, 'contents.twoColumnBrowseResultsRenderer.secondaryContents.sectionListRenderer.contents.0.musicShelfRenderer')
    || nav(data, 'contents.singleColumnBrowseResultsRenderer.tabs.0.tabRenderer.content.sectionListRenderer.contents.0.musicShelfRenderer');
  if (!shelf) return { tracks: [], continuation: undefined };
  return { tracks: parseAlbumTrackArray(arr(shelf.contents)), continuation: extractContinuation(shelf) };
}
function parsePlaylistHeader(data) {
  const header = findHeader(data,
    ['musicResponsiveHeaderRenderer', 'musicDetailHeaderRenderer', 'musicImmersiveHeaderRenderer'],
    'contents.twoColumnBrowseResultsRenderer.tabs.0.tabRenderer.content.sectionListRenderer.contents.0.musicResponsiveHeaderRenderer');
  if (!header) return null;
  const title = getText(header, 'title');
  if (!title) return null;
  const thumbnails = getThumbnails(header);
  const subtitle = getText(header, 'subtitle') || getText(header, 'straplineTextOne');
  let owner = getRunsText(header.straplineTextOne);
  if (!owner && subtitle) owner = subtitle.split(' • ')[0] || undefined;
  let trackCount;
  for (const run of arr(header.secondSubtitle && header.secondSubtitle.runs) || []) {
    const cleaned = String((run && run.text) || '').trim().replace(/\s*tracks?$/, '').replace(/,/g, '');
    if (/^\d+$/.test(cleaned)) { trackCount = Number(cleaned); break; }
  }
  if (trackCount === undefined && subtitle) {
    for (const part of subtitle.split(' • ')) {
      const cleaned = part.trim().replace(/\s*songs?$/, '').replace(/,/g, '');
      if (/^\d+$/.test(cleaned)) { trackCount = Number(cleaned); break; }
    }
  }
  return { title, owner, trackCount, thumbnails, description: getText(header, 'description') };
}
function parsePlaylistTracks(data) {
  let tracks = [], continuation;
  const slr = nav(data, 'contents.twoColumnBrowseResultsRenderer.secondaryContents.sectionListRenderer');
  if (slr) {
    continuation = extractContinuation(slr);
    for (const section of arr(slr.contents) || []) {
      const shelf = section.musicPlaylistShelfRenderer || section.musicShelfRenderer;
      if (!shelf) continue;
      tracks.push(...parseAlbumTrackArray(arr(shelf.contents), tracks.length + 1));
      const t = extractContinuation(shelf);
      if (t) continuation = t;
    }
  }
  if (!tracks.length) {
    const shelf = nav(data, 'contents.singleColumnBrowseResultsRenderer.tabs.0.tabRenderer.content.sectionListRenderer.contents.0.musicShelfRenderer')
      || nav(data, 'contents.twoColumnBrowseResultsRenderer.tabs.0.tabRenderer.content.sectionListRenderer.contents.0.musicShelfRenderer');
    if (shelf) {
      tracks = parseAlbumTrackArray(arr(shelf.contents));
      continuation = extractContinuation(shelf);
    }
  }
  return { tracks, continuation };
}
function parseContinuationTracks(data) {
  let tracks = [], continuation;
  const cc = data && data.continuationContents;
  if (!cc) {
    const items = arr(nav(data, 'onResponseReceivedActions.0.appendContinuationItemsAction.continuationItems'));
    if (items) {
      tracks = parseAlbumTrackArray(items);
      const token = nav(items[items.length - 1], 'continuationItemRenderer.continuationEndpoint.continuationCommand.token');
      if (typeof token === 'string') continuation = token;
    }
    return { tracks, continuation };
  }
  if (cc.sectionListContinuation) {
    continuation = extractContinuation(cc.sectionListContinuation);
    for (const section of arr(cc.sectionListContinuation.contents) || []) {
      const shelf = section.musicPlaylistShelfRenderer || section.musicShelfRenderer;
      if (!shelf) continue;
      tracks.push(...parseAlbumTrackArray(arr(shelf.contents), tracks.length + 1));
      const t = extractContinuation(shelf);
      if (t) continuation = t;
    }
    return { tracks, continuation };
  }
  const shelf = cc.musicShelfContinuation || cc.musicPlaylistShelfContinuation;
  if (shelf) {
    tracks = parseAlbumTrackArray(arr(shelf.contents));
    continuation = extractContinuation(shelf);
  }
  return { tracks, continuation };
}
function parseArtistPage(data, requestedId) {
  const header = (data && data.header && (data.header.musicImmersiveHeaderRenderer || data.header.musicVisualHeaderRenderer || data.header.musicResponseHeaderRenderer)) || undefined;
  const name = (header && getText(header, 'title')) || 'Unknown Artist';
  const thumbnails = header ? getThumbnails(header) : [];
  const description = header ? getText(header, 'description') : undefined;
  const channelId = nav(data, 'header.musicImmersiveHeaderRenderer.subscriptionButton.subscribeButtonRenderer.channelId')
    || nav(data, 'header.musicVisualHeaderRenderer.subscriptionButton.subscribeButtonRenderer.channelId')
    || requestedId || '';
  const topTracks = [], albums = [], singles = [], related = [];
  const sections = arr(nav(data, 'contents.singleColumnBrowseResultsRenderer.tabs.0.tabRenderer.content.sectionListRenderer.contents')) || [];
  for (const section of sections) {
    const shelf = section.musicShelfRenderer;
    if (shelf) {
      const t = (getRunsText(shelf.title) || '').toLowerCase();
      if (t.includes('song') || t.includes('top')) {
        for (const item of arr(shelf.contents) || []) {
          const r = item.musicResponsiveListItemRenderer;
          if (!r) continue;
          const p = parseResponsiveItem(r);
          if (p && p.type === 'track') {
            if (!p.artists.length) p.artists = [{ name, id: channelId || undefined }];
            else for (const a of p.artists) { if (!a.name.trim()) a.name = name; if (!a.id) a.id = channelId || undefined; }
            topTracks.push(p);
          }
        }
      }
      continue;
    }
    const carousel = section.musicCarouselShelfRenderer;
    if (carousel) {
      const t = (getText(nav(carousel, 'header.musicCarouselShelfBasicHeaderRenderer'), 'title') || '').toLowerCase();
      for (const item of arr(carousel.contents) || []) {
        const r = item.musicTwoRowItemRenderer;
        if (!r) continue;
        const p = parseTwoRowItem(r);
        if (!p) continue;
        if (t.includes('album')) albums.push(p);
        else if (t.includes('single') || t.includes('ep')) singles.push(p);
        else if (t.includes('fan') || t.includes('like') || t.includes('similar')) related.push(p);
        else albums.push(p);
      }
    }
  }
  return {
    browseId: channelId, name, thumbnails, description,
    topTracks, albums: [...albums, ...singles], related,
  };
}
function parseWatchPanelItems(contents) {
  const tracks = [];
  for (const item of contents || []) {
    const r = item && item.playlistPanelVideoRenderer;
    if (!r) continue;
    const videoId = r.videoId;
    if (typeof videoId !== 'string' || !videoId) continue;
    const title = getText(r, 'title') || '';
    const artists = [];
    for (const run of arr(nav(r, 'longBylineText.runs')) || []) {
      const text = (run && run.text) || '';
      if (text === ' • ' || text === ' & ' || text === ', ') continue;
      const bid = runBrowseId(run);
      if ((bid && bid.startsWith('UC')) || text.length > 1) artists.push({ name: text, id: bid });
    }
    const lenText = getText(r, 'lengthText');
    tracks.push({
      videoId, title, artists, thumbnails: getThumbnails(r),
      durationMs: lenText ? parseDurationMs(lenText) : undefined,
      isExplicit: false,
    });
  }
  return tracks;
}
function panelContinuation(panel) {
  const conts = arr(panel && panel.continuations);
  if (!conts || !conts.length) return undefined;
  const token = nav(conts[0], 'nextRadioContinuationData.continuation') || nav(conts[0], 'nextContinuationData.continuation');
  return typeof token === 'string' ? token : undefined;
}
function parseWatchPlaylist(data) {
  const panel = nav(data, 'contents.singleColumnMusicWatchNextResultsRenderer.tabbedRenderer.watchNextTabbedResultsRenderer.tabs.0.tabRenderer.content.musicQueueRenderer.content.playlistPanelRenderer');
  return { tracks: parseWatchPanelItems(arr(panel && panel.contents)), continuation: panelContinuation(panel) };
}


module.exports = { nav, bestImage, trackId, arr, getText, getRunsText, getThumbnails, bestImage, cleanThumbUrl, getBrowseId, getVideoId, extractContinuation, mapParsedItem, mapAlbumTrack, mapItems, ytThumbFallback, parseSearchResults, parseHomeSectionsPage, parseAlbumHeader, parseAlbumTracks, parsePlaylistHeader, parsePlaylistTracks, parseContinuationTracks, parseArtistPage, parseWatchPlaylist, parseWatchPanelItems, panelContinuation };
