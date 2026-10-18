/**
 * Chrome-first features: pure logic that decides what the page shows
 */

import { isHoldExpired } from '../birdRotation.js';
import { analysePixels } from '../photoTone.js';

describe('birdRotation.isHoldExpired', () => {
  const HOUR = 60 * 60 * 1000;

  test('nothing shown yet always expires', () => {
    expect(isHoldExpired('hourly', undefined)).toBe(true);
    expect(isHoldExpired('daily', 0)).toBe(true);
  });

  test('hourly holds for an hour', () => {
    const shownAt = Date.UTC(2026, 9, 17, 10, 0);
    expect(isHoldExpired('hourly', shownAt, shownAt + HOUR - 1)).toBe(false);
    expect(isHoldExpired('hourly', shownAt, shownAt + HOUR)).toBe(true);
  });

  test('daily holds until the local date changes', () => {
    const morning = new Date(2026, 9, 17, 8, 0).getTime();
    expect(isHoldExpired('daily', morning, new Date(2026, 9, 17, 23, 59).getTime())).toBe(false);
    expect(isHoldExpired('daily', morning, new Date(2026, 9, 18, 0, 1).getTime())).toBe(true);
  });

  test('every tab never holds', () => {
    expect(isHoldExpired('every', Date.now(), Date.now())).toBe(true);
  });
});

describe('photoTone.analysePixels', () => {
  // A width×height image filled by fill(x, y) → [r, g, b]
  function image(width, height, fill) {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const [r, g, b] = fill(x, y);
        data.set([r, g, b, 255], (y * width + x) * 4);
      }
    }
    return data;
  }

  test('a dark photo needs no extra shading', () => {
    const { scrim, center } = analysePixels(image(20, 10, () => [20, 25, 30]), 20, 10);
    expect(scrim).toBe(0);
    expect(center).toBe(0);
  });

  test('a bright sky behind the name gets full shading', () => {
    const { scrim } = analysePixels(image(20, 10, () => [235, 240, 250]), 20, 10);
    expect(scrim).toBe(1);
  });

  test('right-to-left reads the bottom right, where the name is', () => {
    // Bright on the right half only
    const data = image(20, 10, (x) => (x >= 10 ? [240, 240, 240] : [10, 10, 10]));
    expect(analysePixels(data, 20, 10, false).scrim).toBeLessThan(0.3);
    expect(analysePixels(data, 20, 10, true).scrim).toBe(1);
  });

  test('a grey photo keeps the default accent', () => {
    expect(analysePixels(image(20, 10, () => [128, 128, 128]), 20, 10).accent).toBeNull();
  });

  test('the accent follows the photo’s colour at a readable lightness', () => {
    const { accent } = analysePixels(image(20, 10, () => [200, 40, 40]), 20, 10);
    const [r, g, b] = accent;
    expect(r).toBeGreaterThan(g);
    expect(r).toBeGreaterThan(b);
    // Lightness ≈ 0.66, so black text stays readable on it
    const lightness = (Math.max(r, g, b) + Math.min(r, g, b)) / 2 / 255;
    expect(lightness).toBeGreaterThan(0.6);
    expect(lightness).toBeLessThan(0.72);
  });
});

describe('CONFIG.FEATURES per browser build', () => {
  const featuresFor = (browser) => {
    const saved = process.env.BROWSER;
    process.env.BROWSER = browser;
    let features;
    jest.isolateModules(() => { features = require('../config.js').default.FEATURES; });
    process.env.BROWSER = saved;
    return features;
  };

  test('Chrome and Edge get every feature', () => {
    for (const browser of ['chrome', 'edge']) {
      expect(Object.values(featuresFor(browser)).every(Boolean)).toBe(true);
    }
  });

  test('Firefox gets every feature except Open BirdTab, which needs about:newtab', () => {
    const { newTabMode, ...rest } = featuresFor('firefox');
    expect(newTabMode).toBe(false);
    expect(Object.values(rest).every(Boolean)).toBe(true);
  });
});
