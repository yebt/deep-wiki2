/**
 * Seeds baseline data after migration. No-op in Phase 0: there is no
 * domain schema yet to seed (docs/TODO.md Phase 1). This entry point
 * exists so the documented bootstrap sequence (install, compose up,
 * migrate, seed) is stable before there is anything real to seed.
 */
async function main(): Promise<void> {
  console.log('seed: no-op (no domain schema to seed yet)');
}

if (import.meta.main) {
  await main();
}
