// The webRequest gate decides which traffic the extension is even allowed to
// see. Getting it wrong in the safe direction costs speed; getting it wrong in
// the other direction loses a study with nothing on screen to say so.
import assert from 'node:assert/strict';
import {
  TRACKED_TABS_KEY,
  stateIsTracked,
  shouldInspectRequest,
  serializeTrackedTabs,
  deserializeTrackedTabs,
  mergeRestoredTabs,
} from '../lib/tracked_tabs.js';

assert.equal(TRACKED_TABS_KEY, 'pacs6_tracked_tabs');

// --- Which tab states still need their requests read ----------------------
assert.equal(stateIsTracked({tracking: 'watching'}), true);
assert.equal(stateIsTracked({tracking: 'candidate'}), true);
assert.equal(stateIsTracked({tracking: 'idle', learning: {active: true}}), true,
  'a learning session records requests the URL patterns do not recognise');
assert.equal(stateIsTracked({tracking: 'stopped'}), false);
assert.equal(stateIsTracked({tracking: 'completed'}), false);
assert.equal(stateIsTracked({tracking: 'idle'}), false);
assert.equal(stateIsTracked(null), false);

// --- The gate itself -------------------------------------------------------
const tracked = new Set([7]);

assert.equal(
  shouldInspectRequest({restored: true, tracked, tabId: 7, recognised: false}), true,
  'a tracked tab is inspected',
);
assert.equal(
  shouldInspectRequest({restored: true, tracked, tabId: 99, recognised: false}), false,
  'an unrelated tab is skipped once the set is known — this is the whole saving',
);
assert.equal(
  shouldInspectRequest({restored: true, tracked, tabId: 99, recognised: true}), true,
  'a recognised PACS url is inspected whatever tab it came from',
);

// The regression this file exists for. MV3 tears the worker down after ~30s
// idle and revives it with an empty set, so a closed gate would silently drop
// generic-discovery traffic on a tab that IS being tracked.
assert.equal(
  shouldInspectRequest({restored: false, tracked: new Set(), tabId: 7, recognised: false}), true,
  'before the set is restored the gate must fail open, not closed',
);
assert.equal(
  shouldInspectRequest({restored: true, tracked: new Set(), tabId: 7, recognised: false}), false,
  'once restored, an empty set really does mean nothing is tracked',
);

// --- Restoring must not undo a decision made while it was in flight -------
// Reading the mirrored ids back is asynchronous, so an event can land first.
// The case that matters: the reader presses "Stop tracking" the moment the
// worker wakes, and storage still holds the value from before they pressed it.
{
  const live = new Set();
  const decided = new Set();

  // stopTracking(5) arrives before the storage read resolves.
  decided.add(5);
  live.delete(5);

  mergeRestoredTabs(live, deserializeTrackedTabs([5, 9]), decided);

  assert.equal(live.has(5), false, 'a tab just stopped must not be restored as tracked');
  assert.equal(live.has(9), true, 'a tab nobody has ruled on is restored normally');
}

{
  // The ordinary case: nothing decided yet, everything comes back.
  const live = new Set();
  mergeRestoredTabs(live, deserializeTrackedTabs([1, 2]), new Set());
  assert.deepEqual([...live].sort((a, b) => a - b), [1, 2]);
}

{
  // A tab started this session and also present in storage stays tracked once.
  const live = new Set([4]);
  mergeRestoredTabs(live, deserializeTrackedTabs([4]), new Set([4]));
  assert.deepEqual([...live], [4]);
}

// --- Round trip through session storage -----------------------------------
const restored = deserializeTrackedTabs(serializeTrackedTabs(new Set([3, 11, 3])));
assert.deepEqual([...restored].sort((a, b) => a - b), [3, 11]);

assert.deepEqual(serializeTrackedTabs(new Set([1, NaN, -2, 'x', 4])), [1, 4],
  'only real tab ids survive: storage round trips through JSON');
assert.deepEqual([...deserializeTrackedTabs(null)], [], 'a missing key restores an empty set');
assert.deepEqual([...deserializeTrackedTabs('nonsense')], [], 'a corrupted key restores an empty set');

console.log('Tracked tab gate tests OK');
