/**
 * Colour and shading from the photo (Chrome, CONFIG.FEATURES.photoTone)
 *
 * Once the photo is on screen, a 64×40 copy of it gives:
 *   --photo-accent   the photo's most colourful hue, at a lightness that suits the dark
 *                    glass UI (black text stays readable on it); used lightly: toggles,
 *                    focus rings, the quiz progress bar, the favourite heart
 *   --tone-scrim     0–1, how bright the photo is behind the name and credits; fades in
 *                    extra shading there so white text stays readable on pale photos
 *   --tone-center    0–1, the same behind the clock and search box
 * Until then (and when it can't be read) the CSS defaults keep today's look.
 *
 * The media CDN sends Access-Control-Allow-Origin: *, cached media are blob: URLs and
 * bundled photos are packaged, so fetch() reads all of them without tainting a canvas.
 */

import CONFIG from './config.js';
import { log } from './logger.js';

const SAMPLE_W = 64;
const SAMPLE_H = 40;

function toLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function luminance(r, g, b) {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map(v => Math.round(v * 255));
}

/**
 * Accent colour, and brightness behind the info panel and the clock, from RGBA pixels.
 * @returns {{ accent: number[]|null, scrim: number, center: number }}
 */
export function analysePixels(data, width, height, rtl = false) {
  const buckets = Array.from({ length: 24 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
  let panelLum = 0, panelN = 0, centerLum = 0, centerN = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const fx = x / width, fy = y / height;
      const [h, s, l] = rgbToHsl(r, g, b);
      // Colourful, mid-light pixels count most; greys, near-black and near-white not at all
      const weight = s > 0.25 && l > 0.15 && l < 0.85 ? s * (1 - Math.abs(2 * l - 1)) : 0;
      if (weight > 0) {
        const bucket = buckets[Math.floor(h / 15) % 24];
        bucket.w += weight; bucket.r += r * weight; bucket.g += g * weight; bucket.b += b * weight;
      }
      const inPanel = fy >= 0.72 && (rtl ? fx >= 0.45 : fx <= 0.55);
      if (inPanel) { panelLum += luminance(r, g, b); panelN++; }
      if (fy >= 0.12 && fy <= 0.5 && fx >= 0.3 && fx <= 0.7) { centerLum += luminance(r, g, b); centerN++; }
    }
  }

  const best = buckets.reduce((a, b) => (b.w > a.w ? b : a));
  let accent = null;
  // Needs a real share of colourful pixels, else a grey photo keeps the default gold
  if (best.w > width * height * 0.02) {
    const [h, s] = rgbToHsl(best.r / best.w, best.g / best.w, best.b / best.w);
    accent = hslToRgb(h, Math.min(0.8, Math.max(0.45, s)), 0.66);
  }
  // White text needs a dark backdrop: no extra shading up to a mid-dark photo,
  // full shading from a bright one
  const ramp = (lum) => Math.min(1, Math.max(0, (lum - 0.16) / 0.4));
  return {
    accent,
    scrim: panelN ? ramp(panelLum / panelN) : 0,
    center: centerN ? ramp(centerLum / centerN) : 0,
  };
}

/**
 * Read the photo and set the tone variables on <html>.
 * @param {string} imageUrl - the src the background image loaded from
 */
export async function applyPhotoTone(imageUrl) {
  if (!CONFIG.FEATURES.photoTone || !imageUrl || typeof createImageBitmap !== 'function') return;
  try {
    const blob = await (await fetch(imageUrl)).blob();
    const bitmap = await createImageBitmap(blob, { resizeWidth: SAMPLE_W, resizeHeight: SAMPLE_H, resizeQuality: 'low' });
    const canvas = new OffscreenCanvas(SAMPLE_W, SAMPLE_H);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    // Size given again: a browser that ignores createImageBitmap's resize still samples the whole photo
    ctx.drawImage(bitmap, 0, 0, SAMPLE_W, SAMPLE_H);
    bitmap.close();
    const { data } = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H);
    const rtl = document.documentElement.dir === 'rtl';
    const { accent, scrim, center } = analysePixels(data, SAMPLE_W, SAMPLE_H, rtl);

    const root = document.documentElement;
    if (accent) root.style.setProperty('--photo-accent', `rgb(${accent.join(' ')})`);
    root.style.setProperty('--tone-scrim', scrim.toFixed(2));
    root.style.setProperty('--tone-center', center.toFixed(2));
    root.classList.add('photo-tone');
  } catch (error) {
    log(`Photo tone unavailable: ${error.message}`);
  }
}
