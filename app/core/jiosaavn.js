/* JioSaavn source — Bloomee ke ContentResolver/ChartProvider ki
   REST shakl. api.php (web6dot0) contracts; streams DES-ECB se
   decrypt hote hain (des.js). */
import { fetchJson } from './http.js';
import { track, album, artist, playlist, durationToMs, ApiError } from './model.js';
import { decryptSaavnUrl } from './des.js';

const BASE = 'https://www.jiosaavn.com/api.php';

async function api(callName, params = {}, ctx = 'web6dot0') {
  const q = new URLSearchParams({
    __call: callName, api_version: '4', _format: 'json', _marker: '0', ctx, ...params,
  });
  return fetchJson(`${BASE}?${q}`);
}

const img = (u) => (typeof u === 'string' ? u.replace(/(50x50|150x150)/, '500x500') : null);

function songArtists(s) {
  const map = s?.more_info?.artistMap?.primary_artists;
  if (Array.isArray(map) && map.length) return map.map(a => ({ id: String(a.id), name: a.name }));
  const ids = String(s?.more_info?.primary_artists_ids || s?.primary_artists_ids || '').split(',').map(x => x.trim()).filter(Boolean);
  const names = String(s?.primary_artists || '').split(',').map(x => x.trim()).filter(Boolean);
  return names.map((name, i) => ({ id: ids[i] || null, name }));
}

export function songToTrack(s) {
  if (!s || !s.id) return null;
  const mi = s.more_info || {};
  return track({
    source: 'jiosaavn',
    id: String(s.id),
    title: s.title || s.name || '',
    artists: songArtists(s),
    album: (mi.album_id || s.album_id) ? { id: String(mi.album_id || s.album_id), title: s.album || mi.album || '' } : null,
    durationMs: durationToMs(mi.duration ?? s.duration),
    artwork: img(s.image),
    explicit: mi.explicit_content === 1 || mi.explicit_content === '1' || s.explicit === true,
  });
}

function albumToAlbum(a) {
  if (!a || !a.id) return null;
  const artists = a.more_info?.artistMap?.primary_artists?.map(x => ({ id: String(x.id), name: x.name }))
    || String(a.primary_artists || a.music || '').split(',').map(x => x.trim()).filter(Boolean);
  return album({
    source: 'jiosaavn', id: String(a.id), title: a.title || a.name || '',
    artists, year: a.year || null, artwork: img(a.image),
    trackCount: a.more_info?.song_count ? Number(a.more_info.song_count) : (a.songs?.length ?? null),
  });
}

function playlistToPlaylist(p) {
  if (!p || !p.id) return null;
  return playlist({
    source: 'jiosaavn', id: String(p.id), title: p.title || p.name || '',
    description: p.description || p.more_info?.description || null,
    artwork: img(p.image),
    trackCount: p.songs?.length ?? (p.more_info?.song_count ? Number(p.more_info.song_count) : null),
    author: p.more_info?.firstname ? `${p.more_info.firstname} ${p.more_info.lastname || ''}`.trim() : (p.subtitle || null),
  });
}

function artistToArtist(a) {
  if (!a || !a.id) return null;
  return artist({
    source: 'jiosaavn', id: String(a.id), name: a.name || a.title || '',
    artwork: img(a.image), subtitle: a.subtitle || (a.more_info?.is_verified ? 'Verified artist' : null),
  });
}

const mapList = (arr, fn) => (Array.isArray(arr) ? arr.map(fn).filter(Boolean) : []);

async function getLaunchData() {
  const d = await api('webapi.getLaunchData');
  return d || {};
}

