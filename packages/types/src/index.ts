/** Standard error body returned by every API endpoint. See docs/API.md. */
export interface ApiErrorBody {
  statusCode: number;
  /** Stable machine-readable code, e.g. VALIDATION_FAILED, NOT_FOUND. */
  code: string;
  message: string;
  /** Per-field validation problems, when applicable. */
  errors?: ApiFieldError[];
  /** Correlates the response with server logs. */
  requestId: string;
  timestamp: string;
  path: string;
}

export interface ApiFieldError {
  path: string;
  message: string;
}

export type HealthStatus = 'ok' | 'degraded' | 'down';

export interface HealthResponse {
  status: HealthStatus;
  service: string;
  version: string;
  uptimeSeconds: number;
  timestamp: string;
}

export interface ReadinessCheck {
  status: HealthStatus;
  latencyMs?: number;
  detail?: string;
}

export interface ReadinessResponse {
  status: HealthStatus;
  timestamp: string;
  checks: Record<string, ReadinessCheck>;
}

/** Public, brand-scoped configuration returned by GET /api/v1/storefront/context. */
export interface StorefrontCurrency {
  code: string;
  symbol: string;
  minorUnitDigits: number;
  isDefault: boolean;
}

export interface StorefrontLanguage {
  code: string;
  name: string;
  nativeName: string;
  direction: 'LTR' | 'RTL';
  isDefault: boolean;
}

export interface StorefrontMarket {
  code: string;
  status: 'DRAFT' | 'ACTIVE' | 'SUSPENDED';
  country: { iso2: string; name: string };
  timezone: string;
  currencies: StorefrontCurrency[];
  languages: StorefrontLanguage[];
}

export interface StorefrontContext {
  brand: { slug: string; name: string; themeKey: string };
  /** The market of the requested domain; null for brand-level domains. */
  market: StorefrontMarket | null;
  /** Other publicly available (ACTIVE) markets of the same brand. */
  markets: StorefrontMarket[];
  /** Language for this domain: the domain default, else the market default. */
  language: string | null;
  /** Set when this hostname is an alias that must redirect to the primary hostname. */
  redirect: { hostname: string } | null;
}
