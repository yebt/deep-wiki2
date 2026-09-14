import { backoff } from '~/retry.config';

export function nextDelay(attempt: number): number {
  return backoff(attempt);
}
