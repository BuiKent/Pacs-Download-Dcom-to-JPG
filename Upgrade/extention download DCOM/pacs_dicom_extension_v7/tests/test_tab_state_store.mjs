// Session storage has one quota shared by every tracked tab. What happens when
// a write does not fit decides whether the reader loses some discovered slices
// or the whole tab.
import assert from 'node:assert/strict';
import {
  URL_CAP_LADDER,
  pruneStateForStorage,
  minimalTabState,
  persistTabState,
} from '../lib/tab_state_store.js';

function stateWith(urlCount, entryCount) {
  const state = {
    tabId: 7,
    tracking: 'watching',
    currentUrl: 'https://pacs.example/viewer?study=1.2.3',
    studyHint: '1.2.3',
    confidence: 95,
    headersByOrigin: {'https://pacs.example': {Accept: '*/*'}},
    genericDirectUrls: Array.from({length: urlCount}, (_, i) => `https://pacs.example/i/${i}`),
    genericEntries: Array.from({length: entryCount}, (_, i) => ({
      url: `https://pacs.example/i/${i}`, requestKey: `GET|${i}`, meta: {sopInstanceUid: `1.2.${i}`},
    })),
    _directUrlSet: new Set(['https://pacs.example/i/0']),
  };
  state.pacsRequests = [{
    type: 'PACS_GENERIC_API',
    url: 'https://pacs.example/api/query',
    method: 'POST',
    requestId: 'raw-request',
    requestBody: {kind: 'raw', chunks: ['eyJzdHVkeSI6IjEuMi4zIn0=']},
  }];
  state.learnCandidates = [{
    url: 'https://pacs.example/api/manifest',
    display: 'api/manifest',
    method: 'POST',
    requestId: 'learn-request',
    requestKey: 'POST|manifest|body-signature',
    requestBody: {kind: 'form', data: {study: ['1.2.3']}},
  }];
  return state;
}

// --- The cap actually caps, and the Set never reaches storage --------------
const pruned = pruneStateForStorage(stateWith(9000, 900));
assert.equal(pruned.genericDirectUrls.length, 6000, 'default cap is the top of the ladder');
assert.equal(pruned._directUrlSet, undefined, 'a Set cannot survive storage; it is rebuilt on read');
assert.equal(
  pruned.genericDirectUrls[pruned.genericDirectUrls.length - 1],
  'https://pacs.example/i/8999',
  'trimming must drop the OLDEST urls: the newest are the slices still being found',
);

const small = pruneStateForStorage(stateWith(9000, 900), 300);
assert.equal(small.genericDirectUrls.length, 300);
assert.ok(small.genericEntries.length < pruned.genericEntries.length,
  'entries carry parsed metadata, so they shrink with the url cap');
assert.equal(pruned.pacsRequests[0].requestBody.kind, 'raw',
  'a raw POST body must survive a service-worker restart');
assert.equal(pruned.learnCandidates[0].requestBody.kind, 'form',
  'manual learning must retain the body needed to replay a POST manifest');
assert.equal(pruned.learnCandidates[0].requestKey, 'POST|manifest|body-signature');

// --- The minimal fallback keeps what makes the tab a tracked tab ----------
const minimal = minimalTabState(stateWith(9000, 900));
assert.equal(minimal.tracking, 'watching', 'tracking must survive: without it the tab goes quiet');
assert.equal(minimal.currentUrl, 'https://pacs.example/viewer?study=1.2.3');
assert.equal(minimal.studyHint, '1.2.3');
assert.equal(minimal.truncated, true, 'the state says it is incomplete rather than looking whole');
assert.deepEqual(minimal.genericDirectUrls, []);

// --- The ladder sheds data instead of dropping the key --------------------
// A quota that only accepts small payloads: the real failure mode, since the
// quota is shared and another tab may already be holding most of it.
function quotaLimitedWriter(maxUrls) {
  const written = [];
  return {
    written,
    write: async payload => {
      const value = Object.values(payload)[0];
      if ((value.genericDirectUrls || []).length > maxUrls) {
        throw new Error('QUOTA_BYTES quota exceeded');
      }
      written.push(value);
    },
  };
}

const roomy = quotaLimitedWriter(10000);
assert.equal(await persistTabState(roomy.write, 'pacs6_tab_7', stateWith(9000, 900)), 6000);
assert.equal(roomy.written.length, 1, 'a write that fits happens once');

const tight = quotaLimitedWriter(1000);
const capUsed = await persistTabState(tight.write, 'pacs6_tab_7', stateWith(9000, 900));
assert.equal(capUsed, 1000, 'it steps down the ladder until the payload fits');
assert.equal(tight.written.length, 1, 'only the write that succeeded lands');
assert.equal(tight.written[0].tracking, 'watching');
assert.equal(tight.written[0].genericDirectUrls.length, 1000);
assert.equal(tight.written[0].truncated, true,
  'a smaller quota cap must not masquerade as a complete discovery result');

const complete = quotaLimitedWriter(10000);
await persistTabState(complete.write, 'pacs6_tab_7', stateWith(100, 100));
assert.notEqual(complete.written[0].truncated, true,
  'a state that fits without shedding data remains complete');

// The regression this file exists for: the old code called
// `storage.session.remove(key)` on any failure, so a tab a little over quota
// lost its tracking state entirely and went silent.
const starved = quotaLimitedWriter(0);
const result = await persistTabState(starved.write, 'pacs6_tab_7', stateWith(9000, 900));
assert.equal(result, 0, 'when no cap fits it falls back to the minimal state');
assert.equal(starved.written.length, 1);
assert.equal(starved.written[0].tracking, 'watching',
  'even starved of room the tab stays tracked; it must never be deleted');

// Nothing writable at all still resolves rather than throwing into a timer.
const broken = {write: async () => { throw new Error('storage unavailable'); }};
assert.equal(await persistTabState(broken.write, 'pacs6_tab_7', stateWith(10, 1)), -1);

assert.deepEqual(URL_CAP_LADDER, [...URL_CAP_LADDER].sort((a, b) => b - a),
  'the ladder must run largest first, or the first write always wins with the least data');

console.log('Tab state storage tests OK');
