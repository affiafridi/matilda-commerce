import assert from 'node:assert/strict';
import { test } from 'node:test';
import { safeNext } from './safe-next.ts';

test('keeps same-origin paths', () => {
  assert.equal(safeNext('/account/security'), '/account/security');
  assert.equal(safeNext('/employees?status=active#x'), '/employees?status=active#x');
});

test('rejects external, protocol-relative and malformed targets', () => {
  for (const bad of [
    'https://evil.test',
    '//evil.test',
    '/' + String.fromCharCode(92) + 'evil.test',
    'javascript:alert(1)',
    'employees',
    '/a' + String.fromCharCode(10) + 'b',
    '',
    null,
    undefined,
  ]) {
    assert.equal(safeNext(bad), '/');
  }
  assert.equal(safeNext('/x'.repeat(400)), '/');
});

test('never redirects back into the sign-in screens', () => {
  assert.equal(safeNext('/sign-in'), '/');
  assert.equal(safeNext('/sign-in/verify?x=1'), '/');
  assert.equal(safeNext('/sign-in', '/home'), '/home');
});
