// What survives a service worker restart decides how much of a study the
// download actually asks for. MV3 tears the worker down every thirty idle
// seconds, so "restored from session storage" is the normal path, not an edge
// case — and a study that comes back smaller than it went in loses slices with
// nothing on screen to say so.
import assert from 'node:assert/strict';
import {pruneStateForStorage, URL_CAP_LADDER} from '../lib/tab_state_store.js';
import {mergeDiscoveredEntries} from '../lib/generic_discovery.js';
import {GenericAdapter} from '../lib/adapters/generic.js';
import {Mach7Adapter} from '../lib/adapters/mach7.js';

function discoveredState(count) {
  return {
    genericDirectUrls: Array.from({length: count}, (_, i) => `https://pacs.example/i/${i}`),
    genericEntries: Array.from({length: count}, (_, i) => ({
      url: `https://pacs.example/i/${i}`,
      method: i % 2 ? 'POST' : 'GET',
      requestKey: `k${i}`,
      requestBody: i % 2 ? {kind: 'raw', chunks: ['AAA']} : null,
      meta: {patientId: 'BN001', patientName: 'NGUYEN VAN AN'},
    })),
    genericProfile: {},
  };
}

// --- Persisting must not shrink the study --------------------------------
{
  const state = discoveredState(6000);
  const stored = pruneStateForStorage(state);

  assert.equal(stored.genericDirectUrls.length, 6000);
  assert.equal(
    stored.genericEntries.length, 6000,
    'entries trimmed below the urls silently shrink the download, not the state',
  );
  assert.equal(
    stored.genericEntries.filter(e => e.requestBody).length, 3000,
    'a PACS that serves DICOM over POST cannot be replayed without its body',
  );
  assert.ok(
    stored.genericEntries.some(e => e.meta),
    'some parsed headers survive, or the patient banner has nothing to read',
  );
  assert.ok(
    stored.genericEntries.filter(e => e.meta).length < 100,
    'but not one per image: that is what made the state too big to store',
  );
}

// A smaller cap trims both lists together, never one before the other.
for (const cap of URL_CAP_LADDER) {
  const stored = pruneStateForStorage(discoveredState(6000), cap);
  assert.equal(stored.genericDirectUrls.length, cap, `urls at cap ${cap}`);
  assert.equal(stored.genericEntries.length, cap, `entries at cap ${cap}`);
}

// --- Enumeration reads both lists ----------------------------------------
{
  // The failure this guards: entries trimmed, urls intact. Preferring entries
  // and ignoring urls turned a 6000 image study into a 500 image one.
  const state = discoveredState(6000);
  const lopsided = {
    genericDirectUrls: state.genericDirectUrls,
    genericEntries: state.genericEntries.slice(-500),
    genericProfile: {},
  };

  assert.equal(mergeDiscoveredEntries(lopsided).length, 6000);

  for (const [name, adapter] of [['GENERIC', GenericAdapter], ['MACH7', Mach7Adapter]]) {
    const inventory = await adapter.analyze({state: lopsided, normalizeStudy: x => x});
    const enumerated = inventory.context.groups.reduce((n, g) => n + g.entries.length, 0);
    assert.equal(enumerated, 6000, `${name} must enumerate every discovered image`);
  }
}

{
  // Entries win where they overlap: they know the method and body.
  const merged = mergeDiscoveredEntries({
    genericEntries: [{url: 'https://p/a', method: 'POST', requestBody: {kind: 'raw', chunks: ['x']}}],
    genericDirectUrls: ['https://p/a', 'https://p/b'],
  });

  assert.equal(merged.length, 2);
  const a = merged.find(e => e.url === 'https://p/a');
  const b = merged.find(e => e.url === 'https://p/b');
  assert.equal(a.method, 'POST', 'the richer record wins');
  assert.ok(a.requestBody);
  assert.equal(b.method, 'GET', 'a url with no entry is what it always was: a GET');
}

assert.deepEqual(mergeDiscoveredEntries({}), []);
assert.deepEqual(mergeDiscoveredEntries(null), []);

console.log('Discovery integrity tests OK');
