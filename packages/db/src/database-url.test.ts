import { describe, expect, test } from 'bun:test';
import { describeInvalidDatabaseUrl } from './database-url';

describe('describeInvalidDatabaseUrl', () => {
  test('a well-formed url produces no complaint', () => {
    expect(describeInvalidDatabaseUrl('postgres://u:p@localhost:25432/deepwiki')).toBeUndefined();
    expect(describeInvalidDatabaseUrl('postgresql://u:p@host/db')).toBeUndefined();
  });

  test('an unset value says so', () => {
    expect(describeInvalidDatabaseUrl(undefined)).toContain('not set');
  });

  test('an empty value says so', () => {
    expect(describeInvalidDatabaseUrl('   ')).toContain('empty');
  });

  test('an unexpanded variable is named as the cause, not as a parse error', () => {
    const message = describeInvalidDatabaseUrl('postgres://u:p@localhost:${POSTGRES_HOST_PORT}/db');
    expect(message).toContain('does not');
    expect(message).toContain('interpolate');
  });

  test('a bare $VAR reference is caught too', () => {
    expect(describeInvalidDatabaseUrl('postgres://u:p@localhost:$PGPORT/db')).toContain('interpolate');
  });

  test('quoting is named', () => {
    expect(describeInvalidDatabaseUrl('"postgres://u:p@h:5432/db"')).toContain('quotes');
  });

  test('a missing scheme is named', () => {
    expect(describeInvalidDatabaseUrl('localhost:5432/deepwiki')).toContain('postgres://');
  });

  test('the message never echoes the url, because it carries a password', () => {
    for (const bad of ['', 'localhost:5432/db', '"postgres://u:hunter2@h:5432/db"']) {
      expect(describeInvalidDatabaseUrl(bad)).not.toContain('hunter2');
    }
  });
});
