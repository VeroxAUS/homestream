import { describe, expect, it } from 'vitest';
import { parseArgs, serverEnv } from '../../../../scripts/profile-server.mjs';

describe('profile-server', () => {
  it('defaults to port 8602 and 8 seconds', () => {
    expect(parseArgs([])).toEqual({ port: 8602, seconds: 8 });
    expect(parseArgs(['--port=8610', '--seconds=3'])).toEqual({ port: 8610, seconds: 3 });
  });

  it('refuses ports outside the HomeStream range, bad durations and unknown options', () => {
    expect(parseArgs(['--port=3000'])).toBeNull();
    expect(parseArgs(['--port=8650'])).toBeNull();
    expect(parseArgs(['--seconds=0'])).toBeNull();
    expect(parseArgs(['--seconds=500'])).toBeNull();
    expect(parseArgs(['--verbose'])).toBeNull();
  });

  it('runs the server on a throw-away data directory with telemetry and the NVENC test off', () => {
    const env = serverEnv(8603, '/tmp/profile', { PATH: 'x', SENTRY_DSN_SERVER: 'https://k@example.test/1' });
    expect(env).toMatchObject({
      PORT: '8603',
      SOURCE_PROXY_PORT: '8653',
      DATA_DIR: '/tmp/profile',
      HOMESTREAM_TELEMETRY: 'off',
      HEALTH_NVENC_TEST: 'off',
      PATH: 'x',
    });
  });
});
