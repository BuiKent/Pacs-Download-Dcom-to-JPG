import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchQidoPaged, withQueryParams } from '../lib/pacs.js';

const instance = sop => ({ '00080018': { vr: 'UI', Value: [sop] } });
const sopOf = row => String(row?.['00080018']?.Value?.[0] || '');
const offsetOf = url => new URL(url).searchParams.get('offset');

test('QIDO paging reads past a server-side result cap', async () => {
  // Server chặn 100 dòng bất kể `limit` client xin — dừng ở trang ngắn là cụt ảnh.
  const total = Array.from({ length: 350 }, (_, i) => instance(`1.2.3.${i + 1}`));
  const urls = [];
  const fetchJson = async url => {
    urls.push(url);
    const offset = Number(new URL(url).searchParams.get('offset'));
    return total.slice(offset, offset + 100);
  };

  const rows = await fetchQidoPaged(fetchJson, 'https://pacs.test/rs/instances', { keyOf: sopOf });
  assert.equal(rows.length, 350);
  // 100+100+100+50 rồi một lượt rỗng để biết đã hết.
  assert.deepEqual(urls.map(offsetOf), ['0', '100', '200', '300', '350']);
});

test('QIDO paging stops when the server ignores offset', async () => {
  const page = Array.from({ length: 30 }, (_, i) => instance(`1.2.3.${i + 1}`));
  let calls = 0;
  const rows = await fetchQidoPaged(async () => { calls++; return page; },
    'https://pacs.test/rs/instances', { keyOf: sopOf });
  assert.equal(rows.length, 30);
  assert.equal(calls, 2);
});

test('QIDO paging keeps session query params and accepts a lone object', async () => {
  const seen = [];
  await fetchQidoPaged(async url => { seen.push(url); return []; },
    'https://pacs.test/rs/instances?StudyInstanceUID=1.2.3&token=abc');
  const q = new URL(seen[0]).searchParams;
  assert.equal(q.get('StudyInstanceUID'), '1.2.3');
  assert.equal(q.get('token'), 'abc');
  assert.ok(q.get('limit'));

  const replies = [instance('1.2.3.9'), []];
  const rows = await fetchQidoPaged(async () => replies.shift(),
    'https://pacs.test/rs/instances', { keyOf: sopOf });
  assert.deepEqual(rows.map(sopOf), ['1.2.3.9']);
});

test('withQueryParams overrides only the named params', () => {
  const out = withQueryParams('https://pacs.test/rs/instances?token=abc&limit=5', { limit: 500, offset: 0 });
  const q = new URL(out).searchParams;
  assert.equal(q.get('token'), 'abc');
  assert.equal(q.get('limit'), '500');
  assert.equal(q.get('offset'), '0');
  // URL hỏng thì trả nguyên bản, không ném lỗi làm sập cả lượt quét.
  assert.equal(withQueryParams('khong-phai-url', { limit: 1 }), 'khong-phai-url');
});
