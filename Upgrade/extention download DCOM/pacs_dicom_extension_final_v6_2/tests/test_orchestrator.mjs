import assert from 'node:assert/strict';
import {
  compatibleAdapterIds,
  cumulativeAttemptCounters,
  dicomTaskIdentityError,
  dedupeTasksBySop,
  isSameKnownStudy,
  mapSeriesSelection,
  inventoryIsCovered,
  tasksBelongToStudy,
} from '../lib/orchestrator.js';

const primary = {
  adapter: 'DICOMWEB',
  studyUid: '1.2.3',
  series: [
    {id: 'dw-a', seriesUid: '10.1'},
    {id: 'dw-b', seriesUid: '10.2'},
  ],
};
const sameStudy = {
  adapter: 'VRAD',
  studyUid: '1.2.3',
  series: [
    {id: 'vr-a', seriesUid: '10.1'},
    {id: 'vr-b', seriesUid: '10.2'},
  ],
};
const otherStudy = {...sameStudy, adapter: 'VRPACS', studyUid: '9.9.9'};

assert.equal(isSameKnownStudy(primary, sameStudy), true);
assert.equal(isSameKnownStudy(primary, otherStudy), false);
assert.equal(isSameKnownStudy({...primary, studyUid: ''}, {...sameStudy, studyUid: ''}), false);

assert.deepEqual(
  compatibleAdapterIds(primary, {DICOMWEB: primary, VRAD: sameStudy, VRPACS: otherStudy}, ['VRPACS', 'DICOMWEB', 'VRAD']),
  ['DICOMWEB', 'VRAD'],
);
assert.deepEqual(mapSeriesSelection(primary, sameStudy, ['dw-b']), ['vr-b']);
assert.deepEqual(mapSeriesSelection(primary, sameStudy, ['dw-a', 'dw-b']), ['vr-a', 'vr-b']);
assert.deepEqual(
  mapSeriesSelection({...primary, series: [{id: 'opaque', seriesUid: ''}, primary.series[1]]}, sameStudy, ['opaque']),
  [],
);

assert.equal(tasksBelongToStudy([{studyUid: '1.2.3'}, {studyUid: '1.2.3'}], '1.2.3'), true);
assert.equal(tasksBelongToStudy([{studyUid: '1.2.3'}, {studyUid: '9.9.9'}], '1.2.3'), false);
assert.equal(tasksBelongToStudy([{studyUid: ''}], '1.2.3'), false);

const expectedTask = {studyUid: '1.2.3', seriesUid: '10.1', sopInstanceUid: '1.2.3.1'};
const matchingMeta = {studyUid: '1.2.3', seriesUid: '10.1', sopInstanceUid: '1.2.3.1'};
assert.equal(dicomTaskIdentityError(expectedTask, matchingMeta), '');
assert.match(dicomTaskIdentityError(expectedTask, {...matchingMeta, studyUid: '9.9.9'}), /StudyInstanceUID/);
assert.match(dicomTaskIdentityError(expectedTask, {...matchingMeta, seriesUid: '10.9'}), /SeriesInstanceUID/);
assert.match(dicomTaskIdentityError(expectedTask, {...matchingMeta, sopInstanceUid: '1.2.3.9'}), /SOPInstanceUID/);
assert.match(dicomTaskIdentityError({}, {studyUid: '1.2.3', sopInstanceUid: ''}), /thiếu SOPInstanceUID/);

assert.deepEqual(
  cumulativeAttemptCounters(
    {attemptBaseOriginal: 8, attemptBaseReconstructed: 2, attemptBaseBytes: 1000},
    {original: 3, reconstructed: 1, bytesWritten: 500},
  ),
  {original: 11, reconstructed: 3, bytesWritten: 1500},
);
assert.equal(inventoryIsCovered({logicalTotal: 3, expectedSopUids: ['a', 'b', 'c']}, ['a', 'b']), false);
assert.equal(inventoryIsCovered({logicalTotal: 3, expectedSopUids: ['a', 'b', 'c']}, ['a', 'b', 'c']), true);
assert.equal(inventoryIsCovered({logicalTotal: 4, expectedSopUids: ['a', 'b', 'c']}, ['a', 'b', 'c']), false);
assert.deepEqual(
  dedupeTasksBySop([{sopInstanceUid: 'a'}, {sopInstanceUid: 'a'}, {sopInstanceUid: ''}, {sopInstanceUid: ''}]),
  [{sopInstanceUid: 'a'}, {sopInstanceUid: ''}, {sopInstanceUid: ''}],
);

// SOP deduplication across fallback attempts
const allTasks = [
  {studyUid: '1.2.3', sopInstanceUid: '1.2.3.1', relativePath: 's1/1.dcm'},
  {studyUid: '1.2.3', sopInstanceUid: '1.2.3.2', relativePath: 's1/2.dcm'},
  {studyUid: '1.2.3', sopInstanceUid: '1.2.3.3', relativePath: 's1/3.dcm'},
];
const completedSops = ['1.2.3.1', '1.2.3.2'];
const remainingTasks = allTasks.filter(t => {
  const sop = String(t.sopInstanceUid || '').trim();
  return !sop || !completedSops.includes(sop);
});
assert.equal(remainingTasks.length, 1);
assert.equal(remainingTasks[0].sopInstanceUid, '1.2.3.3');

const allDoneTasks = allTasks.filter(t => {
  const sop = String(t.sopInstanceUid || '').trim();
  return !sop || !['1.2.3.1', '1.2.3.2', '1.2.3.3'].includes(sop);
});
assert.equal(allDoneTasks.length, 0);

console.log('orchestrator fallback tests passed');
