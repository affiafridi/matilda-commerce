import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EMPTY_SCOPE,
  type ScopeOptions,
  normalizeScope,
  scopeChoices,
  withBrand,
  withMarket,
} from './scope.ts';

const options = (platformWide: boolean, brandIds = ['b1', 'b2']): ScopeOptions => ({
  platformWide,
  brands: brandIds.map((id) => ({ id, name: id })),
  markets: [
    { id: 'm1', brandId: 'b1', code: 'uae' },
    { id: 'm2', brandId: 'b2', code: 'uae' },
  ],
  branches: [
    { id: 'x1', name: 'Dubai', marketIds: ['m1'] },
    { id: 'x2', name: 'Abu Dhabi', marketIds: ['m1', 'm2'] },
  ],
});

test('only platform-wide people may pick "all brands"', () => {
  assert.equal(scopeChoices(options(true), EMPTY_SCOPE).allowAllBrands, true);
  assert.equal(scopeChoices(options(false), EMPTY_SCOPE).allowAllBrands, false);
});

test('markets and branches follow the parent selection', () => {
  const choices = scopeChoices(options(true), { brandId: 'b2', marketId: null, branchId: null });
  assert.deepEqual(
    choices.markets.map((m) => m.id),
    ['m2'],
  );
  assert.deepEqual(
    choices.branches.map((b) => b.id),
    ['x2'],
  );
});

test('a person with one brand, market and branch is locked to it', () => {
  const single: ScopeOptions = {
    platformWide: false,
    brands: [{ id: 'b1', name: 'b1' }],
    markets: [{ id: 'm1', brandId: 'b1', code: 'uae' }],
    branches: [{ id: 'x1', name: 'Dubai', marketIds: ['m1'] }],
  };
  assert.deepEqual(normalizeScope(single, EMPTY_SCOPE), {
    brandId: 'b1',
    marketId: 'm1',
    branchId: 'x1',
  });
  const choices = scopeChoices(single, { brandId: 'b1', marketId: 'm1', branchId: 'x1' });
  assert.deepEqual(
    [choices.brandLocked, choices.marketLocked, choices.branchLocked],
    [true, true, true],
  );
});

test('a stored selection outside what the person may use is discarded', () => {
  const scope = normalizeScope(options(false, ['b1']), {
    brandId: 'b2',
    marketId: 'm2',
    branchId: 'x2',
  });
  assert.equal(scope.brandId, 'b1');
  assert.notEqual(scope.marketId, 'm2');
  const platform = normalizeScope(options(true), {
    brandId: 'zzz',
    marketId: null,
    branchId: null,
  });
  assert.equal(platform.brandId, null);
});

test('changing a level resets the levels below it', () => {
  const full = { brandId: 'b1', marketId: 'm1', branchId: 'x1' };
  assert.deepEqual(withBrand(full, 'b2'), { brandId: 'b2', marketId: null, branchId: null });
  assert.deepEqual(withMarket(full, 'm1'), { brandId: 'b1', marketId: 'm1', branchId: null });
});
