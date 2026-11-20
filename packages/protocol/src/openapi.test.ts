import { readFile } from "node:fs/promises";

import SwaggerParser from "@apidevtools/swagger-parser";
import { describe, expect, it } from "vitest";

import { openApiDocument } from "./openapi.js";

const httpMethods = ["get", "post", "put", "patch", "delete"] as const;
const mutationMethods = new Set(["post", "put", "patch", "delete"]);
const publicPaths = new Set(["/health", "/version"]);

describe("OpenAPI contract", () => {
  it("is a valid OpenAPI 3.1 document", async () => {
    await expect(
      SwaggerParser.validate(structuredClone(openApiDocument) as never),
    ).resolves.toBeDefined();
  });

  it("matches the committed generated document", async () => {
    const generated = JSON.parse(
      await readFile(
        new URL("../../../generated/openapi/openapi.json", import.meta.url),
        "utf8",
      ),
    ) as unknown;
    expect(generated).toEqual(openApiDocument);
  });

  it("enforces tenant, request ID, problem, and mutation conventions", () => {
    for (const [path, pathItem] of Object.entries(openApiDocument.paths)) {
      for (const method of httpMethods) {
        const operation = pathItem[method as keyof typeof pathItem] as
          Record<string, unknown> | undefined;
        if (!operation) continue;

        const responses = operation.responses as Record<
          string,
          { readonly $ref?: string; readonly headers?: Record<string, unknown> }
        >;
        for (const response of Object.values(responses)) {
          if (response.$ref === "#/components/responses/Problem") continue;
          expect(
            response.headers,
            `${method.toUpperCase()} ${path}`,
          ).toHaveProperty("X-Request-Id");
        }

        if (publicPaths.has(path)) continue;
        expect(openApiDocument.security).toContainEqual({ bearerAuth: [] });
        const parameters = JSON.stringify(operation.parameters);
        const tenantless = path === "/v1/organizations";
        if (!tenantless)
          expect(parameters).toContain(
            "#/components/parameters/OrganizationId",
          );
        for (const [status, response] of Object.entries(responses)) {
          if (Number(status) >= 400) {
            expect(
              response.$ref,
              `${method.toUpperCase()} ${path} ${status}`,
            ).toBe("#/components/responses/Problem");
          }
        }
        if (mutationMethods.has(method)) {
          expect(parameters).toContain(
            "#/components/parameters/IdempotencyKey",
          );
        }
      }
    }

    expect(openApiDocument.components.responses.Problem.content).toHaveProperty(
      "application/problem+json",
    );
    const problemContent =
      openApiDocument.components.responses.Problem.content[
        "application/problem+json"
      ];
    expect(problemContent).toHaveProperty("examples");
    expect(problemContent.examples).toHaveProperty("validation");
    expect(problemContent.examples).toHaveProperty("authorization");
    expect(problemContent.examples).toHaveProperty("conflict");
    expect(problemContent.examples).toHaveProperty("rateLimit");

    const problemSchema = openApiDocument.components.schemas.Problem;
    const requiredFields = problemSchema.required as readonly string[];
    for (const [key, example] of Object.entries(problemContent.examples)) {
      const val = (example as { value: Record<string, unknown> }).value;
      for (const req of requiredFields) {
        expect(val, `Example ${key} missing required field ${req}`).toHaveProperty(
          req,
        );
      }
      expect(typeof val.status).toBe("number");
      expect(val.status).toBeGreaterThanOrEqual(400);
      expect(val.status).toBeLessThanOrEqual(599);
      expect(typeof val.title).toBe("string");
      expect(typeof val.type).toBe("string");
      if (val.requestId !== undefined) {
        expect(val.requestId).toMatch(
          new RegExp(openApiDocument.components.schemas.RequestId.pattern),
        );
      }
    }

    expect(openApiDocument.components.schemas.UtcTimestamp.pattern).toMatch(
      /Z\$$/u,
    );
    expect(
      openApiDocument.components.schemas.OpaqueCursor.pattern,
    ).not.toContain("=");
  });
});
