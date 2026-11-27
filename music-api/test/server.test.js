/* Server smoke tests — sirf woh routes jo upstream nahi bulatein
   (sandbox mein music hosts blocked hain; live QA user ki machine par). */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createMusicServer } from '../src/server.js';

let server, base;

before(async () => {
  server = createMusicServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

const get = async (path) => {
  const res = await fetch(base + path);
  return { status: res.status, body: await res.json() };
};

test('GET / index lists endpoints + sources', async () => {
  const { status, body } = await get('/');
  assert.equal(status, 200);
  assert.deepEqual(body.sources, ['jiosaavn', 'ytmusic']);
  assert.ok(body.endpoints.length > 10);
});

test('GET /api/health', async () => {
  const { status, body } = await get('/api/health');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
});

test('malformed media id -> 400 bad_id', async () => {
  const { status, body } = await get('/api/track/justanid');
  assert.equal(status, 400);
  assert.equal(body.error.code, 'bad_id');
});

test('unknown source in media id -> 400 bad_source', async () => {
  const { status, body } = await get('/api/track/spotify::abc');
  assert.equal(status, 400);
  assert.equal(body.error.code, 'bad_source');
});

test('missing q -> 400', async () => {
  const { status, body } = await get('/api/search');
  assert.equal(status, 400);
  assert.equal(body.error.code, 'bad_request');
});

test('unknown route -> 404 no_route', async () => {
  const { status, body } = await get('/api/nope');
  assert.equal(status, 404);
  assert.equal(body.error.code, 'no_route');
});
