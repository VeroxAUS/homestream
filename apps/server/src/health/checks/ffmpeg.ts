import type { Config } from '../../config.js';
import type { CommandResult, CommandRunner } from '../exec.js';
import { failure, type CheckOutcome } from './types.js';

const FFMPEG_VERSION_TIMEOUT_MS = 10_000;
const NVENC_TEST_TIMEOUT_MS = 20_000;

export interface FfmpegCheckDeps {
  config: Pick<Config, 'ffmpegPath' | 'ffprobePath' | 'configFile' | 'healthNvencTest'>;
  run: CommandRunner;
  now?: () => number;
}

export function parseVersion(output: string): string | null {
  const match = /\bversion\s+n?([^\s]+)/i.exec(output.split(/\r?\n/, 1)[0] ?? '');
  return match?.[1] ? (match[1].split('-')[0] ?? null) : null;
}

export function parseEncoders(output: string, names: readonly string[]): Record<string, boolean> {
  const found: Record<string, boolean> = {};
  for (const name of names) found[name] = new RegExp(`^\\s*V\\S*\\s+${name}\\b`, 'm').test(output);
  return found;
}

function lastLine(text: string): string {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return (lines[lines.length - 1] ?? '').slice(0, 200);
}

function notRunnable(result: CommandResult): boolean {
  return result.failure !== undefined || result.code !== 0;
}

/** ffmpeg/ffprobe found, NVENC encoders listed, and a real 1 s NVENC encode (the part that touches the GPU; see `healthNvencTest`). */
export async function checkFfmpeg({ config, run, now = Date.now }: FfmpegCheckDeps): Promise<CheckOutcome> {
  const where = `FFMPEG_PATH in ${config.configFile.path}`;
  const missingHint = `Set ${where} to the full path of ffmpeg.exe (for example C:\\ffmpeg\\bin\\ffmpeg.exe), or install ffmpeg and add it to PATH, then restart HomeStream.`;

  const version = await run(config.ffmpegPath, ['-hide_banner', '-version'], { timeoutMs: FFMPEG_VERSION_TIMEOUT_MS });
  if (notRunnable(version)) {
    const missing = version.failure === 'ENOENT' || version.failure === 'EACCES';
    return failure(
      missing ? 'ffmpeg was not found.' : 'ffmpeg did not start.',
      missing ? missingHint : `ffmpeg is installed but failed to run. Re-install it and check ${where}.`,
      { ffmpegFound: false },
    );
  }
  const probe = await run(config.ffprobePath, ['-hide_banner', '-version'], { timeoutMs: FFMPEG_VERSION_TIMEOUT_MS });
  if (notRunnable(probe)) {
    return failure(
      'ffprobe was not found.',
      `Set FFPROBE_PATH in ${config.configFile.path} to the full path of ffprobe.exe (it ships next to ffmpeg.exe), then restart HomeStream.`,
      { ffmpegFound: true, ffmpegVersion: parseVersion(version.stdout), ffprobeFound: false },
    );
  }

  const ffmpegVersion = parseVersion(version.stdout);
  const ffprobeVersion = parseVersion(probe.stdout);
  const encoderList = await run(config.ffmpegPath, ['-hide_banner', '-encoders'], {
    timeoutMs: FFMPEG_VERSION_TIMEOUT_MS,
  });
  const encoders = parseEncoders(encoderList.stdout, ['h264_nvenc', 'hevc_nvenc']);
  const base = {
    ffmpegFound: true,
    ffprobeFound: true,
    ffmpegVersion,
    ffprobeVersion,
    h264_nvenc: encoders.h264_nvenc,
    hevc_nvenc: encoders.hevc_nvenc,
  };

  if (!encoders.h264_nvenc || !encoders.hevc_nvenc) {
    const lacking = ['h264_nvenc', 'hevc_nvenc'].filter((name) => !encoders[name]).join(' and ');
    return failure(
      `This ffmpeg build has no ${lacking}.`,
      `Use a full ffmpeg build with NVIDIA NVENC support (for example the "full" build from gyan.dev) and point ${where} to it, then restart HomeStream.`,
      base,
    );
  }

  if (!config.healthNvencTest) {
    return {
      status: 'ok',
      message: `ffmpeg ${ffmpegVersion ?? '?'} and ffprobe ${ffprobeVersion ?? '?'} found with NVENC encoders (test encode switched off).`,
      details: { ...base, testEncode: { ok: null, skipped: true } },
    };
  }

  const started = now();
  const encode = await run(
    config.ffmpegPath,
    [
      '-hide_banner',
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'testsrc=duration=1:size=1280x720:rate=30',
      '-c:v',
      'h264_nvenc',
      '-f',
      'null',
      '-',
    ],
    { timeoutMs: NVENC_TEST_TIMEOUT_MS },
  );
  const durationMs = now() - started;
  const testedAt = new Date(now()).toISOString();
  if (notRunnable(encode)) {
    return failure(
      'The NVENC test encode failed.',
      `The NVIDIA encoder did not start. Update the NVIDIA driver, make sure the GPU is not disabled or fully used by another program, and check that ${where} points to an ffmpeg build with NVENC.`,
      {
        ...base,
        testEncode: { ok: false, durationMs, testedAt, error: lastLine(encode.stderr) || encode.failure || null },
      },
    );
  }
  return {
    status: 'ok',
    message: `ffmpeg ${ffmpegVersion ?? '?'} and ffprobe ${ffprobeVersion ?? '?'} found; NVENC test encode worked (${durationMs} ms).`,
    details: { ...base, testEncode: { ok: true, durationMs, testedAt } },
  };
}
