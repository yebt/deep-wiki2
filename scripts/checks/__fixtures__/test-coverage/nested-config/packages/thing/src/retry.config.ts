export function backoff(attempt: number): number {
  return Math.min(2 ** attempt, 30) * 1000;
}
