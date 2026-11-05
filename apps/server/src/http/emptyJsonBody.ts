import type { FastifyInstance } from 'fastify';

/**
 * Fastify rejects `content-type: application/json` with an empty body as 400. Clients such as fetch wrappers and
 * curl scripts send that on body-less routes (DELETE /api/sessions/:id), so an empty body is treated as no body.
 * Non-empty bodies keep Fastify's own parser, including its prototype-poisoning checks.
 */
export function allowEmptyJsonBody(app: FastifyInstance): void {
  const parseJson = app.getDefaultJsonParser('error', 'error');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (request, body, done) => {
    if (typeof body === 'string' && body.trim() === '') {
      done(null, undefined);
      return;
    }
    parseJson(request, body as string, done);
  });
}
