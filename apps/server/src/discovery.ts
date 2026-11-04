import { Bonjour } from 'bonjour-service';

export interface DiscoveryOptions {
  name: string;
  version: string;
  port: number;
  onError?: (error: Error) => void;
}

export interface Discovery {
  /** Sends the mDNS goodbye packets and releases the sockets. */
  stop(): Promise<void>;
}

export function startDiscovery(options: DiscoveryOptions): Discovery {
  const onError = options.onError ?? (() => undefined);
  let bonjour: Bonjour | null = null;
  try {
    bonjour = new Bonjour(undefined, onError);
    bonjour.publish({
      name: options.name,
      type: 'homestream',
      protocol: 'tcp',
      port: options.port,
      txt: { name: options.name, version: options.version },
    });
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
