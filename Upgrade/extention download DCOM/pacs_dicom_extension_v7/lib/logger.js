'use strict';

export const LOG_STORAGE_KEY = 'pacs6_activity_logs';
export const MAX_LOG_ENTRIES = 3000;

let logBuffer = null;
let loadPromise = null;
let logGeneration = 0;
let flushTimer = null;

export function extractPacsSite(rawUrl) {
  if (!rawUrl) return '';
  try {
    const u = new URL(rawUrl);
    return u.host || '';
  } catch {
    const m = String(rawUrl).match(/^(?:https?:\/\/)?([^/?#]+)/i);
    return m ? m[1] : '';
  }
}

/**
 * Strip patient identity out of a log line.
 *
 * The activity log is exported to a file and read on screen, and it lives in
 * `chrome.storage.local` for 1500 entries. Folder names carry
 * `<mã BN> - <họ tên> - <tuổi> - <ngày>` and viewer urls carry share tokens, so
 * a log written verbatim is a second copy of the record with none of its
 * protections. What is useful for diagnosis — counts, status, timings — has no
 * identity in it.
 */
const PATIENT_FOLDER_IN_TEXT = new RegExp(
  [
    '[A-Za-z0-9._-]*\\d[A-Za-z0-9._-]*',   // mã bệnh nhân, luôn có chữ số
    '\\s*-\\s*[^\\n-]{2,60}?',              // họ tên
    '\\s*-\\s*\\d{1,3}\\s*[A-Za-zÀ-ỹ]{0,6}',  // tuổi
    '\\s*-\\s*\\d{2}-\\d{2}-\\d{4}',        // ngày tải
  ].join(''),
  'g',
);

const CREDENTIAL_IN_URL =
  /([?&#](?:token|stoken|access_token|session|sessionid|auth|sig|signature|key|password|pwd|secret|bearer)=)[^&#\s]*/gi;

export function redactIdentifiers(text) {
  return String(text == null ? '' : text)
    // A patient folder name: `2606033997 - NGUYEN VAN A - 52T - 10-09-2026`.
    // Anchored on the trailing date so an ordinary hyphenated sentence is not
    // mistaken for one.
    .replace(PATIENT_FOLDER_IN_TEXT, '<hồ sơ đã ẩn>')
    // Any credential carried in a url that reaches the log.
    .replace(CREDENTIAL_IN_URL, '$1<đã ẩn>');
}

function sanitizeDetails(details) {
  if (details == null) return '';
  if (typeof details === 'string') return details.slice(0, 1000);
  if (typeof details === 'number' || typeof details === 'boolean') return String(details);
  try {
    const str = JSON.stringify(details);
    return str.length > 1000 ? str.slice(0, 997) + '...' : str;
  } catch {
    return String(details).slice(0, 1000);
  }
}

export function createLogEntry(levelOrObj, category, message, details = null) {
  let level = levelOrObj, cat = category, msg = message, det = details;
  let tabId = null, pacsSite = '', url = '', studyUid = '';
  if (levelOrObj && typeof levelOrObj === 'object') {
    level = levelOrObj.level;
    cat = levelOrObj.category;
    msg = levelOrObj.message;
    det = levelOrObj.details;
    tabId = levelOrObj.tabId != null ? Number(levelOrObj.tabId) : null;
    url = levelOrObj.url ? redactIdentifiers(levelOrObj.url) : '';
    pacsSite = levelOrObj.pacsSite || extractPacsSite(levelOrObj.url);
    studyUid = levelOrObj.studyUid ? String(levelOrObj.studyUid) : '';
  }
  const now = new Date();
  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: now.toISOString(),
    timeFormatted: now.toLocaleString('vi-VN', { hour12: false }),
    level: String(level || 'INFO').toUpperCase(),
    category: String(cat || 'SYSTEM').toUpperCase(),
    message: redactIdentifiers(msg),
    details: redactIdentifiers(sanitizeDetails(det)),
    pacsSite: String(pacsSite || ''),
    tabId: tabId != null && !Number.isNaN(tabId) ? tabId : null,
    url: url || '',
    studyUid: studyUid || ''
  };
}

function sanitizeStoredEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const site = entry.pacsSite || extractPacsSite(entry.url);
  return {
    ...entry,
    message: redactIdentifiers(entry.message),
    details: redactIdentifiers(sanitizeDetails(entry.details)),
    pacsSite: String(site || ''),
    tabId: entry.tabId != null && !Number.isNaN(Number(entry.tabId)) ? Number(entry.tabId) : null,
    url: entry.url ? redactIdentifiers(entry.url) : '',
    studyUid: entry.studyUid ? String(entry.studyUid) : ''
  };
}

export async function getLogsFromStorage() {
  if (Array.isArray(logBuffer)) return logBuffer;
  if (loadPromise) return loadPromise;
  const generation = logGeneration;
  loadPromise = (async () => {
    let loaded = [];
    try {
      if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
        const res = await chrome.storage.local.get(LOG_STORAGE_KEY);
        loaded = Array.isArray(res[LOG_STORAGE_KEY])
          ? res[LOG_STORAGE_KEY].map(sanitizeStoredEntry).filter(Boolean)
          : [];
      }
    } catch { /* an unavailable log store is an empty log */ }
    if (generation === logGeneration && !Array.isArray(logBuffer)) logBuffer = loaded;
    return Array.isArray(logBuffer) ? logBuffer : loaded;
  })();
  try {
    return await loadPromise;
  } finally {
    loadPromise = null;
  }
}

export function scheduleLogFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(async () => {
    flushTimer = null;
    try {
      if (Array.isArray(logBuffer) && typeof chrome !== 'undefined' && chrome?.storage?.local) {
        await chrome.storage.local.set({ [LOG_STORAGE_KEY]: logBuffer });
      }
    } catch {}
  }, 500);
}

export async function appendLog(levelOrObj, category, message, details = null) {
  const list = await getLogsFromStorage();
  const entry = createLogEntry(levelOrObj, category, message, details);
  list.push(entry);
  if (list.length > MAX_LOG_ENTRIES) {
    list.splice(0, list.length - MAX_LOG_ENTRIES);
  }
  scheduleLogFlush();
  return entry;
}

export async function clearAllLogs() {
  logGeneration += 1;
  logBuffer = [];
  try {
    if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
      await chrome.storage.local.remove(LOG_STORAGE_KEY);
    }
  } catch {}
  return true;
}

