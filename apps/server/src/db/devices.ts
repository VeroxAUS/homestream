import { CapabilityProfileSchema, type CapabilityProfile, type Device } from '@homestream/shared';
import type { Db } from './index.js';

interface DeviceRow {
  id: string;
  name: string;
  kind: string;
  capabilities: string;
  last_ip: string | null;
  last_seen: number;
}

function toDevice(row: DeviceRow): Device {
  const capabilities = CapabilityProfileSchema.parse(JSON.parse(row.capabilities));
  return {
    id: row.id,
    deviceId: row.id,
    name: row.name,
    kind: capabilities.kind,
    capabilities,
    lastIp: row.last_ip,
    lastSeen: new Date(row.last_seen).toISOString(),
  };
}

export function upsertDevice(db: Db, profile: CapabilityProfile, ip: string | null, now = Date.now()): Device {
  db.prepare(
    `INSERT INTO devices (id, name, kind, capabilities, last_ip, last_seen)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       kind = excluded.kind,
       capabilities = excluded.capabilities,
       last_ip = excluded.last_ip,
       last_seen = excluded.last_seen`,
  ).run(profile.deviceId, profile.deviceName, profile.kind, JSON.stringify(profile), ip, now);
  return getDevice(db, profile.deviceId) as Device;
}

export function getDevice(db: Db, id: string): Device | null {
  const row = db.prepare('SELECT * FROM devices WHERE id = ?').get(id) as DeviceRow | undefined;
  return row ? toDevice(row) : null;
}

export function listDevices(db: Db): Device[] {
  const rows = db.prepare('SELECT * FROM devices ORDER BY last_seen DESC, id ASC').all() as unknown as DeviceRow[];
  return rows.map(toDevice);
}
