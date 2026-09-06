/**
 * Turns an unusable DATABASE_URL into a sentence that names the problem.
 *
 * `postgres.js` throws `ERR_INVALID_URL` with a stack rooted in its own
 * parser, which tells a developer nothing about what they typed. These are
 * the shapes that actually occur, and the message must never echo the URL
 * back — it carries a password.
 */
const SCHEMES = ['postgres://', 'postgresql://'];

export function describeInvalidDatabaseUrl(raw: string | undefined): string | undefined {
  if (raw === undefined) {
    return 'DATABASE_URL is not set. Copy env.example to .env and fill it in.';
  }

  const url = raw.trim();

  if (url === '') {
    return 'DATABASE_URL is empty. It should look like postgres://user:password@host:port/database.';
  }

  if (/\$\{[A-Z_][A-Z0-9_]*\}/.test(url) || /\$[A-Z_][A-Z0-9_]*/.test(url)) {
    return (
      'DATABASE_URL still contains an unexpanded variable reference. A .env file does not ' +
      'interpolate: the text is passed through literally. Write the port and host as literal ' +
      'values, for example postgres://user:password@localhost:5432/database.'
    );
  }

  if ((url.startsWith('"') && url.endsWith('"')) || (url.startsWith("'") && url.endsWith("'"))) {
    return 'DATABASE_URL is wrapped in quotes. A .env value needs no quoting; remove them.';
  }

  if (!SCHEMES.some((scheme) => url.startsWith(scheme))) {
    return `DATABASE_URL must start with ${SCHEMES.join(' or ')}. It should look like postgres://user:password@host:port/database.`;
  }

  try {
    const parsed = new URL(url);
    if (parsed.port !== '' && !/^\d+$/.test(parsed.port)) {
      return `DATABASE_URL's port is not a number. It should look like postgres://user:password@host:5432/database.`;
    }
  } catch {
    return (
      'DATABASE_URL is not a parseable URL. It should look like ' +
      'postgres://user:password@host:port/database — check for stray spaces, a missing @, or an ' +
      'unescaped character in the password.'
    );
  }

  return undefined;
}
