import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_API_URL, getApiBaseUrl } from './api.ts';

test('falls back to the local API URL', () => {
  assert.equal(getApiBaseUrl({}), DEFAULT_API_URL);
});

test('uses and normalizes the configured URL', () => {
  assert.equal(
    getApiBaseUrl({ NEXT_PUBLIC_API_URL: ' https://api.example.test/api/v1/ ' }),
    'https://api.example.test/api/v1',
  );
});
