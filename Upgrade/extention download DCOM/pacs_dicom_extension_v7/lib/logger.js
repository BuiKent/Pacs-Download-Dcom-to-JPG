'use strict';

export const LOG_STORAGE_KEY = 'pacs6_activity_logs';
export const MAX_LOG_ENTRIES = 1500;

let logBuffer = null;
let flushTimer = null;

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
  if (typeof details === 'string') return details.slice(0, 600);
  if (typeof details === 'number' || typeof details === 'boolean') return String(details);
  try {
    const str = JSON.stringify(details);
    return str.length > 600 ? str.slice(0, 597) + '...' : str;
  } catch {
    return String(details).slice(0, 600);
  }
}

export function createLogEntry(levelOrObj, category, message, details = null) {
  let level = levelOrObj, cat = category, msg = message, det = details;
  if (levelOrObj && typeof levelOrObj === 'object') {
    level = levelOrObj.level;
    cat = levelOrObj.category;
    msg = levelOrObj.message;
    det = levelOrObj.details;
  }
  const now = new Date();
  return {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: now.toISOString(),
    timeFormatted: now.toLocaleString('vi-VN', { hour12: false }),
    level: String(level || 'INFO').toUpperCase(),
    category: String(cat || 'SYSTEM').toUpperCase(),
    message: redactIdentifiers(msg),
    details: redactIdentifiers(sanitizeDetails(det))
  };
}

export async function getLogsFromStorage() {
  if (Array.isArray(logBuffer)) return logBuffer;
  try {
    if (typeof chrome !== 'undefined' && chrome?.storage?.local) {
      const res = await chrome.storage.local.get(LOG_STORAGE_KEY);
      logBuffer = Array.isArray(res[LOG_STORAGE_KEY]) ? res[LOG_STORAGE_KEY] : [];
    } else {
      logBuffer = [];
    }
  } catch {
    logBuffer = [];
  }
  return logBuffer;
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
    const ts = log.timestamp || log.timeFormatted || '';
    const lvl = `[${log.level || 'INFO'}]`.padEnd(9, ' ');
    const cat = `[${log.category || 'SYSTEM'}]`.padEnd(14, ' ');
    const det = log.details ? ` | Chi tiết: ${log.details}` : '';
    lines.push(`${ts} ${lvl} ${cat} ${log.message}${det}`);
  }

  return lines.join('\r\n');
}
