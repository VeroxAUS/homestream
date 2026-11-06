import { describe, expect, it } from 'vitest';
import { ProgressParser } from '../../src/playback/progress.js';

const BLOCK = (fps: string, speed: string, outUs: string, bitrate = '8123.4kbits/s') =>
  [
    `frame=100`,
    `fps=${fps}`,
    `bitrate=${bitrate}`,
    `out_time_us=${outUs}`,
    `out_time_ms=${outUs}`,
    `speed=${speed}`,
    'progress=continue',
    '',
  ].join('\n');

describe('ProgressParser', () => {
  it('turns a progress block into stats', () => {
    const parser = new ProgressParser();
    expect(parser.push(BLOCK('96.5', '4.02x', '8000000'))).toEqual([
      { fps: 96.5, speed: 4.02, bitrateKbps: 8123.4, outTimeSec: 8 },
    ]);
  });

  it('handles chunks split mid-line and several blocks at once', () => {
    const parser = new ProgressParser();
    const text = BLOCK('24', '1.5x', '4000000') + BLOCK('25', '1.6x', '8000000');
    expect(parser.push(text.slice(0, 30))).toEqual([]);
    const rest = parser.push(text.slice(30));
    expect(rest.map((p) => p.outTimeSec)).toEqual([4, 8]);
  });

  it('keeps the previous reading when ffmpeg reports N/A', () => {
    const parser = new ProgressParser();
    parser.push(BLOCK('24', '2.0x', '4000000'));
    const [next] = parser.push(BLOCK('24', 'N/A', '8000000', 'N/A'));
    expect(next).toMatchObject({ speed: 2, bitrateKbps: 8123.4, outTimeSec: 8 });
  });

  it('copes with CRLF output and ignores garbage', () => {
    const parser = new ProgressParser();
    const [snapshot] = parser.push('noise\r\nfps=30\r\nspeed=3.0x\r\nout_time_us=2000000\r\nprogress=end\r\n');
    expect(snapshot).toMatchObject({ fps: 30, speed: 3, outTimeSec: 2 });
  });
});
