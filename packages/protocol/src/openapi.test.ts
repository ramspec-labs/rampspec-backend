import { readFile } from "node:fs/promises";

import SwaggerParser from "@apidevtools/swagger-parser";
import { describe, expect, it } from "vitest";

import { openApiDocument } from "./openapi.js";

const httpMethods = ["get", "post", "put", "patch", "delete"] as const;
const mutationMethods = new Set(["post", "put", "patch", "delete"]);

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

        if (path === "/health") continue;
        expect(openApiDocument.security).toContainEqual({ bearerAuth: [] });
        const parameters = JSON.stringify(operation.parameters);
        expect(parameters).toContain("#/components/parameters/OrganizationId");
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
    expect(openApiDocument.components.schemas.UtcTimestamp.pattern).toMatch(
      /Z\$$/u,
    );
    expect(
      openApiDocument.components.schemas.OpaqueCursor.pattern,
    ).not.toContain("=");
  });
});
