import {
  effectivePrice,
  lineTotalMinor,
  sumMinor,
  type CartLineInput,
  type OptionType,
  type QuoteBundleItem,
  type QuoteLine,
  type QuoteOption,
  type QuoteTotals,
  type TranslatedText,
} from '@matilda/validation';

/**
 * The pricing engine (Phase 5 step 5.3, D5-01): a pure, deterministic function from loaded catalog
 * definitions and a cart to priced lines. It reads nothing and writes nothing; `QuoteService` loads
 * the definitions inside the brand-scoped transaction. Money is integer minor units throughout.
 * Discounts, delivery fee and tax are added by later steps (5.5 and 5.6) on top of these lines.
 */

export interface PriceDef {
  regular: number;
  sale: number | null;
  saleStartsAt: Date | null;
  saleEndsAt: Date | null;
}

export interface ChoiceDef {
  id: string;
  key: string;
  label: TranslatedText;
  /** Surcharge in the market currency; no price row means no surcharge. */
  deltaMinor: number;
}

export interface RuleDef {
  dependsOnGroupId: string;
  operator: 'FILLED' | 'EQUALS' | 'NOT_EQUALS';
  dependsOnChoiceId: string | null;
}

export interface OptionGroupDef {
  id: string;
  key: string;
  type: OptionType;
  label: TranslatedText;
  required: boolean;
  minSelect: number;
  maxSelect: number | null;
  maxLength: number | null;
  /** Surcharge for using the group at all (for example engraving). */
  groupDeltaMinor: number;
  choices: ChoiceDef[];
  /** All rules must hold for the group to apply (D3-06). */
  rules: RuleDef[];
}

export interface AddonItemDef {
  id: string;
  key: string | null;
  kind: 'PRODUCT' | 'INLINE';
  label: TranslatedText;
  maxQuantity: number;
  /** Null when the item has no price in this market: it cannot be sold there. */
  unitMinor: number | null;
  productId: string | null;
}

export interface AddonGroupDef {
  id: string;
  key: string;
  required: boolean;
  minSelect: number;
  maxSelect: number | null;
  items: AddonItemDef[];
}

export interface BundleItemDef {
  id: string;
  componentProductId: string;
  /** Set when the bundle fixes the component's variation. */
  fixedVariationId: string | null;
  /** Active variations the shopper may pick when the component is variable and not fixed. */
  choosableVariationIds: string[];
  quantity: number;
}

export interface VariationDef {
  id: string;
  sku: string;
  active: boolean;
  price: PriceDef | null;
}

export interface ProductDef {
  id: string;
  type: 'SIMPLE' | 'VARIABLE' | 'BUNDLE';
  name: TranslatedText;
  sku: string | null;
  minQuantity: number;
  maxQuantity: number | null;
  /** Market price of a simple or bundle product (variable products are priced per variation). */
  price: PriceDef | null;
  variations: VariationDef[];
  options: OptionGroupDef[];
  addonGroups: AddonGroupDef[];
  bundleItems: BundleItemDef[];
}

/** A cart line as the engine sees it: the client input plus the id of the stored line. */
export type PricingInputLine = CartLineInput & { id?: string };

export type LineErrorField =
  'product' | 'variation' | 'quantity' | 'price' | 'options' | 'addOns' | 'bundleChoices';

export interface LineError {
  index: number;
  field: LineErrorField;
  code: string;
  message: string;
}

