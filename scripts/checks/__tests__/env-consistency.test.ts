import { describe, expect, test } from 'bun:test';
import { checkEnvConsistency, parseEnv, portOfUrl } from '../env-consistency';

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

  test('agreeing ports pass', () => {
    const result = checkEnvConsistency(
      parseEnv(
        'POSTGRES_HOST_PORT=25432\nDATABASE_URL=postgres://u:p@localhost:25432/db\n' +
          'MAILPIT_SMTP_HOST_PORT=21025\nSMTP_PORT=21025\n',
      ),
    );
    expect(result.ok).toBe(true);
  });

  test('a missing half is not a failure — only a disagreement is', () => {
    expect(checkEnvConsistency(parseEnv('POSTGRES_HOST_PORT=25432\n')).ok).toBe(true);
    expect(checkEnvConsistency(parseEnv('DATABASE_URL=postgres://u:p@h:5432/db\n')).ok).toBe(true);
  });
});
