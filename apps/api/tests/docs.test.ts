import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../src/app";
import { env } from "../src/lib/env";
import { SESSION_COOKIE } from "../src/lib/auth";
import { openApiSpec } from "../src/openapi";

/**
 * Documentation tests.
 *
 * The spec is hand-maintained for responses and generated from the real Zod
 * schemas for requests, so these tests guard the two ways it can rot:
 * structural mistakes (a $ref nothing defines, an id Swagger UI chokes on) and
 * drift from the app (a documented endpoint that Express no longer routes).
 */

type Json = Record<string, any>;

const spec = openApiSpec as Json;
const doc = spec as Json;

/** Every operation in the spec as `"METHOD /path"`. */
const operations: Array<{ method: string; path: string; op: Json }> = [];
for (const [path, item] of Object.entries<Json>(spec.paths)) {
  for (const [method, op] of Object.entries<Json>(item)) {
    operations.push({ method: method.toUpperCase(), path, op });
  }
}

/** Resolve a local `$ref` against the document; `undefined` when dangling. */
function resolveRef(ref: string): unknown {
  let node: unknown = doc;
  for (const part of ref.slice(2).split("/")) {
    if (!node || typeof node !== "object") return undefined;
    node = (node as Json)[part.replace(/~1/g, "/").replace(/~0/g, "~")];
  }
  return node;
}

describe("OpenAPI document", () => {
  it("is an OpenAPI 3.1 document with the required metadata", () => {
    expect(spec.openapi).toMatch(/^3\.1\./);
    expect(spec.info?.title).toBeTruthy();
    expect(spec.info?.version).toBeTruthy();
    expect(Array.isArray(spec.servers)).toBe(true);
    expect(spec.components?.securitySchemes?.cookieAuth).toMatchObject({
      type: "apiKey",
      in: "cookie",
      name: SESSION_COOKIE,
    });
  });

  it("resolves every $ref it uses", () => {
    const refs: string[] = [];
    (function walk(node: unknown): void {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node && typeof node === "object") {
        for (const [key, value] of Object.entries(node as Json)) {
          if (key === "$ref" && typeof value === "string") refs.push(value);
          else walk(value);
        }
      }
    })(doc);

    expect(refs.length).toBeGreaterThan(50);
    const dangling = refs.filter((ref) => !ref.startsWith("#/") || resolveRef(ref) === undefined);
    expect(dangling, `dangling $ref: ${dangling.join(", ")}`).toEqual([]);
  });

  it("gives every operation a unique id, a summary, tags and responses", () => {
    const ids = operations.map((entry) => entry.op.operationId);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size, "duplicate operationId").toBe(ids.length);

    const declared = new Set(spec.tags.map((tag: Json) => tag.name));
    for (const { method, path, op } of operations) {
      const where = `${method} ${path}`;
      expect(op.summary, `${where} has no summary`).toBeTruthy();

      const tags: string[] = op.tags ?? [];
      expect(tags.length, `${where} has no tag`).toBeGreaterThan(0);
      for (const tag of tags) expect(declared.has(tag), `${where} uses undeclared tag ${tag}`).toBe(true);

      const statuses = Object.keys(op.responses ?? {});
      expect(statuses.length, `${where} has no responses`).toBeGreaterThan(0);
      for (const status of statuses) {
        expect(status, `${where} has a malformed status`).toMatch(/^[1-5]\d\d$/);
        expect(
          op.responses[status]?.description,
          `${where} response ${status} has no description`,
        ).toBeTruthy();
      }
    }
  });

  it("declares exactly the path parameters each path uses", () => {
    for (const { method, path, op } of operations) {
      const where = `${method} ${path}`;
      const used = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
      const declared = (op.parameters ?? [])
        .filter((param: Json) => param.in === "path")
        .map((param: Json) => param.name);

      expect(declared.sort(), `${where} path parameters`).toEqual(
        [...used].sort(),
      );
      for (const param of op.parameters ?? []) {
        expect(param.schema, `${where} parameter ${param.name} has no schema`).toBeTruthy();
        expect(param.description, `${where} parameter ${param.name} has no description`).toBeTruthy();
      }
    }
  });

  it("documents the security scheme and marks public endpoints public", () => {
    const global = spec.security as Array<Record<string, string[]>>;
    expect(global).toEqual([{ cookieAuth: [] }]);

    const guarded = operations.filter((entry) => entry.op.security === undefined);
    const open = operations.filter((entry) => entry.op.security !== undefined);

    expect(guarded.length).toBeGreaterThan(20);
    expect(open.map((entry) => `${entry.method} ${entry.path}`).sort()).toEqual([
      "GET /files/{token}",
      "GET /health",
      "GET /public/r/{token}",
      "GET /public/r/{token}/document",
      "GET /public/r/{token}/download",
      "POST /auth/login",
      "POST /auth/logout",
      "POST /auth/signup",
    ]);

    for (const entry of open) expect(entry.op.security, "must be [] to opt out").toEqual([]);
  });

  it("builds request bodies from the live Zod schemas", () => {
    const schemas = spec.components.schemas as Json;

    // Generated from receiptCreateSchema — the schema the API parses with.
    expect(schemas.ReceiptCreateInput?.required).toContain("items");
    expect(schemas.ReceiptCreateInput?.properties?.items?.minItems).toBe(1);
    expect(schemas.ReceiptCreateInput?.properties?.items?.maxItems).toBe(200);
    expect(schemas.SignupInput?.required).toEqual(
      expect.arrayContaining(["business", "user"]),
    );
    expect(schemas.ShareReceiptInput?.properties?.ttl_seconds).toMatchObject({
      type: "integer",
      minimum: 3600,
      maximum: 31536000,
    });

    // Response DTOs written by hand are present too.
    for (const name of ["ApiError", "Auth", "Business", "Customer", "Receipt", "DashboardSummary", "Share"]) {
      expect(schemas[name], `missing schema ${name}`).toBeTruthy();
    }
  });
});

