import assert from 'node:assert/strict';
import {
  FINISHING_STATUS,
  isActiveDownload,
  isTerminalDownload,
  panelPhase,
  progressStatus,
  reconcileInventory,
  shouldShowInventoryEditor,
} from '../lib/download_ui_state.js';

for (const status of ['preparing', 'downloading', 'cancelling', FINISHING_STATUS]) {
  assert.equal(isActiveDownload({status}), true, `${status} must lock the panel in download mode`);
}
for (const status of ['done', 'partial', 'done_with_errors', 'error', 'cancelled', undefined]) {
  assert.equal(isActiveDownload({status}), false, `${status || 'missing'} must not be treated as active`);
}

assert.equal(
  panelPhase({job: {status: 'downloading'}, hasInventory: true, tracking: 'watching', confidence: 100}),
  'downloading',
  'an active download must outrank both Ready and Tracking in the status card',
);
assert.equal(panelPhase({hasInventory: true, tracking: 'watching'}), 'ready');
assert.equal(panelPhase({tracking: 'watching'}), 'tracking');
assert.equal(panelPhase({tracking: 'candidate', confidence: 80}), 'candidate');
assert.equal(panelPhase({tracking: 'stopped'}), 'stopped');
assert.equal(panelPhase({}), 'idle');

const existingInventory = {studyUid: '1.2.3', series: [{id: 'series-1'}]};
assert.equal(
  reconcileInventory(existingInventory, null, {status: 'downloading'}),
  existingInventory,
  'a transient empty overview must not erase the visible study while its job is active',
);
assert.equal(
  reconcileInventory(existingInventory, null, {status: 'done'}),
  null,
  'after the job finishes, a real empty inventory may replace the old study',
);
const refreshedInventory = {studyUid: '1.2.3', series: [{id: 'series-1'}, {id: 'series-2'}]};
assert.equal(
  reconcileInventory(existingInventory, refreshedInventory, {status: 'downloading'}),
  refreshedInventory,
  'a valid inventory refresh must still be accepted during download',
);

assert.equal(shouldShowInventoryEditor({status: 'downloading'}), false,
  'series selection must stay collapsed while files are being written');
assert.equal(shouldShowInventoryEditor({status: FINISHING_STATUS}), false,
  'the editor must not reappear between the last image and the stored result');
assert.equal(shouldShowInventoryEditor({status: 'done'}), true);

// The engine reports 'done'/'error' over progress before the study sidecar is
// written and before the background may retry with the next adapter. Accepting
// that as the end of the job flips the panel out of download mode and the retry
// flips it straight back.
for (const reported of ['done', 'partial', 'done_with_errors', 'error', 'cancelled']) {
  assert.equal(progressStatus('downloading', reported), FINISHING_STATUS,
    `progress reporting ${reported} must hold the job until it is finalized`);
  assert.equal(isTerminalDownload({status: progressStatus('downloading', reported)}), false);
}
assert.equal(progressStatus('cancelling', 'cancelled'), 'cancelling',
  'a cancel in flight keeps saying Cancelling, not Finishing');
assert.equal(progressStatus('downloading', 'downloading'), 'downloading');
assert.equal(progressStatus('preparing', ''), 'preparing', 'a progress message without status changes nothing');

for (const status of ['done', 'partial', 'done_with_errors', 'error', 'cancelled']) {
  assert.equal(isTerminalDownload({status}), true);
}
for (const status of ['preparing', 'downloading', 'cancelling', FINISHING_STATUS, undefined]) {
  assert.equal(isTerminalDownload({status}), false);
}

console.log('Download UI state tests OK');
