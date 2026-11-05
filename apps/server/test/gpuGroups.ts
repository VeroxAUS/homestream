/**
 * Test files that start ffmpeg/ffprobe (NVENC, NVDEC, CUDA). They run in the sequential `gpu` vitest project,
 * one file at a time (AGENTS.md "GPU safety"). Every other test file must stay free of ffmpeg.
 */
export const GPU_TEST_GLOBS = [
  'test/encode/**/*.test.ts',
  'test/prefetch/**/*.test.ts',
  'test/playback/sessions-routes.test.ts',
];

/** Hard ceilings for the gpu project; individual tests may set a lower timeout, never a higher default. */
export const GPU_TEST_TIMEOUT_MS = 60_000;
export const GPU_HOOK_TIMEOUT_MS = 180_000;
