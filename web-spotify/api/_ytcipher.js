/* ═══════════════════════════════════════════════════════════════
   Bloomee backend — YouTube signature cipher (Node port)

   BloomeeTunes ke `ytmusic.bex` plugin ke `cipher.rs` ka seedha
   port. Player JS (base.js) download karke cipher operations
   (Reverse/Splice/Swap) extract karta hai — teeno strategies:
     1. YoutubeExplode-style (callsite + helper object)
     2. Modern fQ + uC + h[] dispatch (player_ias 2024+)
     3. Legacy split/join helper
   Phir `signatureCipher` (s/sp/url) decode karke playable URL
   banata hai (+ ratebypass=yes, bilkul plugin ki tarah).
   ═══════════════════════════════════════════════════════════════ */
'use strict';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';

async function httpGet(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`HTTP GET ${url} returned status ${res.status}`);
  return res.text();
}

/* ── String scanning helpers (cipher.rs ports) ── */
function matchBrace(s, start) {           // find_matching_brace → inner text
  if (s[start] !== '{') return null;
  let depth = 0;
  for (let i = start; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') { depth--; if (depth === 0) return s.slice(start + 1, i); }
  }
  return null;
}
function bracketedText(s, open, close) {  // extract_bracketed_text (string-aware)
  let depth = 0, inStr = false, esc = false, start = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (esc) { esc = false; continue; }
    if (c === '\\' && inStr) { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === open) { if (depth === 0) start = i; depth++; }
    else if (c === close) { depth--; if (depth === 0 && start >= 0) return s.slice(start + 1, i); }
  }
  return null;
}
function quotedStrings(s) {               // extract_quoted_strings
  const out = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '"') continue;
    let val = '', esc = false, j = i + 1;
    for (; j < s.length; j++) {
      const c = s[j];
      if (esc) {
        if (c === 'n') val += '\n'; else if (c === 't') val += '\t';
        else if (c === 'r') val += '\r'; else if (c === '"') val += '"';
        else if (c === '\\') val += '\\'; else val += '\\' + c;
        esc = false;
      } else if (c === '\\') esc = true;
      else if (c === '"') break;
      else val += c;
    }
    out.push(val);
    i = j;
  }
  return out;
}
function parseNumber(s) {                 // → [num, rest] | null
  const m = /^\d+/.exec(s);
  if (!m) return null;
  return [parseInt(m[0], 10), s.slice(m[0].length)];
}
const isIdent = ch => /[A-Za-z0-9_$]/.test(ch);

/* ── Player JS discovery (fetch_player_js_url) ── */
function findBetween(hay, startMarker, endMarker) {
  const a = hay.indexOf(startMarker);
  if (a < 0) return null;
  const from = a + startMarker.length;
  const b = hay.indexOf(endMarker, from);
  return b < 0 ? null : hay.slice(from, b);
}
async function fetchPlayerJsUrl() {
  try {
    const html = await httpGet('https://www.youtube.com/watch?v=dQw4w9WgXcQ&bpctr=9999999999&has_verified=1&hl=en');
    const pos = html.indexOf('player_ias');
    if (pos >= 0) {
      const srcPos = html.lastIndexOf('src="', pos);
      if (srcPos >= 0) {
        const rel = findBetween(html.slice(srcPos), 'src="', '"');
        if (rel) return rel.startsWith('//') ? 'https:' + rel : rel.startsWith('/') ? 'https://www.youtube.com' + rel : rel;
      }
    }
    const jsUrl = findBetween(html, '"jsUrl":"', '"');
    if (jsUrl) return jsUrl.startsWith('/') ? 'https://www.youtube.com' + jsUrl : jsUrl;
  } catch { /* fallback neeche */ }
  const html = await httpGet('https://www.youtube.com/');
  const jsUrl = findBetween(html, '"jsUrl":"', '"');
  if (jsUrl) return jsUrl.startsWith('/') ? 'https://www.youtube.com' + jsUrl : jsUrl;
  const rel = findBetween(html, 'src="/s/player/', '"');
  if (rel) return 'https://www.youtube.com/s/player/' + rel;
  const m = /\/s\/player\/([0-9a-f]{8,})\//.exec(html);
  if (m) return `https://www.youtube.com/s/player/${m[1]}/player_ias.vflset/en_US/base.js`;
  throw new Error('Could not extract player JS URL from YouTube pages');
}

