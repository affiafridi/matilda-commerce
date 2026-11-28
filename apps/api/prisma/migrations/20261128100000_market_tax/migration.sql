-- Per-market sales tax (Phase 5 step 5.6, D5-03). The rate stays zero until finance confirms it.
ALTER TABLE "market"
  ADD COLUMN "tax_rate_bps" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "tax_inclusive" BOOLEAN NOT NULL DEFAULT true,
  ADD CONSTRAINT "market_tax_rate_check" CHECK ("tax_rate_bps" >= 0 AND "tax_rate_bps" <= 10000);
