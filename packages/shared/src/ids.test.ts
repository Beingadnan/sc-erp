import { describe, expect, it } from 'vitest';
import { isUuid, newId } from './ids.js';

describe('newId', () => {
  it('produces valid v7 UUIDs', () => {
    const id = newId();
    expect(isUuid(id)).toBe(true);
    expect(id[14]).toBe('7');
  });

  it('is time-ordered', () => {
    const a = newId(1_700_000_000_000);
    const b = newId(1_700_000_000_001);
    expect(a < b).toBe(true);
  });

  it('rejects non-UUID input', () => {
    expect(isUuid('1 OR 1=1')).toBe(false);
    expect(isUuid(42)).toBe(false);
  });
});
