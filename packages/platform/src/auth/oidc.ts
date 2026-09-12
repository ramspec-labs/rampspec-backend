import {
  createLocalJWKSet,
  createRemoteJWKSet,
  jwtVerify,
  type JSONWebKeySet,
  type JWTVerifyGetKey,
} from "jose";

export interface VerifiedOidcClaims {
  readonly acr?: string;
  readonly amr: readonly string[];
  readonly authTime?: number;
  readonly email?: string;
  readonly expiresAt: number;
  readonly issuer: string;
  readonly name?: string;
  readonly subject: string;
}

export interface OidcVerifier {
  verify(idToken: string, now: Date): Promise<VerifiedOidcClaims>;
}

export interface JoseOidcVerifierOptions {
  readonly audience: string;
  readonly issuer: string;
  readonly jwks?: JSONWebKeySet;
  readonly jwksUri?: string;
}

export class JoseOidcVerifier implements OidcVerifier {
  private readonly audience: string;
  private readonly issuer: string;
  private readonly key: JWTVerifyGetKey;

  constructor(options: JoseOidcVerifierOptions) {
    if ((options.jwks === undefined) === (options.jwksUri === undefined)) {
      throw new Error("Configure exactly one local JWKS or remote JWKS URI.");
    }
    this.audience = options.audience;
    this.issuer = options.issuer;
    this.key = options.jwks
      ? createLocalJWKSet(options.jwks)
      : createRemoteJWKSet(new URL(options.jwksUri ?? ""));
  }

  async verify(idToken: string, now: Date): Promise<VerifiedOidcClaims> {
    const { payload } = await jwtVerify(idToken, this.key, {
      audience: this.audience,
      currentDate: now,
      issuer: this.issuer,
    });
    if (!payload.sub || payload.exp === undefined || !payload.iss) {
      throw new Error("OIDC token is missing required claims.");
    }

    const amr = Array.isArray(payload.amr)
      ? payload.amr.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [];
    return {
      ...(typeof payload.acr === "string" ? { acr: payload.acr } : {}),
      amr,
      ...(typeof payload.auth_time === "number"
        ? { authTime: payload.auth_time }
        : {}),
      ...(typeof payload.email === "string" ? { email: payload.email } : {}),
      expiresAt: payload.exp,
      issuer: payload.iss,
      ...(typeof payload.name === "string" ? { name: payload.name } : {}),
      subject: payload.sub,
    };
  }
}
