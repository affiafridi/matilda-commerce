import { Injectable } from '@nestjs/common';
import {
  currencyCodeSchema,
  languageCodeSchema,
  minorUnitsSchema,
  optionTypeSchema,
  z,
} from '@matilda/validation';
import type { Prisma } from '../../generated/prisma/client';
import { ApiException } from '../../common/errors/api-exception';
import { type AdminActor, notFound } from '../admin/admin-common';
import { CatalogAccess, REQUIRED_LANGUAGE, type Tx, mapCatalogError } from './catalog-common';

const keySchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lower-case letters, numbers and single hyphens');

const labelTranslation = z.object({
  language: languageCodeSchema,
  label: z.string().trim().min(1).max(200),
});
const groupTranslation = labelTranslation.extend({
  helpText: z.string().trim().max(500).nullish(),
});

/** An extra charge in minor units for choosing this option in one market and currency. Never changes SKU or stock. */
const priceSchema = z.object({
  marketId: z.string().uuid(),
  currency: currencyCodeSchema,
  delta: minorUnitsSchema,
});

const choiceSchema = z.object({
  key: keySchema,
  sortOrder: z.number().int().min(0).max(100_000).default(0),
  translations: z.array(labelTranslation).min(1).max(20),
  prices: z.array(priceSchema).max(100).default([]),
});

const ruleSchema = z.object({
  /** Show this option only when the option with this key matches. */
  groupKey: keySchema,
  operator: z.enum(['FILLED', 'EQUALS', 'NOT_EQUALS']),
  /** Required for EQUALS and NOT_EQUALS: a choice key of that option. */
  choiceKey: keySchema.optional(),
});

const groupSchema = z.object({
  key: keySchema,
  type: optionTypeSchema,
  required: z.boolean().default(false),
  minSelect: z.number().int().min(0).max(200).default(0),
  maxSelect: z.number().int().min(1).max(200).nullable().default(null),
  maxLength: z.number().int().min(1).max(5000).nullable().default(null),
  sortOrder: z.number().int().min(0).max(100_000).default(0),
  translations: z.array(groupTranslation).min(1).max(20),
  choices: z.array(choiceSchema).max(200).default([]),
  /** Charge for options without choices (text, file, date, a single checkbox). */
  prices: z.array(priceSchema).max(100).default([]),
  showWhen: z.array(ruleSchema).max(10).default([]),
});

export const putOptionsBody = z.object({ groups: z.array(groupSchema).max(30) });
type PutBody = z.infer<typeof putOptionsBody>;
type GroupBody = z.infer<typeof groupSchema>;

const CHOICE_TYPES = new Set(['SELECT', 'RADIO']);
const TEXT_TYPES = new Set(['TEXT', 'TEXTAREA']);

function requireEnglish(languages: readonly string[], what: string) {
  if (!languages.includes(REQUIRED_LANGUAGE) || new Set(languages).size !== languages.length) {
    throw new ApiException(
      422,
      'ENGLISH_REQUIRED',
      `${what} needs one English label and at most one per language`,
    );
  }
}

const invalid = (code: string, message: string) => new ApiException(422, code, message);

