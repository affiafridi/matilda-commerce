import assert from 'node:assert/strict';
import { test } from 'node:test';
import { type NavGroup, NAV, visibleNav } from './nav.ts';

const sample: NavGroup[] = [
  {
    id: 'g',
    label: 'G',
    items: [
      { id: 'a', label: 'A', href: '/a', icon: 'brands', permission: 'brands.view', built: true },
      { id: 'b', label: 'B', href: '/b', icon: 'roles', permission: 'roles.view', built: true },
      { id: 'c', label: 'C', href: '/c', icon: 'audit', permission: 'audit.view', built: false },
      { id: 'd', label: 'D', href: '/d', icon: 'home', built: true },
    ],
  },
  {
    id: 'empty',
    label: 'E',
    items: [{ id: 'x', label: 'X', href: '/x', icon: 'home', permission: 'x.view', built: true }],
  },
];

test('shows only built items the person holds, and drops empty groups', () => {
  const nav = visibleNav(new Set(['brands.view', 'audit.view']), sample);
  assert.deepEqual(
    nav.map((g) => g.id),
    ['g'],
  );
  assert.deepEqual(
    nav[0]?.items.map((i) => i.id),
    ['a', 'd'],
  ); // c is unbuilt, b not held
});

test('a person with no permissions still gets the ungated items', () => {
  const nav = visibleNav(new Set(), sample);
  assert.deepEqual(
    nav.flatMap((g) => g.items.map((i) => i.id)),
    ['d'],
  );
});

test('the real catalog only references permissions that exist as view keys', () => {
  for (const item of NAV.flatMap((g) => g.items)) {
    if (item.permission) assert.match(item.permission, /^[a-z]+\.(view|manage)$/);
  }
});
