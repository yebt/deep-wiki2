// No import at all, and yet this file is bound to a runtime. "packages/core
// must import nothing, not even a Node built-in" was enforced only against
// import specifiers; the ambient globals that make the built-in unnecessary
// were unenforced.
export function homeDir(): string {
  return process.env.HOME ?? '';
}

export function encode(value: string): string {
  return Buffer.from(value).toString('base64');
}
