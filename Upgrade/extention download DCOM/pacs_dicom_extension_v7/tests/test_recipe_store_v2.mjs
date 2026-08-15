import test from 'node:test';
import assert from 'node:assert/strict';
import { RecipeStoreV2, computeUrlFingerprint } from '../lib/pacs.js';

test('computeUrlFingerprint normalizes UIDs, UUIDs, tokens and query parameters', () => {
  const url1 = 'https://viewer.vnrad.vn:7198/Viewer/s#/view?id=2690b589-8a0a-4fa5-90a8-1d951980414d&foo=123';
  const fp1 = computeUrlFingerprint(url1, 'VradViewer');
  assert.match(fp1, /^https:\/\/viewer\.vnrad\.vn:7198\|\/Viewer\/s\?/i);
  assert.match(fp1, /VRADVIEWER$/);

  const url2 = 'https://pacs.hospital.vn/studies/1.2.840.113619.2.55/series/1.2.840.113619.2.55.1?token=secret123';
  const fp2 = computeUrlFingerprint(url2, 'dicomweb');
  assert.equal(fp2, 'https://pacs.hospital.vn|/studies/*/series/*?token|DICOMWEB');
});

test('RecipeStoreV2 records success and updates EWMA latency and preferred routes', () => {
  const now = 1000000;
  const initial = RecipeStoreV2.createRecipe('fp1', 'dicomweb', now);
  assert.equal(initial.success, 0);
  assert.equal(initial.schemaVersion, 2);

  const updated1 = RecipeStoreV2.updateRecipe(initial, 'dicomweb', {
    status: 'complete',
    preferredRoutes: ['wadors', 'wadouri'],
    latencyMs: 100,
  }, now);

  assert.equal(updated1.success, 1);
  assert.equal(updated1.lastSuccessAt, now);
  assert.deepEqual(updated1.preferredRoutes, ['wadors', 'wadouri']);
  assert.equal(updated1.latencyEwmaMs, 100);

  const updated2 = RecipeStoreV2.updateRecipe(updated1, 'dicomweb', {
    status: 'complete',
    preferredRoutes: ['wadors', 'wadouri'],
    latencyMs: 200,
  }, now + 1000);

  assert.equal(updated2.success, 2);
  // 0.7 * 100 + 0.3 * 200 = 70 + 60 = 130
  assert.equal(updated2.latencyEwmaMs, 130);
});

test('RecipeStoreV2 records partial and failure with error classes', () => {
  const now = 2000000;
  let r = RecipeStoreV2.createRecipe('fp2', 'vrpacs', now);

  r = RecipeStoreV2.updateRecipe(r, 'vrpacs', { status: 'partial' }, now);
  assert.equal(r.partial, 1);

  r = RecipeStoreV2.updateRecipe(r, 'vrpacs', { status: 'failed', errorClass: 'timeout' }, now + 100);
  assert.equal(r.failure, 1);
  assert.equal(r.lastFailureClass, 'timeout');
  assert.equal(r.failureByClass.timeout, 1);
});

test('RecipeStoreV2 purges expired recipes older than 90 days', () => {
  const now = 10000000000;
  const TTL = RecipeStoreV2.TTL_MS; // 90 days in ms

  const recipes = {
    'fresh_recipe': {
      schemaVersion: 2,
      lastSuccessAt: now - 1000,
      updatedAt: now - 1000,
      adapters: {
        'vrad': { lastSuccessAt: now - 1000 }
      }
    },
    'expired_recipe': {
      schemaVersion: 2,
      lastSuccessAt: now - (TTL + 10000),
      updatedAt: now - (TTL + 10000),
      adapters: {
        'vrad': { lastSuccessAt: now - (TTL + 10000) }
      }
    },
    'recipe_with_fresh_adapter': {
      schemaVersion: 2,
      lastSuccessAt: 0,
      updatedAt: now - (TTL + 10000),
      adapters: {
        'dicomweb': { lastSuccessAt: now - 5000 }
      }
    }
  };

  const purged = RecipeStoreV2.purgeExpired(recipes, now);
  assert.ok(purged.fresh_recipe);
  assert.ok(purged.recipe_with_fresh_adapter);
  assert.equal(purged.expired_recipe, undefined);
});

test('RecipeStoreV2 caps max capacity to 200 entries sorted by recent success', () => {
  const now = 1000000;
  const map = {};
  for (let i = 0; i < 250; i++) {
    map[`recipe_${i}`] = {
      schemaVersion: 2,
      lastSuccessAt: now + i * 10,
      updatedAt: now + i * 10,
    };
  }

  const pruned = RecipeStoreV2.pruneCapacity(map, 200);
  assert.equal(Object.keys(pruned).length, 200);
  // Oldest ones (recipe_0 to recipe_49) should be dropped
  assert.equal(pruned.recipe_0, undefined);
  assert.equal(pruned.recipe_49, undefined);
  assert.ok(pruned.recipe_249);
});

test('RecipeStoreV2 provides preferred adapter and preferred routes', () => {
  const r1 = {
    adapter: 'dicomweb',
    success: 5,
    failure: 1,
    preferredRoutes: ['wadors', 'wadouri'],
  };
  assert.equal(RecipeStoreV2.getPreferredAdapter(r1), 'dicomweb');
  assert.deepEqual(RecipeStoreV2.getPreferredRoutes(r1), ['wadors', 'wadouri']);

  const r2 = {
    adapter: 'dicomweb',
    success: 1,
    failure: 5,
  };
  assert.equal(RecipeStoreV2.getPreferredAdapter(r2), null);
});

