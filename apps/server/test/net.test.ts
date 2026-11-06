import type os from 'node:os';
import { describe, expect, it } from 'vitest';
import { getLanAddresses, stripIpv6Prefix } from '../src/net.js';

type Interfaces = ReturnType<typeof os.networkInterfaces>;

function iface(address: string, internal = false, family: 'IPv4' | 'IPv6' = 'IPv4') {
  return { address, family, internal, netmask: '', mac: '', cidr: null };
}

describe('getLanAddresses', () => {
  it('skips internal, IPv6 and link-local addresses and ranks private ranges (192.168, 10, 172.16/12) before public ones', () => {
    const interfaces = {
      Loopback: [iface('127.0.0.1', true)],
      WSL: [iface('172.28.0.1')],
      Docker: [iface('10.5.0.1')],
      'Wi-Fi': [iface('192.168.1.50'), iface('fe80::1', false, 'IPv6')],
      Bad: [iface('169.254.3.4')],
      Uplink: [iface('203.0.113.9')],
    } as unknown as Interfaces;
    expect(getLanAddresses(interfaces)).toEqual(['192.168.1.50', '10.5.0.1', '172.28.0.1', '203.0.113.9']);
  });

  it('returns an empty list when there is no network', () => {
    expect(getLanAddresses({} as Interfaces)).toEqual([]);
  });
});

describe('stripIpv6Prefix', () => {
  it('unwraps IPv4-mapped addresses', () => {
    expect(stripIpv6Prefix('::ffff:192.168.1.5')).toBe('192.168.1.5');
    expect(stripIpv6Prefix('::1')).toBe('::1');
    expect(stripIpv6Prefix(undefined)).toBeNull();
  });
});