export interface PricedCart {
  lines: QuoteLine[];
  errors: LineError[];
  subtotalMinor: number;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_TEXT_LENGTH = 500;

const validDate = (value: string): boolean => {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
};

const baseUnit = (price: PriceDef, at: Date): { amount: number; onSale: boolean } =>
  effectivePrice(
    {
      regular: price.regular,
      sale: price.sale,
      saleStartsAt: price.saleStartsAt,
      saleEndsAt: price.saleEndsAt,
    },
    at,
  );

/** True when a group applies, given what the shopper picked in the groups it depends on. */
function groupApplies(
  group: OptionGroupDef,
  groups: ReadonlyMap<string, OptionGroupDef>,
  picked: ReadonlyMap<string, string[]>,
  memo: Map<string, boolean>,
  visiting: Set<string>,
): boolean {
  const known = memo.get(group.id);
  if (known !== undefined) return known;
  if (visiting.has(group.id)) return false;
  visiting.add(group.id);
  let applies = true;
  for (const rule of group.rules) {
    const dependency = groups.get(rule.dependsOnGroupId);
    const depApplies = dependency
      ? groupApplies(dependency, groups, picked, memo, visiting)
      : false;
    const values = depApplies ? (picked.get(rule.dependsOnGroupId) ?? []) : [];
    const holds =
      rule.operator === 'FILLED'
        ? values.length > 0
        : rule.operator === 'EQUALS'
          ? rule.dependsOnChoiceId !== null && values.includes(rule.dependsOnChoiceId)
          : rule.dependsOnChoiceId === null || !values.includes(rule.dependsOnChoiceId);
    if (!holds) {
      applies = false;
      break;
    }
  }
  visiting.delete(group.id);
  memo.set(group.id, applies);
  return applies;
}

/** Checks the picks against the product's option groups and returns the priced selections. */
function priceOptions(
  def: ProductDef,
  input: PricingInputLine,
  fail: (code: string, message: string) => void,
): { options: QuoteOption[]; deltaMinor: number } {
  const groups = new Map(def.options.map((g) => [g.id, g]));
  const selections = new Map<string, PricingInputLine['options'][number]>();
  for (const sel of input.options) {
    if (!groups.has(sel.optionId)) {
      fail('OPTION_UNKNOWN', 'An option does not belong to this product');
      continue;
    }
    if (selections.has(sel.optionId)) {
      fail('OPTION_DUPLICATE', 'An option can only be chosen once');
      continue;
    }
    selections.set(sel.optionId, sel);
  }
  const picked = new Map<string, string[]>();
  for (const [id, sel] of selections) {
    const group = groups.get(id)!;
    const isChoiceType = ['SELECT', 'RADIO', 'CHECKBOX'].includes(group.type);
    picked.set(id, isChoiceType ? sel.valueIds : sel.text?.trim() ? [sel.text.trim()] : []);
  }

  const memo = new Map<string, boolean>();
  const result: QuoteOption[] = [];
  let delta = 0;
  for (const group of def.options) {
    const sel = selections.get(group.id);
    const isChoiceType = ['SELECT', 'RADIO', 'CHECKBOX'].includes(group.type);
    const text = sel?.text?.trim() ?? '';
    const valueIds = sel?.valueIds ?? [];
    const count = isChoiceType ? valueIds.length : text ? 1 : 0;
    if (!groupApplies(group, groups, picked, memo, new Set())) {
      if (count > 0) fail('OPTION_NOT_APPLICABLE', `${group.key} does not apply to this choice`);
      continue;
    }
    if (isChoiceType && text) {
      fail('OPTION_INVALID', `${group.key} takes a choice, not text`);
      continue;
    }
    if (!isChoiceType && valueIds.length > 0) {
      fail('OPTION_INVALID', `${group.key} takes text, not a choice`);
      continue;
    }
    const need = group.required ? Math.max(1, group.minSelect) : count > 0 ? group.minSelect : 0;
    const most =
      group.type === 'SELECT' || group.type === 'RADIO' || !isChoiceType
        ? Math.min(1, group.maxSelect ?? 1)
        : (group.maxSelect ?? Number.POSITIVE_INFINITY);
    if (count < need) {
      fail('OPTION_REQUIRED', `${group.key} needs ${need === 1 ? 'a choice' : `${need} choices`}`);
      continue;
    }
    if (count > most) {
      fail('OPTION_TOO_MANY', `${group.key} allows at most ${most}`);
      continue;
    }
    if (count === 0) continue;

    if (isChoiceType) {
      if (new Set(valueIds).size !== valueIds.length) {
        fail('OPTION_DUPLICATE', `${group.key} repeats a choice`);
        continue;
      }
      for (const valueId of valueIds) {
        const choice = group.choices.find((c) => c.id === valueId);
        if (!choice) {
          fail('OPTION_INVALID', `A choice does not belong to ${group.key}`);
          continue;
        }
        delta += choice.deltaMinor;
        result.push({
          optionId: group.id,
          optionKey: group.key,
          optionLabel: group.label,
          choiceId: choice.id,
          choiceKey: choice.key,
          choiceLabel: choice.label,
          text: null,
          deltaMinor: choice.deltaMinor,
        });
      }
    } else {
      const limit = group.maxLength ?? DEFAULT_TEXT_LENGTH;
      if (text.length > limit) {
        fail('OPTION_TOO_LONG', `${group.key} allows at most ${limit} characters`);
        continue;
      }
      if (group.type === 'DATE' && !validDate(text)) {
        fail('OPTION_INVALID', `${group.key} needs a date as YYYY-MM-DD`);
        continue;
      }
      result.push({
        optionId: group.id,
        optionKey: group.key,
        optionLabel: group.label,
        choiceId: null,
        choiceKey: null,
        choiceLabel: null,
        text,
        deltaMinor: 0,
      });
    }
    if (group.groupDeltaMinor !== 0) {
      delta += group.groupDeltaMinor;
      const last = result[result.length - 1];
      if (last)
        result[result.length - 1] = {
          ...last,
          deltaMinor: last.deltaMinor + group.groupDeltaMinor,
        };
    }
  }
  return { options: result, deltaMinor: delta };
}

function priceAddons(
  def: ProductDef,
  input: PricingInputLine,
  lineQuantity: number,
  fail: (code: string, message: string) => void,
): Array<{ item: AddonItemDef; quantity: number }> {
  const items = new Map<string, { item: AddonItemDef; groupId: string }>();
  for (const group of def.addonGroups) {
    for (const item of group.items) items.set(item.id, { item, groupId: group.id });
  }
  const chosen = new Map<string, number>();
  for (const a of input.addOns) {
    if (!items.has(a.addOnId)) {
      fail('ADDON_UNKNOWN', 'An add-on does not belong to this product');
      continue;
    }
    if (chosen.has(a.addOnId)) {
      fail('ADDON_DUPLICATE', 'An add-on can only be added once');
      continue;
    }
    const { item } = items.get(a.addOnId)!;
    if (item.unitMinor === null) {
      fail('ADDON_UNAVAILABLE', 'An add-on is not sold in this market');
      continue;
    }
    if (a.quantity > item.maxQuantity) {
      fail('ADDON_QUANTITY', `An add-on allows at most ${item.maxQuantity} per item`);
      continue;
    }
    chosen.set(a.addOnId, a.quantity);
  }
  for (const group of def.addonGroups) {
    const count = group.items.filter((i) => chosen.has(i.id)).length;
    const need = group.required ? Math.max(1, group.minSelect) : count > 0 ? group.minSelect : 0;
    if (count < need) fail('ADDON_REQUIRED', `${group.key} needs at least ${need}`);
    if (group.maxSelect !== null && count > group.maxSelect) {
      fail('ADDON_TOO_MANY', `${group.key} allows at most ${group.maxSelect}`);
    }
  }
  return [...chosen].map(([id, quantity]) => ({
    item: items.get(id)!.item,
    quantity: quantity * lineQuantity,
  }));
}

function resolveBundle(
  def: ProductDef,
  input: PricingInputLine,
  fail: (code: string, message: string) => void,
): QuoteBundleItem[] {
  if (def.type !== 'BUNDLE') {
    if (input.bundleChoices.length > 0) {
      fail('BUNDLE_NOT_ALLOWED', 'Only a bundle takes component choices');
    }
    return [];
  }
  const items = new Map(def.bundleItems.map((b) => [b.id, b]));
  const picks = new Map<string, string | undefined>();
  for (const c of input.bundleChoices) {
    if (!items.has(c.bundleItemId)) {
      fail('BUNDLE_UNKNOWN', 'A component does not belong to this bundle');
      continue;
    }
    if (picks.has(c.bundleItemId)) {
      fail('BUNDLE_DUPLICATE', 'A component can only be chosen once');
      continue;
    }
    picks.set(c.bundleItemId, c.variationId);
  }
  const out: QuoteBundleItem[] = [];
  for (const item of def.bundleItems) {
    const picked = picks.get(item.id);
    let variationId: string | null = item.fixedVariationId;
    if (item.fixedVariationId) {
      if (picked && picked !== item.fixedVariationId) {
        fail('BUNDLE_CHOICE_INVALID', 'This component has a fixed variation');
        continue;
      }
    } else if (item.choosableVariationIds.length > 0) {
      if (!picked) {
        fail('BUNDLE_CHOICE_REQUIRED', 'Choose a variation for each component that has options');
        continue;
      }
      if (!item.choosableVariationIds.includes(picked)) {
        fail('BUNDLE_CHOICE_INVALID', 'That variation is not available for this component');
        continue;
      }
      variationId = picked;
    } else if (picked) {
      fail('BUNDLE_CHOICE_INVALID', 'This component has no variations to choose');
      continue;
    }
    out.push({
      bundleItemId: item.id,
      productId: item.componentProductId,
      variationId,
      quantity: item.quantity,
    });
  }
  return out;
}

/**
 * Prices a cart at a moment in time. A line with any problem produces errors and no quote lines;
 * the caller decides whether to reject the cart or drop the line. `products` holds the definitions
 * of products that exist, are published and are sold in the market; a missing key means the
 * product cannot be bought.
 */
export function priceCart(
  products: ReadonlyMap<string, ProductDef>,
  lines: readonly PricingInputLine[],
  at: Date,
): PricedCart {
  const quoteLines: QuoteLine[] = [];
  const errors: LineError[] = [];

  lines.forEach((input, index) => {
    const lineErrors: LineError[] = [];
    const failIn =
      (field: LineErrorField) =>
      (code: string, message: string): void => {
        lineErrors.push({ index, field, code, message });
      };
    const def = products.get(input.productId);
    if (!def) {
      failIn('product')('PRODUCT_UNAVAILABLE', 'This product is not available');
      errors.push(...lineErrors);
      return;
    }
    if (input.quantity < def.minQuantity) {
      failIn('quantity')('QUANTITY_TOO_LOW', `The minimum quantity is ${def.minQuantity}`);
    }
    if (def.maxQuantity !== null && input.quantity > def.maxQuantity) {
      failIn('quantity')('QUANTITY_TOO_HIGH', `The maximum quantity is ${def.maxQuantity}`);
    }

    let price: PriceDef | null = def.price;
    let sku = def.sku;
    let variationId: string | null = null;
    if (def.type === 'VARIABLE') {
      const variation = def.variations.find((v) => v.id === input.variationId);
      if (!input.variationId) {
        failIn('variation')('VARIATION_REQUIRED', 'Choose a variation');
      } else if (!variation || !variation.active) {
        failIn('variation')('VARIATION_UNAVAILABLE', 'This variation is not available');
      } else {
        price = variation.price;
        sku = variation.sku;
        variationId = variation.id;
      }
    } else if (input.variationId) {
      failIn('variation')('VARIATION_NOT_ALLOWED', 'This product has no variations');
    }
    if (def.type !== 'VARIABLE' || variationId) {
      if (!price) failIn('price')('NO_PRICE', 'This product has no price in this market');
    }

    const options = priceOptions(def, input, failIn('options'));
    const addOns = priceAddons(def, input, input.quantity, failIn('addOns'));
    const bundleItems = resolveBundle(def, input, failIn('bundleChoices'));

    if (lineErrors.length === 0 && price) {
      const unitMinor = baseUnit(price, at).amount + options.deltaMinor;
      if (unitMinor < 0) {
        failIn('price')('PRICE_NEGATIVE', 'The options bring the price below zero');
      } else {
        quoteLines.push({
          kind: 'PRODUCT',
          cartLineId: input.id ?? null,
          productId: def.id,
          variationId,
          addonItemId: null,
          name: def.name,
          sku,
          options: options.options,
          bundleItems,
          quantity: input.quantity,
          unitMinor,
          discountMinor: 0,
          taxMinor: 0,
          totalMinor: lineTotalMinor(unitMinor, input.quantity),
        });
        for (const a of addOns) {
          const unit = a.item.unitMinor ?? 0;
          quoteLines.push({
            kind: 'ADD_ON',
            cartLineId: input.id ?? null,
            productId: a.item.productId,
            variationId: null,
            addonItemId: a.item.id,
            name: a.item.label,
            sku: null,
            options: [],
            bundleItems: [],
            quantity: a.quantity,
            unitMinor: unit,
            discountMinor: 0,
            taxMinor: 0,
            totalMinor: lineTotalMinor(unit, a.quantity),
          });
        }
      }
    }
    errors.push(...lineErrors);
  });

  // A line with a problem contributes nothing; the others still price (the cart view shows them).
  // Checkout never uses a partial result: QuoteService.price throws when errors is not empty.
  const subtotalMinor = sumMinor(quoteLines.map((l) => lineTotalMinor(l.unitMinor, l.quantity)));
  return { lines: quoteLines, errors, subtotalMinor };
}

export interface TotalsInput {
  currency: string;
  subtotalMinor: number;
  discountMinor: number;
  deliveryFeeMinor: number;
  taxMinor: number;
  taxInclusive: boolean;
}

/**
 * Totals exactly as the database checks them on the order: subtotal minus discount plus delivery fee,
 * plus tax only when prices do not already include it (D5-03).
 */
export function composeTotals(input: TotalsInput): QuoteTotals {
  const total =
    input.subtotalMinor -
    input.discountMinor +
    input.deliveryFeeMinor +
    (input.taxInclusive ? 0 : input.taxMinor);
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new RangeError('A quote total cannot be negative.');
  }
  return { ...input, totalMinor: total };
}
