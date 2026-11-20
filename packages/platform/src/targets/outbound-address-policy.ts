import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Outbound network policy for target probes.
 *
 * HTTPS alone does not stop an approved hostname from resolving to an
 * internal address, so every address a target hostname resolves to is
 * validated before any connection is made. A single non-public answer
 * rejects the whole probe: an attacker who controls one DNS record must
 * not be able to steer the probe at a private, loopback, link-local, or
 * cloud-metadata address while a public answer is also present.
 */

export interface ResolvedTargetAddress {
  readonly address: string;
  readonly family: number;
}

export type TargetAddressResolver = (
  hostname: string,
) => Promise<readonly ResolvedTargetAddress[]>;

/** Upper bound on the number of addresses considered for one probe. */
export const MAX_RESOLVED_ADDRESSES = 16;

/** Default time allowed for one DNS resolution, in milliseconds. */
export const DEFAULT_RESOLUTION_TIMEOUT_MS = 5000;

const defaultResolver: TargetAddressResolver = (hostname) =>
  lookup(hostname, { all: true, verbatim: true });

function ipv4Value(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^(0|[1-9][0-9]*)$/u.test(part)) return null;
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet > 255) return null;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

function inPrefix(value: number, network: number, prefix: number): boolean {
  if (prefix === 0) return true;
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) === (network & mask);
}

/** IPv4 ranges that are never a public probe destination. */
const BLOCKED_IPV4_PREFIXES: ReadonlyArray<{
  readonly network: string;
  readonly prefix: number;
  readonly reason: string;
}> = [
  { network: "0.0.0.0", prefix: 8, reason: "unspecified" },
  { network: "10.0.0.0", prefix: 8, reason: "private" },
  { network: "100.64.0.0", prefix: 10, reason: "shared address space" },
  { network: "127.0.0.0", prefix: 8, reason: "loopback" },
  { network: "169.254.0.0", prefix: 16, reason: "link-local" },
  { network: "172.16.0.0", prefix: 12, reason: "private" },
  { network: "192.0.0.0", prefix: 24, reason: "protocol assignment" },
  { network: "192.0.2.0", prefix: 24, reason: "documentation" },
  { network: "192.31.196.0", prefix: 24, reason: "AS112" },
  { network: "192.52.193.0", prefix: 24, reason: "AMT" },
  { network: "192.88.99.0", prefix: 24, reason: "6to4 relay" },
  { network: "192.168.0.0", prefix: 16, reason: "private" },
  { network: "192.175.48.0", prefix: 24, reason: "AS112" },
  { network: "198.18.0.0", prefix: 15, reason: "benchmarking" },
  { network: "198.51.100.0", prefix: 24, reason: "documentation" },
  { network: "203.0.113.0", prefix: 24, reason: "documentation" },
  { network: "224.0.0.0", prefix: 4, reason: "multicast" },
  { network: "240.0.0.0", prefix: 4, reason: "reserved" },
];

export function isPublicIpv4Address(address: string): boolean {
  const value = ipv4Value(address);
  if (value === null) return false;
  return !BLOCKED_IPV4_PREFIXES.some(({ network, prefix }) => {
    const networkValue = ipv4Value(network);
    return networkValue !== null && inPrefix(value, networkValue, prefix);
  });
}

/**
 * Expand an IPv6 literal into its eight 16-bit groups. A trailing dotted
 * quad (IPv4-mapped, IPv4-translated, or IPv4-compatible form) is expanded
 * into its two groups. Returns null for malformed input.
 */
export function ipv6Groups(address: string): readonly number[] | null {
  let expanded = address;
  const dotted = address.match(/:(\d+\.\d+\.\d+\.\d+)$/u);
  if (dotted?.[1]) {
    const value = ipv4Value(dotted[1]);
    if (value === null) return null;
    expanded = `${address.slice(0, -dotted[1].length)}${((value >>> 16) & 0xffff).toString(16)}:${(value & 0xffff).toString(16)}`;
  }

  const halves = expanded.split("::");
  if (halves.length > 2) return null;
  const parseHalf = (half: string): number[] | null => {
    if (half === "") return [];
    const groups: number[] = [];
    for (const part of half.split(":")) {
      if (!/^[0-9a-fA-F]{1,4}$/u.test(part)) return null;
      groups.push(Number.parseInt(part, 16));
    }
    return groups;
  };

  if (halves.length === 1) {
    const groups = parseHalf(halves[0] ?? "");
    return groups !== null && groups.length === 8 ? groups : null;
  }
  const head = parseHalf(halves[0] ?? "");
  const tail = parseHalf(halves[1] ?? "");
  if (head === null || tail === null) return null;
  if (head.length + tail.length > 7) return null;
  return [
    ...head,
    ...Array.from<number>({ length: 8 - head.length - tail.length }).fill(0),
    ...tail,
  ];
}

function groupsPrefix(groups: readonly number[], prefixGroups: readonly number[]): boolean {
  return prefixGroups.every((group, index) => groups[index] === group);
}

