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

  // REVERSED ON PURPOSE (2026-09-09). This test used to assert that a missing
  // half is not a failure. That skip was the hole: `if (!published ||
  // !consumed) continue` silently disabled the whole rule, so a DATABASE_URL
  // that named no port while POSTGRES_HOST_PORT said 25432 returned ok — which
  // is the exact worst case this module's header describes (the app connects
  // to whatever unrelated service owns the default port and the data is wrong,
  // not missing). Both halves of a pair are the same fact written twice: either
  // the fact is written twice, or it is not written at all. Half of it is a
  // drift that has already happened, not a configuration to tolerate.
  test('a pair with only its published half is an error', () => {
    const result = checkEnvConsistency(parseEnv('POSTGRES_HOST_PORT=25432\n'));
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('DATABASE_URL');
  });

  test('a pair with only its consumed half is an error', () => {
    const result = checkEnvConsistency(parseEnv('DATABASE_URL=postgres://u:p@h:5432/db\n'));
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('POSTGRES_HOST_PORT');
  });

  test('a whole pair that is absent is nobody\u2019s business', () => {
    expect(checkEnvConsistency(parseEnv('NODE_ENV=development\n')).ok).toBe(true);
  });

  // The header's portless exemption is about APP_URL behind a reverse proxy.
  // It was never about these pairs: a portless DATABASE_URL does not mean "no
  // port", it means 5432, and a portless NUXT_PUBLIC_API_BASE_URL means 80/443.
  // Those are the numbers the published half exists to set.
  test('a DATABASE_URL that declares no port at all is an error, not a skip', () => {
    const result = checkEnvConsistency(
      parseEnv('POSTGRES_HOST_PORT=25432\nDATABASE_URL=postgres://u:p@localhost/db\n'),
    );
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('25432');
    expect(result.errors[0]).toContain('no port');
  });

  test('an api base url that declares no port at all is an error, not a skip', () => {
    const result = checkEnvConsistency(parseEnv('PORT=4400\nNUXT_PUBLIC_API_BASE_URL=http://localhost\n'));
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('4400');
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
    expect(result.errors[0]).toContain('Could not reach the server');
    // The failure is loud and misleading, never silent. A message that promises
    // silence, or a 200 to go looking for, sends the reader somewhere the fault
    // is not — which is exactly what happened before 2026-09-09.
    expect(result.errors[0]).not.toMatch(/silent|no error logged|returns 200/i);
  });

  test('an APP_URL on the port apps/web serves passes', () => {
    expect(checkEnvConsistency(parseEnv('APP_URL=http://localhost:3001\n'), { webDevPort: 3001 }).ok).toBe(true);
  });

  test('a deployed APP_URL that names no port is not this rule’s business', () => {
    expect(checkEnvConsistency(parseEnv('APP_URL=https://wiki.example.com\n'), { webDevPort: 3001 }).ok).toBe(true);
  });

  test('apps/web and apps/api may not be given the same port', () => {
    // NUXT_PUBLIC_API_BASE_URL is spelled out so PORT's own pair is complete:
    // a half-present pair is an error in its own right now, and this test is
    // about the collision, not about that.
    const result = checkEnvConsistency(
      parseEnv('PORT=3001\nNUXT_PUBLIC_API_BASE_URL=http://localhost:3001\nAPP_URL=http://localhost:3001\n'),
      { webDevPort: 3001 },
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('same port'))).toBe(true);
  });

  // REVERSED ON PURPOSE (2026-09-09). APP_URL used to be compared on its PORT
  // alone, so `http://example.com:3000` sailed through. The port was never the
  // whole fact: APP_URL is the single origin apps/api allows through CORS with
  // credentials, and an origin is scheme + host + port. It is also the host of
  // the /reset-password and /invite/accept links mailed to users, so a wrong
  // host sends real people to a machine that is not theirs.
  test('an APP_URL on the right port but the wrong host fails', () => {
    const result = checkEnvConsistency(parseEnv('APP_URL=http://example.com:3001\n'), { webDevPort: 3001 });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('example.com');
    expect(result.errors[0]).toContain('localhost');
    expect(result.errors[0]).toContain('Could not reach the server');
  });

  // 127.0.0.1 and localhost are the same machine and different origins. The
  // browser compares origins by text, so this fails exactly like a wrong host.
  test('127.0.0.1 is not localhost to a browser, and fails', () => {
    const result = checkEnvConsistency(parseEnv('APP_URL=http://127.0.0.1:3001\n'), { webDevPort: 3001 });
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('127.0.0.1');
  });
});
