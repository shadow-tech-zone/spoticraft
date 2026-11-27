/* Chhota fetch wrapper — timeout + desktop UA + JSON/text helpers. */
import { ApiError } from './model.js';

export const UA_DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export async function fetchText(url, { method = 'GET', headers = {}, body = null, timeoutMs = 20000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: { 'user-agent': UA_DESKTOP, ...headers },
      body,
      signal: ctrl.signal,
      redirect: 'follow',
    });
    const text = await res.text();
    if (!res.ok) throw new ApiError(`upstream HTTP ${res.status} for ${new URL(url).host}`, 502, 'upstream_http');
    return text;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(`upstream fetch failed (${e.name === 'AbortError' ? 'timeout' : e.message})`, 502, 'upstream_fetch');
  } finally {
    clearTimeout(t);
  }
}

export async function fetchJson(url, opts = {}) {
  const text = await fetchText(url, opts);
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError('upstream returned invalid JSON', 502, 'upstream_parse');
  }
}
