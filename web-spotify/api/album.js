/* GET /api/album?id= — album details + tracks
   Bloomee plugin: get_album_details (content.getAlbumDetails / webapi.get) */
'use strict';
const { jio, mapAlbum, mapTrack, handler, badRequest } = require('./_jiosaavn');

module.exports = handler(async (q) => {
  const id = (q.id || '').trim();
  if (!id) return badRequest('id parameter zaroori hai');
  const params = /^\d+$/.test(id)
    ? `__call=content.getAlbumDetails&albumid=${encodeURIComponent(id)}`
    : `__call=webapi.get&token=${encodeURIComponent(id)}&type=album`;
  const item = await jio(params);
  if (!item || (!item.id && !item.title)) return { status: 404, body: { error: 'Album not found' }, cache: null };
  const list = Array.isArray(item.list) ? item.list : (Array.isArray(item.songs) ? item.songs : []);
  return {
    body: {
      source: 'bloomee-jiosaavn',
      album: mapAlbum(item),
      tracks: list.map(mapTrack),
      description: (item.more_info && item.more_info.description) || item.subtitle || null,
    },
  };
});
