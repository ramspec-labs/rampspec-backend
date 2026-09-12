import { describe, expect, it } from "vitest";
import { assertTenantAccess } from "./tenant.js";
describe("tenant isolation", () => { it("allows matching tenants and fails closed for mismatches", () => { expect(() => assertTenantAccess("org_1", "org_1")).not.toThrow(); expect(() => assertTenantAccess("org_1", "org_2")).toThrow("Cross-tenant"); expect(() => assertTenantAccess("", "org_1")).toThrow("Cross-tenant"); }); });
