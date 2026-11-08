import os from 'node:os';

type Interfaces = ReturnType<typeof os.networkInterfaces>;

/** Adapter names (Windows aliases and Linux names) of virtual switches, containers and VMs; their addresses are not reachable from other devices. */
const VIRTUAL_ADAPTER = /vEthernet|WSL|Hyper-V|Docker|VirtualBox|VMware/i;

function isLinkLocal(address: string): boolean {
  return address.startsWith('169.254.');
}

function rank(address: string): number {
  if (address.startsWith('192.168.')) return 0;
  if (address.startsWith('10.')) return 1;
  const second = Number(address.split('.')[1]);
  if (address.startsWith('172.') && second >= 16 && second <= 31) return 2;
  return isLinkLocal(address) ? 4 : 3;
}

function candidates(interfaces: Interfaces): { name: string; address: string }[] {
  return Object.entries(interfaces).flatMap(([name, entries]) =>
    (entries ?? []).flatMap((entry) =>
      entry.family === 'IPv4' && !entry.internal && !entry.address.startsWith('127.')
        ? [{ name, address: entry.address }]
        : [],
    ),
  );
}

function ranked(addresses: string[]): string[] {
  return [...new Set(addresses)].sort((a, b) => rank(a) - rank(b));
}

/**
 * Non-internal IPv4 addresses of physical adapters, most likely home-LAN address first. Virtual adapters and
 * link-local addresses are left out; when that leaves nothing, every non-internal IPv4 address is returned so the
 * list is never empty while the PC has one.
 */
export function getLanAddresses(interfaces: Interfaces = os.networkInterfaces()): string[] {
  const all = candidates(interfaces);
  const physical = all.filter((entry) => !VIRTUAL_ADAPTER.test(entry.name) && !isLinkLocal(entry.address));
  return ranked((physical.length > 0 ? physical : all).map((entry) => entry.address));
}

export function stripIpv6Prefix(ip: string | undefined): string | null {
  if (!ip) return null;
  return ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;
}
