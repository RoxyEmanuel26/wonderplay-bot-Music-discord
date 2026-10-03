import assert from 'node:assert/strict';
import test from 'node:test';
import { paginateQueue } from './queuePagination';

test('all tracks in a long queue are reachable in order', () => {
  const tracks = Array.from({ length: 198 }, (_, index) => index + 1);
  const pages = Array.from({ length: 20 }, (_, page) => paginateQueue(tracks, page));

  assert.deepEqual(pages.flatMap((result) => result.items), tracks);
  assert.equal(pages[0].hasPrevious, false);
  assert.equal(pages[19].hasNext, false);
  assert.equal(pages[19].items.at(-1), 198);
});

test('page is clamped when the queue shrinks or becomes empty', () => {
  const last = paginateQueue([1, 2, 3], 9);
  assert.equal(last.page, 0);
  assert.deepEqual(last.items, [1, 2, 3]);

  const empty = paginateQueue([], 9);
  assert.equal(empty.page, 0);
  assert.equal(empty.totalPages, 1);
  assert.deepEqual(empty.items, []);
  assert.equal(empty.hasNext, false);
});
