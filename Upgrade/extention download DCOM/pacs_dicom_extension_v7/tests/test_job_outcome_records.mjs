// Three records this extension leaves on the reader's disk, and what each has
// to be honest about: what the download achieved, who is writing the folder,
// and what a log line is allowed to say about a patient.
import assert from 'node:assert/strict';
import {buildStudySidecar, sidecarStatusFor, buildStudyLock, claimBlocksUs} from '../lib/pacs.js';
import {createLogEntry, redactIdentifiers} from '../lib/logger.js';

const URL = 'https://pacs.example/viewer?studyUID=1.2.3';

// --- A download that stopped short must say so ---------------------------
// The sidecar used to record only how many images it managed to save, and the
// app compared what it found on disk against that. Three saved, three found,
// "Đã tải": comparing what was saved to what was saved cannot fail, so every
// failed download was reported as a finished study.
{
  const partial = buildStudySidecar({
    sourceUrl: URL, status: 'done_with_errors', imageCount: 3, plannedTotal: 5, failedCount: 2,
  });
  assert.equal(partial.status, 'partial');
  assert.equal(partial.imageCount, 3, 'what reached the disk');
  assert.equal(partial.plannedTotal, 5, 'what the job set out to fetch');
  assert.equal(partial.failedCount, 2);
  assert.notEqual(
    partial.imageCount, partial.plannedTotal,
    'the two must be able to differ, or the app has nothing to compare',
  );
}

for (const [jobStatus, expected] of [
  ['done', 'complete'],
  ['done_with_errors', 'partial'],
  ['cancelled', 'cancelled'],
  ['error', 'error'],
  ['downloading', 'downloading'],
  ['', 'complete'],
]) {
  assert.equal(sidecarStatusFor(jobStatus), expected, `job ${jobStatus || '(none)'}`);
}

// A clean run is the only thing that reads as finished.
assert.equal(
  buildStudySidecar({sourceUrl: URL, status: 'done', imageCount: 5, plannedTotal: 5}).status,
  'complete',
);

// `plannedTotal` never claims fewer images than actually arrived: a resumed
// download can leave more on disk than any single attempt set out to fetch.
assert.equal(
  buildStudySidecar({sourceUrl: URL, imageCount: 130, plannedTotal: 120}).plannedTotal, 130,
);
assert.equal(buildStudySidecar({sourceUrl: URL, imageCount: 4}).plannedTotal, 4);
assert.equal(buildStudySidecar({sourceUrl: URL, plannedTotal: -3}).plannedTotal, 0);

// --- Only the holder may release a claim ---------------------------------
{
  const ours = buildStudyLock({claimId: 'ours'});
  const theirs = buildStudyLock({owner: 'app', claimId: 'theirs'});

  assert.equal(claimBlocksUs(theirs, 'ours'), true, 'the app is live in this folder');
  assert.equal(claimBlocksUs(ours, 'ours'), false, 'our own claim is not an obstacle');
  assert.equal(claimBlocksUs(null, 'ours'), false);
  assert.equal(claimBlocksUs({format: 'something-else'}, 'ours'), false);

  const abandoned = {...theirs, renewedAt: Math.floor(Date.now() / 1000) - 400};
  assert.equal(
    claimBlocksUs(abandoned, 'ours'), false,
    'a browser killed mid download must not lock the study out for good',
  );

  assert.ok(buildStudyLock().claimId, 'every claim carries an id');
  assert.notEqual(buildStudyLock().claimId, buildStudyLock().claimId);
}

// --- A log line is not a second copy of the record -----------------------
// The activity log is exported to a file and kept for 1500 entries. Folder
// names carry `<mã BN> - <họ tên> - <tuổi> - <ngày>` and viewer urls carry
// share tokens, so a log written verbatim is the record again with none of its
// protections.
{
  const entry = createLogEntry({
    level: 'info',
    category: 'download',
    message: 'Lưu vào 2606033997 - NGUYEN VAN AN - 52T - 10-09-2026 từ '
      + 'https://pacs.example/v?studyUID=1.2.3&token=SECRET123',
  });

  assert.ok(!entry.message.includes('NGUYEN VAN AN'), 'the patient name must not reach the log');
  assert.ok(!entry.message.includes('2606033997'), 'nor the patient code');
  assert.ok(!entry.message.includes('SECRET123'), 'nor the share credential');
  assert.ok(
    entry.message.includes('studyUID=1.2.3'),
    'the study uid stays: it identifies the scan, not the person, and is what makes a log useful',
  );
}

// Ordinary hyphenated prose is left alone — over-redacting makes logs useless.
{
  const plain = 'Tải xong 120/120 ảnh - không có lỗi';
  assert.equal(redactIdentifiers(plain), plain);
}

// Details are redacted too; they are where structured folder names end up.
{
  const entry = createLogEntry({
    level: 'error', category: 'engine', message: 'Lỗi ghi file',
    details: {folder: '2606033997 - TRAN THI BINH - 30T - 10-09-2026'},
  });
  assert.ok(!entry.details.includes('TRAN THI BINH'));
}

assert.equal(redactIdentifiers(null), '');
assert.equal(redactIdentifiers(undefined), '');

console.log('Job outcome record tests OK');
