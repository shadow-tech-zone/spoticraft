/* JioSaavn source tests — fetch stub par fixtures; asli parser,
   DES decryption aur API-call routing sab asal code se guzarta hai. */
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { jiosaavn } from '../src/jiosaavn.js';

const load = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const song = load('saavn-song.json');
const search = load('saavn-search.json');
const launch = load('saavn-launch.json');

before(() => {
  globalThis.fetch = async (url) => {
    const call = new URL(url).searchParams.get('__call');
    const body =
      call === 'song.getDetails' ? song :
      call === 'search.getResults' ? search :
      call === 'webapi.getLaunchData' ? launch :
      { results: [] };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
});

test('trackDetails: normalized Track + decrypted best stream url', async () => {
  const t = await jiosaavn.trackDetails('TestSong1');
  assert.equal(t.kind, 'track');
  assert.equal(t.id, 'jiosaavn::TestSong1');
  assert.equal(t.title, 'Kesariya "Live"');
  assert.deepEqual(t.artists, [{ id: 'jiosaavn::459320', name: 'Arijit Singh' }]);
  assert.deepEqual(t.album, { id: 'jiosaavn::36543210', title: 'Brahmastra' });
  assert.equal(t.durationMs, 268000);
  assert.match(t.artwork.url, /500x500/);
  assert.equal(t.url, 'https://aac.saavncdn.com/695/9f8e7d6c_320.mp4');
});

test('streams: 320/160/96 variants + preview, best first', async () => {
  const streams = await jiosaavn.streams('TestSong1');
  assert.deepEqual(streams.map(s => s.quality), ['320kbps', '160kbps', '96kbps', 'preview']);
  assert.equal(streams[2].url, 'https://aac.saavncdn.com/695/9f8e7d6c_96.mp4');
});

test('search tracks: entities decoded, explicit flag, artists split', async () => {
  const r = await jiosaavn.search('arijit', 'track');
  assert.equal(r.items.length, 2);
  assert.equal(r.items[0].artists[0].name, 'Arijit Singh');
  assert.equal(r.items[1].artists.length, 2);
  assert.equal(r.items[1].isExplicit, true);
  assert.equal(r.items[0].durationMs, 262000);
});

test('home: sections from launch data, empty ones skipped', async () => {
  const sections = await jiosaavn.home();
  assert.deepEqual(sections.map(s => s.title), ['Trending Now', 'New Releases', 'Charts']);
  assert.equal(sections[0].items[0].kind, 'track');
  assert.equal(sections[1].items[0].kind, 'album');
  assert.equal(sections[2].items[0].kind, 'playlist');
  assert.equal(sections[2].items[0].trackCount, 50);
});

test('charts: playlist summaries', async () => {
  const charts = await jiosaavn.charts();
  assert.equal(charts.length, 1);
  assert.equal(charts[0].id, 'jiosaavn::CH1');
});
