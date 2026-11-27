/* GET /api/radio?id= — related tracks (autoplay / radio)
   Bloomee plugin: get_radio_tracks → reco.getreco (ctx=android only) */
'use strict';
const { jio, mapTrack, handler, badRequest } = require('./_jiosaavn');

module.exports = handler(async (q) => {
  const id = (q.id || '').trim();
  if (!id) return badRequest('id (seed track id) zaroori hai');
  const data = await jio(`__call=reco.getreco&pid=${encodeURIComponent(id)}`, { ctx: 'android' });
  let arr = null;
  if (Array.isArray(data)) arr = data;
  else if (data && typeof data === 'object') {
    arr = data[id] || Object.values(data).find(v => Array.isArray(v)) || null;
  }
  const tracks = (arr || []).map(mapTrack).filter(t => t.id && t.id !== id);
  return { body: { source: 'bloomee-jiosaavn', tracks }, cache: 'public, s-maxage=300, stale-while-revalidate=900' };
});
