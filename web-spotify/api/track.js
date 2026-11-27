/* GET /api/track?id= — track details + stream URLs
   Bloomee plugin: get_track_details + get_stream_source
   (song.getDetails → encrypted_media_url → DES decrypt → 320/160/96) */
'use strict';
const { jio, mapTrack, streamSources, handler, badRequest } = require('./_jiosaavn');

module.exports = handler(async (q) => {
  const id = (q.id || '').trim();
  if (!id) return badRequest('id parameter zaroori hai');
  const data = await jio(`__call=song.getDetails&pids=${encodeURIComponent(id)}`);
  const song = (Array.isArray(data.songs) && data.songs[0]) || data[id];
  if (!song) return { status: 404, body: { error: 'Song not found' }, cache: null };
  return {
    body: { source: 'bloomee-jiosaavn', track: mapTrack(song), streams: streamSources(song) },
    cache: 'public, s-maxage=60, stale-while-revalidate=300',
  };
});
