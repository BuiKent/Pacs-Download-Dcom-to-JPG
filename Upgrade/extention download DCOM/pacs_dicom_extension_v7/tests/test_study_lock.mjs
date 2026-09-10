// The claim this extension leaves in a study folder while it fills it, so the
// desktop app does not read a study still arriving as one that failed halfway.
// The app parses this exact shape in `dcom_pipeline.read_study_lock`, so the
// two must agree on the field names and on what `renewedAt` counts in.
import assert from 'node:assert/strict';
import {
  buildStudyLock,
  claimBlocksUs,
  studyLockFilename,
  studyLockWinner,
  STUDY_LOCK_NAME,
  STUDY_LOCK_FORMAT,
  STUDY_LOCK_RENEW_MS,
} from '../lib/pacs.js';

assert.equal(STUDY_LOCK_NAME, '.dcom-busy.json');
assert.equal(STUDY_LOCK_FORMAT, 'dcom-study-lock-v1');

const lock = buildStudyLock({label: 'Đang tải 120 ảnh'});

assert.equal(lock.format, STUDY_LOCK_FORMAT);
assert.equal(lock.owner, 'extension', 'the app shows a different label per owner');
assert.equal(lock.label, 'Đang tải 120 ảnh');

// The app compares `renewedAt` against `time.time()`, which is SECONDS.
// Writing milliseconds would put every claim far in the future, and one that
// never expires locks a study out of the app for good.
const seconds = Math.floor(Date.now() / 1000);
assert.ok(
  Math.abs(lock.renewedAt - seconds) <= 2,
  `renewedAt must be unix seconds to match the app, got ${lock.renewedAt}`,
);
assert.ok(lock.renewedAt < 10_000_000_000, 'seconds, not milliseconds');
assert.equal(lock.createdAt, lock.renewedAt, 'a new contender records when it entered the race');

// Renewing has to stay well inside the app's expiry or a live download lapses
// and the app starts treating an arriving study as an abandoned one.
const APP_TTL_MS = 300 * 1000;   // dcom_pipeline.STUDY_LOCK_TTL_SECONDS
assert.ok(
  STUDY_LOCK_RENEW_MS * 2 < APP_TTL_MS,
  'a missed renewal must not be enough to expire the claim',
);

// A fixed clock, so the shape is pinned rather than the moment it was built.
const fixed = buildStudyLock({now: 1_700_000_000_000});
assert.equal(fixed.renewedAt, 1_700_000_000);

// Defaults must still produce a claim the app can read: a label is a nicety,
// the owner and the timestamp are what it acts on.
const bare = buildStudyLock();
assert.equal(bare.owner, 'extension');
assert.equal(bare.label, '');
assert.ok(bare.renewedAt > 0);

// Each writer owns a separate file. Two runtimes overwriting one shared JSON
// file cannot implement compare-and-swap and occasionally both entered.
assert.match(studyLockFilename(bare.claimId), /^\.dcom-busy\.[A-Za-z0-9_-]+\.json$/);
assert.equal(studyLockFilename('../escape'), '', 'a claim id must not become a path');

const older = buildStudyLock({owner: 'app', claimId: 'older', now: 1_700_000_000_000});
const newer = buildStudyLock({claimId: 'newer', now: 1_700_000_001_000});
assert.equal(
  studyLockWinner([newer, older], 300, 1_700_000_002_000).claimId,
  'older',
  'simultaneous contenders must independently choose the same winner',
);
assert.equal(
  studyLockWinner([older], 300, 1_700_000_301_001),
  null,
  'an abandoned contender expires',
);
assert.equal(claimBlocksUs(older, 'newer', 300, 1_700_000_002_000), true);

console.log('Study lock tests OK');
