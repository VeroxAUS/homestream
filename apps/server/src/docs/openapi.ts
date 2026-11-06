import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { ErrorResponseSchema } from '@homestream/shared';
import type { FastifyInstance, FastifySchema, RouteOptions } from 'fastify';
import { toJsonSchema, type JsonSchema } from './jsonSchema.js';
import { ROUTE_DOCS, TAG_DESCRIPTIONS, type ResponseDoc, type RouteDoc } from './routeDocs.js';

const DOCS_PREFIX = '/api/docs';
/** Version of the HTTP API contract; bump on breaking changes. Deliberately not the app version, so releases do not change docs/openapi.json. */
const API_VERSION = '1.0.0';

const ERROR_REF = '#/components/schemas/ErrorResponse';
const ERROR_DESCRIPTIONS: Record<number, string> = {
  400: 'The request is invalid.',
  404: 'Nothing matches the id or path.',
  409: 'The request conflicts with the current state.',
  429: 'Too many requests or sessions.',
  502: 'An upstream service (TMDB, gateway, TorBox or ffmpeg) failed.',
  503: 'The server or an upstream service is not available right now.',
  504: 'An upstream service or the encoder timed out.',
};

function methodsOf(route: RouteOptions): string[] {
  return (Array.isArray(route.method) ? route.method : [route.method]).map((method) => String(method));
}

/** Registry key for a route, `GET /api/home` style. */
function routeKey(method: string, url: string): string {
  return `${method.toUpperCase()} ${url}`;
}

function pathParameters(url: string, described: Record<string, string> = {}): JsonSchema | undefined {
  const names = [...url.matchAll(/:(\w+)/g)].map((match) => match[1] as string);
  if (names.length === 0) return undefined;
  return {
    type: 'object',
    properties: Object.fromEntries(
      names.map((name) => [name, { type: 'string', ...(described[name] ? { description: described[name] } : {}) }]),
    ),
    required: names,
  };
}

function responseObject({ description, schema, contentType = 'application/json' }: ResponseDoc) {
  return {
    description,
    content: { [contentType]: schema ? { schema: toJsonSchema(schema, 'output') } : {} },
  };
}

function errorResponses(statuses: number[]) {
  return Object.fromEntries(
    statuses.map((status) => [
      String(status),
      {
        description: ERROR_DESCRIPTIONS[status] ?? 'Error.',
        content: { 'application/json': { schema: { $ref: ERROR_REF } } },
      },
    ]),
  );
}

/** Builds the documentation-only schema Swagger reads; Fastify itself never sees it, so runtime validation is unchanged. */
function schemaFor(doc: RouteDoc, url: string): FastifySchema {
  const querystring = doc.query ? toJsonSchema(doc.query, 'input') : undefined;
  const body = doc.body ? toJsonSchema(doc.body, 'input') : undefined;
  const params = pathParameters(url, doc.params);
  return {
    summary: doc.summary,
    ...(doc.description ? { description: doc.description } : {}),
    tags: [doc.tag],
    ...(params ? { params } : {}),
    ...(querystring ? { querystring } : {}),
    ...(body ? { body } : {}),
    response: {
      ...Object.fromEntries(
        Object.entries(doc.responses).map(([status, response]) => [status, responseObject(response)]),
      ),
      ...errorResponses(doc.errors),
    },
  } as FastifySchema;
}

/** Routes that exist on every server but are not part of the API (CORS preflight catch-all, static files). */
function isInfrastructureRoute(method: string, url: string): boolean {
  if (method === 'OPTIONS' || url === '/*' || url === '/' || url.startsWith(DOCS_PREFIX)) return true;
  return !(url.startsWith('/api') || url.startsWith('/hls'));
}

function transformRoute({ schema, url, route }: { schema: FastifySchema; url: string; route: RouteOptions }) {
  const [method = 'GET'] = methodsOf(route);
  if (isInfrastructureRoute(method, url)) return { schema: { ...schema, hide: true }, url };
  const doc = ROUTE_DOCS[routeKey(method, route.url)];
  if (!doc) return { schema: { ...schema, tags: ['undocumented'], summary: `Undocumented: ${method} ${url}` }, url };
  return { schema: schemaFor(doc, route.url), url };
}

/** Must run before the API routes are registered: Swagger collects them through an onRoute hook. */
export async function registerOpenApi(app: FastifyInstance): Promise<void> {
  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'HomeStream API',
        description:
          'HTTP API of the HomeStream server. Errors always use `{error:{code,message,hint?}}`. Generated from the route registry and the shared zod schemas; documentation only, the server validates requests itself.',
        version: API_VERSION,
        license: { name: 'GPL-3.0-only', url: 'https://www.gnu.org/licenses/gpl-3.0.html' },
      },
      servers: [{ url: 'http://localhost:8600', description: 'Default local server' }],
      tags: Object.entries(TAG_DESCRIPTIONS).map(([name, description]) => ({ name, description })),
      components: {
        schemas: { ErrorResponse: toJsonSchema(ErrorResponseSchema, 'output') },
      },
    },
    transform: transformRoute,
  });
  await app.register(swaggerUi, {
    routePrefix: DOCS_PREFIX,
    uiConfig: { docExpansion: 'list', deepLinking: false },
  });
}
