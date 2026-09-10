// What `content.js` reads off a viewer page decides the series the reader gets
// offered and the folder the study is filed under, yet nothing exercised it.
// Two regressions shipped through that gap and both are pinned here:
//   * a greedy `{0,5}` quantifier that let one series swallow the next one's
//     image count and drop that series from the list;
//   * a body-text window that silently shrank to 18k, putting the patient
//     banner of a long viewer page out of reach.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../content.js', import.meta.url), 'utf8');

// Digit-free filler: anything numeric here could be picked up by the identity
// regexes and would make the test pass for the wrong reason.
const FILLER_LINE = 'Danh sach lat cat trong loat anh dang mo\n';
const SERIES_BLOCK = 'Se: 3\nW/L: 400/40\n12 / 220\nSe: 4\n8 / 96\n';
const PATIENT_BLOCK = 'NGUYEN VAN AN\n26100659 F 014Y\n07/02/2026 14:34\n';

const filler = FILLER_LINE.repeat(Math.ceil(19000 / FILLER_LINE.length));
const BODY_TEXT = `${SERIES_BLOCK}${filler}${PATIENT_BLOCK}`;
const patientOffset = BODY_TEXT.indexOf(PATIENT_BLOCK);

// The test is only meaningful while the banner sits past the old 18k cut and
// inside the 100k window the extractor is supposed to read.
assert.ok(
  patientOffset > 18000 && patientOffset < 99000,
  `patient banner must sit between 18k and 99k to exercise the window, got ${patientOffset}`,
);

let bodyTextReads = 0;

function runReport() {
  const hints = [];
  bodyTextReads = 0;
  const body = {
    get textContent() {
      bodyTextReads += 1;
      return BODY_TEXT;
    },
  };
  const context = {
    console,
    URL,
    location: {href: 'https://pacs.example/viewer?study=1.2.3', hostname: 'pacs.example', port: ''},
    document: {
      title: 'DICOM Viewer',
      readyState: 'complete',
      documentElement: {},
      body,
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    chrome: {
      runtime: {
        id: 'test-extension',
        sendMessage: async message => {
          if (message?.type === 'PAGE_HINTS') hints.push(message.hint);
          return {};
        },
        onMessage: {addListener: () => {}},
      },
    },
    MutationObserver: class { observe() {} disconnect() {} },
    // Fire synchronously so the debounced `report()` runs inside this call.
    setTimeout: fn => { if (typeof fn === 'function') fn(); return 1; },
    clearTimeout: () => {},
    setInterval: () => 1,
    clearInterval: () => {},
  };
  context.window = context;
  context.addEventListener = () => {};
  context.postMessage = () => {};
  vm.createContext(context);
  vm.runInContext(source, context, {filename: 'content.js'});
  assert.ok(hints.length >= 1, 'content script must report page hints');
  return hints[hints.length - 1];
}

const hint = runReport();

// --- Series: each "Se:" keeps its own image count -------------------------
const series = hint.domSeries || [];
const counts = new Map(series.map(s => [String(s.number), Number(s.imageCount)]));

assert.equal(series.length, 2, `both series must survive, got ${JSON.stringify(series)}`);
assert.equal(counts.get('3'), 220, 'series 3 must keep its own image count');
assert.equal(counts.get('4'), 96, 'series 4 must keep its own image count');

// --- Patient identity beyond the old 18k cut ------------------------------
const patient = hint.domPatient || {};
assert.equal(patient.patientId, '26100659', 'patient id must be read past the 18k mark');
assert.equal(patient.patientName, 'NGUYEN VAN AN', 'patient name must be read past the 18k mark');

// --- One body serialisation per report ------------------------------------
// `textContent` walks the entire DOM. Reading it once and sharing the result is
// the 7.0.4/7.1.1 optimisation; a future edit that re-reads it per extractor
// would quietly restore the freeze this guards against.
assert.equal(bodyTextReads, 1, `body text must be serialised once per report, was ${bodyTextReads}`);

console.log('Content DOM extraction tests OK');