function extractSigTimestamp(js) {
  for (const prefix of ['signatureTimestamp:', 'sts:']) {
    const pos = js.indexOf(prefix);
    if (pos >= 0) {
      const rest = js.slice(pos + prefix.length);
      const m = /^\d+/.exec(rest);
      if (m) return m[0];
    }
  }
  return null;
}

/* ── Ops application (CipherManifest::decipher) ── */
function decipher(sig, ops) {
  const chars = [...String(sig)];
  for (const op of ops) {
    if (op.kind === 'R') chars.reverse();
    else if (op.kind === 'S') { if (op.index < chars.length) chars.splice(0, op.index); }
    else if (op.kind === 'W') { if (chars.length) { const i = op.index % chars.length; [chars[0], chars[i]] = [chars[i], chars[0]]; } }
  }
  return chars.join('');
}

/* ── Strategy 1: YoutubeExplode-style ── */
function splitVarName(body) {
  let pos = body.indexOf('.split("")');
  if (pos < 0) pos = body.indexOf(".split('')");
  if (pos < 0) return null;
  const lhs = body.slice(0, pos);
  const eq = lhs.lastIndexOf('=');
  if (eq < 0) return null;
  const m = /([A-Za-z_$][A-Za-z0-9_$]*)\s*$/.exec(lhs.slice(0, eq).trim());
  return m ? m[1] : null;
}
function findCipherCallsite(js) {
  let offset = 0;
  for (;;) {
    const local = js.indexOf('=function(', offset);
    if (local < 0) return null;
    const braceRel = js.indexOf('{', local);
    if (braceRel < 0) return null;
    const body = matchBrace(js, braceRel);
    if (body !== null) {
      const varName = splitVarName(body);
      if (varName && (body.includes('.split("")') || body.includes(".split('')")) &&
          (body.includes(`return ${varName}.join("")`) || body.includes(`return ${varName}.join('')`))) {
        return body;
      }
    }
    offset = braceRel + 1;
  }
}
function parseContainerCall(statement, splitVar) {
  const stmt = statement.trim();
  const dot = stmt.indexOf('.');
  if (dot < 0) return null;
  const container = stmt.slice(0, dot).trim();
  if (!container) return null;
  const afterDot = stmt.slice(dot + 1);
  const open = afterDot.indexOf('(');
  if (open < 0) return null;
  const method = afterDot.slice(0, open).trim();
  const args = afterDot.slice(open + 1).replace(/\)\s*$/, '').trim();
  const parts = args.split(',').map(s => s.trim());
  if (parts[0] !== splitVar) return null;
  const index = parts.length > 1 ? (parseInt(parts[1], 10) || 0) : 0;
  return { container, method, index };
}
function findContainerDefinition(js, name) {
  for (const token of [`var ${name}={`, `var ${name} = {`, `${name}={`, `${name} = {`]) {
    const pos = js.indexOf(token);
    if (pos >= 0) return matchBrace(js, pos + token.length - 1);
  }
  return null;
}
function classifyMethods(definition, mode) {
  const methods = new Map();
  let pos = 0;
  for (;;) {
    const fnPos = definition.indexOf(':function(', pos);
    if (fnPos < 0) break;
    const before = definition.slice(0, fnPos);
    const name = before.split(/[,{\n;]/).pop().trim();
    const braceRel = definition.indexOf('{', fnPos);
    if (braceRel >= 0) {
      const body = matchBrace(definition, braceRel);
      if (body !== null) {
        let kind = null;
        if (mode === 'explode') {
          if (body.includes('%')) kind = 'W';
          else if (body.includes('splice')) kind = 'S';
          else if (body.includes('reverse')) kind = 'R';
        } else {
          if (body.includes('reverse')) kind = 'R';
          else if (body.includes('splice')) kind = 'S';
          else if (body.includes('var c=') || (body.includes('a[0]') && body.includes('a[b'))) kind = 'W';
        }
        if (kind && name) methods.set(name, kind);
        pos = braceRel + body.length + 2;
        continue;
      }
    }
    pos = fnPos + 1;
  }
  return methods;
}
function extractOpsExplode(js) {
  const callsite = findCipherCallsite(js);
  if (!callsite) throw new Error('Failed to locate cipher callsite');
  const splitVar = splitVarName(callsite);
  if (!splitVar) throw new Error('Failed to identify split variable');
  let container = null;
  for (const stmt of callsite.split(';')) {
    const call = parseContainerCall(stmt, splitVar);
    if (call) { container = call.container; break; }
  }
  if (!container) throw new Error('Failed to identify cipher helper container');
  const definition = findContainerDefinition(js, container);
  if (definition === null) throw new Error('Failed to locate cipher helper definition');
  const methodTypes = classifyMethods(definition, 'explode');
  if (!methodTypes.size) throw new Error('Failed to classify cipher helper methods');
  const ops = [];
  for (const stmt of callsite.split(';')) {
    const call = parseContainerCall(stmt, splitVar);
    if (call && methodTypes.has(call.method)) ops.push({ kind: methodTypes.get(call.method), index: call.index });
  }
  if (!ops.length) throw new Error('No cipher operations were parsed from callsite');
  return ops;
}

/* ── Strategy 2: modern fQ + uC + h[] ── */
function extractHArray(js) {
  for (const token of ['var h=[', 'let h=[', 'const h=[', 'var h = [']) {
    const pos = js.indexOf(token);
    if (pos >= 0) {
      const text = bracketedText(js.slice(pos + token.length - 1), '[', ']');
      if (text !== null) return quotedStrings(text);
    }
  }
  return null;
}
function extractUcMethods(js, spliceIdx, reverseIdx) {
  const token = 'var uC={';
  const pos = js.indexOf(token);
  if (pos < 0) throw new Error("Could not find 'var uC={' in player JS");
  const inner = bracketedText(js.slice(pos + token.length - 1), '{', '}');
  if (inner === null) throw new Error("Could not find matching '}' for uC object");
  const methods = new Map();
  let search = inner;
  for (;;) {
    const fnPos = search.indexOf(':function(');
    if (fnPos < 0) break;
    const before = search.slice(0, fnPos);
    const cut = Math.max(before.lastIndexOf(','), before.lastIndexOf('{'), before.lastIndexOf('\n'), before.lastIndexOf(';'));
    const name = before.slice(cut + 1).trim();
    if (name) {
      const bodyStart = search.indexOf('){', fnPos + 10);
      if (bodyStart >= 0) {
        const body = bracketedText(search.slice(bodyStart + 1), '{', '}') || '';
        let kind = null;
        if (body.includes(`h[${spliceIdx}]`)) kind = 'S';
        else if (body.includes(`h[${reverseIdx}]`)) kind = 'R';
        else if (body.includes('D[0]')) kind = 'W';
        if (kind) methods.set(name, kind);
      }
    }
    search = search.slice(fnPos + 1);
  }
  return methods;
}
function isFqCipherCall(slice) {
  let rest = slice.slice(3);                       // after "fQ("
  let p = parseNumber(rest); if (!p) return false; rest = p[1];
  if (!rest.startsWith(',')) return false;
  p = parseNumber(rest.slice(1)); if (!p) return false; rest = p[1];
  if (!rest.startsWith(',fQ(')) return false;
  p = parseNumber(rest.slice(4)); if (!p) return false; rest = p[1];
  if (!rest.startsWith(',')) return false;
  p = parseNumber(rest.slice(1)); if (!p) return false; rest = p[1];
  return rest.startsWith(',m.s)');
}
function extractFqCipherBlock(js) {
  let search = js, base = 0, callPos = -1;
  for (;;) {
    const pos = search.indexOf('fQ(');
    if (pos < 0) break;
    if (isFqCipherCall(search.slice(pos))) { callPos = base + pos; break; }
    base += pos + 3;
    search = search.slice(pos + 3);
  }
  if (callPos < 0) throw new Error('Could not find fQ cipher call pattern');
  let rest = js.slice(callPos + 3);
  const pd = parseNumber(rest); if (!pd) throw new Error('Failed to parse fQ outer args');
  rest = pd[1];
  if (!rest.startsWith(',')) throw new Error('Failed to parse fQ outer args');
  const px = parseNumber(rest.slice(1)); if (!px) throw new Error('Failed to parse fQ outer args');
  const vOuter = (pd[0] ^ px[0]) >>> 0;

  let fnPos = js.indexOf('fQ=function(D,X,B,C){');
  if (fnPos < 0) fnPos = js.indexOf('fQ =function(D,X,B,C){');
  if (fnPos < 0) throw new Error('Could not find fQ function definition');
  const brace = js.indexOf('{', fnPos);
  const fqBody = bracketedText(js.slice(brace), '{', '}');
  if (fqBody === null) throw new Error('Could not extract fQ function body');
  const marker = 'if((D|80)==D)';
  const d80 = fqBody.indexOf(marker);
  if (d80 < 0) throw new Error('Could not find if((D|80)==D) block');
  const d80Brace = fqBody.indexOf('{', d80);
  const block = bracketedText(fqBody.slice(d80Brace), '{', '}');
  if (block === null) throw new Error('Could not extract if((D|80)==D) block content');
  return { v: vOuter, block };
}
function extractOpsFq(js) {
  const h = extractHArray(js);
  if (!h || !h.length) throw new Error('Failed to locate h[] array');
  const spliceIdx = h.indexOf('splice');
  const reverseIdx = h.indexOf('reverse');
  if (spliceIdx < 0) throw new Error("Could not find 'splice' in h[] array");
  if (reverseIdx < 0) throw new Error("Could not find 'reverse' in h[] array");
  const methods = extractUcMethods(js, spliceIdx, reverseIdx);
  if (!methods.size) throw new Error('No uC cipher methods found');
  const { v, block } = extractFqCipherBlock(js);
  const ops = [];
  let search = block;
  const marker = 'uC[h[V^';
  for (;;) {
    const pos = search.indexOf(marker);
    if (pos < 0) break;
    const after = search.slice(pos + marker.length);
    const pn = parseNumber(after);
    if (pn && pn[1].startsWith(']](x')) {
      const rest2 = pn[1].slice(4);
      let actualArg = 0;
      if (rest2.startsWith(',V^')) { const pa = parseNumber(rest2.slice(3)); actualArg = pa ? (v ^ pa[0]) >>> 0 : 0; }
      else if (rest2.startsWith(',')) { const pa = parseNumber(rest2.slice(1)); actualArg = pa ? pa[0] : 0; }
      const methodName = h[(v ^ pn[0]) >>> 0] || '';
      if (methods.has(methodName)) ops.push({ kind: methods.get(methodName), index: actualArg });
    }
    search = search.slice(pos + marker.length);
  }
  if (!ops.length) throw new Error('No cipher operations found in fQ dispatch block');
  return ops;
}

/* ── Strategy 3: legacy split/join ── */
function extractOpsLegacy(js) {
  const splitMarker = 'a=a.split("");';
  const joinMarker = 'return a.join("")';
  const splitPos = js.indexOf(splitMarker);
  if (splitPos < 0) throw new Error('Could not find decipher function in player JS');
  const joinOff = js.indexOf(joinMarker, splitPos);
  if (joinOff < 0) throw new Error('Could not find decipher function in player JS');
  const fnBody = js.slice(splitPos + splitMarker.length, joinOff).trim().replace(/;$/, '');
  const dot = fnBody.indexOf('.');
  const helperName = dot >= 0 ? fnBody.slice(0, dot).trim() : '';
  if (!helperName) throw new Error('Could not find helper object name');
  let objStart = -1;
  for (const pattern of [`var ${helperName}={`, `${helperName} = {`, `${helperName}={`]) {
    const pos = js.indexOf(pattern);
    if (pos >= 0) { objStart = pos + pattern.length - 1; break; }
  }
  if (objStart < 0) throw new Error(`Could not find helper object '${helperName}'`);
  const objBody = matchBrace(js, objStart);
  if (objBody === null) throw new Error('Could not find end of helper object');
  const methodTypes = classifyMethods(objBody, 'legacy');
  if (!methodTypes.size) throw new Error('No cipher methods found in helper object');
  const ops = [];
  for (const rawCall of fnBody.split(';')) {
    const call = rawCall.trim();
    if (!call) continue;
    const d = call.indexOf('.');
    if (d < 0) continue;
    const afterDot = call.slice(d + 1);
    const paren = afterDot.indexOf('(');
    if (paren < 0) continue;
    const method = afterDot.slice(0, paren);
    if (!methodTypes.has(method)) continue;
    const argsStr = afterDot.slice(paren + 1).replace(/\)\s*$/, '');
    const idxPart = argsStr.split(',')[1];
    ops.push({ kind: methodTypes.get(method), index: idxPart ? (parseInt(idxPart.trim(), 10) || 0) : 0 });
  }
  if (!ops.length) throw new Error('No cipher operations parsed from function body');
  return ops;
}

