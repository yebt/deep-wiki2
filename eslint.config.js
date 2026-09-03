// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Flat ESLint config shared by every workspace member.
 * Framework-specific members (apps/web, apps/landing) may layer their own
 * config on top via `eslint.config.js` composing this array, but the base
 * TypeScript rules are defined once here.
 *
 * `apps/web` is excluded entirely: ESLint's flat config resolves exactly
 * one config file per invocation (verified — running `eslint .` from the
 * repo root never merges a nested `eslint.config.js`), so a single root
 * config cannot both apply plain TypeScript rules here and Vue/Nuxt-aware
 * rules there. `apps/web/eslint.config.js` layers `@nuxt/eslint`'s
 * generated config on top of this file's intent instead, and owns its own
 * `lint` script; `bun run --filter '*' lint` (see root package.json) runs
 * it as part of `bun run lint`. `apps/landing` needs no such split — its
 * `.astro` files are silently skipped by this config (no matching parser),
 * and its plain `.ts` files lint correctly under the rules below.
 */
export default tseslint.config(
  {
    ignores: [
      'apps/web/**',
      '**/dist/**',
      '**/.output/**',
      '**/.nuxt/**',
      '**/.astro/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.tsbuildinfo',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
