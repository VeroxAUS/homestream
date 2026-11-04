import { Bonjour, type Service } from 'bonjour-service';
import { describe, expect, it } from 'vitest';
import { startDiscovery } from '../src/discovery.js';

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

describe('startDiscovery', () => {
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
