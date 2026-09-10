import assert from 'node:assert/strict';
import { createLogEntry, formatLogsAsText, MAX_LOG_ENTRIES } from '../lib/logger.js';

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

console.log('Activity logger tests OK');
