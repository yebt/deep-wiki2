/**
 * Ensures the apps/api test-only Mailpit/MinIO stack (compose.yaml in this
 * directory) is reachable, bringing it up via `podman|docker compose` if
 * neither is. Mirrors packages/db/testing/provision.ts's fixed-argument-
 * vector, bounded-timeout compose invocation (no shell, no user-supplied
 * token) — but there is nothing to provision per-suite or drop here, both
 * containers are stateless dev tooling.
 */
import { createHash, createHmac } from 'node:crypto';
import { connect } from 'node:net';
import {
  apiComposeEnv,
  composeEnvPrefix,
  findForeignPortOwner,
  harnessIdentity,
  listPortOwners,
} from '@deep-wiki/db/testing/worktree';

export const COMPOSE_DIR = import.meta.dir;
const COMPOSE_TIMEOUT_MS = 90_000;

// Ports, the compose project name and the bucket are per-worktree so two
// git worktrees can run their suites at the same time; the main checkout
// keeps 11025/18025/19000/19001 and the bucket `deep-wiki-test`. See
// packages/db/testing/worktree.ts.
const HARNESS = harnessIdentity();

export const MAILPIT_SMTP_HOST = 'localhost';
export const MAILPIT_SMTP_PORT = HARNESS.ports.mailpitSmtp;
export const MAILPIT_HTTP_BASE_URL = `http://localhost:${HARNESS.ports.mailpitHttp}`;

export const MINIO_ENDPOINT = `http://localhost:${HARNESS.ports.minioApi}`;
export const MINIO_REGION = 'us-east-1';
export const MINIO_ACCESS_KEY_ID = 'dw_test';
export const MINIO_SECRET_ACCESS_KEY = 'dw_test_password';
// Per-worktree too, so even a slot collision cannot make two worktrees
// read and delete each other's objects.
export const MINIO_TEST_BUCKET = HARNESS.minioBucket;

export type ContainerRuntime = 'podman' | 'docker';

export function detectContainerRuntime(which: (bin: string) => string | null = (bin) => Bun.which(bin)): ContainerRuntime | undefined {
  if (which('podman')) return 'podman';
  if (which('docker')) return 'docker';
  return undefined;
}

