/* YTM parser + cipher tests — fixtures par, network baghair. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSearchResponse, parseListItem, decipherWithJs } from '../src/ytmusic.js';
import { parseLrc } from '../src/lyrics.js';

const search = JSON.parse(readFileSync(new URL('./fixtures/ytm-search.json', import.meta.url), 'utf8'));

test('search shelves: songs classified with artist/album/duration', () => {
  const r = parseSearchResponse(search);
  assert.equal(r.tracks.length, 2);
  const t = r.tracks[0];
  assert.equal(t.id, 'ytmusic::vidKesariya1');
  assert.equal(t.title, 'Kesariya');
  assert.deepEqual(t.artists, [{ id: 'ytmusic::UCartistArijit', name: 'Arijit Singh' }]);
  assert.deepEqual(t.album, { id: 'ytmusic::MPREalbumBrahma', title: 'Brahmastra' });
  assert.equal(t.durationMs, 268000);
  assert.match(t.artwork.url, /w540-h540/);
  assert.equal(r.tracks[1].isExplicit, true);
  assert.equal(r.tracks[1].album, null);
});

test('search shelves: album with year + artist id', () => {
  const r = parseSearchResponse(search);
  assert.equal(r.albums.length, 1);
  assert.equal(r.albums[0].id, 'ytmusic::MPREalbumBrahma');
  assert.equal(r.albums[0].year, '2022');
  assert.equal(r.albums[0].artists[0].id, 'ytmusic::UCartistPritam');
});

test('parseListItem: unknown renderer -> null', () => {
  assert.equal(parseListItem({ somethingElse: {} }), null);
  assert.equal(parseListItem(null), null);
});

test('cipher: synthetic base.js ops (swap, splice, reverse)', () => {
  const js = `
    var Zx={r:function(a){a.reverse()},s:function(a,b){a.splice(0,b)},w:function(a,b){var c=a[0];a[0]=a[b%a.length];a[b%a.length]=c}};
    function dec(a){a=a.split("");Zx.w(a,3);Zx.s(a,2);Zx.r(a);return a.join("")}
  `;
  // '0123456789' -> swap(0,3) '3120456789' -> splice 2 '20456789' -> reverse '98765402'
  assert.equal(decipherWithJs(js, '0123456789'), '98765402');
});

test('LRC parse: timestamps sorted, text kept', () => {
  const lines = parseLrc('[00:10.50] second line\n[00:05.00] first line\n[ti:ignored]');
  assert.deepEqual(lines, [
    { timeMs: 5000, text: 'first line' },
    { timeMs: 10500, text: 'second line' },
  ]);
});
