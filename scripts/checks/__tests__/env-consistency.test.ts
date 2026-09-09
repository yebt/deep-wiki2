import { describe, expect, test } from 'bun:test';
import { checkEnvConsistency, parseEnv, parseWebDevPort, portOfUrl } from '../env-consistency';

describe('parseEnv', () => {
  test('reads assignments and ignores comments and blanks', () => {
    const env = parseEnv('# a comment\n\nFOO=1\nBAR=two words\n');
    expect(env.get('FOO')).toBe('1');
    expect(env.get('BAR')).toBe('two words');
    expect(env.has('# a comment')).toBe(false);
  });
});

describe('portOfUrl', () => {
  test('extracts the port from a postgres url', () => {
    expect(portOfUrl('postgres://u:p@localhost:25432/db')).toBe('25432');
  });

  test('returns undefined when the url declares no port', () => {
    expect(portOfUrl('postgres://u:p@localhost/db')).toBeUndefined();
  });

  test('returns undefined for something that is not a url', () => {
    expect(portOfUrl('not a url')).toBeUndefined();
  });
});

describe('checkEnvConsistency', () => {
  test('a published port that disagrees with DATABASE_URL fails, naming both values', () => {
    const result = checkEnvConsistency(
      parseEnv('POSTGRES_HOST_PORT=25432\nDATABASE_URL=postgres://u:p@localhost:5432/db\n'),
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('25432');
    expect(result.errors[0]).toContain('5432');
  });

  test('a published smtp port that disagrees with SMTP_PORT fails', () => {
    const result = checkEnvConsistency(parseEnv('MAILPIT_SMTP_HOST_PORT=21025\nSMTP_PORT=1025\n'));
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
  });

  test('PORT disagreeing with the api base url the browser is given fails', () => {
    const result = checkEnvConsistency(
      parseEnv('PORT=4400\nNUXT_PUBLIC_API_BASE_URL=http://localhost:4000\n'),
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('4400');
    expect(result.errors[0]).toContain('4000');
  });

  // APP_URL is the browser-facing origin of apps/web — the CORS allowlist entry
  // and the host of mailed reset/invite links. It is NOT the API's own address,
  // and in development it is the Nuxt dev server on a different port entirely.
  // Comparing it against PORT was a real mistake once; this test keeps it out.
  test('APP_URL is deliberately not tied to PORT', () => {
    const result = checkEnvConsistency(
      parseEnv('PORT=4400\nAPP_URL=http://localhost:4173\nNUXT_PUBLIC_API_BASE_URL=http://localhost:4400\n'),
    );
    expect(result.ok).toBe(true);
  });

  test('agreeing ports pass', () => {
    const result = checkEnvConsistency(
      parseEnv(
        'POSTGRES_HOST_PORT=25432\nDATABASE_URL=postgres://u:p@localhost:25432/db\n' +
          'MAILPIT_SMTP_HOST_PORT=21025\nSMTP_PORT=21025\n' +
          'PORT=4400\nNUXT_PUBLIC_API_BASE_URL=http://localhost:4400\n',
      ),
    );
    expect(result.ok).toBe(true);
  });

  test('a missing half is not a failure — only a disagreement is', () => {
    expect(checkEnvConsistency(parseEnv('POSTGRES_HOST_PORT=25432\n')).ok).toBe(true);
    expect(checkEnvConsistency(parseEnv('DATABASE_URL=postgres://u:p@h:5432/db\n')).ok).toBe(true);
  });
});

describe('parseWebDevPort', () => {
  test('reads the port apps/web declares for its dev server', () => {
    expect(parseWebDevPort('export default defineNuxtConfig({\n  devServer: { port: 3001 },\n})')).toBe(3001);
  });

  test('returns undefined when no dev server port is declared', () => {
    expect(parseWebDevPort('export default defineNuxtConfig({ modules: [] })')).toBeUndefined();
  });
});

describe('APP_URL against where apps/web actually listens', () => {
  test('an APP_URL on a port apps/web does not serve fails, naming the symptom', () => {
    const result = checkEnvConsistency(parseEnv('APP_URL=http://localhost:4173\n'), { webDevPort: 3001 });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('4173');
    expect(result.errors[0]).toContain('3001');
    expect(result.errors[0]).toContain('returned to sign-in');
  });

  test('an APP_URL on the port apps/web serves passes', () => {
    expect(checkEnvConsistency(parseEnv('APP_URL=http://localhost:3001\n'), { webDevPort: 3001 }).ok).toBe(true);
  });

  test('a deployed APP_URL that names no port is not this rule’s business', () => {
    expect(checkEnvConsistency(parseEnv('APP_URL=https://wiki.example.com\n'), { webDevPort: 3001 }).ok).toBe(true);
  });

  test('apps/web and apps/api may not be given the same port', () => {
    const result = checkEnvConsistency(parseEnv('PORT=3001\nAPP_URL=http://localhost:3001\n'), { webDevPort: 3001 });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('same port'))).toBe(true);
  });
});