/**
 * Every documented endpoint must actually be routed: Express answers an
 * unknown `/api/...` path with its own `Endpoint not found.` catch-all, which
 * is distinct from a route that exists but rejects the request (401/403/422).
 */
describe("documented endpoints are routed", () => {
  let app: Express;

  beforeAll(() => {
    app = createApp();
  });

  for (const { method, path } of operations) {
    it(`${method} /api${path.replace(/\{[^}]+\}/g, "probe")}`, async () => {
      const url = `/api${path.replace(/\{[^}]+\}/g, "probe")}`;
      const response = await (request(app) as any)[method.toLowerCase()](url);

      const isCatchAll =
        response.status === 404 && response.body?.message === "Endpoint not found.";
      expect(
        isCatchAll,
        `${method} ${url} is documented but Express has no route for it`,
      ).toBe(false);
    });
  }
});

/**
 * Serving the UI — skipped when DOCS_ENABLED=false, since the flag is allowed
 * to take the documentation down.
 */
(env.docsEnabled ? describe : describe.skip)("Swagger UI", () => {
  let app: Express;

  beforeAll(() => {
    app = createApp();
  });

  it("serves the UI from the bare path (no redirect loop behind the proxy)", async () => {
    const response = await request(app).get("/api/docs");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/html");
    expect(response.text).toContain("Eleosstyles Receipt System API");
    // Absolute asset URLs: a relative one would bounce between Next's
    // trailing-slash 308 and express.static's directory 301.
    expect(response.text).toContain('src="/api/docs/swagger-ui-bundle.js"');
    expect(response.text).not.toContain('src="./');
  });

  it("serves the UI from the slashed path too", async () => {
    const response = await request(app).get("/api/docs/");
    expect(response.status).toBe(200);
    expect(response.text).toContain("swagger-ui-init.js");
  });

  it("serves the UI assets from local swagger-ui-dist", async () => {
    for (const asset of ["swagger-ui-bundle.js", "swagger-ui.css", "swagger-ui-init.js"]) {
      const response = await request(app).get(`/api/docs/${asset}`);
      expect(response.status, asset).toBe(200);
      expect(response.text.length, asset).toBeGreaterThan(1000);
    }

    const init = await request(app).get("/api/docs/swagger-ui-init.js");
    expect(init.text).toContain('"openapi"');
    expect(init.text).toContain(spec.info.title);
  });

  it("publishes the raw spec as JSON", async () => {
    const response = await request(app).get("/api/docs/openapi.json");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(response.body.openapi).toMatch(/^3\.1\./);
    expect(Object.keys(response.body.paths).length).toBe(Object.keys(spec.paths).length);
  });

  it("answers 404 for anything else under /api/docs", async () => {
    const response = await request(app).get("/api/docs/not-a-real-page");
    expect(response.status).toBe(404);
    expect(response.body?.message).toBe("Endpoint not found.");
  });
});
