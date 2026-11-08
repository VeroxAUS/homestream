import { Bonjour, type Service } from 'bonjour-service';
import { getLanAddresses } from './net.js';

export interface DiscoveryOptions {
  name: string;
  version: string;
  port: number;
  /** Addresses to advertise; defaults to the filtered LAN list that `/api/info` reports. */
  addresses?: () => string[];
  onError?: (error: Error) => void;
}

export interface Discovery {
  /** Sends the mDNS goodbye packets and releases the sockets. */
  stop(): Promise<void>;
}

type DnsRecord = ReturnType<Service['records']>[number];

/**
 * bonjour-service adds an A/AAAA record for every adapter it finds, including WSL and Hyper-V switches whose
 * addresses other devices cannot reach. Replaces them with A records for exactly `addresses` (no AAAA).
 */
export function withAddresses(records: DnsRecord[], host: string, addresses: string[]): DnsRecord[] {
  const kept = records.filter((record) => record.type !== 'A' && record.type !== 'AAAA');
  const own: DnsRecord[] = addresses.map((address) => ({ name: host, type: 'A', ttl: 120, data: address }));
  return [...kept, ...own];
}

export function startDiscovery(options: DiscoveryOptions): Discovery {
  const onError = options.onError ?? (() => undefined);
  const addresses = options.addresses ?? getLanAddresses;
  let bonjour: Bonjour | null = null;
  try {
    bonjour = new Bonjour(undefined, onError);
    const service = bonjour.publish({
      name: options.name,
      type: 'homestream',
      protocol: 'tcp',
      port: options.port,
      txt: { name: options.name, version: options.version },
    });
    // publish() probes the name for at least 250 ms before the first announce reads records(), so this
    // replacement is in place before anything is sent (and the goodbye packets use it too).
    const original = service.records.bind(service);
    service.records = () => withAddresses(original(), service.host, addresses());
  } catch (error) {
    // Discovery is best effort: the server stays reachable by address.
    onError(error as Error);
    bonjour = null;
  }

  return {
    stop: () =>
      new Promise<void>((resolve) => {
        const instance = bonjour;
        bonjour = null;
        if (!instance) return resolve();
        const timer = setTimeout(resolve, 2000);
        instance.unpublishAll(() => {
          clearTimeout(timer);
          instance.destroy(() => resolve());
        });
      }),
  };
}
