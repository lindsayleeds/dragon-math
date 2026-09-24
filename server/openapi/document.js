// Builds the OpenAPI document from the route contracts in server/contracts/.
// `npm run openapi` writes it to server/openapi.json, which is checked in and
// consumed by swift-openapi-generator; server/openapi/openapi.test.js fails when
// the checked-in file no longer matches this output.
//
// Dev-only: @asteasolutions/zod-to-openapi is a devDependency, and nothing the
// running server loads may require this file.
const path = require('path');
const { OpenAPIRegistry, OpenApiGeneratorV3 } = require('@asteasolutions/zod-to-openapi');
const contracts = require('../contracts');

const OPENAPI_PATH = path.join(__dirname, '..', 'openapi.json');

// 3.0.3 rather than 3.1: both are supported by swift-openapi-generator, and 3.0
// is the version its documentation and most tooling treat as the baseline.
const OPENAPI_VERSION = '3.0.3';

function buildDocument(routes = contracts.routes, components = contracts.components) {
  const registry = new OpenAPIRegistry();
  // Standalone components go in as plain schema definitions: each already names
  // itself with .meta({ id }), which registry.register() would redundantly
  // restate through the zod prototype extension this project does not install.
  const componentDefinitions = components.map(schema => {
    if (!schema.meta()?.id) throw new Error('A standalone contract component needs .meta({ id })');
    return { type: 'schema', schema };
  });
  const bearer = registry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
  });

  for (const route of routes) {
    const request = {};
    if (route.params) request.params = route.params;
    if (route.query) request.query = route.query;
    if (route.body) {
      request.body = { required: true, content: { 'application/json': { schema: route.body } } };
    }
    const responses = {};
    for (const [status, response] of Object.entries(route.responses)) {
      const { description } = response;
      responses[status] = response.binary
        ? { description, content: { [response.contentType]: { schema: { type: 'string', format: 'binary' } } } }
        : { description, content: { 'application/json': { schema: response.schema } } };
    }
    registry.registerPath({
      method: route.method,
      path: route.path,
      operationId: route.operationId,
      summary: route.summary,
      tags: route.tags,
      ...(route.auth ? { security: [{ [bearer.name]: [] }] } : {}),
      request,
      responses,
    });
  }

  return new OpenApiGeneratorV3([...registry.definitions, ...componentDefinitions]).generateDocument({
    openapi: OPENAPI_VERSION,
    info: {
      title: 'Dragon Math API',
      version: '1.0.0',
      description:
        'The routes the Dragon Academy iOS app uses. Generated from server/contracts/ by `npm run openapi`; do not edit by hand.',
    },
  });
}

function serializeDocument(doc = buildDocument()) {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

module.exports = { buildDocument, serializeDocument, OPENAPI_PATH };
