// Tests never talk to Sentry or PostHog: a developer's .env keys must not leak into a test run through process.env.
for (const key of [
  'SENTRY_DSN_SERVER',
  'SENTRY_DSN',
  'SENTRY_ENVIRONMENT',
  'SENTRY_AUTH_TOKEN',
  'SENTRY_API_TOKEN',
  'SENTRY_ORG',
  'POSTHOG_API_KEY',
  'POSTHOG_HOST',
  'POSTHOG_PERSONAL_API_KEY',
  'HOMESTREAM_TELEMETRY',
]) {
  delete process.env[key];
}
