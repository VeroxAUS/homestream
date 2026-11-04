import os from 'node:os';

type Interfaces = ReturnType<typeof os.networkInterfaces>;

function rank(address: string): number {
  if (address.startsWith('192.168.')) return 0;
  if (address.startsWith('10.')) return 1;
  const second = Number(address.split('.')[1]);
  if (address.startsWith('172.') && second >= 16 && second <= 31) return 2;
  return 3;
}

/** Non-internal IPv4 addresses, most likely home-LAN address first. */
export function getLanAddresses(interfaces: Interfaces = os.networkInterfaces()): string[] {
  const found = new Set<string>();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      if (entry.address.startsWith('169.254.')) continue;
      found.add(entry.address);
    }
  }
  return [...found].sort((a, b) => rank(a) - rank(b));
}

export function stripIpv6Prefix(ip: string | undefined): string | null {
  if (!ip) return null;
  return ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;
}
