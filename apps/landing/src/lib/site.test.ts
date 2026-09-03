import { describe, expect, test } from 'bun:test';
import { site } from './site';

describe('site metadata', () => {
  test('names the product', () => {
    expect(site.name).toBe('deep-wiki');
  });

  test('provides a non-empty tagline and description', () => {
    expect(site.tagline.length).toBeGreaterThan(0);
    expect(site.description.length).toBeGreaterThan(0);
  });

  test('description does not merely repeat the tagline', () => {
    expect(site.description).not.toBe(site.tagline);
  });
});
