import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { run } from './harness.js';

export interface FailingFfmpegOptions {
  /**
   * The first N encoder invocations (command lines with `-f hls`) exit 1 without doing anything; later ones, and every
   * other invocation (subtitle extraction, version checks), run the real ffmpeg. Default: all encoder invocations fail.
   */
  failFirst?: number;
  /** ffmpeg to forward to. */
  realFfmpeg?: string;
}

/**
 * Builds a stand-in for ffmpeg.exe (use it as FFMPEG_PATH). Every encoder invocation appends a line to `counter`
 * (see `readCounter`) so a test can tell how many encoders a start launched.
 */
export async function buildFailingFfmpeg(exe: string, counter: string, options: FailingFfmpegOptions = {}): Promise<void> {
  const failFirst = options.failFirst ?? 2_000_000_000;
  const real = (options.realFfmpeg ?? 'ffmpeg').replace(/\\/g, '\\\\');
  const source = `
using System;
using System.Diagnostics;
using System.IO;
using System.Text;
class W {
  static string Quote(string a) {
    if (a.Length > 0 && a.IndexOfAny(new[] { ' ', '"', '\\t' }) < 0) return a;
    return "\\"" + a.Replace("\\\\", "\\\\\\\\").Replace("\\"", "\\\\\\"") + "\\"";
  }
  static int Main(string[] args) {
    bool encode = false;
    for (int i = 0; i + 1 < args.Length; i++) if (args[i] == "-f" && args[i + 1] == "hls") encode = true;
    if (encode) {
      string file = @"${counter}";
      File.AppendAllText(file, "x\\n");
      int n = File.ReadAllText(file).Split('x').Length - 1;
      if (n <= ${failFirst}) {
        Console.Error.WriteLine("simulated encoder failure while reading https://cdn.example.test/file?token=abc123456789");
        return 1;
      }
    }
    var sb = new StringBuilder();
    foreach (string a in args) { if (sb.Length > 0) sb.Append(' '); sb.Append(Quote(a)); }
    var psi = new ProcessStartInfo("${real}", sb.ToString()) { UseShellExecute = false };
    using (var p = Process.Start(psi)) { p.WaitForExit(); return p.ExitCode; }
  }
}`;
  const script = `Add-Type -TypeDefinition @'\n${source}\n'@ -OutputAssembly '${exe}' -OutputType ConsoleApplication`;
  await run('powershell.exe', ['-NoProfile', '-Command', `New-Item -ItemType Directory -Force '${path.dirname(exe)}' | Out-Null; ${script}`], 120_000);
}

/** Number of encoder invocations the wrapper has seen. */
export function readCounter(file: string): number {
  return existsSync(file) ? readFileSync(file, 'utf8').split('x').length - 1 : 0;
}
