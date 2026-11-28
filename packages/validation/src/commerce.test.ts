import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CART_STATUSES,
  FULFILLMENT_STATUSES,
  ORDER_STATUSES,
  PAYMENT_ATTEMPT_STATUSES,
  PAYMENT_STATUSES,
  cartLineInputSchema,
  cartMachine,
  couponCodeSchema,
  fulfillmentMachine,
  idempotencyKeySchema,
  inclusiveTaxMinor,
  lineTotalMinor,
  orderMachine,
  orderNumberSchema,
  paymentAttemptMachine,
  paymentMachine,
  percentOfMinor,
  sumMinor,
} from './commerce.ts';

test('every state machine covers all states and only moves to known states', () => {
  const cases = [
    [orderMachine, ORDER_STATUSES],
    [paymentMachine, PAYMENT_STATUSES],
    [fulfillmentMachine, FULFILLMENT_STATUSES],
    [paymentAttemptMachine, PAYMENT_ATTEMPT_STATUSES],
    [cartMachine, CART_STATUSES],
  ] as const;
  for (const [m, states] of cases) {
    const known = new Set<string>(states);
    assert.deepEqual(new Set(Object.keys(m.next)), known);
    for (const targets of Object.values(m.next) as string[][]) {
      for (const t of targets) assert.ok(known.has(t), t);
    }
  }
});

test('an order cannot skip payment or leave a final state', () => {
  assert.equal(orderMachine.can('DRAFT', 'CONFIRMED'), false);
  assert.equal(orderMachine.can('PENDING_PAYMENT', 'CONFIRMED'), true);
  assert.equal(orderMachine.isFinal('COMPLETED'), true);
  assert.equal(orderMachine.can('CANCELLED', 'CONFIRMED'), false);
  assert.equal(orderMachine.can('COMPLETED', 'CANCELLED'), false);
});

test('payment only reaches refunded through paid', () => {
  assert.equal(paymentMachine.can('UNPAID', 'REFUNDED'), false);
  assert.equal(paymentMachine.can('PENDING', 'REFUNDED'), false);
  assert.equal(paymentMachine.can('PAID', 'REFUNDED'), true);
  assert.equal(paymentMachine.can('FAILED', 'PENDING'), true);
  assert.equal(paymentMachine.isFinal('REFUNDED'), true);
  assert.equal(paymentAttemptMachine.can('SUCCEEDED', 'FAILED'), false);
});

test('money helpers stay in whole minor units', () => {
  assert.equal(sumMinor([100, 250, 5]), 355);
  assert.throws(() => sumMinor([1.5]), RangeError);
  assert.throws(() => sumMinor([Number.MAX_SAFE_INTEGER, 1]), RangeError);
  assert.equal(lineTotalMinor(1999, 3), 5997);
  assert.throws(() => lineTotalMinor(100, 1.5), RangeError);
  assert.equal(percentOfMinor(1000, 500), 50);
  assert.equal(percentOfMinor(1001, 500), 50);
  assert.equal(percentOfMinor(1010, 500), 51);
  // UAE VAT 5 percent included in 10500 fils is 500 fils.
  assert.equal(inclusiveTaxMinor(10500, 500), 500);
  assert.equal(inclusiveTaxMinor(0, 500), 0);
  assert.throws(() => inclusiveTaxMinor(-1, 500), RangeError);
});

test('client input carries no price and is bounded', () => {
  const id = '3b8f6f0e-5a32-4c1d-9f43-0a1b2c3d4e5f';
  const ok = cartLineInputSchema.parse({ productId: id, quantity: 2, price: 1 });
  assert.equal('price' in ok, false);
  assert.deepEqual(ok.options, []);
  assert.throws(() => cartLineInputSchema.parse({ productId: id, quantity: 0 }));
  assert.throws(() => cartLineInputSchema.parse({ productId: id, quantity: 100 }));
  assert.throws(() => cartLineInputSchema.parse({ productId: 'x', quantity: 1 }));
});

test('order numbers, idempotency keys and coupon codes are well formed', () => {
  assert.ok(orderNumberSchema.safeParse('MF-100245').success);
  assert.ok(!orderNumberSchema.safeParse('mf-1').success);
  assert.ok(idempotencyKeySchema.safeParse('abcd1234abcd1234').success);
  assert.ok(!idempotencyKeySchema.safeParse('short').success);
  assert.ok(!idempotencyKeySchema.safeParse('has space has space').success);
  assert.equal(couponCodeSchema.parse(' eid-2026 '), 'EID-2026');
});
