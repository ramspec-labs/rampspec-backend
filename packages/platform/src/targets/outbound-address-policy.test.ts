import { describe, expect, it, vi } from "vitest";

import {
  isPublicIpAddress,
  isPublicIpv4Address,
  isPublicIpv6Address,
  MAX_RESOLVED_ADDRESSES,
  resolveTargetAddresses,
  validateResolvedAddresses,
  type TargetAddressResolver,
} from "./outbound-address-policy.js";

const publicV4 = ["8.8.8.8", "1.1.1.1", "93.184.216.34"];

const nonPublicV4: ReadonlyArray<readonly [string, string]> = [
  ["0.0.0.0", "unspecified"],
  ["0.1.2.3", "this-host range"],
  ["10.0.0.1", "private"],
  ["10.255.255.255", "private"],
  ["100.64.0.1", "shared address space"],
  ["100.127.255.255", "shared address space"],
  ["127.0.0.1", "loopback"],
  ["127.53.1.2", "loopback"],
  ["169.254.0.1", "link-local"],
  ["169.254.169.254", "cloud metadata"],
  ["172.16.0.1", "private"],
  ["172.31.255.255", "private"],
  ["192.0.0.1", "protocol assignment"],
  ["192.0.2.1", "documentation"],
  ["192.31.196.1", "AS112"],
  ["192.52.193.1", "AMT"],
  ["192.88.99.1", "6to4 relay"],
  ["192.168.0.1", "private"],
  ["192.175.48.1", "AS112"],
  ["198.18.0.1", "benchmarking"],
  ["198.51.100.1", "documentation"],
  ["203.0.113.1", "documentation"],
  ["224.0.0.1", "multicast"],
  ["240.0.0.1", "reserved"],
  ["255.255.255.255", "broadcast"],
];

const publicV6 = [
  "2606:4700:4700::1111",
  "2001:4860:4860::8888",
  "2600::1",
];

const nonPublicV6: ReadonlyArray<readonly [string, string]> = [
  ["::", "unspecified"],
  ["::1", "loopback"],
  ["::ffff:127.0.0.1", "IPv4-mapped loopback"],
  ["::ffff:10.0.0.1", "IPv4-mapped private"],
  ["::ffff:169.254.169.254", "IPv4-mapped metadata"],
  ["::ffff:0:127.0.0.1", "IPv4-translated loopback"],
  ["::10.0.0.1", "IPv4-compatible private"],
  ["64:ff9b::10.0.0.1", "NAT64 private"],
  ["64:ff9b:1::1", "NAT64 local-use"],
  ["100::1", "discard-only"],
  ["2001:db8::1", "documentation"],
  ["2001::80ff:fffe", "Teredo loopback"],
  ["2002:7f00:1::1", "6to4 loopback"],
  ["fc00::1", "unique-local"],
  ["fd00:ec2::254", "IPv6 cloud metadata"],
  ["fe80::1", "link-local"],
  ["ff02::1", "multicast"],
];

describe("outbound address policy", () => {
  it("accepts public IPv4 addresses", () => {
    for (const address of publicV4) {
      expect(isPublicIpv4Address(address)).toBe(true);
      expect(isPublicIpAddress(address)).toBe(true);
    }
  });

  it("rejects every non-public IPv4 range", () => {
    for (const [address] of nonPublicV4) {
      expect(isPublicIpv4Address(address)).toBe(false);
      expect(isPublicIpAddress(address)).toBe(false);
    }
  });

  it("accepts public IPv6 addresses", () => {
    for (const address of publicV6) {
      expect(isPublicIpv6Address(address)).toBe(true);
      expect(isPublicIpAddress(address)).toBe(true);
    }
  });

  it("rejects every non-public IPv6 form", () => {
    for (const [address] of nonPublicV6) {
      expect(isPublicIpv6Address(address)).toBe(false);
      expect(isPublicIpAddress(address)).toBe(false);
    }
  });

  it("accepts IPv4-mapped, 6to4, Teredo, and NAT64 wrappers of public IPv4", () => {
    expect(isPublicIpAddress("::ffff:93.184.216.34")).toBe(true);
    expect(isPublicIpAddress("2002:5db8:d822::1")).toBe(true);
    expect(isPublicIpAddress("2001:0:5db8:d822::1")).toBe(false);
    expect(isPublicIpAddress("64:ff9b::5db8:d822")).toBe(true);
  });

  it("rejects malformed and non-IP input", () => {
    expect(isPublicIpAddress("example.com")).toBe(false);
    expect(isPublicIpAddress("999.1.1.1")).toBe(false);
    expect(isPublicIpAddress("")).toBe(false);
    expect(isPublicIpAddress("12345::")).toBe(false);
  });

  it("pins the first validated address", () => {
    const validated = validateResolvedAddresses([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:4700:4700::1111", family: 6 },
    ]);
    expect(validated.pinned).toBe("93.184.216.34");
    expect(validated.addresses).toEqual([
      "93.184.216.34",
      "2606:4700:4700::1111",
    ]);
  });

  it("rejects a mixed good-and-bad address list outright", () => {
    expect(() =>
      validateResolvedAddresses([
        { address: "93.184.216.34", family: 4 },
        { address: "169.254.169.254", family: 4 },
      ]),
    ).toThrow("non-public");
    expect(() =>
      validateResolvedAddresses([
        { address: "93.184.216.34", family: 4 },
        { address: "::1", family: 6 },
      ]),
    ).toThrow("non-public");
  });

  it("rejects empty and unbounded address lists", () => {
    expect(() => validateResolvedAddresses([])).toThrow("any address");
    expect(() =>
      validateResolvedAddresses(
        Array.from({ length: MAX_RESOLVED_ADDRESSES + 1 }, (_, index) => ({
          address: `93.184.216.${(index % 250) + 1}`,
          family: 4,
        })),
      ),
    ).toThrow("too many");
  });

  it("resolves IP literals without touching the resolver", async () => {
    const resolver: TargetAddressResolver = vi.fn();
    const resolved = await resolveTargetAddresses("93.184.216.34", resolver);
    expect(resolved).toEqual([{ address: "93.184.216.34", family: 4 }]);
    expect(resolver).not.toHaveBeenCalled();
    const resolvedV6 = await resolveTargetAddresses("::1", resolver);
    expect(resolvedV6).toEqual([{ address: "::1", family: 6 }]);
    expect(resolver).not.toHaveBeenCalled();
  });

  it("delegates hostnames to the injected resolver", async () => {
    const resolver: TargetAddressResolver = vi
      .fn()
      .mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    const resolved = await resolveTargetAddresses("example.com", resolver);
    expect(resolved).toEqual([{ address: "93.184.216.34", family: 4 }]);
    expect(resolver).toHaveBeenCalledWith("example.com");
  });

  it("bounds a hung resolver", async () => {
    const resolver: TargetAddressResolver = () =>
      new Promise(() => undefined);
    await expect(
      resolveTargetAddresses("example.com", resolver, 10),
    ).rejects.toThrow("timed out");
  });
});
