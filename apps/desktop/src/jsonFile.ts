import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface FileIo {
  read(file: string): string | null;
  /** Writes through a temporary file and a rename, so a reader never sees half a file. */
  writeAtomic(file: string, text: string): void;
}

export const nodeFileIo: FileIo = {
  read(file) {
    try {
      return readFileSync(file, 'utf8');
    } catch {
      return null;
    }
  },
  writeAtomic(file, text) {
    mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    try {
      writeFileSync(temp, text, 'utf8');
      renameSync(temp, file);
    } catch (error) {
      rmSync(temp, { force: true });
      throw error;
    }
  },
};

/** Parsed JSON of a file, or `null` when it is missing or not valid JSON. */
export function readJson(file: string, io: FileIo = nodeFileIo): unknown {
  const text = io.read(file);
  if (text === null) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export function writeJson(file: string, value: unknown, io: FileIo = nodeFileIo): void {
  io.writeAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}
