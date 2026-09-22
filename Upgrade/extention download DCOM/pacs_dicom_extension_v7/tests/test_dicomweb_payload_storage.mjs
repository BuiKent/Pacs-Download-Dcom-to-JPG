import assert from 'node:assert/strict';
import test from 'node:test';
import {pruneStateForStorage, persistTabState} from '../lib/tab_state_store.js';
import {cacheDicomwebPayload, getDicomwebPayload, boundDicomwebPayloads} from '../lib/dicomweb_payloads.js';

const bytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8');
function capturedState() {
  const dicomwebPayloads = {};
  for (let series = 0; series < 6; series++) {
    const url = `https://pacs.example/studies/1.2/series/1.2.${series}/metadata`;
    const payload = Array.from({length: 4000}, (_, instance) => ({
      '00080018': {vr: 'UI', Value: [`1.2.${series}.${instance}`]},
      '0020000E': {vr: 'UI', Value: [`1.2.${series}`]},
      '0008103E': {vr: 'LO', Value: ['Synthetic series description'.repeat(3)]},
    }));
    dicomwebPayloads[url] = payload;
    dicomwebPayloads[new URL(url).pathname] = payload;
  }
  const urls = Array.from({length: 4000}, (_, i) => `https://pacs.example/instances/${i}`);
  return {
    tabId: 7, tracking: 'watching', currentUrl: 'https://pacs.example/viewer',
    genericDirectUrls: urls, genericEntries: urls.map(url => ({url, method: 'GET'})),
    dicomwebPayloads,
  };
}

test('captured metadata cannot bypass the cumulative storage budget', () => {
  const state = capturedState();
  const pruned = pruneStateForStorage(state);
  assert.ok(bytes(pruned.dicomwebPayloads) <= 2 * 1024 * 1024,
    'all cached metadata together must fit within 2 MiB');
  assert.equal(pruned.genericDirectUrls.length, 4000);
  assert.equal(pruned.genericEntries.length, 4000);
  assert.equal(Object.keys(state.dicomwebPayloads).length, 12, 'pruning must not mutate live state');
  for (const [url, payload] of Object.entries(pruned.dicomwebPayloads)) {
    assert.ok(url.startsWith('https://'), 'legacy pathname aliases must not duplicate full URL data');
    assert.equal(payload.length, 4000, 'retain an entire response or evict it; never forge a complete slice list');
  }
});

test('quota fallback sheds cached metadata before sacrificing discovered DICOM URLs', async () => {
  const state = capturedState();
  const withoutMetadata = {...pruneStateForStorage(state), dicomwebPayloads: {}};
  const budget = bytes(withoutMetadata) + 100;
  let stored;
  const cap = await persistTabState(async payload => {
    if (bytes(Object.values(payload)[0]) > budget) throw new Error('QUOTA_BYTES exceeded');
    stored = Object.values(payload)[0];
  }, 'pacs6_tab_7', state);
  assert.equal(cap, 6000, 'metadata must be evicted before the URL cap decreases');
  assert.equal(stored.genericDirectUrls.length, 4000);
  assert.equal(stored.genericEntries.length, 4000);
  assert.equal(stored.tracking, 'watching');
  assert.deepEqual(stored.dicomwebPayloads, {});
});

test('capture cache is bounded in memory and never truncates response arrays',()=>{
  let payloads={};
  for(let i=0;i<50;i++){
    const result=cacheDicomwebPayload(payloads,`https://pacs.test/series/${i}`,Array(20).fill({value:'synthetic'}),{maxEntries:3,maxBytes:4096});
    payloads=result.payloads;
    assert.ok(Object.keys(payloads).length<=3);
    assert.ok(bytes(payloads)<=4096);
    assert.ok(Object.values(payloads).every(array=>array.length===20));
  }
  assert.ok(Object.hasOwn(payloads,'https://pacs.test/series/49'));
  const dropped=cacheDicomwebPayload(payloads,'https://pacs.test/too-large',[{value:'x'.repeat(5000)}],{maxBytes:4096});
  assert.equal(dropped.truncated,true);
  assert.ok(!Object.hasOwn(dropped.payloads,'https://pacs.test/too-large'));
});

test('cached fallback accepts token rotation but not a different page, query or origin',()=>{
  const payload=[{uid:'1.2.3'}];
  const cache={'https://pacs.test/series?offset=0&token=old':payload};
  assert.equal(getDicomwebPayload(cache,'https://pacs.test/series?token=new&offset=0'),payload);
  assert.equal(getDicomwebPayload(cache,'https://pacs.test/series?offset=20&token=new'),null);
  assert.equal(getDicomwebPayload(cache,'https://pacs.test/series?study=other'),null);
  assert.equal(getDicomwebPayload(cache,'https://another.test/series?offset=0'),null);
  assert.equal(getDicomwebPayload({...cache,'https://pacs.test/series?offset=0&token=second':[{}]},'https://pacs.test/series?offset=0&token=new'),null);
  assert.equal(getDicomwebPayload({'/series':payload},'https://pacs.test/series'),payload);
  assert.equal(Object.keys(boundDicomwebPayloads({...cache,'/series':payload}).payloads).length,1);
});
