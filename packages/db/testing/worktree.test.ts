import { describe, expect, test } from 'bun:test';
import {
  apiComposeEnv,
  dbComposeEnv,
  deriveHarnessIdentity,
  findForeignPortOwner,
  HARNESS_PORTS_PER_SLOT,
  HARNESS_PORT_BASE,
  HARNESS_SLOT_COUNT,
  MAIN_CHECKOUT_PORTS,
  parsePortOwners,
  resolveGitFacts,
  worktreeSlot,
  worktreeTag,
  type GitFacts,
} from './worktree';

const MAIN = '/home/dev/deep-wiki';
const PROBE = '/home/dev/deep-wiki-worktrees/harness-probe';

function main(env: Record<string, string | undefined> = {}) {
  return deriveHarnessIdentity({ root: MAIN, isMainWorktree: true }, env);
}

function linked(root = PROBE, env: Record<string, string | undefined> = {}) {
  return deriveHarnessIdentity({ root, isMainWorktree: false }, env);
}

describe('worktreeSlot / worktreeTag — deterministic derivation from the worktree path', () => {
  test('the same path always produces the same slot and tag', () => {
    expect(worktreeSlot(PROBE)).toBe(worktreeSlot(PROBE));
    expect(worktreeTag(PROBE)).toBe(worktreeTag(PROBE));
  });

  test('different paths produce different slots and tags', () => {
    const roots = [
      '/home/dev/deep-wiki-worktrees/a',
      '/home/dev/deep-wiki-worktrees/b',
      '/home/dev/deep-wiki-worktrees/c',
      '/srv/checkouts/deep-wiki',
    ];
    const tags = new Set(roots.map(worktreeTag));
    expect(tags.size).toBe(roots.length);

    const slots = new Set(roots.map(worktreeSlot));
    expect(slots.size).toBe(roots.length);
  });

  test('a slot is always inside the reserved block, never zero (zero belongs to the main checkout)', () => {
    for (let i = 0; i < 500; i += 1) {
      const slot = worktreeSlot(`/home/dev/wt/${i}`);
      expect(slot).toBeGreaterThanOrEqual(1);
      expect(slot).toBeLessThan(HARNESS_SLOT_COUNT);
    }
  });

  test('a tag is a short, filesystem- and DNS-safe lowercase hex string', () => {
    expect(worktreeTag(PROBE)).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('deriveHarnessIdentity — the main checkout keeps today’s values', () => {
  test('the main checkout gets slot 0 and the exact ports the harness has always used', () => {
    const id = main();
    expect(id.slot).toBe(0);
    expect(id.ports).toEqual({
      postgres: 55432,
      mailpitSmtp: 11025,
      mailpitHttp: 18025,
      minioApi: 19000,
      minioConsole: 19001,
      api: 4000,
      web: 4173,
    });
    expect(id.ports).toEqual(MAIN_CHECKOUT_PORTS);
  });

  test('the main checkout keeps the unsuffixed compose project names and bucket', () => {
    const id = main();
    expect(id.dbProjectName).toBe('deep-wiki-test');
    expect(id.apiProjectName).toBe('deep-wiki-api-test');
    expect(id.minioBucket).toBe('deep-wiki-test');
    expect(id.tag).toBe('');
  });

  test('the owner database that stamps a running Postgres is a legal, worktree-specific identifier', () => {
    expect(main().ownerDatabase).toBe('dw_owner_main');
    expect(linked().ownerDatabase).toBe(`dw_owner_${worktreeTag(PROBE)}`);
    expect(linked().ownerDatabase).toMatch(/^[a-z_][a-z0-9_]*$/);
  });
});

describe('deriveHarnessIdentity — a linked worktree shifts to its own block', () => {
  test('every port moves into the reserved 13000-range block and none matches the main checkout', () => {
    const id = linked();
    const ports = Object.values(id.ports);

    for (const port of ports) {
      expect(port).toBeGreaterThanOrEqual(HARNESS_PORT_BASE + HARNESS_PORTS_PER_SLOT);
      expect(port).toBeLessThan(HARNESS_PORT_BASE + HARNESS_PORTS_PER_SLOT * HARNESS_SLOT_COUNT);
    }

    for (const port of ports) {
      expect(Object.values(MAIN_CHECKOUT_PORTS)).not.toContain(port);
    }
  });

  test('every derived port is at or above 1024, which rootless podman requires', () => {
    for (let i = 0; i < 200; i += 1) {
      const id = linked(`/home/dev/wt/${i}`);
      for (const port of Object.values(id.ports)) {
        expect(port).toBeGreaterThanOrEqual(1024);
      }
    }
  });

  test('a worktree never reuses a port this machine is known to run other things on', () => {
    // Verified occupied on the development host during this change.
    const occupied = new Set([
      5432, 1025, 8025, 9000, 9001, 8000, 3000, 6379, 5433, 1026, 8026, 8080,
      25432, 21025, 28025, 28000, 29000, 29001, 55432, 11025, 18025, 19000, 19001,
    ]);
    for (let i = 0; i < 500; i += 1) {
      for (const port of Object.values(linked(`/home/dev/wt/${i}`).ports)) {
        expect(occupied.has(port)).toBe(false);
      }
    }
  });

  test('the whole block is distinct per worktree, so two worktrees share no port at all', () => {
    const a = Object.values(linked('/home/dev/wt/alpha').ports);
    const b = Object.values(linked('/home/dev/wt/beta').ports);
    expect(a.some((port) => b.includes(port))).toBe(false);
  });

  test('compose project names and the MinIO bucket carry the worktree tag', () => {
    const id = linked();
    expect(id.dbProjectName).toBe(`deep-wiki-test-${id.tag}`);
    expect(id.apiProjectName).toBe(`deep-wiki-api-test-${id.tag}`);
    expect(id.minioBucket).toBe(`deep-wiki-test-${id.tag}`);
  });

  test('the derivation is a pure function of the path: same path in, same values out', () => {
    expect(linked()).toEqual(linked());
  });
});

describe('deriveHarnessIdentity — an explicit override always wins', () => {
  test('a single port variable overrides just that port, on the main checkout too', () => {
    const id = main({ DEEPWIKI_TEST_PG_PORT: '15999' });
    expect(id.ports.postgres).toBe(15999);
    expect(id.ports.mailpitSmtp).toBe(11025);
  });

  test('every port has its own override variable', () => {
    const id = linked(PROBE, {
      DEEPWIKI_TEST_PG_PORT: '15001',
      DEEPWIKI_TEST_MAILPIT_SMTP_PORT: '15002',
      DEEPWIKI_TEST_MAILPIT_HTTP_PORT: '15003',
      DEEPWIKI_TEST_MINIO_PORT: '15004',
      DEEPWIKI_TEST_MINIO_CONSOLE_PORT: '15005',
      DEEPWIKI_E2E_API_PORT: '15006',
      DEEPWIKI_E2E_WEB_PORT: '15007',
    });
    expect(id.ports).toEqual({
      postgres: 15001,
      mailpitSmtp: 15002,
      mailpitHttp: 15003,
      minioApi: 15004,
      minioConsole: 15005,
      api: 15006,
      web: 15007,
    });
  });

  test('DEEPWIKI_TEST_SLOT moves the whole block without touching the tag', () => {
    const id = linked(PROBE, { DEEPWIKI_TEST_SLOT: '7' });
    expect(id.slot).toBe(7);
    expect(id.ports.postgres).toBe(HARNESS_PORT_BASE + 7 * HARNESS_PORTS_PER_SLOT);
    expect(id.tag).toBe(worktreeTag(PROBE));
  });

  test('DEEPWIKI_TEST_WORKTREE_TAG overrides the project names and bucket', () => {
    const id = linked(PROBE, { DEEPWIKI_TEST_WORKTREE_TAG: 'feature-x' });
    expect(id.dbProjectName).toBe('deep-wiki-test-feature-x');
    expect(id.apiProjectName).toBe('deep-wiki-api-test-feature-x');
    expect(id.minioBucket).toBe('deep-wiki-test-feature-x');
  });

  test('an unparseable override is refused loudly rather than silently ignored', () => {
    expect(() => main({ DEEPWIKI_TEST_PG_PORT: 'not-a-port' })).toThrow(/DEEPWIKI_TEST_PG_PORT/);
    expect(() => main({ DEEPWIKI_TEST_PG_PORT: '80' })).toThrow(/1024/);
  });
});

describe('resolveGitFacts', () => {
  test('the main worktree is the one whose git dir is the common git dir', () => {
    const facts = resolveGitFacts((args) => {
      if (args.includes('--show-toplevel')) return '/home/dev/deep-wiki\n';
      if (args.includes('--absolute-git-dir')) return '/home/dev/deep-wiki/.git\n';
      return '/home/dev/deep-wiki/.git\n';
    });
    expect(facts).toEqual({ root: '/home/dev/deep-wiki', isMainWorktree: true } satisfies GitFacts);
  });

  test('a linked worktree points at the main checkout’s git dir and is not the main worktree', () => {
    const facts = resolveGitFacts((args) => {
      if (args.includes('--show-toplevel')) return '/home/dev/wt/probe\n';
      if (args.includes('--absolute-git-dir')) return '/home/dev/deep-wiki/.git/worktrees/probe\n';
      return '/home/dev/deep-wiki/.git\n';
    });
    expect(facts.root).toBe('/home/dev/wt/probe');
    expect(facts.isMainWorktree).toBe(false);
  });

  test('git reports --git-common-dir relative to the CURRENT DIRECTORY, not to the toplevel', () => {
    // `bun test` runs with the workspace member as its cwd, so from
    // apps/api the main checkout answers "../../.git". Resolving that
    // against the toplevel instead of the cwd walks two directories too
    // far up, and every workspace member then believes it is a linked
    // worktree and derives shifted ports. Observed for real.
    const facts = resolveGitFacts((args) => {
      if (args.includes('--show-toplevel')) return '/home/dev/deep-wiki\n';
      if (args.includes('--absolute-git-dir')) return '/home/dev/deep-wiki/.git\n';
      return '../../.git\n';
    }, '/home/dev/deep-wiki/apps/api');

    expect(facts).toEqual({ root: '/home/dev/deep-wiki', isMainWorktree: true } satisfies GitFacts);
  });

  test('a linked worktree stays a linked worktree when asked from one of its subdirectories', () => {
    const facts = resolveGitFacts((args) => {
      if (args.includes('--show-toplevel')) return '/home/dev/wt/probe\n';
      if (args.includes('--absolute-git-dir')) return '/home/dev/deep-wiki/.git/worktrees/probe\n';
      return '/home/dev/deep-wiki/.git\n';
    }, '/home/dev/wt/probe/apps/api');

    expect(facts.isMainWorktree).toBe(false);
  });

  test('when git cannot answer, it falls back to the checkout it ships in and behaves as the main checkout', () => {
    const facts = resolveGitFacts(() => {
      throw new Error('not a git repository');
    });
    expect(facts.isMainWorktree).toBe(true);
    expect(facts.root.length).toBeGreaterThan(0);
  });
});

describe('parsePortOwners / findForeignPortOwner — a collision names itself', () => {
  const PS_OUTPUT = [
    'deep-wiki-test_postgres_1\tdeep-wiki-test\t0.0.0.0:55432->5432/tcp',
    'deep-wiki-api-test_mailpit_1\tdeep-wiki-api-test\t0.0.0.0:11025->1025/tcp, 0.0.0.0:18025->8025/tcp, 1110/tcp',
    'deep-wiki-api-test_minio_1\tdeep-wiki-api-test\t0.0.0.0:19000-19001->9000-9001/tcp',
    'someone-elses-thing\t\t8002/tcp',
  ].join('\n');

  test('reads a single published port', () => {
    expect(parsePortOwners(PS_OUTPUT).get(55432)).toEqual({
      container: 'deep-wiki-test_postgres_1',
      project: 'deep-wiki-test',
    });
  });

  test('reads every port of a multi-port container', () => {
    const owners = parsePortOwners(PS_OUTPUT);
    expect(owners.get(11025)?.project).toBe('deep-wiki-api-test');
    expect(owners.get(18025)?.project).toBe('deep-wiki-api-test');
  });

  test('expands a published port range', () => {
    const owners = parsePortOwners(PS_OUTPUT);
    expect(owners.get(19000)?.container).toBe('deep-wiki-api-test_minio_1');
    expect(owners.get(19001)?.container).toBe('deep-wiki-api-test_minio_1');
  });

  test('ignores a container port that is not published to the host', () => {
    expect(parsePortOwners(PS_OUTPUT).has(8002)).toBe(false);
  });

  test('tolerates empty or garbage output rather than throwing', () => {
    expect(parsePortOwners('').size).toBe(0);
    expect(parsePortOwners('nonsense without tabs').size).toBe(0);
  });

  test('finds no foreign owner when the port belongs to our own compose project', () => {
    expect(findForeignPortOwner(PS_OUTPUT, [55432], 'deep-wiki-test')).toBeUndefined();
  });

  test('names the foreign project holding a port we need', () => {
    const found = findForeignPortOwner(PS_OUTPUT, [18025], 'deep-wiki-api-test-abc12345');
    expect(found).toEqual({
      port: 18025,
      container: 'deep-wiki-api-test_mailpit_1',
      project: 'deep-wiki-api-test',
    });
  });

  test('finds nothing when no container publishes the port at all', () => {
    expect(findForeignPortOwner(PS_OUTPUT, [13456], 'deep-wiki-test')).toBeUndefined();
  });
});

describe('dbComposeEnv / apiComposeEnv — one fact, passed to compose', () => {
  test('the db stack gets its project name and its postgres port', () => {
    const id = linked();
    expect(dbComposeEnv(id)).toEqual({
      COMPOSE_PROJECT_NAME: id.dbProjectName,
      DEEPWIKI_TEST_PG_PORT: String(id.ports.postgres),
      DEEPWIKI_TEST_OWNER_DB: id.ownerDatabase,
    });
  });

  test('the api stack gets its project name and all four service ports', () => {
    const id = linked();
    expect(apiComposeEnv(id)).toEqual({
      COMPOSE_PROJECT_NAME: id.apiProjectName,
      DEEPWIKI_TEST_MAILPIT_SMTP_PORT: String(id.ports.mailpitSmtp),
      DEEPWIKI_TEST_MAILPIT_HTTP_PORT: String(id.ports.mailpitHttp),
      DEEPWIKI_TEST_MINIO_PORT: String(id.ports.minioApi),
      DEEPWIKI_TEST_MINIO_CONSOLE_PORT: String(id.ports.minioConsole),
    });
  });

  test('on the main checkout the compose env reproduces exactly the values the files default to', () => {
    expect(dbComposeEnv(main())).toEqual({
      COMPOSE_PROJECT_NAME: 'deep-wiki-test',
      DEEPWIKI_TEST_PG_PORT: '55432',
      DEEPWIKI_TEST_OWNER_DB: 'dw_owner_main',
    });
    expect(apiComposeEnv(main())).toEqual({
      COMPOSE_PROJECT_NAME: 'deep-wiki-api-test',
      DEEPWIKI_TEST_MAILPIT_SMTP_PORT: '11025',
      DEEPWIKI_TEST_MAILPIT_HTTP_PORT: '18025',
      DEEPWIKI_TEST_MINIO_PORT: '19000',
      DEEPWIKI_TEST_MINIO_CONSOLE_PORT: '19001',
    });
  });
});
