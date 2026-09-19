/*
 * The country-fill layer.
 *
 * Drawn to an equirectangular canvas and handed to the surface shader as a texture.
 * Equirectangular maps 1:1 onto sphere UVs, so there is no projection maths here:
 *   x = (lon + 180) / 360 * W       y = (90 - lat) / 180 * H
 *
 * FILLS ONLY. Borders used to be stroked here too, and markers drawn as circles, and
 * both were wrong for the same reason: a texture fixes their size in geography rather
 * than on screen. Borders are line geometry now (borders.ts) and markers are screen-space
 * points (markers.ts). A soft-edged fill magnifies perfectly well, so it stays.
 *
 * Repainting is incremental. A full repaint of 99k vertices at this resolution is a
 * visible hitch, and exactly one country changes per correct answer.
 */
import { CanvasTexture, LinearFilter, SRGBColorSpace } from 'three';
import { FOUND, NEUTRAL } from './palette';

export interface OverlayFeature {
  iso: string;
  /**
   * EVERY ring of every polygon, outer boundaries and holes alike - not just the outer
   * ones the picker uses. Lesotho is a hole in South Africa, San Marino and Vatican City
   * are holes in Italy, and there are enclaves in the Caucasus and Central Asia. Trace
   * only the outer rings and finding South Africa fills Lesotho in with it.
   */
  rings: number[][][];
}
export interface OverlayState {
  inScope: ReadonlySet<string>;
  found: ReadonlySet<string>;
  hue: string;
  /** Drawn, but never asked about - currently Western Sahara alone. */
  neutral?: ReadonlySet<string>;
}

/* Twice the old size, and now matched to the 8K base map rather than half the 4K one. */
const W = 4096;
const H = 2048;

const xOf = (lon: number) => ((lon + 180) / 360) * W;
const yOf = (lat: number) => ((90 - lat) / 180) * H;

export class CountryOverlay {
  readonly texture: CanvasTexture;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly byIso = new Map<string, OverlayFeature[]>();
  private state: OverlayState = { inScope: new Set(), found: new Set(), hue: '#4CC2FF' };

  constructor(features: OverlayFeature[]) {
    for (const f of features) {
      const list = this.byIso.get(f.iso);
      if (list) list.push(f); else this.byIso.set(f.iso, [f]);
    }
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    this.ctx = canvas.getContext('2d')!;
    this.texture = new CanvasTexture(canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.minFilter = LinearFilter;
    this.texture.magFilter = LinearFilter;
  }

  private trace(iso: string): boolean {
    const feats = this.byIso.get(iso);
    if (!feats) return false;
    const c = this.ctx;
    c.beginPath();
    for (const f of feats) {
      for (const ring of f.rings) {
        if (ring.length < 3) continue;
        c.moveTo(xOf(ring[0]![0]!), yOf(ring[0]![1]!));
        for (let i = 1; i < ring.length; i++) c.lineTo(xOf(ring[i]![0]!), yOf(ring[i]![1]!));
        c.closePath();
      }
    }
    return true;
  }

  private fillCountry(iso: string): void {
    const found = this.state.found.has(iso);
    const inScope = this.state.inScope.has(iso);
    const neutral = this.state.neutral?.has(iso) ?? false;
    if (!found && !inScope && !neutral) return;
    if (!this.trace(iso)) return;
    const c = this.ctx;
    if (neutral && !inScope) {
      // Drawn but outside the game. Without this it reads as a hole in the map rather
      // than as somewhere deliberately left out.
      c.fillStyle = NEUTRAL;
      c.globalAlpha = 0.3;
    } else {
      c.fillStyle = found ? FOUND : this.state.hue;
      // Found is solid enough to read at a glance; in-play is a wash that lets the
      // terrain and the borders through.
      c.globalAlpha = found ? 0.62 : 0.28;
    }
    /* 'evenodd', not the default 'nonzero': it punches a hole out of the fill wherever
     * one ring sits inside another, regardless of which way round the two are wound.
     * GeoJSON is supposed to wind holes opposite to their outer ring, but Natural Earth
     * does not do so reliably, and under 'nonzero' a same-wound hole fills in solid. */
    c.fill('evenodd');
    c.globalAlpha = 1;
  }

  /** Full repaint. Round start and reset only. */
  paint(state: OverlayState): void {
    this.state = state;
    this.ctx.clearRect(0, 0, W, H);
    for (const iso of this.byIso.keys()) this.fillCountry(iso);
    this.texture.needsUpdate = true;
  }

  /**
   * Repaint one country. "Found" is drawn more opaque than "in play", so this paints over
   * the existing wash without needing to clear - which would mean redrawing everything.
   */
  markFound(iso: string): void {
    this.state = { ...this.state, found: new Set([...this.state.found, iso]) };
    this.fillCountry(iso);
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
