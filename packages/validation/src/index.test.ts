import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paginationQuerySchema } from './index.ts';

test('pagination applies defaults', () => {
  assert.deepEqual(paginationQuerySchema.parse({}), { page: 1, pageSize: 20 });
});

test('pagination rejects oversized pages', () => {
  assert.throws(() => paginationQuerySchema.parse({ pageSize: 1000 }));
});
