import { describe, expect, it } from 'vitest';
import {
  apparentRadiusPx, BADGE_MAX_PX, badgeVisible, kmForPixels, MARKER_RADIUS_PX,
  markerVisible, pixelsPerWorldUnit, pointVisible,
} from './screen';

const FOV = 42;
const H = 900;

describe('pixelsPerWorldUnit', () => {
  it('gives more pixels per world unit as the camera comes closer', () => {
    expect(pixelsPerWorldUnit(1.5, FOV, H)).toBeGreaterThan(pixelsPerWorldUnit(3.5, FOV, H));
  });

  it('scales with viewport height', () => {
    expect(pixelsPerWorldUnit(2, FOV, 1800)).toBeCloseTo(pixelsPerWorldUnit(2, FOV, 900) * 2, 6);
  });

  it('does not blow up when the camera reaches the surface', () => {
    expect(Number.isFinite(pixelsPerWorldUnit(1, FOV, H))).toBe(true);
    expect(Number.isFinite(pixelsPerWorldUnit(0.5, FOV, H))).toBe(true);
  });
});

describe('kmForPixels', () => {
  it('round-trips against apparentRadiusPx', () => {
    // A country of some angular size, converted to pixels and back, must come out the
    // same. This is the guarantee that what you see is what you can press.
    const angular = 0.01;
    for (const d of [3.45, 2.6, 2.09, 1.6]) {
      const px = apparentRadiusPx(angular, d, FOV, H);
      const km = kmForPixels(px, d, FOV, H);
      expect(km).toBeCloseTo(Math.sin(angular) * 6371, 3);
    }
  });

  it('covers more ground per pixel when zoomed out', () => {
    expect(kmForPixels(9, 3.45, FOV, H)).toBeGreaterThan(kmForPixels(9, 1.5, FOV, H));
  });
});

describe('markerVisible', () => {
  // Radii straight from the generated data: Vatican City is the smallest country in the
  // world, Luxembourg is the borderline case, Russia is the largest.
  const VAT = 0.00007;
  const LUX = 0.0072;
  const RUS = 0.371882;

  it('marks the tiniest countries at every plausible zoom', () => {
    for (const d of [3.45, 2.6, 2.09, 1.6, 1.3]) {
      expect(markerVisible(VAT, d, FOV, H), `distance ${d}`).toBe(true);
    }
  });

  it('never marks a country that is obviously big enough to click', () => {
    for (const d of [3.45, 2.6, 2.09, 1.6]) {
      expect(markerVisible(RUS, d, FOV, H), `distance ${d}`).toBe(false);
    }
  });

  it('drops the marker for a mid-sized country as you zoom in', () => {
    expect(markerVisible(LUX, 3.45, FOV, H)).toBe(true);    // world view: Luxembourg is a speck
    expect(markerVisible(LUX, 1.3, FOV, H, true)).toBe(false); // zoomed in: clickable on its own
  });

  it('has hysteresis, so a country on the threshold does not flicker', () => {
    // Find the distance where Luxembourg sits exactly at the marker radius.
    let d = 3.5;
    while (apparentRadiusPx(LUX, d, FOV, H) < MARKER_RADIUS_PX && d > 1.05) d -= 0.001;
    // At that exact point the answer depends on which way we came from - which is the
    // whole point of hysteresis.
    expect(markerVisible(LUX, d, FOV, H, true)).toBe(true);
    expect(markerVisible(LUX, d * 0.8, FOV, H, false)).toBe(false);
  });
});


