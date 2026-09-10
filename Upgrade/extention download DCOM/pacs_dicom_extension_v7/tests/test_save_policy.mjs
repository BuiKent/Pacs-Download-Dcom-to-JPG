import assert from 'node:assert/strict';
import { resolveBulkDicomSaveMode } from '../lib/save_policy.js';

assert.throws(
  () => resolveBulkDicomSaveMode(false, 'downloads'),
  /select a writable folder/i,
  'bulk DICOM download must stop before Chrome can open one Save As prompt per file',
);

assert.equal(
  resolveBulkDicomSaveMode(true, 'downloads'),
  'filesystem',
  'a legacy Downloads preference must not bypass the writable-folder guard',
);

assert.equal(
  resolveBulkDicomSaveMode(true, 'filesystem'),
  'filesystem',
  'a writable directory always selects direct filesystem output',
);

console.log('Bulk save policy tests OK');
