// `dcom-source.json` is the only thing the extension tells the app that the
// DICOM tags cannot say. Two properties matter and neither is obvious from
// reading the writer: the viewer credential must not reach the reader's disk,
// and a study whose download never finished must say so.
import assert from 'node:assert/strict';
import {buildStudySidecar, sidecarStudyPath, SIDECAR_FORMAT} from '../lib/pacs.js';

// --- The format marker the app checks before believing the file -----------
assert.equal(SIDECAR_FORMAT, 'dcom-extension-source-v1');

const complete = buildStudySidecar({
  sourceUrl: 'https://pacs.example/viewer?studyUID=1.2.3&token=SECRET',
  studyUid: '1.2.3',
  info: {patientId: 'BN001', studyDate: '20260901', modality: 'CT'},
  imageCount: 120,
});

assert.equal(complete.format, SIDECAR_FORMAT);
assert.equal(complete.imageCount, 120);
assert.equal(complete.status, 'complete');
assert.equal(complete.studyInstanceUid, '1.2.3');

// --- The credential must not land on the reader's disk --------------------
assert.ok(!complete.sourceUrl.includes('SECRET'),
  'a share token must be stripped when the study is identified another way');
assert.ok(complete.sourceUrl.includes('studyUID=1.2.3'),
  'the study locator has to survive or there is nothing to reopen');

// A link whose token IS the only thing identifying the study keeps it —
// stripping it would leave "Tải tiếp" with a URL that opens nothing.
const shareOnly = buildStudySidecar({
  sourceUrl: 'https://pacs.example/share?token=ONLY-WAY-IN',
  imageCount: 5,
});
assert.ok(shareOnly.sourceUrl.includes('ONLY-WAY-IN'),
  'a share link with no other locator must keep its token');

// --- An unfinished download says so ---------------------------------------
// Written from the first saved image. A browser closed mid-download used to
// leave images with no link beside them, so the study could not be resumed at
// all; now it carries the link AND admits it is incomplete.
const started = buildStudySidecar({
  sourceUrl: 'https://pacs.example/viewer?studyUID=1.2.3',
  status: 'downloading',
  imageCount: 0,
});
assert.equal(started.status, 'downloading');
assert.equal(started.imageCount, 0);
assert.ok(started.sourceUrl, 'the link is there from the first image on');

// Anything that is not the downloading mark reads as complete, so a corrupted
// value can never make a finished study look unfinished forever.
assert.equal(buildStudySidecar({sourceUrl: 'https://p.example/v', status: 'nonsense'}).status, 'complete');

// --- No link means no file -------------------------------------------------
// A sidecar with no url is worse than none: it looks like a record and answers
// nothing.
assert.equal(buildStudySidecar({sourceUrl: ''}), null);
assert.equal(buildStudySidecar({}), null);
assert.equal(buildStudySidecar({sourceUrl: 'not a url'}), null);

// --- Counts are never negative or NaN -------------------------------------
assert.equal(buildStudySidecar({sourceUrl: 'https://p.example/v', imageCount: -4}).imageCount, 0);
assert.equal(buildStudySidecar({sourceUrl: 'https://p.example/v', imageCount: 'x'}).imageCount, 0);

// --- The sidecar belongs to the study, not its DICOM folder ---------------
assert.equal(
  sidecarStudyPath('BN001 - NGUYEN VAN AN - 52T - 10-09-2026/01-09-2026 - CT - CT Bung/DICOM'),
  'BN001 - NGUYEN VAN AN - 52T - 10-09-2026/01-09-2026 - CT - CT Bung',
);
assert.equal(sidecarStudyPath('a/b/DICOM/'), 'a/b');
assert.equal(sidecarStudyPath(''), '');

console.log('Study sidecar tests OK');
