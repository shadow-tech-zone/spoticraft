/* GET /api/playlist?id=&page=1 — playlist details + tracks
   Bloomee plugin: get_playlist_details (playlist.getDetails / webapi.get) */
'use strict';
const { jio, mapPlaylist, mapTrack, handler, badRequest } = require('./_jiosaavn');

module.exports = handler(async (q) => {
  const id = (q.id || '').trim();
  if (!id) return badRequest('id parameter zaroori hai');
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const n = 50;
  const params = /^\d+$/.test(id)
    ? `__call=playlist.getDetails&listid=${encodeURIComponent(id)}&p=${page}&n=${n}`
    : `__call=webapi.get&token=${encodeURIComponent(id)}&type=playlist&p=${page}&n=${n}`;
  const item = await jio(params);
  if (!item || (!item.id && !item.title)) return { status: 404, body: { error: 'Playlist not found' }, cache: null };
  const tracks = (Array.isArray(item.list) ? item.list : []).map(mapTrack);
  const total = item.list_count ? parseInt(item.list_count, 10) : NaN;
  const nextPage = Number.isFinite(total) ? (page * n < total ? page + 1 : null) : (tracks.length === n ? page + 1 : null);
  return {
    body: {
      source: 'bloomee-jiosaavn',
      playlist: mapPlaylist(item),
      tracks,
      page,
      nextPage,
      description: (item.more_info && item.more_info.description) || item.subtitle || null,
    },
  };
});
