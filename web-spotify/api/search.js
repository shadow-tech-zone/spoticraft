/* GET /api/search?q=&type=songs|albums|artists|playlists&page=1
   Bloomee plugin: client.rs `search()` — search.getResults etc. */
'use strict';
const { jio, mapList, handler, badRequest } = require('./_jiosaavn');

const CALLS = {
  songs: 'search.getResults',
  albums: 'search.getAlbumResults',
  artists: 'search.getArtistResults',
  playlists: 'search.getPlaylistResults',
};

module.exports = handler(async (q) => {
  const query = (q.q || '').trim();
  if (!query) return badRequest('q parameter zaroori hai');
  const type = CALLS[q.type] ? q.type : 'songs';
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const data = await jio(`__call=${CALLS[type]}&q=${encodeURIComponent(query)}&p=${page}&n=20`);
  const results = mapList(data.results);
  return {
    body: {
      source: 'bloomee-jiosaavn',
      type,
      page,
      total: data.total ?? results.length,
      results,
      nextPage: results.length === 20 ? page + 1 : null, // plugin bhi hamesha next token deta hai; 20 se kam = end
    },
    cache: 'public, s-maxage=120, stale-while-revalidate=600',
  };
});
