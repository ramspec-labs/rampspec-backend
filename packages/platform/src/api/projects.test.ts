import { describe, expect, it } from "vitest";

import { InMemoryProjectRepository, ProjectService } from "./projects.js";

const organizationId = "organization_00000000-0000-4000-8000-000000000001";

describe("project service", () => {
  function service() {
    return new ProjectService({
      clock: () => new Date("2026-09-12T18:00:00.000Z"),
      repository: new InMemoryProjectRepository(),
    });
  }

  it("creates, reads, updates, archives, and paginates tenant projects", async () => {
    const projects = service();
    const project = await projects.create({ organizationId, name: " Core ", slug: "core-app", repositoryUrl: "https://github.com/example/core" });
    expect((await projects.get(organizationId, project.id)).name).toBe("Core");
    expect((await projects.update(organizationId, project.id, { name: "Core API" })).name).toBe("Core API");
    expect((await projects.archive(organizationId, project.id)).status).toBe("archived");
    await expect(projects.archive(organizationId, project.id)).resolves.toMatchObject({ status: "archived" });
    expect((await projects.list(organizationId, undefined, 1)).items).toHaveLength(1);
  });

  it("enforces tenant boundaries and storage constraints", async () => {
    const projects = service();
    await expect(projects.create({ organizationId, name: "App", slug: "ab" })).rejects.toThrow("slug");
    await expect(projects.create({ organizationId, name: "App", slug: "valid-app", repositoryUrl: "http://github.com/example/app" })).rejects.toThrow("HTTPS");
    const project = await projects.create({ organizationId, name: "App", slug: "valid-app" });
    await expect(projects.get("organization_00000000-0000-4000-8000-000000000002", project.id)).rejects.toThrow("not found");
    await expect(projects.list(organizationId, "bad-cursor")).rejects.toThrow("cursor");
  });

  it("rejects duplicate slugs and oversized policies", async () => {
    const projects = service();
    await projects.create({ organizationId, name: "App", slug: "valid-app" });
    await expect(projects.create({ organizationId, name: "Other", slug: "valid-app" })).rejects.toThrow("already exists");
    await expect(projects.create({ organizationId, name: "Other", slug: "other-app", policy: { value: "x".repeat(33000) } })).rejects.toThrow("too large");
  });
});
