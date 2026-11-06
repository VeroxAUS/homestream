import { execFileSync } from 'node:child_process';

let cached: boolean | undefined;

/** True when ffmpeg lists both NVENC encoders and an NVIDIA driver answers; neither call touches the encoder. */
export function hasNvenc(): boolean {
  cached ??= detectNvenc();
  return cached;
}

function detectNvenc(): boolean {
  const run = (file: string, args: string[]): string =>
    execFileSync(file, args, {
      encoding: 'utf8',
      timeout: 15_000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  try {
    const encoders = run(process.env.FFMPEG_PATH?.trim() || 'ffmpeg', ['-hide_banner', '-encoders']);
    if (!encoders.includes('h264_nvenc') || !encoders.includes('hevc_nvenc')) return false;
    run('nvidia-smi', ['-L']);
    return true;
  } catch {
    return false;
  }
}