function extractCipherOps(js) {
  for (const fn of [extractOpsExplode, extractOpsFq, extractOpsLegacy]) {
    try {
      const ops = fn(js);
      if (ops && ops.length) return ops;
    } catch { /* agli strategy try karo */ }
  }
  throw new Error('All cipher extraction strategies failed');
}

/* ── Manifest (module-level cache; lambda warm reuse) ── */
let manifestCache = null;
async function fetchManifestFresh() {
  const jsUrl = await fetchPlayerJsUrl();
  const js = await httpGet(jsUrl);
  const sigTimestamp = extractSigTimestamp(js);
  if (!sigTimestamp) throw new Error('Failed to extract signatureTimestamp from player JS');
  const ops = extractCipherOps(js);
  manifestCache = { ops, sigTimestamp, jsUrl };
  return manifestCache;
}
async function getCipherManifest(forceRefresh = false) {
  if (!forceRefresh && manifestCache) return manifestCache;
  return fetchManifestFresh();
}

/* ── decode_stream_url: signatureCipher → playable URL ── */
function appendOrReplaceParam(url, key, value) {
  const qPos = url.indexOf('?');
  const base = qPos >= 0 ? url.slice(0, qPos) : url;
  const query = qPos >= 0 ? url.slice(qPos + 1) : '';
  const pairs = [];
  let replaced = false;
  for (const pair of query.split('&').filter(Boolean)) {
    const eq = pair.indexOf('=');
    const k = eq >= 0 ? pair.slice(0, eq) : pair;
    if (k === key) { pairs.push(`${k}=${value}`); replaced = true; }
    else pairs.push(pair);
  }
  if (!replaced) pairs.push(`${key}=${value}`);
  return pairs.length ? `${base}?${pairs.join('&')}` : base;
}
const safeDecode = s => { try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch { return s; } };
function decodeStreamUrl(cipherStr, manifest) {
  const parts = {};
  for (const pair of String(cipherStr).split('&')) {
    const eq = pair.indexOf('=');
    if (eq >= 0) parts[safeDecode(pair.slice(0, eq))] = safeDecode(pair.slice(eq + 1));
  }
  const encSig = parts.s || parts.sig;
  const baseUrl = parts.url;
  if (!encSig) throw new Error("Missing 's' (signature) in signatureCipher");
  if (!baseUrl) throw new Error("Missing 'url' in signatureCipher");
  const sp = parts.sp || 'signature';
  const decoded = decipher(encSig, manifest.ops);
  let url = appendOrReplaceParam(baseUrl, sp, encodeURIComponent(decoded));
  if (!url.includes('ratebypass=')) url = appendOrReplaceParam(url, 'ratebypass', 'yes');
  return url;
}

module.exports = {
  getCipherManifest, decipher, decodeStreamUrl,
  _extractCipherOps: extractCipherOps, _extractSigTimestamp: extractSigTimestamp,
};