/** Pure shape and rule checks; market and currency checks need the database and run afterwards. */
export function validateOptions(body: PutBody): void {
  const keys = body.groups.map((g) => g.key);
  if (new Set(keys).size !== keys.length) {
    throw invalid('DUPLICATE_OPTION_KEY', 'Each option key can appear only once');
  }
  const byKey = new Map(body.groups.map((g) => [g.key, g]));
  for (const g of body.groups) {
    requireEnglish(
      g.translations.map((t) => t.language),
      `Option ${g.key}`,
    );
    const choiceKeys = g.choices.map((c) => c.key);
    if (new Set(choiceKeys).size !== choiceKeys.length) {
      throw invalid('DUPLICATE_CHOICE_KEY', `Option ${g.key} repeats a choice key`);
    }
    for (const c of g.choices)
      requireEnglish(
        c.translations.map((t) => t.language),
        `Choice ${c.key}`,
      );
    if (CHOICE_TYPES.has(g.type) && g.choices.length === 0) {
      throw invalid('CHOICES_REQUIRED', `Option ${g.key} needs at least one choice`);
    }
    if (g.choices.length > 0 && g.type !== 'CHECKBOX' && !CHOICE_TYPES.has(g.type)) {
      throw invalid('CHOICES_NOT_ALLOWED', `Option ${g.key} of this type cannot have choices`);
    }
    if (g.maxLength !== null && !TEXT_TYPES.has(g.type)) {
      throw invalid('MAX_LENGTH_NOT_ALLOWED', `Only text options have a maximum length (${g.key})`);
    }
    const multi = g.type === 'CHECKBOX' && g.choices.length > 0;
    if (!multi && (g.minSelect > 0 || g.maxSelect !== null)) {
      throw invalid(
        'SELECTION_LIMITS_INVALID',
        `Selection limits apply to checkbox options with choices (${g.key})`,
      );
    }
    if (multi) {
      if (g.maxSelect !== null && g.maxSelect < g.minSelect) {
        throw invalid('SELECTION_LIMITS_INVALID', `The maximum is below the minimum (${g.key})`);
      }
      if (g.minSelect > g.choices.length || (g.maxSelect ?? 0) > g.choices.length) {
        throw invalid(
          'SELECTION_LIMITS_INVALID',
          `Selection limits exceed the number of choices (${g.key})`,
        );
      }
    }
    if (g.choices.length > 0 && g.prices.length > 0) {
      throw invalid('PRICE_TARGET_INVALID', `Price the choices of ${g.key}, not the option itself`);
    }
    const seen = new Set<string>();
    const priceKeys = [
      ...g.prices.map((p) => `g:${p.marketId}:${p.currency}`),
      ...g.choices.flatMap((c) => c.prices.map((p) => `${c.key}:${p.marketId}:${p.currency}`)),
    ];
    for (const k of priceKeys) {
      if (seen.has(k))
        throw invalid(
          'DUPLICATE_PRICE',
          'Each market and currency can be priced once per option or choice',
        );
      seen.add(k);
    }
    for (const r of g.showWhen) {
      const target = byKey.get(r.groupKey);
      if (!target) throw invalid('RULE_TARGET_NOT_FOUND', `${g.key} depends on an unknown option`);
      if (r.groupKey === g.key) throw invalid('RULE_CYCLE', `${g.key} cannot depend on itself`);
      if (r.operator === 'FILLED') {
        if (r.choiceKey) throw invalid('RULE_INVALID', 'A "filled" rule takes no choice');
      } else if (!r.choiceKey || !target.choices.some((c) => c.key === r.choiceKey)) {
        throw invalid('RULE_INVALID', `The rule on ${g.key} must name a choice of ${r.groupKey}`);
      }
    }
  }
  // No loops: A shown when B, B shown when A would never be visible.
  const state = new Map<string, 1 | 2>();
  const visit = (key: string) => {
    if (state.get(key) === 2) return;
    if (state.get(key) === 1)
      throw invalid('RULE_CYCLE', 'Options cannot depend on each other in a loop');
    state.set(key, 1);
    for (const r of byKey.get(key)?.showWhen ?? []) visit(r.groupKey);
    state.set(key, 2);
  };
  for (const key of keys) visit(key);
}

const include = {
  translations: { select: { language: true, label: true, helpText: true } },
  choices: {
    orderBy: [{ sortOrder: 'asc' as const }, { key: 'asc' as const }],
    include: { translations: { select: { language: true, label: true } } },
  },
  rules: true,
} satisfies Prisma.OptionGroupInclude;

@Injectable()
export class OptionsService {
  constructor(private readonly access: CatalogAccess) {}

  get(actor: AdminActor, brandId: string, productId: string) {
    return this.access.run(actor, brandId, 'products.view', async (tx) => {
      await this.mustGetProduct(tx, brandId, productId);
      return this.describe(tx, productId);
    });
  }