describe('badgeVisible / pointVisible', () => {
  const FOV2 = 42, H2 = 900;
  // Real radii from the generated data.
  const VAT = 0.00007;      // Vatican City - smallest country on earth
  const BHS = 0.00206;      // Bahamas - just above the click-target threshold
  const FRA = 0.0733;       // France
  const RUS = 0.371882;

  it('always sits wider than the click-target threshold', () => {
    // Anything small enough to need a marker must also be small enough to badge, or a
    // country could be clickable-by-marker yet show nothing when found.
    expect(BADGE_MAX_PX).toBeGreaterThan(MARKER_RADIUS_PX);
  });

  it('badges a found island that is too small to read as green', () => {
    // The Bahamas at the North America view: ~3.7px, well under the badge threshold.
    const d = 2.69;
    expect(apparentRadiusPx(BHS, d, FOV2, H2)).toBeLessThan(BADGE_MAX_PX);
    expect(pointVisible(BHS, true, d, FOV2, H2)).toBe(true);
  });

  it('does not badge a big country - its fill already says it', () => {
    for (const d of [3.45, 2.6, 2.09]) {
      expect(pointVisible(RUS, true, d, FOV2, H2), `Russia at ${d}`).toBe(false);
    }
    expect(pointVisible(FRA, true, 2.09, FOV2, H2)).toBe(false);
  });

  it('shows nothing for a big country whether found or not', () => {
    expect(pointVisible(RUS, false, 2.09, FOV2, H2)).toBe(false);
    expect(pointVisible(RUS, true, 2.09, FOV2, H2)).toBe(false);
  });

  it('keeps the click marker for a tiny country even before it is found', () => {
    expect(pointVisible(VAT, false, 2.09, FOV2, H2)).toBe(true);
    expect(pointVisible(VAT, true, 2.09, FOV2, H2)).toBe(true);
  });

  it('badges a mid-sized found country that the click rule alone would not mark', () => {
    // Somewhere between the two thresholds: no marker when unfound, badge when found.
    let angular = 0.001;
    const d = 2.09;
    while (apparentRadiusPx(angular, d, FOV2, H2) < (MARKER_RADIUS_PX + BADGE_MAX_PX) / 2) {
      angular *= 1.02;
    }
    expect(pointVisible(angular, false, d, FOV2, H2)).toBe(false);
    expect(pointVisible(angular, true, d, FOV2, H2)).toBe(true);
  });

  it('drops the badge once the country is big enough to read on its own', () => {
    // Vanuatu-ish, zoomed right in: the shape carries it, the badge gets out of the way.
    const VUT = 0.0028;
    expect(pointVisible(VUT, true, 2.29, FOV2, H2)).toBe(true);   // Oceania view
    // At 1.15 it is 21.9px - still inside the hysteresis band. By 1.08 it is 41px and
    // unmistakably large enough to read on its own.
    expect(pointVisible(VUT, true, 1.08, FOV2, H2, true)).toBe(false);
  });

  it('has hysteresis at the badge threshold', () => {
    let d = 3.5;
    const r = 0.004;
    while (apparentRadiusPx(r, d, FOV2, H2) < BADGE_MAX_PX && d > 1.05) d -= 0.001;
    expect(badgeVisible(r, d, FOV2, H2, true)).toBe(true);
    expect(badgeVisible(r, d * 0.8, FOV2, H2, false)).toBe(false);
  });
});

describe('the hit radius is the same on touch as on a mouse', () => {
  it('reaches about the same number of pixels whatever the window shape', () => {
    /*
     * The hit radius is in screen pixels, so a phone framing Europe from 3.78 and a
     * desktop framing it from 1.99 give the finger the same reach ON SCREEN - which is
     * the whole reason there is no separate, larger touch radius. The km differ by 3x;
     * the pixels do not differ at all.
     */
    const phone = kmForPixels(MARKER_RADIUS_PX, 3.78, 42, 844);
    const desktop = kmForPixels(MARKER_RADIUS_PX, 1.99, 42, 900);
    expect(phone / desktop).toBeGreaterThan(2);       // very different on the ground
    // ...and the same reach back in pixels, which is what the finger actually has.
    expect(apparentRadiusPx(phone / 6371, 3.78, 42, 844)).toBeCloseTo(MARKER_RADIUS_PX, 2);
    expect(apparentRadiusPx(desktop / 6371, 1.99, 42, 900)).toBeCloseTo(MARKER_RADIUS_PX, 2);
  });
});
