import { CapabilityProfileSchema, type Device, type DevicesResponse } from '@homestream/shared';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { listDevices, upsertDevice } from '../db/devices.js';
import { invalidRequest } from '../errors.js';
import { stripIpv6Prefix } from '../net.js';

export function registerDeviceRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post('/api/devices', async (request): Promise<Device> => {
    const parsed = CapabilityProfileSchema.safeParse(request.body);
    if (!parsed.success) throw invalidRequest(parsed.error);
    return upsertDevice(ctx.db, parsed.data, stripIpv6Prefix(request.ip));
  });

  app.get('/api/devices', async (): Promise<DevicesResponse> => ({ devices: listDevices(ctx.db) }));
}
