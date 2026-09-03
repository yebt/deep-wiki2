import { describe, expect, test } from 'bun:test';
import { isRenderedSvg } from '../compose-smoke';

describe('isRenderedSvg', () => {
  test('accepts a response containing an <svg> element', () => {
    expect(isRenderedSvg('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>')).toBe(true);
  });

  test('rejects a response with no <svg> element', () => {
    expect(isRenderedSvg('{"error":"unknown diagram type"}')).toBe(false);
  });
});
