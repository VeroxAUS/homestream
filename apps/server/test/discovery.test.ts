import { Bonjour, type Service } from 'bonjour-service';
import { describe, expect, it } from 'vitest';
import { startDiscovery, withAddresses } from '../src/discovery.js';

function findService(browser: Bonjour, name: string, timeoutMs: number): Promise<Service | null> {
  return new Promise((resolve) => {
    const finder = browser.find({ type: 'homestream', protocol: 'tcp' }, (service) => {
      if (service.name === name) {
        clearTimeout(timer);
        finder.stop();
        resolve(service);
      }
    });
    const timer = setTimeout(() => {
      finder.stop();
      resolve(null);
    }, timeoutMs);
  });
}

describe('withAddresses', () => {
  const records = [
    { name: '_homestream._tcp.local', type: 'PTR' as const, ttl: 1, data: 'x' },
    { name: 'pc', type: 'A' as const, ttl: 120, data: '172.28.0.1' },
    { name: 'pc', type: 'AAAA' as const, ttl: 120, data: 'fe80::1' },
    { name: 'x._homestream._tcp.local', type: 'SRV' as const, ttl: 1, data: { port: 1, target: 'pc' } },
  ];

  it('swaps every adapter address record for the given addresses and keeps the service records', () => {
    const result = withAddresses(records, 'pc', ['192.168.1.50', '10.0.0.8']);
    expect(result.map((record) => record.type)).toEqual(['PTR', 'SRV', 'A', 'A']);
    expect(result.filter((record) => record.type === 'A').map((record) => [record.name, record.data])).toEqual([
      ['pc', '192.168.1.50'],
      ['pc', '10.0.0.8'],
    ]);
  });

  it('advertises no address record when there are no addresses', () => {
    expect(withAddresses(records, 'pc', []).map((record) => record.type)).toEqual(['PTR', 'SRV']);
  });
});

describe('startDiscovery', () => {
  it('announces only the injected addresses, not every adapter', async () => {
    const name = `HomeStream addr ${process.pid}-${Date.now()}`;
    const discovery = startDiscovery({ name, version: '1.0.0', port: 8613, addresses: () => ['192.0.2.77'] });
    const browser = new Bonjour();
    try {
      const service = await findService(browser, name, 8000);
      expect(service).not.toBeNull();
      expect(service?.addresses).toEqual(['192.0.2.77']);
    } finally {
      await discovery.stop();
      await new Promise<void>((resolve) => browser.destroy(() => resolve()));
    }
  });

  it('advertises _homestream._tcp with name and version TXT records', async () => {
    const name = `HomeStream test ${process.pid}-${Date.now()}`;
    const discovery = startDiscovery({ name, version: '9.9.9', port: 8611 });
    const browser = new Bonjour();
    try {
      const service = await findService(browser, name, 8000);
      expect(service).not.toBeNull();
      expect(service?.port).toBe(8611);
      expect(service?.type).toBe('homestream');
      expect(service?.protocol).toBe('tcp');
      expect(service?.txt).toMatchObject({ name, version: '9.9.9' });
    } finally {
      await discovery.stop();
      await new Promise<void>((resolve) => browser.destroy(() => resolve()));
    }
  });

  it('stop() is safe to call twice', async () => {
    const discovery = startDiscovery({ name: `HomeStream twice ${process.pid}`, version: '1.0.0', port: 8612 });
    await discovery.stop();
    await expect(discovery.stop()).resolves.toBeUndefined();
  });
});
