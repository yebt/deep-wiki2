export function readConfig(): string {
  return process.env.THING ?? '';
}
