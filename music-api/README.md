# music-api — ek unified Music API

BloomeeTunes (v3.1.3) ki study ke baad usi ke **plugin contract** ko ek
standalone REST API mein badla gaya hai. Bloomee mein music sources
WASM plugins hote hain jo `ContentResolver` / `ChartProvider` /
`LyricsProvider` commands implement karte hain — yahi commands yahan
HTTP endpoints hain, peeche do asal sources ke saath:

- **JioSaavn** (`src/jiosaavn.js`) — api.php `web6dot0` calls; stream
  URLs DES-ECB (`38346591`) se decrypt hote hain, 320/160/96 kbps variants.
- **YouTube Music** (`src/ytmusic.js`) — InnerTube `WEB_REMIX` se
  search/browse/home/radio; playable streams ke liye IOS → ANDROID →
  TVHTML5 player clients + signature cipher (base.js se ops).

Koi npm dependency nahi — sirf Node ≥ 18 (built-in `fetch`, `node:http`).

## Chalana

```sh
cd music-api
npm start            # http://localhost:3000  (PORT env se badlo)
```

## Bloomee contract → REST mapping

| Bloomee command | Endpoint |
|---|---|
| `getHomeSections` | `GET /api/home?src=all\|jiosaavn\|ytmusic` |
| `search(query, filter, pageToken)` | `GET /api/search?q=&filter=all\|track\|album\|playlist\|artist&src=&page=` |
| `getSuggestions` | `GET /api/suggestions?q=&src=` |
| `getTrackDetails(id)` | `GET /api/track/{id}` |
| `getStreams(id)` | `GET /api/track/{id}/streams` |
| `getAlbumDetails(id)` | `GET /api/album/{id}` |
| `getPlaylistDetails(id)` | `GET /api/playlist/{id}` |
| `getArtistDetails(id)` | `GET /api/artist/{id}` |
| `getRadioTracks(id)` | `GET /api/radio/{id}?page=` |
| `getCharts` / `getChartDetails` | `GET /api/charts?src=` / `GET /api/charts/{id}` |
| `getLyrics(metadata)` | `GET /api/lyrics?title=&artist=&album=&durationMs=` |
| (track se lyrics) | `GET /api/lyrics/{trackId}` |
| — | `GET /api/health`, `GET /` (index) |

## Model (Bloomee jaisa hi)

Har ID **stamped** hai: `jiosaavn::abc123`, `ytmusic::dQw4w9WgXcQ`
(Bloomee ka `pluginId::localId` format). Track:

```json
{
  "kind": "track",
  "id": "jiosaavn::TestSong1",
  "title": "Kesariya",
  "artists": [{ "id": "jiosaavn::459320", "name": "Arijit Singh" }],
  "album": { "id": "jiosaavn::36543210", "title": "Brahmastra" },
  "durationMs": 268000,
  "artwork": { "url": "https://...500x500.jpg" },
  "isExplicit": false,
  "url": "https://..._320.mp4"
}
```

Jawab ka ghonsla: `{ ok: true, source, data }` — ghalti par
`{ ok: false, error: { code, message } }` (400 bad input, 404 not
found, 502 upstream fail).

## Misalein

```sh
curl 'localhost:3000/api/search?q=arijit&filter=track&src=jiosaavn'
curl 'localhost:3000/api/track/ytmusic::dQw4w9WgXcQ/streams'
curl 'localhost:3000/api/home?src=ytmusic'
curl 'localhost:3000/api/lyrics?title=Kesariya&artist=Arijit%20Singh'
```

## Tests

```sh
npm test     # 19 tests: DES FIPS vectors, dono sources ke parsers
             # (fixtures, network baghair), cipher ops, LRC, server smoke
```

**Live note:** is sandbox se music hosts (jiosaavn.com,
music.youtube.com, lrclib.net) blocked hain, is liye live calls yahan
verify nahi ho sakay — parsers fixtures se fully verified hain. Apni
machine par `npm start` karke upar wali misalein chalayein; koi
endpoint fail ho to us ka `error.code` batayein, wahin fix hoga.
