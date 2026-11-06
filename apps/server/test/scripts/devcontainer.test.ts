import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const read = (file: string): string => readFileSync(path.join(root, file), 'utf8');

interface DevContainer {
  build: { dockerfile: string };
  postCreateCommand: string;
  forwardPorts: number[];
  customizations: { vscode: { extensions: string[] } };
}

describe('dev container', () => {
  const config = JSON.parse(read('.devcontainer/devcontainer.json')) as DevContainer;
  const dockerfile = read('.devcontainer/Dockerfile');

  it('builds from a Dockerfile that exists', () => {
    expect(existsSync(path.join(root, '.devcontainer', config.build.dockerfile))).toBe(true);
  });

  it('uses a pinned Node 24 image and installs ffmpeg and pnpm', () => {
    expect(dockerfile).toMatch(/^FROM node:24[\w.-]*$/m);
    expect(dockerfile).not.toMatch(/:latest/);
    expect(dockerfile).toMatch(/apt-get install[^\n]*\bffmpeg\b/);
    expect(dockerfile).toMatch(/npm install --global pnpm@\d+/);
  });

  it('runs the bootstrap script after creation', () => {
    expect(config.postCreateCommand).toBe('node scripts/bootstrap.mjs');
    expect(existsSync(path.join(root, 'scripts', 'bootstrap.mjs'))).toBe(true);
  });

  it('forwards the server and web dev ports and recommends the repository extensions', () => {
    expect(config.forwardPorts).toEqual([8600, 8601]);
    expect(config.customizations.vscode.extensions).toEqual(
      expect.arrayContaining(['esbenp.prettier-vscode', 'dbaeumer.vscode-eslint']),
    );
  });

  it('matches the Node major version in .nvmrc', () => {
    expect(read('.nvmrc').trim()).toBe('24');
  });
});
