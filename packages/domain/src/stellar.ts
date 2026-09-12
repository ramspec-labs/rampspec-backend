import { StrKey } from "@stellar/stellar-sdk";

export const knownNetworkPassphrases = Object.freeze({
  futurenet: "Test SDF Future Network ; October 2022",
  pubnet: "Public Global Stellar Network ; September 2015",
  testnet: "Test SDF Network ; September 2015",
} as const);

export type KnownStellarNetwork = keyof typeof knownNetworkPassphrases;
export type StellarAddressKind = "account" | "contract" | "muxed-account";

declare const stellarAddressBrand: unique symbol;
export type StellarAddress<Kind extends StellarAddressKind> = string & {
  readonly [stellarAddressBrand]: Kind;
};

export function parseStellarAddress<Kind extends StellarAddressKind>(
  kind: Kind,
  value: unknown,
): StellarAddress<Kind> {
  if (typeof value !== "string") {
    throw new TypeError("Stellar address must be a string.");
  }

  const valid =
    kind === "account"
      ? StrKey.isValidEd25519PublicKey(value)
      : kind === "muxed-account"
        ? StrKey.isValidMed25519PublicKey(value)
        : StrKey.isValidContract(value);
  if (!valid) {
    throw new TypeError(`Invalid Stellar ${kind} address.`);
  }
  return value as StellarAddress<Kind>;
}

export function assertNetworkPassphrase(
  network: KnownStellarNetwork,
  passphrase: unknown,
): string {
  if (passphrase !== knownNetworkPassphrases[network]) {
    throw new TypeError(`Network passphrase does not match ${network}.`);
  }
  return knownNetworkPassphrases[network];
}
