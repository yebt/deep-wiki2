/**
 * Structural check: `compose.yaml` stays strictly on Compose-specification
 * syntax so the same file runs unmodified under `podman compose` (Fedora,
 * rootless, local dev) and `docker compose` (CI, production) — see
 * design.md D5/D6/D7 and docs/SPECS.md §12.1.
 *
 * Three rules, each independently testable against a fixture:
 *   1. Every bind mount carries an SELinux `:z` or `:Z` label. Named
 *      volumes need no label; only host-path bind mounts do.
 *   2. Every published host port is 1024 or above (rootless podman cannot
 *      bind lower ports).
 *   3. No Docker-specific or otherwise non-portable key appears anywhere
 *      in the file (`container_name`, `develop`, or any top-level key
 *      outside the Compose specification's own vocabulary).
 */
import { existsSync, readFileSync } from 'node:fs';
import { parse } from 'yaml';

export interface ComposeCheckResult {
  ok: boolean;
  errors: string[];
}

interface ComposeService {
  volumes?: unknown[];
  ports?: unknown[];
  [key: string]: unknown;
}

interface ComposeDocument {
  services?: Record<string, ComposeService>;
  volumes?: Record<string, unknown>;
  [key: string]: unknown;
}

const TOP_LEVEL_ALLOWED_KEYS = new Set([
  'name',
  'services',
  'networks',
  'volumes',
  'configs',
  'secrets',
  'include',
]);

const BANNED_SERVICE_KEYS = new Set(['container_name', 'develop']);

function isBindMountSource(source: string): boolean {
  return source.startsWith('./') || source.startsWith('../') || source.startsWith('/') || source.startsWith('~');
}

function checkVolumeEntry(serviceName: string, entry: unknown, namedVolumes: Set<string>, errors: string[]): void {
  if (typeof entry === 'string') {
    const parts = entry.split(':');
    const source = parts[0] ?? '';

    if (namedVolumes.has(source) || !isBindMountSource(source)) {
      // Named volume reference (or a bare volume name Compose will create) —
      // SELinux labelling does not apply.
      return;
    }

    const options = parts.slice(2).join(':');
    if (!/(^|,)[zZ](,|$)/.test(options)) {
      errors.push(
        `services.${serviceName}: bind mount "${entry}" is missing an SELinux :z or :Z label`,
      );
    }
    return;
  }

  if (entry && typeof entry === 'object') {
    const obj = entry as { type?: string; source?: string; bind?: { selinux?: string } };
    if (obj.type === 'bind' && obj.source && isBindMountSource(obj.source)) {
      const label = obj.bind?.selinux;
      if (label !== 'z' && label !== 'Z') {
        errors.push(
          `services.${serviceName}: bind mount "${obj.source}" is missing an SELinux :z or :Z label (bind.selinux)`,
        );
      }
    }
  }
}

function checkPortEntry(serviceName: string, entry: unknown, errors: string[]): void {
  let hostPort: string | undefined;

  if (typeof entry === 'string' || typeof entry === 'number') {
    const parts = String(entry).split(':');
    // A single value with no colon publishes no fixed host port (Compose
    // picks an ephemeral one) — nothing to check.
    if (parts.length >= 2) hostPort = parts[parts.length - 2];
  } else if (entry && typeof entry === 'object') {
    const obj = entry as { published?: string | number };
    if (obj.published !== undefined) hostPort = String(obj.published);
  }

  if (hostPort === undefined) return;
  const portNumber = Number(hostPort);
  if (Number.isFinite(portNumber) && portNumber < 1024) {
    errors.push(`services.${serviceName}: published host port ${portNumber} is below 1024 (rootless podman cannot bind it)`);
  }
}

function checkServiceKeys(serviceName: string, service: ComposeService, errors: string[]): void {
  for (const key of Object.keys(service)) {
    if (BANNED_SERVICE_KEYS.has(key)) {
      errors.push(`services.${serviceName}: non-portable key "${key}" is not allowed (Docker/Podman-specific extension)`);
    }
  }
}

export function checkComposeDocument(doc: ComposeDocument): ComposeCheckResult {
  const errors: string[] = [];

  for (const key of Object.keys(doc)) {
    if (!TOP_LEVEL_ALLOWED_KEYS.has(key) && !key.startsWith('x-')) {
      errors.push(`top-level key "${key}" is not part of the Compose specification`);
    }
  }

  const namedVolumes = new Set(Object.keys(doc.volumes ?? {}));
  const services = doc.services ?? {};

  for (const [serviceName, service] of Object.entries(services)) {
    checkServiceKeys(serviceName, service, errors);

    for (const entry of service.volumes ?? []) {
      checkVolumeEntry(serviceName, entry, namedVolumes, errors);
    }

    for (const entry of service.ports ?? []) {
      checkPortEntry(serviceName, entry, errors);
    }
  }

  return { ok: errors.length === 0, errors };
}

export function checkCompose(composePath: string): ComposeCheckResult {
  if (!existsSync(composePath)) {
    return { ok: false, errors: [`${composePath} does not exist`] };
  }

  const doc = parse(readFileSync(composePath, 'utf8')) as ComposeDocument;
  return checkComposeDocument(doc);
}

if (import.meta.main) {
  const target = process.argv[2] ?? 'compose.yaml';
  const result = checkCompose(target);
  if (!result.ok) {
    for (const err of result.errors) {
      console.error(`compose: ${err}`);
    }
    process.exit(1);
  }
  console.log('compose: ok');
}
