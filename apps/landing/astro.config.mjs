// @ts-check
import { defineConfig } from 'astro/config';

// apps/landing is dependency-isolated by design (design.md's Nuxt/Astro
// coexistence fallback ladder step 2 relies on this): no shared UI
// library or integration lives here in Phase 0.
export default defineConfig({});
