/**
 * Ensures the apps/api test-only Mailpit/MinIO stack (compose.yaml in this
 * directory) is reachable, bringing it up via `podman|docker compose` if
 * neither is. Mirrors packages/db/testing/provision.ts's fixed-argument-
 * vector, bounded-timeout compose invocation (no shell, no user-supplied
 * token) — but there is nothing to provision per-suite or drop here, both
 * containers are stateless dev tooling.
 */
import { connect } from 'node:net';

export const COMPOSE_DIR = import.meta.dir;
const COMPOSE_TIMEOUT_MS = 90_000;

export const MAILPIT_SMTP_HOST = 'localhost';
export const MAILPIT_SMTP_PORT = 11025;
export const MAILPIT_HTTP_BASE_URL = 'http://localhost:18025';

export const MINIO_ENDPOINT = 'http://localhost:19000';
export const MINIO_REGION = 'us-east-1';
export const MINIO_ACCESS_KEY_ID = 'dw_test';
export const MINIO_SECRET_ACCESS_KEY = 'dw_test_password';

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
export async function ensureTestServices(): Promise<void> {
  if (await servicesReachable()) {
    return;
  }

  const binary = detectContainerRuntime();
  if (!binary) {
    throw new Error(
      'apps/api/testing: no container runtime found on PATH (podman or docker). ' +
        'Run (cd apps/api/testing && podman compose up -d --wait) manually.',
    );
  }

  const proc = Bun.spawn([binary, 'compose', 'up', '-d', '--wait'], {
    cwd: COMPOSE_DIR,
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
    throw new Error(
      `apps/api/testing: ${binary} compose did not bring up a reachable Mailpit/MinIO within ` +
        `${COMPOSE_TIMEOUT_MS}ms. Run (cd apps/api/testing && ${binary} compose up -d --wait) manually ` +
        'to see the underlying error.',
    );
  }
}