// The caller passes `chrome.runtime.getManifest().version`. The default is
// deliberately empty rather than a literal version, which goes stale the
// next time the manifest is bumped and then misreports every exported log.
export function formatLogsAsText(logs = [], extensionVersion = '') {
  const now = new Date();
  const lines = [
    `======================================================================`,
    `PACS DICOM Downloader & View - Activity Log`,
    `Phiên bản Extension : ${extensionVersion || 'không rõ'}`,
    `Thời gian xuất file  : ${now.toISOString()} (${now.toLocaleString('vi-VN')})`,
    `Tổng số bản ghi log  : ${logs.length}`,
    `======================================================================`,
    ``
  ];

  for (const log of logs) {
    const safe = sanitizeStoredEntry(log) || {};
    const ts = safe.timestamp || safe.timeFormatted || '';
    const lvl = `[${safe.level || 'INFO'}]`.padEnd(9, ' ');
    const cat = `[${safe.category || 'SYSTEM'}]`.padEnd(14, ' ');
    const site = safe.pacsSite ? `[${safe.pacsSite}] ` : '';
    const det = safe.details ? ` | Chi tiết: ${safe.details}` : '';
    lines.push(`${ts} ${lvl} ${cat} ${site}${safe.message || ''}${det}`);
  }

  return lines.join('\r\n');
}
