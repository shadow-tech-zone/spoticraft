/* Typed bridge — renderer ko sirf yehi surface milti hai. */
const { contextBridge, ipcRenderer } = require('electron');

const call = (name, ...args) => ipcRenderer.invoke(name, ...args);

contextBridge.exposeInMainWorld('bloomee', {
  api: {
    home: (src) => call('api:home', src),
    search: (src, q, filter, page) => call('api:search', src, q, filter, page),
    suggestions: (src, q) => call('api:suggestions', src, q),
    track: (id) => call('api:track', id),
    streams: (track) => call('api:streams', track),
    album: (id) => call('api:album', id),
    playlist: (id) => call('api:playlist', id),
    artist: (id) => call('api:artist', id),
    radio: (id) => call('api:radio', id),
    charts: (src) => call('api:charts', src),
    chart: (id) => call('api:chart', id),
    lyrics: (track) => call('api:lyrics', null, track),
  },
  lib: {
    get: () => call('lib:get'),
    op: (op, payload) => call('lib:op', op, payload),
  },
  win: {
    min: () => call('win:min'),
    max: () => call('win:max'),
    close: () => call('win:close'),
    isMax: () => call('win:isMax'),
    onMaxChanged: (cb) => {
      ipcRenderer.on('win:maximized', () => cb(true));
      ipcRenderer.on('win:unmaximized', () => cb(false));
    },
  },
  playerCmd: (cb) => ipcRenderer.on('player:cmd', (_e, cmd) => cb(cmd)),
  playerState: (st) => call('player:state', st),
  openLogs: () => call('app:openLogs'),
  info: () => call('app:info'),
  quit: () => call('app:quit'),
});