export const jiosaavn = {
  id: 'jiosaavn',
  name: 'JioSaavn',

  async home() {
    const d = await getLaunchData();
    const sections = [];
    const trending = d.new_trending && !Array.isArray(d.new_trending)
      ? Object.values(d.new_trending).flatMap(v => (Array.isArray(v) ? v : []))
      : d.new_trending;
    const push = (title, items) => { if (items.length) sections.push({ title, items }); };
    push('Trending Now', mapList(trending, songToTrack));
    push('New Releases', mapList(d.new_albums, albumToAlbum));
    push('Charts', mapList(d.charts, playlistToPlaylist));
    push('Featured Playlists', mapList(d.featured_playlists, playlistToPlaylist));
    push('Top Playlists', mapList(d.top_playlists, playlistToPlaylist));
    return sections;
  },

  async search(query, filter = 'all', page = 1) {
    const p = Math.max(1, Number(page) || 1);
    if (filter === 'track') {
      const d = await api('search.getResults', { q: query, p, n: 20 });
      return { items: mapList(d.results, songToTrack), total: d.total ?? null, page: p };
    }
    if (filter === 'album') {
      const d = await api('search.getAlbumResults', { q: query, p, n: 20 });
      return { items: mapList(d.results, albumToAlbum), total: d.total ?? null, page: p };
    }
    if (filter === 'playlist') {
      const d = await api('search.getPlaylistResults', { q: query, p, n: 20 });
      return { items: mapList(d.results, playlistToPlaylist), total: d.total ?? null, page: p };
    }
    if (filter === 'artist') {
      const d = await api('search.getArtistResults', { q: query, p, n: 20 });
      return { items: mapList(d.results, artistToArtist), total: d.total ?? null, page: p };
    }
    const [songs, albums, playlists, artists] = await Promise.all([
      api('search.getResults', { q: query, p: 1, n: 8 }),
      api('search.getAlbumResults', { q: query, p: 1, n: 6 }),
      api('search.getPlaylistResults', { q: query, p: 1, n: 6 }),
      api('search.getArtistResults', { q: query, p: 1, n: 6 }),
    ]);
    return {
      tracks: mapList(songs.results, songToTrack),
      albums: mapList(albums.results, albumToAlbum),
      playlists: mapList(playlists.results, playlistToPlaylist),
      artists: mapList(artists.results, artistToArtist),
    };
  },

  async suggestions(query) {
    try {
      const d = await api('autocomplete.get', { query });
      const out = [];
      for (const key of ['songs', 'albums', 'artists', 'playlists']) {
        for (const it of d?.[key]?.data || []) {
          const t = it.title || it.name;
          if (t && !out.includes(t)) out.push(t);
        }
      }
      if (out.length) return out.slice(0, 10);
    } catch { /* fallback neeche */ }
    const d = await api('search.getResults', { q: query, p: 1, n: 5 });
    return mapList(d.results, songToTrack).map(t => t.title);
  },

  async trackDetails(id) {
    const d = await api('song.getDetails', { pids: id });
    const s = d?.songs?.[0];
    if (!s) throw new ApiError('track not found', 404, 'not_found');
    const t = songToTrack(s);
    try {
      const streams = await this.streams(id, s);
      if (streams.length) t.url = streams[0].url;
    } catch { /* url baghair bhi details kaam ke hain */ }
    return t;
  },

  async streams(id, knownSong = null) {
    let s = knownSong;
    if (!s) {
      const d = await api('song.getDetails', { pids: id });
      s = d?.songs?.[0];
    }
    if (!s) throw new ApiError('track not found', 404, 'not_found');
    const enc = s.more_info?.encrypted_media_url || s.encrypted_media_url;
    if (!enc) throw new ApiError('no stream available for this track', 404, 'no_stream');
    const base = decryptSaavnUrl(enc);
    const out = [];
    const seen = new Set();
    const pushVariant = (quality, url) => { if (url && !seen.has(url)) { seen.add(url); out.push({ quality, url, format: 'mp4' }); } };
    if (/_(96|160)\.(mp4|m4a)/.test(base)) {
      pushVariant('320kbps', base.replace(/_(96|160)\.(mp4|m4a)/, '_320.$2'));
      pushVariant('160kbps', base.replace(/_(96|160)\.(mp4|m4a)/, '_160.$2'));
      pushVariant('96kbps', base.replace(/_(96|160)\.(mp4|m4a)/, '_96.$2'));
    } else {
      pushVariant('320kbps', base);
    }
    const preview = s.more_info?.media_preview_url || s.media_preview_url;
    if (preview) out.push({ quality: 'preview', url: preview, format: 'mp4' });
    return out;
  },

  async albumDetails(id) {
    const d = await api('content.getAlbumDetails', { albumid: id });
    if (!d || !d.id) throw new ApiError('album not found', 404, 'not_found');
    const songs = d.songs || d.list || [];
    return { ...albumToAlbum(d), tracks: mapList(songs, songToTrack) };
  },

  async playlistDetails(id) {
    const d = await api('playlist.getDetails', { listid: id });
    if (!d || !d.id) throw new ApiError('playlist not found', 404, 'not_found');
    const songs = d.songs || d.list || [];
    return { ...playlistToPlaylist(d), tracks: mapList(songs, songToTrack) };
  },

  async artistDetails(id) {
    const d = await api('artist.getArtistPageDetails', { artistId: id, page: 1, n_song: 20, n_album: 12 });
    if (!d || (!d.id && !d.name)) throw new ApiError('artist not found', 404, 'not_found');
    return {
      ...artistToArtist({ id: d.id || id, name: d.name, image: d.image }),
      topTracks: mapList(d.topSongs?.songs || d.topSongs || [], songToTrack),
      albums: mapList(d.topAlbums?.albums || d.topAlbums || [], albumToAlbum),
      singles: mapList(d.latest_release || [], albumToAlbum),
      bio: d.bio ? String(d.bio).replace(/<[^>]+>/g, '').slice(0, 500) : null,
    };
  },

  async radio(id, page = 1) {
    const st = await api('webradio.createEntityStation', { entity_id: id, entity_type: 'queue' }, 'android');
    const stationId = st?.stationid;
    if (!stationId) throw new ApiError('radio station could not be created', 502, 'radio');
    const d = await api('webradio.getSong', { stationid: stationId, k: 15, p: page }, 'android');
    let songs = [];
    if (Array.isArray(d?.songs)) songs = d.songs;
    else if (d && typeof d === 'object') songs = Object.values(d).map(v => v?.song).filter(Boolean);
    return { items: mapList(songs, songToTrack), page };
  },

  async charts() {
    const d = await getLaunchData();
    return mapList(d.charts, playlistToPlaylist);
  },

  async chartDetails(id) {
    const p = await this.playlistDetails(id);
    return p.tracks;
  },

  async lyricsById(id) {
    const d = await api('lyrics.getLyrics', { lyrics_id: id });
    if (!d?.lyrics) return null;
    return { plain: String(d.lyrics).replace(/<br\s*\/?>/gi, '\n'), synced: null, source: 'jiosaavn' };
  },
};