export function isPublicIpv6Address(address: string): boolean {
  const groups = ipv6Groups(address);
  if (groups === null || groups.length !== 8) return false;
  const first = groups[0] ?? 0;
  const second = groups[1] ?? 0;

  // Unspecified (::) and loopback (::1).
  if (groups.every((group) => group === 0)) return false;
  if (groups.slice(0, 7).every((group) => group === 0) && groups[7] === 1) {
    return false;
  }

  // IPv4-mapped (::ffff:a.b.c.d), IPv4-translated (::ffff:0:a.b.c.d), and
  // IPv4-compatible (::a.b.c.d) forms carry an embedded IPv4 address;
  // judge the embedded address, not the wrapper.
  const firstSix = groups.slice(0, 6);
  const embeddedV4 =
    firstSix.every((group) => group === 0) ||
    groupsPrefix(firstSix, [0, 0, 0, 0, 0, 0xffff]) ||
    groupsPrefix(firstSix, [0, 0, 0, 0, 0xffff, 0]);
  if (embeddedV4) {
    const value = (((groups[6] ?? 0) << 16) | (groups[7] ?? 0)) >>> 0;
    return !BLOCKED_IPV4_PREFIXES.some(({ network, prefix }) => {
      const networkValue = ipv4Value(network);
      return networkValue !== null && inPrefix(value, networkValue, prefix);
    });
  }

  // 6to4 (2002::/16) and Teredo (2001::/32) embed an IPv4 address.
  if (first === 0x2002) {
    const value = ((second << 16) | (groups[2] ?? 0)) >>> 0;
    return !BLOCKED_IPV4_PREFIXES.some(({ network, prefix }) => {
      const networkValue = ipv4Value(network);
      return networkValue !== null && inPrefix(value, networkValue, prefix);
    });
  }
  if (first === 0x2001 && second === 0) {
    const value = ((((groups[6] ?? 0) << 16) | (groups[7] ?? 0)) ^ 0xffffffff) >>> 0;
    return !BLOCKED_IPV4_PREFIXES.some(({ network, prefix }) => {
      const networkValue = ipv4Value(network);
      return networkValue !== null && inPrefix(value, networkValue, prefix);
    });
  }

  // NAT64 well-known prefix (64:ff9b::/96) embeds an IPv4 address.
  if (groupsPrefix(groups, [0x64, 0xff9b, 0, 0, 0, 0])) {
    const value = (((groups[6] ?? 0) << 16) | (groups[7] ?? 0)) >>> 0;
    return !BLOCKED_IPV4_PREFIXES.some(({ network, prefix }) => {
      const networkValue = ipv4Value(network);
      return networkValue !== null && inPrefix(value, networkValue, prefix);
    });
  }

  if (first === 0x64 && second === 0xff9b && (groups[2] ?? 0) === 1) {
    return false; // NAT64 local-use prefix 64:ff9b:1::/48.
  }
  if (first === 0x0100 && second === 0) return false; // Discard-only 100::/64.
  if (first === 0x2001 && second === 0xdb8) return false; // Documentation.
  if ((first & 0xfe00) === 0xfc00) return false; // Unique-local fc00::/7.
  if ((first & 0xffc0) === 0xfe80) return false; // Link-local fe80::/10.
  if ((first & 0xff00) === 0xff00) return false; // Multicast ff00::/8.
  return true;
}

/**
 * True only for a public unicast address. Loopback, private, link-local,
 * shared, documentation, benchmarking, multicast, reserved, and
 * unspecified addresses are rejected, as are IPv6 forms that embed such an
 * IPv4 address. The cloud metadata address 169.254.169.254 is link-local
 * and therefore rejected; the IPv6 metadata address fd00:ec2::254 is
 * unique-local and therefore rejected.
 */
export function isPublicIpAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPublicIpv4Address(address);
  if (family === 6) return isPublicIpv6Address(address);
  return false;
}

export interface ValidatedTargetAddresses {
  /** Every resolved address, in resolver order. */
  readonly addresses: readonly string[];
  /** The single address the probe connects to. */
  readonly pinned: string;
}

/**
 * Validate every resolved address. Any non-public answer rejects the whole
 * set, and an empty or unbounded answer set is rejected as well, so the
 * probe fails closed instead of silently falling back to a public answer.
 */
export function validateResolvedAddresses(
  addresses: readonly ResolvedTargetAddress[],
): ValidatedTargetAddresses {
  if (addresses.length === 0) {
    throw new Error("Target hostname did not resolve to any address.");
  }
  if (addresses.length > MAX_RESOLVED_ADDRESSES) {
    throw new Error("Target hostname resolved to too many addresses.");
  }
  const list = addresses.map((entry) => entry.address);
  for (const address of list) {
    if (!isPublicIpAddress(address)) {
      throw new Error(
        "Target hostname resolved to a non-public address.",
      );
    }
  }
  const pinned = list[0];
  if (pinned === undefined) {
    throw new Error("Target hostname did not resolve to any address.");
  }
  return { addresses: list, pinned };
}

/**
 * Resolve a target hostname. IP literals never touch the resolver and are
 * returned as-is for validation by the caller. Resolution is bounded by
 * `timeoutMs` so a hung resolver cannot stall the probe.
 */
export async function resolveTargetAddresses(
  hostname: string,
  resolver: TargetAddressResolver = defaultResolver,
  timeoutMs: number = DEFAULT_RESOLUTION_TIMEOUT_MS,
): Promise<readonly ResolvedTargetAddress[]> {
  const family = isIP(hostname);
  if (family !== 0) {
    return [{ address: hostname, family }];
  }
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout =
      timeoutMs > 0
        ? new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () => reject(new Error("Target hostname resolution timed out.")),
              timeoutMs,
            );
          })
        : null;
    return timeout === null
      ? await resolver(hostname)
      : await Promise.race([resolver(hostname), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
