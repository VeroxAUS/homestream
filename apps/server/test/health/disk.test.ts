import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkDisk } from '../../src/health/checks/disk.js';
import { diskSpace } from '../../src/health/exec.js';
import { makeTempDir, removeDir } from '../helpers.js';

const GIB = 1024 ** 3;

let root: string;
beforeAll(() => {
  root = makeTempDir('health-disk');
});
afterAll(() => removeDir(root));

describe('checkDisk', () => {
  const config = {
    transcodeDir: 'E:\\HomeStream\\transcode',
    dataDir: 'D:\\HomeStream\\data',
    transcodeMaxGb: 20,
    diskWarnFreeGb: 20,
  };
  const space = (freeGb: Record<string, number>) => async (dir: string) => ({
    freeBytes: (freeGb[dir.slice(0, 1)] ?? 500) * GIB,
    totalBytes: 1000 * GIB,
  });
  const usage = () => ({ bytes: 3 * GIB, capBytes: 20 * GIB });

  it('reports both drives, transcode usage and the cap', async () => {
    const outcome = await checkDisk({ config, probe: space({ E: 800, D: 300 }), usage });
    expect(outcome.status).toBe('ok');
    expect(outcome.details).toMatchObject({
      transcode: { drive: 'E:', freeGb: 800 },
      data: { drive: 'D:', freeGb: 300 },
      transcodeUsageGb: 3,
      transcodeMaxGb: 20,
      transcodeUsagePct: 15,
    });
  });

  it.each([
    [25, 'ok'],
    [19.9, 'warn'],
    [5, 'warn'],
    [4.9, 'error'],
  ] as const)('with %d GB free the status is %s', async (free, status) => {
    const outcome = await checkDisk({ config, probe: space({ E: free }), usage });
    expect(outcome.status).toBe(status);
    if (status !== 'ok') {
      expect(outcome.hint).toContain('E:');
      expect(outcome.message).toContain(String(free));
    }
  });

  it.each([
    [100, 150, 'warn'],
    [100, 100, 'ok'],
    [100, 50, 'ok'],
    [10, 8, 'ok'],
    [4.9, 8, 'error'],
  ] as const)('with %d GB free and DISK_WARN_FREE_GB=%d the status is %s', async (free, warnAt, status) => {
    const outcome = await checkDisk({
      config: { ...config, diskWarnFreeGb: warnAt },
      probe: space({ E: free, D: free }),
      usage,
    });
    expect(outcome.status).toBe(status);
    expect(outcome.details).toMatchObject({ thresholds: { warnFreeGb: warnAt, errorFreeGb: 5 } });
    if (status === 'warn') {
      expect(outcome.message).toContain(`${free} GB free`);
      expect(outcome.hint).toMatch(/Free up space on E:.*DISK_WARN_FREE_GB/);
    }
  });

  it('warns on a real drive when DISK_WARN_FREE_GB is above its free space and stays ok at the default', async () => {
    const real = { transcodeDir: root, dataDir: root, transcodeMaxGb: 20 };
    const freeGb = (await diskSpace(root)).freeBytes / GIB;
    const warned = await checkDisk({ config: { ...real, diskWarnFreeGb: freeGb + 1000 }, probe: diskSpace, usage });
    expect(warned).toMatchObject({ status: 'warn', hint: expect.stringContaining('DISK_WARN_FREE_GB') });
    const normal = await checkDisk({ config: { ...real, diskWarnFreeGb: 20 }, probe: diskSpace, usage });
    expect(normal.status).toBe(freeGb < 20 ? 'warn' : 'ok');
  });

  it('with a warn level below the 5 GB error level the status goes straight from ok to error', async () => {
    const low = { ...config, diskWarnFreeGb: 3 };
    expect((await checkDisk({ config: low, probe: space({ E: 4, D: 500 }), usage })).status).toBe('error');
    expect((await checkDisk({ config: low, probe: space({ E: 5, D: 500 }), usage })).status).toBe('ok');
  });

  it('judges the fuller of the two drives', async () => {
    const outcome = await checkDisk({ config, probe: space({ E: 500, D: 3 }), usage });
    expect(outcome).toMatchObject({ status: 'error', hint: expect.stringContaining('DATA_DIR') });
  });

  it('warns when the transcode cache is over its cap', async () => {
    const outcome = await checkDisk({
      config,
      probe: space({}),
      usage: () => ({ bytes: 21 * GIB, capBytes: 20 * GIB }),
    });
    expect(outcome.status).toBe('warn');
  });

  it('is an error when the drive cannot be read', async () => {
    const outcome = await checkDisk({ config, probe: () => Promise.reject(new Error('EIO')), usage });
    expect(outcome).toMatchObject({ status: 'error', hint: expect.stringContaining('TRANSCODE_DIR') });
  });
});
