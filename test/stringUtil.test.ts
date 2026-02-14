import { describe, it, expect } from 'vitest';
import { ifString } from '../src/lib/stringUtil';

describe('ifString', () => {
  it('should return the value if it is a string', () => {
    expect(ifString('hello')).toBe('hello');
  });

  it('should return undefined for non-string values', () => {
    expect(ifString(123)).toBeUndefined();
    expect(ifString(null)).toBeUndefined();
    expect(ifString(undefined)).toBeUndefined();
    expect(ifString(true)).toBeUndefined();
    expect(ifString({})).toBeUndefined();
    expect(ifString([])).toBeUndefined();
  });

  it('should return empty string for empty string input', () => {
    expect(ifString('')).toBe('');
  });
});
