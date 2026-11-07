export interface CliFlags {
  /** Start straight to the tray, no window. */
  hidden: boolean;
  /** A second launch asking the running instance to quit. */
  quit: boolean;
}

/** Reads the app's own flags from a command line. Everything else (Chromium switches, the script path) is ignored. */
export function parseCliFlags(argv: readonly string[]): CliFlags {
  return { hidden: argv.includes('--hidden'), quit: argv.includes('--quit') };
}

/** The arguments the Run entry carries: `--hidden` only when Start minimised to tray is on. */
export function loginItemArgs(startMinimized: boolean): string[] {
  return startMinimized ? ['--hidden'] : [];
}
