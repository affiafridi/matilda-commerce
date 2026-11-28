import { priceDelivery } from './delivery-fee';
import { computeTax } from './tax';

const base = { areaId: 'a', methodId: 'm', zoneId: 'z', goodsMinor: 10000, freeDelivery: false };
const charge = { feeMinor: 2500, minimumOrderMinor: 0, freeOverMinor: null };

describe('priceDelivery', () => {
  it('charges the zone fee', () => {
    expect(priceDelivery({ ...base, charge })).toMatchObject({
      feeMinor: 2500,
      baseFeeMinor: 2500,
      waivedBy: null,
      problem: null,
    });
  });

  it('is not serviceable without a charge', () => {
    expect(priceDelivery({ ...base, zoneId: null, charge: null })).toMatchObject({
      feeMinor: 0,
      problem: 'NOT_SERVICEABLE',
    });
  });

  it('waives the fee over the free threshold, judged on goods after discounts', () => {
    const c = { ...charge, freeOverMinor: 10000 };
    expect(priceDelivery({ ...base, charge: c }).waivedBy).toBe('THRESHOLD');
    expect(priceDelivery({ ...base, charge: c, goodsMinor: 9999 })).toMatchObject({
      feeMinor: 2500,
      waivedBy: null,
    });
  });

  it('lets a free-delivery promotion win over the threshold', () => {
    const c = { ...charge, freeOverMinor: 5000 };
    expect(priceDelivery({ ...base, charge: c, freeDelivery: true }).waivedBy).toBe('PROMOTION');
  });

  it('reports a basket below the minimum order without hiding the fee', () => {
    const c = { ...charge, minimumOrderMinor: 15000 };
    expect(priceDelivery({ ...base, charge: c })).toMatchObject({
      feeMinor: 2500,
      problem: 'BELOW_MINIMUM',
      minimumOrderMinor: 15000,
    });
  });

  it('does not call a zero fee waived', () => {
    const c = { feeMinor: 0, minimumOrderMinor: 0, freeOverMinor: 100 };
    expect(priceDelivery({ ...base, charge: c, freeDelivery: true }).waivedBy).toBeNull();
  });
});

describe('computeTax', () => {
  it('finds the tax inside inclusive prices, per line and on delivery', () => {
    // 5 percent inside 10500 is 500; inside 2100 is 100.
    const out = computeTax({ rateBps: 500, inclusive: true }, [10500, 2100], 2100);
    expect(out).toEqual({ lineTaxMinor: [500, 100], deliveryTaxMinor: 100, taxMinor: 700 });
  });

  it('adds tax on top for exclusive prices', () => {
    const out = computeTax({ rateBps: 500, inclusive: false }, [10000, 2000], 2000);
    expect(out).toEqual({ lineTaxMinor: [500, 100], deliveryTaxMinor: 100, taxMinor: 700 });
  });

  it('rounds each line half away from zero and the total is the sum of the lines', () => {
    // 5 percent of 1010 is 50.5, which rounds to 51.
    const out = computeTax({ rateBps: 500, inclusive: false }, [1010, 1010, 0], 0);
    expect(out.lineTaxMinor).toEqual([51, 51, 0]);
    expect(out.taxMinor).toBe(102);
  });

  it('charges nothing at a zero rate', () => {
    expect(computeTax({ rateBps: 0, inclusive: true }, [999], 300).taxMinor).toBe(0);
  });
});
