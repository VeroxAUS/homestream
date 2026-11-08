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
      Ethernet: [iface('172.20.0.7')],
      'Ethernet 2': [iface('10.5.0.1')],
      'Wi-Fi': [iface('192.168.1.50'), iface('fe80::1', false, 'IPv6')],
      Bad: [iface('169.254.3.4')],
      Uplink: [iface('203.0.113.9')],
    } as unknown as Interfaces;
    expect(getLanAddresses(interfaces)).toEqual(['192.168.1.50', '10.5.0.1', '172.20.0.7', '203.0.113.9']);
  });

  it.each([
    'vEthernet (WSL)',
    'vEthernet (WSL (Hyper-V firewall))',
    'vEthernet (Default Switch)',
    'Hyper-V Virtual Ethernet Adapter',
    'docker0',
    'Docker NAT',
    'VirtualBox Host-Only Network',
    'VMware Network Adapter VMnet8',
    'VETHERNET (WSL)',
    'wsl',
    'hyper-v virtual ethernet adapter #2',
    'DOCKER',
    'virtualbox host-only network #3',
    'vmware network adapter vmnet1',
  ])('drops the virtual adapter %s while keeping physical ones', (name) => {
    const interfaces = {
      Ethernet: [iface('192.168.1.50')],
      'Wi-Fi': [iface('10.0.0.8')],
      [name]: [iface('172.28.0.1'), iface('192.168.56.1')],
    } as unknown as Interfaces;
    expect(getLanAddresses(interfaces)).toEqual(['192.168.1.50', '10.0.0.8']);
  });

  it('removes loopback, link-local and IPv6 addresses even from physical adapters', () => {
    const interfaces = {
      Ethernet: [
        iface('192.168.1.50'),
        iface('169.254.12.9'),
        iface('127.0.0.1'),
        iface('fe80::1', false, 'IPv6'),
        iface('2001:db8::5', false, 'IPv6'),
      ],
      Loopback: [iface('127.0.0.1', true)],
    } as unknown as Interfaces;
    expect(getLanAddresses(interfaces)).toEqual(['192.168.1.50']);
  });

  it('falls back to every non-internal IPv4 address when only virtual adapters are left', () => {
    const interfaces = {
      'vEthernet (WSL)': [iface('172.28.0.1')],
      'vEthernet (Default Switch)': [iface('192.168.240.1')],
      'VirtualBox Host-Only Network': [iface('192.168.56.1'), iface('fe80::2', false, 'IPv6')],
      Loopback: [iface('127.0.0.1', true)],
    } as unknown as Interfaces;
    expect(getLanAddresses(interfaces)).toEqual(['192.168.240.1', '192.168.56.1', '172.28.0.1']);
  });

  it('falls back to link-local addresses (last) when nothing else exists', () => {
    const interfaces = {
      Ethernet: [iface('169.254.3.4')],
      'Docker NAT': [iface('172.17.0.1')],
    } as unknown as Interfaces;
    expect(getLanAddresses(interfaces)).toEqual(['172.17.0.1', '169.254.3.4']);
    expect(getLanAddresses({ Ethernet: [iface('169.254.3.4')] } as unknown as Interfaces)).toEqual(['169.254.3.4']);
  });

  it('treats a missing entry list as empty and de-duplicates addresses', () => {
    const interfaces = {
      Missing: undefined,
      Ethernet: [iface('192.168.1.50')],
      'Ethernet 2': [iface('192.168.1.50')],
    } as unknown as Interfaces;
    expect(getLanAddresses(interfaces)).toEqual(['192.168.1.50']);
  });

  it('returns an empty list when there is no network at all', () => {
    expect(getLanAddresses({} as Interfaces)).toEqual([]);
    expect(getLanAddresses({ Loopback: [iface('127.0.0.1', true)] } as unknown as Interfaces)).toEqual([]);
  });
});

describe('stripIpv6Prefix', () => {
  it('unwraps IPv4-mapped addresses', () => {
    expect(stripIpv6Prefix('::ffff:192.168.1.5')).toBe('192.168.1.5');
    expect(stripIpv6Prefix('::1')).toBe('::1');
    expect(stripIpv6Prefix(undefined)).toBeNull();
  });
});
