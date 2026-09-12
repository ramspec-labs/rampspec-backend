import { Decimal } from "decimal.js";

declare const exactDecimalBrand: unique symbol;
export type ExactDecimal = string & { readonly [exactDecimalBrand]: true };

export interface DecimalConstraints {
  readonly allowNegative?: boolean;
  readonly maxAbsolute?: string;
  readonly maxScale?: number;
}

const DecimalContext = Decimal.clone({
  precision: 80,
  rounding: Decimal.ROUND_HALF_EVEN,
});
const decimalPattern = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u;

export function parseDecimal(
  value: unknown,
  constraints: DecimalConstraints = {},
): ExactDecimal {
  if (typeof value !== "string" || !decimalPattern.test(value)) {
    throw new TypeError("Decimal values must be plain base-10 strings.");
  }

  const decimal = new DecimalContext(value);
  if (!decimal.isFinite()) {
    throw new RangeError("Decimal value must be finite.");
  }
  if (!constraints.allowNegative && decimal.isNegative() && !decimal.isZero()) {
    throw new RangeError("Negative decimal values are not allowed.");
  }

  const scale = value.includes(".") ? (value.split(".")[1]?.length ?? 0) : 0;
  if (constraints.maxScale !== undefined && scale > constraints.maxScale) {
    throw new RangeError(`Decimal scale exceeds ${constraints.maxScale}.`);
  }
  if (
    constraints.maxAbsolute !== undefined &&
    decimal.abs().greaterThan(new DecimalContext(constraints.maxAbsolute))
  ) {
    throw new RangeError(
      `Decimal magnitude exceeds ${constraints.maxAbsolute}.`,
    );
  }

  return decimal.toFixed() as ExactDecimal;
}

export function addDecimals(
  left: ExactDecimal,
  right: ExactDecimal,
): ExactDecimal {
  return new DecimalContext(left).plus(right).toFixed() as ExactDecimal;
}

export function compareDecimals(
  left: ExactDecimal,
  right: ExactDecimal,
): -1 | 0 | 1 {
  return new DecimalContext(left).comparedTo(right) as -1 | 0 | 1;
}
