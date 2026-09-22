import assert from 'node:assert/strict';
import test from 'node:test';
import { Mach7Adapter } from '../lib/adapters/mach7.js';
import { DicomwebAdapter } from '../lib/adapters/dicomweb.js';

const context = (state = {}, url = 'https://pacs.test/ClinicalStudio/Procedures/ProcedureComposite?ID=procedure-a') => ({
  state,
  summary: { currentUrl: url, requests: [] },
  normalizeStudy: value => value,
  headersForUrl: () => ({})
});

test('Mach7 leaves missing modality empty for both DOM and captured series', async () => {
  const inv = await Mach7Adapter.analyze(context({
    domSeries: [{ number: '1', imageCount: 20 }, { number: '2', imageCount: 30 }],
    genericEntries: [{ url: 'https://pacs.test/image/1', meta: { seriesNumber: '1', seriesUid: '1.2.3.1' } }]
  }));
  assert.deepEqual(inv.series.map(series => series.modality), ['', '']);
});

test('Mach7 preserves explicit series modality before the study fallback', async () => {
  const inv = await Mach7Adapter.analyze(context({
    domPatient: { modality: 'CT' },
    domSeries: [{ number: '1', modality: 'PT', imageCount: 2 }, { number: '2', imageCount: 3 }]
  }));
  assert.deepEqual(inv.series.map(series => series.modality), ['PT', 'CT']);
});

test('Mach7 retains advertised counts separately from captured download readiness', async () => {
  const ctx = context({
    domSeries: [{ number: '1', imageCount: 20 }, { number: '2', imageCount: 30 }],
    genericEntries: [{ url: 'https://pacs.test/image/1', meta: { seriesNumber: '1', seriesUid: '1.2.3.1' } }]
  });
  const inv = await Mach7Adapter.analyze(ctx);
  assert.deepEqual(inv.series.map(({ imageCount, capturedImageCount, downloadReady, captureComplete }) =>
    ({ imageCount, capturedImageCount, downloadReady, captureComplete })), [
    { imageCount: 20, capturedImageCount: 1, downloadReady: true, captureComplete: false },
    { imageCount: 30, capturedImageCount: 0, downloadReady: false, captureComplete: false }
  ]);
  assert.equal((await Mach7Adapter.enumerate(inv, [inv.series[0].id], ctx)).length, 1);
  assert.equal((await Mach7Adapter.enumerate(inv, [inv.series[1].id], ctx)).length, 0);
});

test('Mach7 identity is stable without a date and never invents a DICOM Study UID', async () => {
  const ctx = context({ domPatient: { patientId: 'TEST-PATIENT' } });
  const inv = await Mach7Adapter.analyze(ctx);
  const later = await Mach7Adapter.analyze(ctx);
  assert.equal(inv.studyUid, '');
  assert.match(inv.context.studyKey, /^mach7:[a-f0-9]{64}$/);
  assert.equal(later.context.studyKey, inv.context.studyKey);
  assert.ok(!inv.context.studyKey.includes('procedure-a'));
});

test('Mach7 identity separates procedures and origins but ignores changing session tokens', async () => {
  const analyze = url => Mach7Adapter.analyze(context({}, url));
  const a = await analyze('https://pacs.test/ClinicalStudio/Procedures/ProcedureComposite?ID=A&session=old');
  const same = await analyze('https://pacs.test/ClinicalStudio/Procedures/ProcedureComposite?session=new&ID=A');
  const other = await analyze('https://pacs.test/ClinicalStudio/Procedures/ProcedureComposite?ID=B');
  const otherSite = await analyze('https://another.test/ClinicalStudio/Procedures/ProcedureComposite?ID=A');
  assert.equal(a.context.studyKey, same.context.studyKey);
  assert.notEqual(a.context.studyKey, other.context.studyKey);
  assert.notEqual(a.context.studyKey, otherSite.context.studyKey);
});

test('Mach7 cannot infer a study identity from patient and date alone', async () => {
  const inv = await Mach7Adapter.analyze(context({ domPatient: {
    patientId: 'TEST-PATIENT', studyDate: '20260101'
  } }, 'https://pacs.test/ClinicalStudio/Viewer'));
  assert.equal(inv.studyUid, '');
  assert.equal(inv.context.studyKey, '');
});

test('Mach7 preserves real Study UID and does not send a synthetic UID in download tasks', async () => {
  const ctx = context({ genericEntries: [{
    url: 'https://pacs.test/image/1', meta: { studyUid: '1.2.3', seriesUid: '1.2.3.1', sopInstanceUid: '1.2.3.1.1' }
  }] });
  const inv = await Mach7Adapter.analyze(ctx);
  assert.equal(inv.studyUid, '1.2.3');
  assert.equal((await Mach7Adapter.enumerate(inv, [inv.series[0].id], ctx))[0].studyUid, '1.2.3');
  const unknownCtx = context({ genericEntries: [{ url: 'https://pacs.test/image/1' }] });
  const unknown = await Mach7Adapter.analyze(unknownCtx);
  assert.equal((await Mach7Adapter.enumerate(unknown, [unknown.series[0].id], unknownCtx))[0].studyUid, '');
});

test('DICOMweb MedDream structure leaves missing modality empty', async () => {
  const url = 'https://pacs.test/studies/1.2.3/structure';
  const inv = await DicomwebAdapter.analyze({
    state: {}, summary: { requests: [{ type: 'MEDDREAM_STRUCTURE', url, score: 105 }] },
    normalizeStudy: value => value, inheritQuery: target => target,
    fetchJson: async () => ({ study: { patient: { id: 'TEST-PATIENT' }, series: [
      { uid: '1.2.3.1', instances: [{ uid: '1.2.3.1.1' }] }
    ] } })
  });
  assert.equal(inv.series[0].modality, '');
});
