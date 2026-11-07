const HEX = Array.from({ length: 256 }, (_, byte) => byte.toString(16).padStart(2, '0'));

/**
 * A random v4 UUID. `crypto.randomUUID` exists only in secure contexts (https or localhost), so a page opened over
 * plain HTTP from a LAN address such as http://192.168.1.50:8600 has to build one from `getRandomValues`, which every
 * context has.
 */
export function randomUuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => HEX[byte]).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
