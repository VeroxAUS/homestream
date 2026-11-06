import { z, type ZodType } from 'zod';

export type JsonSchema = Record<string, unknown>;

/** Zod bounds every integer to the safe-integer range; that says nothing a reader needs. */
function dropSafeIntegerBounds(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(dropSafeIntegerBounds);
  if (node === null || typeof node !== 'object') return node;
  const entries = Object.entries(node).filter(
    ([key, value]) =>
      !(
        (key === 'minimum' && value === Number.MIN_SAFE_INTEGER) ||
        (key === 'maximum' && value === Number.MAX_SAFE_INTEGER)
      ),
  );
  return Object.fromEntries(entries.map(([key, value]) => [key, dropSafeIntegerBounds(value)]));
}

/**
 * Documentation-only JSON Schema for a shared zod schema. Requests use the input side (what a client may send) and
 * responses the output side (what the server returns). Constructs JSON Schema cannot express become `{}` instead of
 * throwing, so a new refinement never breaks the docs build.
 */
export function toJsonSchema(schema: ZodType, io: 'input' | 'output'): JsonSchema {
  const { $schema: _draft, ...rest } = z.toJSONSchema(schema, {
    io,
    target: 'openapi-3.0',
    unrepresentable: 'any',
  }) as JsonSchema;
  return dropSafeIntegerBounds(rest) as JsonSchema;
}
