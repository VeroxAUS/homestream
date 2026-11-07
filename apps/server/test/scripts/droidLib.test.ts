import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { extractJsonObject, normalizeReview, parseDroidOutput, runDroid } from '../../../../scripts/lib/droid.mjs';

const result = (text: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: text, ...extra });

describe('parseDroidOutput', () => {
  it('returns the result text of the last result object', () => {
    expect(parseDroidOutput(`warming up\n${result('the answer')}\n`)).toBe('the answer');
  });

  it('throws when droid reports an error or prints no result', () => {
    expect(() => parseDroidOutput(result('quota exceeded', { is_error: true }))).toThrow('quota exceeded');
    expect(() => parseDroidOutput('nothing useful')).toThrow('no result');
  });
});

describe('extractJsonObject', () => {
  it.each([
    ['a bare object', '{"a":1}'],
    ['a fenced block', 'Here you go:\n```json\n{"a":1}\n```\nDone.'],
    ['an object inside prose', 'Result: {"a":1} end'],
  ])('finds %s', (_name, text) => {
    expect(extractJsonObject(text)).toEqual({ a: 1 });
  });

  it('returns null for text without an object', () => {
    expect(extractJsonObject('no json here')).toBeNull();
    expect(extractJsonObject('[1,2]')).toBeNull();
  });
});

describe('normalizeReview', () => {
  it('normalizes findings, drops empty ones, caps the count and neutralizes mentions', () => {
    const findings = [
      { path: './src/a.ts', line: '12', severity: 'HIGH', title: 'Bad @octocat', body: 'text <!-- hidden --> more' },
      { path: 'src\\b.ts', line: -3, severity: 'weird', title: 'T', body: '' },
      null,
      { title: '', body: '' },
      ...Array.from({ length: 30 }, (_, i) => ({ title: `f${i}`, body: 'b' })),
    ];
    const review = normalizeReview(JSON.stringify({ summary: 'All fine @team', findings }));
    expect(review.structured).toBe(true);
    expect(review.summary).toBe('All fine @\u200bteam');
    expect(review.findings).toHaveLength(15);
    expect(review.findings[0]).toMatchObject({
      path: 'src/a.ts',
      line: 12,
      severity: 'high',
      title: 'Bad @\u200boctocat',
    });
    expect(review.findings[0]?.body).toBe('text  more');
    expect(review.findings[1]).toMatchObject({ path: 'src/b.ts', line: 0, severity: 'medium' });
  });

  it('keeps unstructured text as the summary', () => {
    const review = normalizeReview('I could not produce JSON.');
    expect(review).toMatchObject({ structured: false, findings: [], summary: 'I could not produce JSON.' });
  });
});

function fakeSpawn(
  behaviour: (child: EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => void }) => void,
) {
  const calls: Array<{ command: string; args: string[]; env: NodeJS.ProcessEnv }> = [];
  const impl = (command: string, args: string[], options: { env: NodeJS.ProcessEnv }) => {
    calls.push({ command, args, env: options.env });
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      kill: () => {},
    });
    setImmediate(() => behaviour(child));
    return child;
  };
  return { impl, calls };
}

describe('runDroid', () => {
  const secret = 'fk-super-secret-value-123';

  it('runs droid exec read-only with the prompt file and returns the answer', async () => {
    const spawn = fakeSpawn((child) => {
      child.stdout.emit('data', `${result('{"summary":"ok","findings":[]}')}\n`);
      child.emit('close', 0);
    });
    const answer = await runDroid({
      promptFile: '/tmp/p.md',
      cwd: '/work',
      env: { FACTORY_API_KEY: secret },
      spawnImpl: spawn.impl,
    });
    expect(answer).toBe('{"summary":"ok","findings":[]}');
    expect(spawn.calls[0]?.command).toBe('droid');
    expect(spawn.calls[0]?.args).toEqual([
      'exec',
      '--output-format',
      'json',
      '--only-tools',
      'Read,Grep,Glob,LS',
      '--file',
      '/tmp/p.md',
      '--cwd',
      '/work',
    ]);
    expect(spawn.calls[0]?.args.join(' ')).not.toMatch(/--auto|skip-permissions/);
  });

  it('never repeats the key or token from a failing child in the error', async () => {
    const spawn = fakeSpawn((child) => {
      child.stderr.emit('data', `auth failed for ${secret} and ghs_tokenvalue1234`);
      child.emit('close', 2);
    });
    const error = await runDroid({
      promptFile: 'p',
      cwd: '.',
      env: { FACTORY_API_KEY: secret, GITHUB_TOKEN: 'ghs_tokenvalue1234' },
      spawnImpl: spawn.impl,
    }).catch((e: Error) => e);
    expect((error as Error).message).toContain('exited with 2');
    expect((error as Error).message).not.toContain(secret);
    expect((error as Error).message).not.toContain('ghs_tokenvalue1234');
  });

  it('rejects when the process cannot start and when it takes too long', async () => {
    const missing = fakeSpawn((child) => child.emit('error', new Error('spawn droid ENOENT')));
    await expect(runDroid({ promptFile: 'p', cwd: '.', env: {}, spawnImpl: missing.impl })).rejects.toThrow('ENOENT');
    const hung = fakeSpawn(() => {});
    await expect(runDroid({ promptFile: 'p', cwd: '.', env: {}, spawnImpl: hung.impl, timeoutMs: 20 })).rejects.toThrow(
      'did not finish',
    );
  });
});
