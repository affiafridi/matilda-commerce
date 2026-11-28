/** The fee a zone charges for one delivery method (a `zone_charge` row, in the cart's currency). */
export interface ChargeDef {
  feeMinor: number;
  minimumOrderMinor: number;
  freeOverMinor: number | null;
}

export type DeliveryProblem =
  /** The area is in no active zone of this market, or the zone has no charge for the method. */
  | 'NOT_SERVICEABLE'
  /** Goods after discounts are below the zone's minimum order. */
  | 'BELOW_MINIMUM';

export interface DeliveryQuote {
  areaId: string;
  methodId: string;
  zoneId: string | null;
  /** What the zone charges before any waiver. */
  baseFeeMinor: number;
  /** What the shopper pays. */
  feeMinor: number;
  /** Why the fee is zero although the zone charges one. */
  waivedBy: 'PROMOTION' | 'THRESHOLD' | null;
  minimumOrderMinor: number;
  problem: DeliveryProblem | null;
}

export interface DeliveryFeeInput {
  areaId: string;
  methodId: string;
  zoneId: string | null;
  charge: ChargeDef | null;
  /** Goods after discounts, before delivery and tax. */
  goodsMinor: number;
  /** A free-delivery promotion applies. */
  freeDelivery: boolean;
}

/**
 * The delivery fee for a chosen area and method (D5-03/D5-11). A free-delivery promotion waives the
 * fee first, then the zone's own "free over" threshold, judged on goods after discounts. A minimum
 * order below the zone's limit is reported as a problem, not hidden: the order step refuses it.
 */
export function priceDelivery(input: DeliveryFeeInput): DeliveryQuote {
  const { areaId, methodId, zoneId, charge } = input;
  if (!charge) {
    return {
      areaId,
      methodId,
      zoneId,
      baseFeeMinor: 0,
      feeMinor: 0,
      waivedBy: null,
      minimumOrderMinor: 0,
      problem: 'NOT_SERVICEABLE',
    };
  }
  let waivedBy: DeliveryQuote['waivedBy'] = null;
  if (charge.feeMinor > 0) {
    if (input.freeDelivery) waivedBy = 'PROMOTION';
    else if (charge.freeOverMinor !== null && input.goodsMinor >= charge.freeOverMinor) {
      waivedBy = 'THRESHOLD';
    }
  }
  return {
    areaId,
    methodId,
    zoneId,
    baseFeeMinor: charge.feeMinor,
    feeMinor: waivedBy ? 0 : charge.feeMinor,
    waivedBy,
    minimumOrderMinor: charge.minimumOrderMinor,
    problem: input.goodsMinor < charge.minimumOrderMinor ? 'BELOW_MINIMUM' : null,
  };
}
