/**
 * The two letters an avatar shows for a person with no picture: first
 * word, last word. One helper for the presence chip and the dashboard
 * rows, so a name never abbreviates two ways on one screen.
 */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]!.charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1]!.charAt(0) : '';
  return (first + last).toUpperCase();
}
