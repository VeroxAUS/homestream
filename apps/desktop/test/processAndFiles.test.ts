import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { nodeFileIo, readJson, writeJson } from '../src/jsonFile.js';
import { spawnServerChild, type ExitInfo, type ServerChild } from '../src/serverProcess.js';

const temp = mkdtempSync(path.join(os.tmpdir(), 'hs-desktop-proc-'));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

function launch(script: string) {
  return spawnServerChild({ command: process.execPath, args: ['-e', script], env: { ...process.env } });
}

function exitOf(child: ServerChild, timeoutMs = 8000): Promise<ExitInfo> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('the child did not exit')), timeoutMs);
    child.onExit((info) => {
      clearTimeout(timer);
      resolve(info);
    });
  });
}

describe('spawnServerChild', () => {
  it('delivers whole output lines and stops on the shutdown line', async () => {
    const child = launch(`
      console.log('first line'); console.error('an error line');
      process.stdin.on('data', (chunk) => { if (chunk.toString().trim() === 'shutdown') { console.log('bye'); process.exit(0); } });
    `);
    const lines: string[] = [];
    child.onOutput((line, stream) => lines.push(`${stream}:${line}`));
    const exited = exitOf(child);
    while (!lines.includes('stderr:an error line')) await new Promise((resolve) => setTimeout(resolve, 25));
    child.requestShutdown();
    expect(await exited).toMatchObject({ code: 0 });
    expect(lines).toEqual(expect.arrayContaining(['stdout:first line', 'stderr:an error line']));
    expect(child.pid).toBeTypeOf('number');
  });

  it('ends a server that ignores the shutdown line, process tree included', async () => {
    const child = launch(`process.stdin.resume(); setInterval(() => {}, 1000); console.log('up');`);
    const up = new Promise<void>((resolve) => child.onOutput(() => resolve()));
    const exited = exitOf(child);
    await up;
    child.forceKill();
    const info = await exited;
    expect(info.code === 0).toBe(false);
    child.forceKill();
    child.requestShutdown();
  });

  it('ends the child directly on platforms without taskkill', async () => {
    const child = spawnServerChild(
      { command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], env: { ...process.env } },
      'linux',
    );
    const exited = exitOf(child);
    child.forceKill();
    expect((await exited).code === 0).toBe(false);
  });

  it('reports a program that cannot start as an exit without a code', async () => {
    const child = spawnServerChild({ command: path.join(temp, 'no-such-program.exe'), args: [], env: {} });
    expect(await exitOf(child)).toEqual({ code: null, signal: null });
    child.forceKill();
  });
});

describe('nodeFileIo', () => {
  it('writes through a temporary file, replaces an existing file and creates folders', () => {
    const file = path.join(temp, 'deep', 'er', 'settings.json');
    writeJson(file, { a: 1 });
    writeJson(file, { a: 2 });
    expect(readJson(file)).toEqual({ a: 2 });
    expect(readFileSync(file, 'utf8').endsWith('\n')).toBe(true);
    expect(nodeFileIo.read(path.join(temp, 'missing.json'))).toBeNull();
  });

  it('throws and leaves no temporary file when the target cannot be written', () => {
    const blocker = path.join(temp, 'a-file');
    writeFileSync(blocker, 'x');
    expect(() => nodeFileIo.writeAtomic(path.join(blocker, 'child.json'), '{}')).toThrow();
  });
});
