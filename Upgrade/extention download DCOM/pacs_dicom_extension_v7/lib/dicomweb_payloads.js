'use strict';

// Cached responses are only a replay fallback, not the durable discovery list.
// Keep whole responses: slicing a metadata array would look like a complete
// response and could silently turn a large series into a partial download.
export const DICOMWEB_PAYLOAD_MAX_BYTES = 2 * 1024 * 1024;
export const DICOMWEB_PAYLOAD_MAX_ENTRIES = 32;
const encoder = new TextEncoder();
const payloadSizes = new WeakMap();

function parseUrl(raw) {
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    url.hash = '';
    return url;
  } catch { return null; }
}

function responseBytes(payload) {
  if (!payload || typeof payload !== 'object') return Infinity;
  // Captured JSON objects are immutable after parsing. Cache their serialized
  // size so every capture/storage flush does not reserialize earlier responses.
  if (payloadSizes.has(payload)) return payloadSizes.get(payload);
  let bytes;
  try { bytes = encoder.encode(JSON.stringify(payload)).byteLength; }
  catch { bytes = Infinity; }
  payloadSizes.set(payload, bytes);
  return bytes;
}

export function boundDicomwebPayloads(input, {
  maxBytes = DICOMWEB_PAYLOAD_MAX_BYTES,
  maxEntries = DICOMWEB_PAYLOAD_MAX_ENTRIES,
} = {}) {
  const entries = Object.entries(input || {});
  const fullPaths = new Set(entries.map(([key]) => parseUrl(key)?.pathname).filter(Boolean));
  // Old workers wrote a second copy under pathname. Drop that alias when the
  // full URL remains, but retain standalone legacy pathname entries on restore.
  const unique = entries.filter(([key]) => !key.startsWith('/') || !fullPaths.has(key));
  const kept = [];
  let bytes = 2, truncated = false;
  for (let i = unique.length - 1; i >= 0; i--) {
    const [key, payload] = unique[i];
    const entryBytes = encoder.encode(JSON.stringify(key)).byteLength + 1 + responseBytes(payload);
    const nextBytes = bytes + entryBytes + (kept.length ? 1 : 0);
    if (kept.length >= maxEntries || nextBytes > maxBytes) {
      truncated = true;
      continue;
    }
    kept.push([key, payload]);
    bytes = nextBytes;
  }
  return {payloads: Object.fromEntries(kept.reverse()), truncated, bytes};
}

export function cacheDicomwebPayload(payloads, rawUrl, payload, options) {
  const url = parseUrl(rawUrl);
  if (!url) return boundDicomwebPayloads(payloads, options);
  const next = {...payloads};
  delete next[url.href];
  delete next[url.pathname];
  next[url.href] = payload;
  return boundDicomwebPayloads(next, options);
}

export function getDicomwebPayload(payloads, rawUrl) {
  if (!payloads) return null;
  const url = parseUrl(rawUrl);
  if (!url) return null;
  if (Object.hasOwn(payloads, url.href)) return payloads[url.href];
  if (Object.hasOwn(payloads, url.pathname)) return payloads[url.pathname];
  const queryKey = value => JSON.stringify([...value.searchParams]
    .filter(([key]) => !/^(?:token|access_token|session|stoken|sig|signature|expires|auth)$/i.test(key))
    .sort(([ak,av], [bk,bv]) => ak.localeCompare(bk) || av.localeCompare(bv)));
  const query = queryKey(url);
  // Token changes may alter the query without altering the response. Only use
  // that fallback for a unique same-origin match, never an ambiguous page/query
  // or a different PACS origin with a coincidentally identical path.
  const matches = Object.entries(payloads).filter(([key]) => {
    const candidate = parseUrl(key);
    return candidate?.origin === url.origin && candidate.pathname === url.pathname && queryKey(candidate) === query;
  });
  return matches.length === 1 ? matches[0][1] : null;
}
