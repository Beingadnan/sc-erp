import { describe, expect, it } from 'vitest';
import { Money } from './money.js';

describe('Money', () => {
  it('round-trips decimal strings without floating point', () => {
    for (const v of ['0.00', '0.10', '1250.50', '-10.05', '99999999999.99']) {
      expect(Money.fromDecimalString(v).toDecimalString()).toBe(v);
    }
    expect(Money.fromDecimalString('10').toDecimalString()).toBe('10.00');
    expect(Money.fromDecimalString('10.5').toDecimalString()).toBe('10.50');
  });

  it('adds 0.10 + 0.20 exactly', () => {
    const sum = Money.fromDecimalString('0.10').add(Money.fromDecimalString('0.20'));
    expect(sum.toDecimalString()).toBe('0.30');
  });

  it('rejects malformed and over-precise input', () => {
    expect(() => Money.fromDecimalString('1.234')).toThrow();
    expect(() => Money.fromDecimalString('abc')).toThrow();
    expect(() => Money.fromDecimalString('1e3')).toThrow();
  });

  it('allocates installments that sum exactly to the total', () => {
    const total = Money.fromDecimalString('1000.00');
    const parts = total.allocate(3);
    expect(parts.map((p) => p.toDecimalString())).toEqual(['333.34', '333.33', '333.33']);
    expect(parts.reduce((a, b) => a.add(b), Money.zero()).equals(total)).toBe(true);
  });

  it('compares amounts', () => {
    const a = Money.fromDecimalString('5.00');
    const b = Money.fromDecimalString('7.50');
    expect(a.compare(b)).toBe(-1);
    expect(b.subtract(a).toDecimalString()).toBe('2.50');
  });
});