function probeTcp(port: number, host = '127.0.0.1', timeoutMs = 500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function probeHttp(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function servicesReachable(): Promise<boolean> {
  const [mailpit, minio] = await Promise.all([
    probeTcp(MAILPIT_SMTP_PORT),
    probeHttp(`${MINIO_ENDPOINT}/minio/health/live`),
  ]);
  return mailpit && minio;
}

/**
 * Brings up the Mailpit/MinIO test stack if it is not already reachable.
 * Never skips — throws with the exact manual command on total failure,
 * same idiom as packages/db/testing/provision.ts (design.md D15).
 */
/**
 * Turns "compose timed out" into a sentence that names the container in
 * the way, so a slot collision between two worktrees does not masquerade
 * as a broken Mailpit.
 */
function foreignOwnerMessage(binary: ContainerRuntime): string | undefined {
  const foreign = findForeignPortOwner(
    listPortOwners(binary),
    [HARNESS.ports.mailpitSmtp, HARNESS.ports.mailpitHttp, HARNESS.ports.minioApi, HARNESS.ports.minioConsole],
    HARNESS.apiProjectName,
  );
  if (!foreign) return undefined;

  return (
    `host port ${foreign.port} is already published by container "${foreign.container}"` +
    (foreign.project ? ` of a different compose project ("${foreign.project}")` : ' outside any compose project') +
    `, but this worktree (${HARNESS.root}, slot ${HARNESS.slot}, project "${HARNESS.apiProjectName}") needs it. ` +
    'This is a port collision between two checkouts, not a broken service: move this worktree with ' +
    `DEEPWIKI_TEST_SLOT=<1..248>, or stop "${foreign.container}".`
  );
}

/** The manual command, carrying the environment that makes it mean the same thing. */
function manualCommand(binary: ContainerRuntime): string {
  return `(cd apps/api/testing && ${composeEnvPrefix(apiComposeEnv(HARNESS))} ${binary} compose up -d --wait)`;
}

export async function ensureTestServices(): Promise<void> {
  if (await servicesReachable()) {
    return;
  }

  const binary = detectContainerRuntime();
  if (!binary) {
    throw new Error(
      'apps/api/testing: no container runtime found on PATH (podman or docker). ' +
        `Run ${manualCommand('podman')} manually.`,
    );
  }

  const proc = Bun.spawn([binary, 'compose', 'up', '-d', '--wait'], {
    cwd: COMPOSE_DIR,
    // The compose project name travels in COMPOSE_PROJECT_NAME, not a -p
    // flag: verified honoured at `up` time by this host's provider
    // (podman-compose 1.6.0). The compose file interpolates the same
    // variable into its own `name:` so the two can never disagree.
    env: { ...process.env, ...apiComposeEnv(HARNESS) },
    stdout: 'ignore',
    stderr: 'ignore',
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, COMPOSE_TIMEOUT_MS);
  // `podman-compose`'s reported exit code for `up -d --wait` is not a
  // reliable success signal on this host (observed returning a nonzero
  // code even once both containers report healthy) — the only trustworthy
  // signal is whether the services actually answer, checked below.
  await proc.exited;
  clearTimeout(timer);

  if (timedOut || !(await servicesReachable())) {
    const collision = foreignOwnerMessage(binary);
    throw new Error(
      collision
        ? `apps/api/testing: ${collision}`
        : `apps/api/testing: ${binary} compose did not bring up a reachable Mailpit/MinIO within ` +
          `${COMPOSE_TIMEOUT_MS}ms. Run ${manualCommand(binary)} manually to see the underlying error.`,
    );
  }
}

const EMPTY_PAYLOAD_SHA256 = createHash('sha256').update('').digest('hex');

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function amzDates(): { amzDate: string; dateStamp: string } {
  const iso = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

/**
 * Signs and issues a bare `PUT /{bucket}` (S3 `CreateBucket`) against
 * MinIO. Bun's `S3Client` has no bucket-management API (it assumes the
 * bucket already exists — see s3-blob-store.ts), and no S3 SDK is a
 * dependency of this project (design.md D17), so this hand-rolled SigV4
 * signature is test-only plumbing to make the bucket exist before the
 * adapter round-trip test runs against it.
 */
export async function ensureMinioBucket(bucket: string = MINIO_TEST_BUCKET): Promise<void> {
  const host = new URL(MINIO_ENDPOINT).host;
  const { amzDate, dateStamp } = amzDates();
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${EMPTY_PAYLOAD_SHA256}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = ['PUT', `/${bucket}`, '', canonicalHeaders, signedHeaders, EMPTY_PAYLOAD_SHA256].join('\n');

  const credentialScope = `${dateStamp}/${MINIO_REGION}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');

  const kDate = hmac(`AWS4${MINIO_SECRET_ACCESS_KEY}`, dateStamp);
  const kRegion = hmac(kDate, MINIO_REGION);
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = hmac(kSigning, stringToSign).toString('hex');

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${MINIO_ACCESS_KEY_ID}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(`${MINIO_ENDPOINT}/${bucket}`, {
    method: 'PUT',
    headers: {
      host,
      'x-amz-content-sha256': EMPTY_PAYLOAD_SHA256,
      'x-amz-date': amzDate,
      authorization,
    },
  });

  // 200 = created, 409 = already owned by us — both mean the bucket exists.
  if (!res.ok && res.status !== 409) {
    const body = await res.text();
    throw new Error(`apps/api/testing: failed to create MinIO bucket "${bucket}": ${res.status} ${body}`);
  }
}