  /**
   * Replaces the customization options of a product, matching existing options and choices by key so
   * their ids stay stable. Options never change SKU or stock. Changing prices also needs `pricing.edit`.
   */
  async put(actor: AdminActor, brandId: string, productId: string, body: PutBody) {
    validateOptions(body);
    try {
      return await this.access.run(actor, brandId, 'products.edit', async (tx) => {
        await this.mustGetProduct(tx, brandId, productId);
        await this.assertMarketsAndCurrencies(tx, brandId, body);
        const before = await this.describe(tx, productId);
        if (this.priceSet(this.fromBody(body)) !== this.priceSet(before.groups)) {
          this.access.require(actor, brandId, 'pricing.edit');
        }
        await this.sync(tx, brandId, productId, body);
        const after = await this.describe(tx, productId);
        await this.access.record(
          tx,
          actor,
          brandId,
          'product.options.set',
          'product',
          productId,
          before,
          after,
        );
        return after;
      });
    } catch (err) {
      throw mapCatalogError(err, 'OPTION_CONFLICT', 'An option or choice key is already used');
    }
  }

  private fromBody(body: PutBody) {
    return body.groups.map((g) => ({
      key: g.key,
      prices: g.prices,
      choices: g.choices.map((c) => ({ key: c.key, prices: c.prices })),
    }));
  }

  /** A comparable fingerprint of every option price, independent of order. */
  private priceSet(
    groups: readonly {
      key: string;
      prices: { marketId: string; currency: string; delta: number }[];
      choices: { key: string; prices: { marketId: string; currency: string; delta: number }[] }[];
    }[],
  ): string {
    const line = (target: string, p: { marketId: string; currency: string; delta: number }) =>
      `${target}|${p.marketId}|${p.currency}|${p.delta}`;
    return groups
      .flatMap((g) => [
        ...g.prices.map((p) => line(g.key, p)),
        ...g.choices.flatMap((c) => c.prices.map((p) => line(`${g.key}/${c.key}`, p))),
      ])
      .sort()
      .join(';');
  }

  private async assertMarketsAndCurrencies(tx: Tx, brandId: string, body: PutBody) {
    const prices = body.groups.flatMap((g) => [...g.prices, ...g.choices.flatMap((c) => c.prices)]);
    const marketIds = [...new Set(prices.map((p) => p.marketId))];
    if (marketIds.length === 0) return;
    const markets = await tx.market.count({ where: { brandId, id: { in: marketIds } } });
    if (markets !== marketIds.length) {
      throw invalid('MARKET_NOT_FOUND', 'A market does not belong to this brand');
    }
    const currencies = await tx.marketCurrency.findMany({ where: { marketId: { in: marketIds } } });
    for (const p of prices) {
      if (!currencies.some((c) => c.marketId === p.marketId && c.currencyCode === p.currency)) {
        throw invalid('CURRENCY_NOT_IN_MARKET', `${p.currency} is not a currency of that market`);
      }
    }
  }

