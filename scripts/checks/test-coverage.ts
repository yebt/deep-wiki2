/**
 * Structural check: every workspace member is covered by at least one
 * real, executing automated test. A test file that declares a test but
 * makes no assertion (`expect(...)`/`assert(...)`) trivially "passes"
 * without exercising any code, so it is treated as a coverage failure —
 * not as green.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { findMemberDirs } from './workspace-shape';

export interface TestCoverageResult {
  ok: boolean;
  errors: string[];
}

export interface MemberCoverageResult {
  ok: boolean;
  reason?: string;
}

const TEST_FILE_PATTERN = /\.(test|spec)\.(ts|tsx|js|jsx)$/;
const ASSERTION_PATTERN = /\b(expect|assert)\s*\(/;
const SKIP_DIRS = new Set(['node_modules', 'dist', '.output', '.nuxt', '.astro', 'coverage']);

function findTestFiles(dir: string): string[] {
  const found: string[] = [];

  function walk(current: string): void {
    for (const entry of readdirSync(current)) {
      if (SKIP_DIRS.has(entry)) continue;
      const full = join(current, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (TEST_FILE_PATTERN.test(entry)) {
        found.push(full);
      }
    }
  }

  walk(dir);
  return found;
}

export function checkMemberCoverage(memberDir: string): MemberCoverageResult {
  const testFiles = findTestFiles(memberDir);

  if (testFiles.length === 0) {
    return { ok: false, reason: 'no test files found for this member' };
  }

  const hasRealAssertion = testFiles.some((file) =>
    ASSERTION_PATTERN.test(readFileSync(file, 'utf8')),
  );

  if (!hasRealAssertion) {
    return {
      ok: false,
      reason: 'test file(s) contain no real assertions (expect()/assert() call) — placeholder coverage does not count',
    };
  }

  return { ok: true };
}

export function checkTestCoverage(root: string): TestCoverageResult {
  const errors: string[] = [];

  for (const memberDir of findMemberDirs(root)) {
    const result = checkMemberCoverage(memberDir);
    if (!result.ok) {
      errors.push(`${relative(root, memberDir)}: ${result.reason}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

if (import.meta.main) {
  const result = checkTestCoverage(process.cwd());
  if (!result.ok) {
    for (const err of result.errors) {
      console.error(`test-coverage: ${err}`);
    }
    process.exit(1);
  }
  console.log('test-coverage: ok');
}
