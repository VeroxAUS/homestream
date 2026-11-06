/**
 * Registry of feature flags and experiments (PostHog). Every flag the code evaluates is declared here with its local default,
 * so an unreachable or unconfigured PostHog never changes behavior. `pnpm flags:check` fails for a flag that nothing
 * references and for an evaluated key that is not declared here; `pnpm flags:sync` creates the flags in PostHog.
 * Keep this file free of imports: the scripts load it directly.
 */

export interface BooleanFlag {
  type: 'boolean';
  default: boolean;
  description: string;
  owner: string;
  /** `planned`: declared and synced, but no app reads it yet (listed by flags:check, never an error). */
  status: 'active' | 'planned';
}

export interface MultivariateFlag {
  type: 'multivariate';
  variants: readonly string[];
  default: string;
  description: string;
  owner: string;
  status: 'active' | 'planned';
}

export type FlagDefinition = BooleanFlag | MultivariateFlag;

export const FLAGS = {
  'prefetch-on-details': {
    type: 'boolean',
    default: true,
    description:
      'Warm up the stream the next Play would pick when a details screen opens (POST /api/prefetch). Off skips the warm-up.',
    owner: 'server',
    status: 'active',
  },
  'banner-rotation-interval': {
    type: 'multivariate',
    variants: ['9s', '12s'],
    default: '9s',
    description:
      'Experiment: seconds between slides of the featured banner on Home (web and TV). Compares 9 s with 12 s.',
    owner: 'web',
    status: 'planned',
  },
} as const satisfies Record<string, FlagDefinition>;

export type FlagKey = keyof typeof FLAGS;

export type FlagValue<K extends FlagKey> = (typeof FLAGS)[K] extends { type: 'boolean' }
  ? boolean
  : (typeof FLAGS)[K] extends { variants: readonly (infer V)[] }
    ? V
    : never;

export const FLAG_KEYS = Object.keys(FLAGS) as FlagKey[];

export function isFlagKey(key: string): key is FlagKey {
  return Object.hasOwn(FLAGS, key);
}

export function flagDefault<K extends FlagKey>(key: K): FlagValue<K> {
  return FLAGS[key].default as FlagValue<K>;
}

/** Maps what PostHog returned (boolean, variant name or nothing) onto a valid value; anything unexpected is the default. */
export function coerceFlagValue<K extends FlagKey>(key: K, raw: unknown): FlagValue<K> {
  const definition: FlagDefinition = FLAGS[key];
  if (definition.type === 'boolean') {
    return (typeof raw === 'boolean' ? raw : definition.default) as FlagValue<K>;
  }
  const variant = typeof raw === 'string' && definition.variants.includes(raw) ? raw : definition.default;
  return variant as FlagValue<K>;
}
