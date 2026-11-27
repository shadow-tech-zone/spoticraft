/* GET /api/artist?id= — artist page: top tracks, albums, similar
   Bloomee plugin: get_artist_details (artist.getArtistPageDetails) */
'use strict';
const { jio, mapArtist, mapAlbum, mapTrack, handler, badRequest } = require('./_jiosaavn');

module.exports = handler(async (q) => {
  const id = (q.id || '').trim();
  if (!id) return badRequest('id parameter zaroori hai');
  const params = /^\d+$/.test(id)
    ? `__call=artist.getArtistPageDetails&artistId=${encodeURIComponent(id)}&n_song=60&n_album=60`
    : `__call=webapi.get&token=${encodeURIComponent(id)}&type=artist&n_song=60&n_album=60`;
  const root = await jio(params);
  if (!root || typeof root !== 'object') return { status: 404, body: { error: 'Artist not found' }, cache: null };

  const topTracks = (root.topSongs || root.songs || root.list || []).map(mapTrack);
  const albums = (root.topAlbums || []).map(mapAlbum);
  const related = (root.similarArtists || []).map(mapArtist);

  let description = null;
  if (typeof root.bio === 'string') {
    try {
      const arr = JSON.parse(root.bio);
      description = (Array.isArray(arr) && arr[0] && arr[0].text) || root.bio;
    } catch { description = root.bio; }
  }

  return {
    body: {
      source: 'bloomee-jiosaavn',
      artist: mapArtist(root),
      topTracks,
      albums,
      related,
      description,
    },
  };
});
