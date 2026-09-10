import assert from 'node:assert/strict';
import {
  createLogEntry,
  formatLogsAsText,
  getLogsFromStorage,
  MAX_LOG_ENTRIES,
} from '../lib/logger.js';

// Test 1: createLogEntry structure
const entry = createLogEntry('info', 'detection', 'Found PACS viewer', { score: 95, url: 'https://pacs.test/view' });
assert.equal(entry.level, 'INFO');
assert.equal(entry.category, 'DETECTION');
assert.equal(entry.message, 'Found PACS viewer');
assert.ok(entry.details.includes('score'));
assert.ok(entry.timestamp);

// Test 2: formatLogsAsText
const logs = [
  entry,
  createLogEntry('warn', 'storage', 'Directory permission reset'),
  createLogEntry('error', 'download', 'Failed slice 10', 'HTTP 500')
];

const formatted = formatLogsAsText(logs, '7.1.0');
assert.ok(formatted.includes('PACS DICOM Downloader & View - Activity Log'));
assert.ok(formatted.includes('Phiên bản Extension : 7.1.0'));
assert.ok(formatted.includes('Found PACS viewer'));
assert.ok(formatted.includes('[WARN]'));
assert.ok(formatted.includes('[ERROR]'));
assert.ok(formatted.includes('Failed slice 10'));

// Entries written by an older extension version are sanitized on read and
// again on export. Upgrading must not leave historical tokens exportable.
let storageReads = 0;
globalThis.chrome = {storage: {local: {
  get: async () => {
    storageReads += 1;
    await new Promise(resolve => setTimeout(resolve, 10));
    return {pacs6_activity_logs: [{
      timestamp: '2026-09-10T00:00:00.000Z',
      level: 'INFO',
      category: 'DOWNLOAD',
      message: 'Open https://pacs.test/view?token=OLD_SECRET_TOKEN',
      details: '2606033997 - NGUYEN VAN AN - 52T - 10-09-2026',
    }]};
  },
  set: async () => {},
  remove: async () => {},
}}};
const [oldLogs, concurrentLogs] = await Promise.all([
  getLogsFromStorage(), getLogsFromStorage(),
]);
assert.equal(storageReads, 1, 'concurrent first use must share one storage read');
assert.equal(oldLogs, concurrentLogs);
assert.ok(!oldLogs[0].message.includes('OLD_SECRET_TOKEN'));
assert.ok(!oldLogs[0].details.includes('NGUYEN VAN AN'));
assert.ok(!formatLogsAsText([{
  ...oldLogs[0], message: 'https://pacs.test/?token=EXPORT_SECRET',
}]).includes('EXPORT_SECRET'), 'export sanitizes even caller-provided legacy rows');

console.log('Activity logger tests OK');
