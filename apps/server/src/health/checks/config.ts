import { REQUIRED_KEYS, type Config } from '../../config.js';
import type { CheckOutcome } from './types.js';

const OPTIONAL_KEYS = ['TORBOX_API_KEY'] as const;

/** Reports which keys are set by name only; no value, prefix or length of any secret leaves this function. */
export function checkConfig(config: Config): CheckOutcome {
  const present: Record<string, boolean> = {
    GATEWAY_MANIFEST_URL: !!config.gatewayManifestUrl,
    TMDB_READ_TOKEN: !!config.tmdbReadToken,
    TORBOX_API_KEY: !!config.torboxApiKey,
  };
  const keys = [
    ...REQUIRED_KEYS.map((name) => ({ name, required: true, present: present[name] ?? false })),
    ...OPTIONAL_KEYS.map((name) => ({ name, required: false, present: present[name] ?? false })),
  ];
  const details = {
    configFile: config.configFile.path,
    configFileExists: config.configFile.exists,
    keys,
    warnings: config.warnings,
  };

  if (config.missingKeys.length > 0) {
    const names = config.missingKeys.join(', ');
    return {
      status: 'error',
      message: `Missing required setting${config.missingKeys.length > 1 ? 's' : ''}: ${names}.`,
      hint: `Add ${names} to ${config.configFile.path}${config.configFile.exists ? '' : ' (the file does not exist yet, create it)'} and restart HomeStream.`,
      details,
    };
  }
  if (config.warnings.length > 0) {
    return {
      status: 'warn',
      message: `${config.warnings.length === 1 ? 'A setting has' : `${config.warnings.length} settings have`} an invalid value and the default is used.`,
      hint: `Fix the value in ${config.configFile.path} (see the warning text in the details) and restart HomeStream.`,
      details,
    };
  }
  return { status: 'ok', message: `All required settings are present (${config.configFile.path}).`, details };
}
