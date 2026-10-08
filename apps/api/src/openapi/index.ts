import { Router, type RequestHandler } from "express";
import swaggerUi, { type SwaggerUiOptions } from "swagger-ui-express";
import { openApiSpec } from "./spec";

export { openApiSpec };

/** Where the UI is mounted in `app.ts`. */
export const DOCS_PATH = "/api/docs";

const uiOptions: SwaggerUiOptions = {
  customSiteTitle: "Eleosstyles Receipt System API — Swagger UI",
  swaggerOptions: {
    persistAuthorization: true,
    deepLinking: true,
    docExpansion: "list",
    filter: true,
    tagsSorter: "alpha",
    operationsSorter: "alpha",
    // Keep sending the session cookie when the UI and API share an origin.
    withCredentials: true,
  },
};

/**
 * Swagger UI for the API.
 *
 *   GET /api/docs             — the interactive UI
 *   GET /api/docs/openapi.json — the raw spec (codegen, linting, other tools)
 *
 * Assets come from the local `swagger-ui-dist` package rather than a CDN, so
 * the page renders with no internet access, and the spec is inlined into
 * `swagger-ui-init.js` by `generateHTML`, so there is no second round trip.
 *
 * The stock page links its assets relatively (`./swagger-ui.css`), which only
 * resolves when the page URL itself ends in a slash. Absolute hrefs sidestep
 * that entirely: the page works from `/api/docs` and `/api/docs/` alike,
 * whichever URL the caller or a link happens to use.
 */
const page = swaggerUi
  .generateHTML(openApiSpec as swaggerUi.JsonObject, uiOptions)
  .replaceAll('href="./', `href="${DOCS_PATH}/`)
  .replaceAll('src="./', `src="${DOCS_PATH}/`);

export function createDocsRouter(): Router {
  const router = Router();

  // Serves swagger-ui-init.js (the spec) and the local swagger-ui-dist assets.
  // `redirect: false` keeps express.static from 301ing the mount path itself,
  // so the bare `/api/docs` falls through to the page handler below.
  router.use(swaggerUi.serveWithOptions({ redirect: false }));

  const servePage: RequestHandler = (_req, res) => {
    res
      .status(200)
      .setHeader("Cache-Control", "no-store")
      .type("html")
      .send(page);
  };

  router.get("/", servePage);

  router.get("/openapi.json", (_req, res) => {
    res
      .status(200)
      .setHeader("Cache-Control", "no-store")
      .type("application/json")
      .send(JSON.stringify(openApiSpec, null, 2));
  });

  return router;
}
