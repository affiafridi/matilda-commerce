/** Static seed data. No fake business data in the `reference` and `bootstrap` tiers. */
export const CURRENCIES = [
  { code: 'AED', name: 'UAE Dirham', symbol: 'AED', minorUnitDigits: 2 },
  { code: 'SAR', name: 'Saudi Riyal', symbol: 'SAR', minorUnitDigits: 2 },
  { code: 'USD', name: 'US Dollar', symbol: '$', minorUnitDigits: 2 },
  { code: 'EUR', name: 'Euro', symbol: 'EUR', minorUnitDigits: 2 },
] as const;

export const LANGUAGES = [
  { code: 'en', name: 'English', nativeName: 'English', direction: 'LTR' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', direction: 'RTL' },
] as const;

export const COUNTRIES = [
  { iso2: 'AE', iso3: 'ARE', name: 'United Arab Emirates', callingCode: '+971' },
] as const;

export const BRANDS = [
  { slug: 'matilda-flower', name: 'Matilda Flower', status: 'ACTIVE', host: 'matildaflower.com' },
  { slug: 'matilda-cake', name: 'Matilda Cake', status: 'INACTIVE', host: 'matildacake.com' },
  {
    slug: 'cookies-by-matilda',
    name: 'Cookies by Matilda',
    status: 'INACTIVE',
    host: 'cookiesbymatilda.com',
  },
] as const;

/** Local-only hostnames (`*.localhost` resolves to loopback in browsers). */
export const DEV_HOSTS: Record<string, string> = {
  'matilda-flower': 'flower.localhost',
  'matilda-cake': 'cake.localhost',
  'cookies-by-matilda': 'cookies.localhost',
};

export const UAE_MARKET = {
  code: 'ae',
  timezone: 'Asia/Dubai',
  currency: 'AED',
  languages: ['en', 'ar'],
} as const;
