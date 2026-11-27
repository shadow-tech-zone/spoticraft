/* GET /api/home — Bloomee home sections (plugin: fetch_home_data)
   JioSaavn `webapi.getLaunchData` → sections, plugin ki tarah:
   Trending Now → Browse Categories → modules (position order) → New Albums */
'use strict';
const { jio, mapMediaItem, handler } = require('./_jiosaavn');

function createSection(id, title, items, layout) {
  const mapped = (Array.isArray(items) ? items : []).map(mapMediaItem).filter(Boolean);
  if (!mapped.length) return null;
  return { id, title, layout, items: mapped };
}

module.exports = handler(async () => {
  const data = await jio('__call=webapi.getLaunchData');
  const sections = [];
  const add = s => { if (s && !sections.some(x => x.id === s.id)) sections.push(s); };

  add(createSection('new_trending', 'Trending Now', data.new_trending, 'carousel'));
  add(createSection('browse_discover', 'Browse Categories', data.browse_discover, 'grid'));

  const modules = data.modules && typeof data.modules === 'object' ? data.modules : {};
  const ordered = Object.entries(modules)
    .sort((a, b) => (a[1].position ?? 99) - (b[1].position ?? 99));
  for (const [key, val] of ordered) {
    const title = (val && val.title) || key;
    const scroll = (val && val.scroll_type) || '';
    const layout = scroll.includes('Condensed') ? 'carousel' : 'grid';
    add(createSection(key, title, data[key], layout));
  }

  add(createSection('new_albums', 'New Albums', data.new_albums, 'grid'));
  add(createSection('top_playlists', 'Top Playlists', data.top_playlists, 'carousel'));
  add(createSection('charts', 'Charts', data.charts, 'carousel'));

  if (!sections.length) throw new Error('Launch data mein koi section nahi mila');
  return { body: { source: 'bloomee-jiosaavn', sections }, cache: 'public, s-maxage=300, stale-while-revalidate=900' };
});
