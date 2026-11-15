/**
 * Pure TypeScript deterministic content digest helper safe in browser, Edge, and Node runtimes.
 * Used for backup bundle checksums and immutable report envelope verification.
 */
export function computeDeterministicDigest(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;

  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    h1 ^= code;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= (code + (i & 0xff)) >>> 0;
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }

  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}