  private async sync(tx: Tx, brandId: string, productId: string, body: PutBody) {
    const existing = await tx.optionGroup.findMany({
      where: { productId },
      include: { choices: true },
    });
    const keep = new Set(body.groups.map((g) => g.key));
    await tx.optionRule.deleteMany({ where: { productId } });
    await tx.optionPrice.deleteMany({
      where: {
        OR: [{ optionGroup: { productId } }, { optionChoice: { optionGroup: { productId } } }],
      },
    });
    await tx.optionGroup.deleteMany({
      where: { productId, key: { notIn: [...keep] } },
    });

    const groupIds = new Map<string, string>();
    const choiceIds = new Map<string, string>();
    for (const g of body.groups) {
      const data = this.groupData(g);
      const found = existing.find((e) => e.key === g.key);
      const id = found
        ? (await tx.optionGroup.update({ where: { id: found.id }, data, select: { id: true } })).id
        : (
            await tx.optionGroup.create({
              data: { ...data, brandId, productId, key: g.key },
              select: { id: true },
            })
          ).id;
      groupIds.set(g.key, id);
      await tx.optionGroupTranslation.deleteMany({ where: { optionGroupId: id } });
      await tx.optionGroupTranslation.createMany({
        data: g.translations.map((t) => ({
          ...t,
          helpText: t.helpText ?? null,
          brandId,
          optionGroupId: id,
        })),
      });

      const wanted = new Set(g.choices.map((c) => c.key));
      await tx.optionChoice.deleteMany({
        where: { optionGroupId: id, key: { notIn: [...wanted] } },
      });
      for (const c of g.choices) {
        const current = found?.choices.find((e) => e.key === c.key);
        const choiceId = current
          ? (
              await tx.optionChoice.update({
                where: { id: current.id },
                data: { sortOrder: c.sortOrder },
                select: { id: true },
              })
            ).id
          : (
              await tx.optionChoice.create({
                data: { brandId, optionGroupId: id, key: c.key, sortOrder: c.sortOrder },
                select: { id: true },
              })
            ).id;
        choiceIds.set(`${g.key}/${c.key}`, choiceId);
        await tx.optionChoiceTranslation.deleteMany({ where: { optionChoiceId: choiceId } });
        await tx.optionChoiceTranslation.createMany({
          data: c.translations.map((t) => ({ ...t, brandId, optionChoiceId: choiceId })),
        });
      }
    }

    const priceRows: Prisma.OptionPriceCreateManyInput[] = [];
    for (const g of body.groups) {
      const groupId = groupIds.get(g.key);
      for (const p of g.prices) {
        priceRows.push({
          brandId,
          marketId: p.marketId,
          currencyCode: p.currency,
          optionGroupId: groupId,
          deltaMinor: p.delta,
        });
      }
      for (const c of g.choices) {
        for (const p of c.prices) {
          priceRows.push({
            brandId,
            marketId: p.marketId,
            currencyCode: p.currency,
            optionChoiceId: choiceIds.get(`${g.key}/${c.key}`),
            deltaMinor: p.delta,
          });
        }
      }
    }
    await tx.optionPrice.createMany({ data: priceRows });

    await tx.optionRule.createMany({
      data: body.groups.flatMap((g) =>
        g.showWhen.map((r) => ({
          brandId,
          productId,
          optionGroupId: groupIds.get(g.key) ?? '',
          dependsOnGroupId: groupIds.get(r.groupKey) ?? '',
          operator: r.operator,
          dependsOnChoiceId: r.choiceKey
            ? (choiceIds.get(`${r.groupKey}/${r.choiceKey}`) ?? null)
            : null,
        })),
      ),
    });
  }

  private groupData(g: GroupBody) {
    return {
      type: g.type,
      required: g.required,
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
      maxLength: g.maxLength,
      sortOrder: g.sortOrder,
    };
  }

  private async mustGetProduct(tx: Tx, brandId: string, id: string) {
    const p = await tx.product.findFirst({
      where: { id, brandId, deletedAt: null },
      select: { id: true },
    });
    if (!p) throw notFound('Product');
    return p;
  }

  private async describe(tx: Tx, productId: string) {
    const groups = await tx.optionGroup.findMany({
      where: { productId },
      include,
      orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }],
    });
    const groupKey = new Map(groups.map((g) => [g.id, g.key]));
    const choiceKey = new Map(groups.flatMap((g) => g.choices.map((c) => [c.id, c.key] as const)));
    const choiceIds = [...choiceKey.keys()];
    const prices = await tx.optionPrice.findMany({
      where: {
        OR: [
          { optionGroupId: { in: groups.map((g) => g.id) } },
          { optionChoiceId: { in: choiceIds } },
        ],
      },
      orderBy: [{ marketId: 'asc' }, { currencyCode: 'asc' }],
    });
    const priceOf = (where: { group?: string; choice?: string }) =>
      prices
        .filter((p) =>
          where.group ? p.optionGroupId === where.group : p.optionChoiceId === where.choice,
        )
        .map((p) => ({ marketId: p.marketId, currency: p.currencyCode, delta: p.deltaMinor }));
    return {
      groups: groups.map((g) => ({
        id: g.id,
        key: g.key,
        type: g.type,
        required: g.required,
        minSelect: g.minSelect,
        maxSelect: g.maxSelect,
        maxLength: g.maxLength,
        sortOrder: g.sortOrder,
        translations: g.translations,
        prices: priceOf({ group: g.id }),
        choices: g.choices.map((c) => ({
          id: c.id,
          key: c.key,
          sortOrder: c.sortOrder,
          translations: c.translations,
          prices: priceOf({ choice: c.id }),
        })),
        showWhen: g.rules.map((r) => ({
          groupKey: groupKey.get(r.dependsOnGroupId) ?? '',
          operator: r.operator,
          choiceKey: r.dependsOnChoiceId ? choiceKey.get(r.dependsOnChoiceId) : undefined,
        })),
      })),
    };
  }
}
