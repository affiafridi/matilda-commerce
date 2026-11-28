import { inclusiveTaxMinor, percentOfMinor } from '@matilda/validation';

export interface TaxRule {
  /** Basis points: 500 is 5 percent. */
  rateBps: number;
  /** Prices already contain the tax (true) or the tax is added on top (false). */
  inclusive: boolean;
}

export interface TaxBreakdown {
  lineTaxMinor: number[];
  deliveryTaxMinor: number;
  /** Tax contained in (inclusive) or added to (exclusive) the total. */
  taxMinor: number;
}

/**
 * Tax per line and on the delivery fee, each rounded half away from zero (D5-03). Lines are taxed on
 * their amount after discounts. The rounding is per line so the order's line taxes always add up to
 * its tax total.
 */
export function computeTax(
  rule: TaxRule,
  lineTotalsMinor: readonly number[],
  deliveryFeeMinor: number,
): TaxBreakdown {
  const of = (amount: number): number =>
    rule.rateBps === 0
      ? 0
      : rule.inclusive
        ? inclusiveTaxMinor(amount, rule.rateBps)
        : percentOfMinor(amount, rule.rateBps);
  const lineTaxMinor = lineTotalsMinor.map(of);
  const deliveryTaxMinor = of(deliveryFeeMinor);
  return {
    lineTaxMinor,
    deliveryTaxMinor,
    taxMinor: lineTaxMinor.reduce((a, b) => a + b, deliveryTaxMinor),
  };
}
