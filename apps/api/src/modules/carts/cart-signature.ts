import type { CartLineInput } from '@matilda/validation';

const byKey = <T>(items: readonly T[], key: (item: T) => string): T[] =>
  [...items].sort((a, b) => key(a).localeCompare(key(b)));

/**
 * A stable identity for what a cart line is: product, variation and every customization choice,
 * but not the quantity. Adding the same configuration twice raises the quantity of one line; a
 * different message or add-on stays a separate line.
 */
export function lineSignature(line: CartLineInput): string {
  return JSON.stringify([
    line.productId,
    line.variationId ?? null,
    byKey(line.options, (o) => o.optionId).map((o) => [
      o.optionId,
      [...o.valueIds].sort(),
      o.text?.trim() ?? null,
    ]),
    byKey(line.addOns, (a) => a.addOnId).map((a) => [a.addOnId, a.quantity]),
    byKey(line.bundleChoices, (b) => b.bundleItemId).map((b) => [
      b.bundleItemId,
      b.variationId ?? null,
    ]),
  ]);
}
