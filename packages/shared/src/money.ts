/**
 * Money is stored as an integer number of minor units (paise for INR) in a bigint.
 * Floating-point numbers are never used for money anywhere in the codebase.
 *
 * In Postgres money columns are `numeric(14,2)`; convert with `fromDecimalString` /
 * `toDecimalString` at the data-access boundary.
 */

export type CurrencyCode = 'INR';

const MINOR_UNITS: Record<CurrencyCode, number> = { INR: 2 };

export class Money {
  private constructor(
    readonly minor: bigint,
    readonly currency: CurrencyCode,
  ) {}

  static zero(currency: CurrencyCode = 'INR'): Money {
    return new Money(0n, currency);
  }

  static ofMinor(minor: bigint, currency: CurrencyCode = 'INR'): Money {
    return new Money(minor, currency);
  }

  /** Parses a decimal string such as "1250.50" or "-10" (as returned by Postgres numeric). */
  static fromDecimalString(value: string, currency: CurrencyCode = 'INR'): Money {
    const scale = MINOR_UNITS[currency];
    const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(value.trim());
    if (!match) {
      throw new Error(`Invalid money amount: "${value}"`);
    }
    const [, sign, whole, fraction = ''] = match;
    if (fraction.length > scale) {
      throw new Error(`Amount "${value}" has more than ${scale} decimal places`);
    }
    const minor = BigInt(whole + fraction.padEnd(scale, '0'));
    return new Money(sign ? -minor : minor, currency);
  }

  toDecimalString(): string {
    const scale = MINOR_UNITS[this.currency];
    const negative = this.minor < 0n;
    const digits = (negative ? -this.minor : this.minor).toString().padStart(scale + 1, '0');
    const whole = digits.slice(0, digits.length - scale);
    const fraction = digits.slice(digits.length - scale);
    return `${negative ? '-' : ''}${whole}.${fraction}`;
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minor + other.minor, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.minor - other.minor, this.currency);
  }

  /**
   * Splits an amount into `parts` installments whose sum is exactly the original amount.
   * Remainder paise go to the earliest installments.
   */
  allocate(parts: number): Money[] {
    if (!Number.isInteger(parts) || parts <= 0) {
      throw new Error('parts must be a positive integer');
    }
    const count = BigInt(parts);
    const base = this.minor / count;
    const remainder = this.minor % count;
    return Array.from(
      { length: parts },
      (_, i) => new Money(base + (BigInt(i) < remainder ? 1n : 0n), this.currency),
    );
  }

  isZero(): boolean {
    return this.minor === 0n;
  }

  isNegative(): boolean {
    return this.minor < 0n;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.minor === other.minor;
  }

  compare(other: Money): -1 | 0 | 1 {
    this.assertSameCurrency(other);
    return this.minor < other.minor ? -1 : this.minor > other.minor ? 1 : 0;
  }

  private assertSameCurrency(other: Money): void {
    if (other.currency !== this.currency) {
      throw new Error(`Currency mismatch: ${this.currency} vs ${other.currency}`);
    }
  }
}
