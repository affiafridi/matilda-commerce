import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  dayHoursSchema,
  localDateSchema,
  localTimeSchema,
  minutesOfDay,
  timeRangeSchema,
  timeRangesOverlap,
  weekdayOfLocalDate,
} from './delivery.ts';
import {
  STOCK_MOVEMENT_TYPES,
  availableQuantity,
  canTransition,
  movementDirection,
  publicStockState,
  quantitySchema,
} from './inventory.ts';

test('every ledger movement has a direction and stock never reads below zero', () => {
  for (const t of STOCK_MOVEMENT_TYPES) assert.ok([1, -1].includes(movementDirection(t)), t);
  assert.equal(movementDirection('RECEIPT'), 1);
  assert.equal(movementDirection('TRANSFER_OUT'), -1);
  assert.equal(availableQuantity(10, 3), 7);
  assert.equal(availableQuantity(2, 5), 0);
});

test('quantities are whole positive units', () => {
  assert.equal(quantitySchema.safeParse(1).success, true);
  for (const bad of [0, -1, 1.5, 1_000_001])
    assert.equal(quantitySchema.safeParse(bad).success, false);
});

test('shoppers see a state, not a number, and backorder keeps a product available', () => {
  assert.equal(publicStockState(20, 5), 'AVAILABLE');
  assert.equal(publicStockState(5, 5), 'LOW');
  assert.equal(publicStockState(0, 5), 'UNAVAILABLE');
  assert.equal(publicStockState(0, 5, true), 'AVAILABLE');
});

test('transfers move forward only', () => {
  assert.equal(canTransition('REQUESTED', 'IN_TRANSIT'), true);
  assert.equal(canTransition('IN_TRANSIT', 'RECEIVED'), true);
  assert.equal(canTransition('IN_TRANSIT', 'CANCELLED'), false);
  assert.equal(canTransition('RECEIVED', 'REQUESTED'), false);
});

test('local times are HH:mm and ranges stay inside one day', () => {
  for (const ok of ['00:00', '09:30', '23:59'])
    assert.equal(localTimeSchema.safeParse(ok).success, true, ok);
  for (const bad of ['24:00', '9:30', '12:60', '12:5', 'noon'])
    assert.equal(localTimeSchema.safeParse(bad).success, false, bad);
  assert.equal(minutesOfDay('10:15'), 615);
  assert.equal(timeRangeSchema.safeParse({ start: '09:00', end: '17:00' }).success, true);
  assert.equal(timeRangeSchema.safeParse({ start: '17:00', end: '09:00' }).success, false);
  assert.equal(timeRangeSchema.safeParse({ start: '09:00', end: '09:00' }).success, false);
});

test('opening hours allow a break but not overlapping ranges', () => {
  const day = (ranges: Array<{ start: string; end: string }>) =>
    dayHoursSchema.safeParse({ weekday: 5, ranges });
  assert.equal(
    day([
      { start: '09:00', end: '13:00' },
      { start: '15:00', end: '21:00' },
    ]).success,
    true,
  );
  assert.equal(
    day([
      { start: '09:00', end: '14:00' },
      { start: '13:00', end: '21:00' },
    ]).success,
    false,
  );
  assert.equal(day([]).success, true, 'a closed day has no ranges');
  assert.equal(
    timeRangesOverlap({ start: '09:00', end: '12:00' }, { start: '12:00', end: '15:00' }),
    false,
    'touching ranges do not overlap',
  );
});

test('dates are real calendar days', () => {
  assert.equal(localDateSchema.safeParse('2026-12-02').success, true);
  assert.equal(localDateSchema.safeParse('2026-02-30').success, false);
  assert.equal(localDateSchema.safeParse('02-12-2026').success, false);
  assert.equal(weekdayOfLocalDate('2026-11-27'), 5);
});
