import assert from 'node:assert/strict';
import {
  shouldPreserveTerminalContext,
  trackingAfterDocumentChange,
  trackingAfterSameDocumentStudyChange,
} from '../lib/tracking_state.js';

assert.equal(
  shouldPreserveTerminalContext('completed', {
    oldStudy: '',
    nextStudy: '',
    transitionType: 'reload',
  }),
  true,
  'reload must preserve the completed inventory as well as the state',
);
assert.equal(
  shouldPreserveTerminalContext('completed', {
    oldStudy: 'study-a',
    nextStudy: 'study-b',
    transitionType: 'link',
  }),
  false,
  'a new study must invalidate the old inventory',
);

assert.equal(
  trackingAfterDocumentChange('completed', {
    oldStudy: 'study-a',
    nextStudy: 'study-a',
    transitionType: 'reload',
  }),
  'completed',
  'completed state must survive a reload of the same study',
);
assert.equal(
  trackingAfterDocumentChange('completed', {
    oldStudy: '',
    nextStudy: '',
    transitionType: 'reload',
  }),
  'completed',
  'token-only viewer reload must not restart completed tracking',
);
assert.equal(
  trackingAfterDocumentChange('completed', {
    oldStudy: 'study-a',
    nextStudy: 'study-b',
    transitionType: 'link',
  }),
  'idle',
  'a different full-page study must be eligible for tracking',
);
assert.equal(
  trackingAfterSameDocumentStudyChange('completed'),
  'idle',
  'a different SPA study must be eligible for tracking',
);
assert.equal(
  trackingAfterDocumentChange('stopped', {
    oldStudy: 'study-a',
    nextStudy: 'study-b',
    transitionType: 'link',
  }),
  'stopped',
  'an explicit manual stop must remain sticky',
);

console.log('Tracking state tests OK');
