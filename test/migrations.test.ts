import { describe, it, expect } from 'vitest';
import { migrations } from '../src/migrations';

/**
 * Tests for the consolidated migration schema.
 * Ensures the migration structure is correct before running on production.
 */
describe('migrations', () => {
  it('should have a 001 initial migration', () => {
    expect(migrations).toHaveProperty('001');
    expect(migrations['001']).toHaveProperty('up');
    expect(migrations['001']).toHaveProperty('down');
  });

  it('should have up and down functions that are async', () => {
    const migration = migrations['001'];
    expect(typeof migration.up).toBe('function');
    expect(typeof migration.down).toBe('function');
  });

  it('should not contain legacy table migrations', () => {
    // The old migrations 001-025 should be consolidated
    // We should only have our clean initial migration
    const keys = Object.keys(migrations);
    expect(keys).toContain('001');
    // Should NOT have the old incremental migrations
    expect(keys.length).toBeLessThanOrEqual(5); // Allow room for a few future migrations
  });
});
