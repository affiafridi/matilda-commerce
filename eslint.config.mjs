import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const nextFiles = ['apps/storefront/**/*.{ts,tsx,js,mjs}', 'apps/admin/**/*.{ts,tsx,js,mjs}'];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/next-env.d.ts',
      'apps/api/src/generated/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-assertions': [
        'error',
        { assertionStyle: 'as', objectLiteralTypeAssertions: 'never' },
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    files: ['**/*.spec.ts', '**/*.e2e-spec.ts'],
    languageOptions: { globals: { ...globals.jest } },
  },
  // Next.js apps: framework rules scoped to the frontends only.
  ...nextCoreWebVitals.map((config) => ({ ...config, files: nextFiles })),
  {
    files: nextFiles,
    rules: { '@next/next/no-html-link-for-pages': 'off' },
  },
  // Plain CommonJS config files.
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  prettier,
);
