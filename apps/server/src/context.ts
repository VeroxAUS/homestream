import type { Config } from './config.js';
import type { Db } from './db/index.js';
import type { EventBus } from './events/bus.js';
import type { GatewayClient } from './gateway/client.js';
import type { StreamService } from './streams/service.js';
import type { TmdbService } from './tmdb/service.js';
import type { FastifyBaseLogger } from 'fastify';

export interface AppContext {
  config: Config;
  db: Db;
  bus: EventBus;
  logger: FastifyBaseLogger;
  tmdb: TmdbService;
  gateway: GatewayClient;
  streams: StreamService;
}
