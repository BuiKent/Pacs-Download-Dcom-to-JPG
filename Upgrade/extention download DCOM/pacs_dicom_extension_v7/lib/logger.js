'use strict';

export const LOG_STORAGE_KEY = 'pacs6_activity_logs';
export const MAX_LOG_ENTRIES = 1500;

let logBuffer = null;
let flushTimer = null;

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
    message: String(msg || ''),
    details: sanitizeDetails(det)
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
