/*
 * Country borders as line geometry.
 *
 * Borders used to be painted into the overlay texture, which meant their sharpness was
 * capped by that texture's resolution - at continent zoom they were magnified 3.5x and
 * turned to mush, which is exactly why dense regions like the Balkans were unreadable.
 * Geometry has no such ceiling: these stay crisp however far you zoom in.
 *
 * Two networks, drawn with different weights:
 *   land  - international boundaries. What the player actually needs to see.
 *   coast - coastline. Drawn fainter, because the satellite imagery already shows where
 *           the sea is, and competing with it only adds noise.
 *
 * Every border is drawn twice, once from each side's polygon. That is harmless because
 * the colour is uniform; the moment anyone tints borders per country, the two coincident
 * lines have different colours and z-fight into shimmer. Hence: one colour.
 */
import { Color } from 'three';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { sphereVector } from './picking';
import { BORDER_CASING, BORDER_COAST, BORDER_LAND } from './palette';

/** Just above the surface, so lines are never swallowed by it. */
const R = 1.0015;
const R_HIGHLIGHT = 1.003;

export interface BorderFeature {
  properties: { iso: string; kind: string };
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: number[][][] | number[][][][] };
}
export interface BorderGeo { features: BorderFeature[] }
/** Per feature, per ring: one character per segment. '1' land border, '0' coast, '-' skip. */
export interface BorderClasses { classes: string[][] }

const ringsOf = (g: BorderFeature['geometry']): number[][][] =>
  g.type === 'Polygon' ? (g.coordinates as number[][][])
    : (g.coordinates as number[][][][]).flat();

function push(out: number[], a: number[], b: number[], radius: number): void {
  const p = sphereVector(a[0]!, a[1]!, radius);
  const q = sphereVector(b[0]!, b[1]!, radius);
  out.push(p[0], p[1], p[2], q[0], q[1], q[2]);
}

export class Borders {
  readonly land: LineSegments2;
  /** Drawn beneath `land`, wider and dark. Shares land's geometry - see the constructor. */
  readonly landCasing: LineSegments2;
  readonly coast: LineSegments2;
  readonly highlight: LineSegments2;

  private readonly geo: BorderGeo;
  private readonly classes: BorderClasses;
  private readonly highlightMat: LineMaterial;
  private readonly materials: LineMaterial[] = [];
  private readonly cache =
    new Map<string, { land: Float32Array; casing: Float32Array; coast: Float32Array }>();

  constructor(geo: BorderGeo, classes: BorderClasses) {
    this.geo = geo;
    this.classes = classes;

    /* Both networks start empty and hidden: the home screen shows no borders at all.
     * Coastline is far dimmer than the numbers alone suggest, because it sits against
     * dark ocean where anything light reads as high contrast, while land borders sit on
     * bright terrain. Matching them by opacity makes the coast shout. */
    this.land = this.makeSegments(BORDER_LAND, 1.3, 0.95);
    this.coast = this.makeSegments(BORDER_COAST, 0.9, 0.16);

    /* The casing needs its OWN geometry, very slightly inside the core line's radius.
     * Sharing one buffer is tempting - it is half the memory and can never drift - but
     * it puts both lines at identical depth, and the resulting z-fighting makes the
     * border read as a dark dotted line instead of a light line with a dark edge.
     *
     * Only land borders are cased. Coastline is deliberately faint and sits over ocean,
     * where a light line already has about 4:1 contrast. */
    this.landCasing = new LineSegments2(new LineSegmentsGeometry(), new LineMaterial({
      color: new Color(BORDER_CASING).getHex(),
      linewidth: 2.6,
      transparent: true,
      opacity: 0.62,
      depthTest: true,
      worldUnits: false,
    }));
    this.materials.push(this.landCasing.material as LineMaterial);
    this.landCasing.renderOrder = 3;
    this.landCasing.frustumCulled = false;

    this.land.visible = false;
    this.landCasing.visible = false;
    this.coast.visible = false;

    // One country's outline, rebuilt on demand for the wrong-click flash and the reveal.
    this.highlightMat = new LineMaterial({
      color: new Color('#ffffff').getHex(),
      linewidth: 2.6,
      transparent: true,
      opacity: 0,
      depthTest: false,
      worldUnits: false,
    });
    this.materials.push(this.highlightMat);
    // Segments, not a continuous polyline: a country's outline is many disjoint rings.
    this.highlight = new LineSegments2(new LineSegmentsGeometry(), this.highlightMat);
    this.highlight.renderOrder = 6;
    this.highlight.visible = false;
  }

  private makeSegments(color: string, width: number, opacity: number): LineSegments2 {
    const g = new LineSegmentsGeometry();
    g.setPositions(new Float32Array(0));
    const m = new LineMaterial({
      color: new Color(color).getHex(),
      linewidth: width,
      transparent: true,
      opacity,
      depthTest: true,
      worldUnits: false,
    });
    this.materials.push(m);
    const seg = new LineSegments2(g, m);
    seg.renderOrder = 4;
    seg.frustumCulled = false;
    return seg;
  }

  /**
   * Which countries' borders to draw. `null` clears them entirely.
   *
   * Borders exist for the region being played and nowhere else: on the home and mode
   * screens the planet is just a planet, and during a round the lit region is the board
   * while everything else is scenery.
   *
   * This rebuilds the position buffers rather than recolouring, because LineMaterial
   * carries colour as a vec3 and has no per-vertex alpha to hide segments with. It walks
   * ~100k segments, which costs a few milliseconds, happens once per round, and is
   * cached per scope.
   */
  setScope(isos: ReadonlySet<string> | null): void {
    if (!isos || isos.size === 0) {
      this.land.visible = false;
      this.landCasing.visible = false;
      this.coast.visible = false;
      return;
    }
    const key = [...isos].sort().join(',');
    let built = this.cache.get(key);
    if (!built) {
      const landPos: number[] = [];
      const coastPos: number[] = [];
      this.geo.features.forEach((f, fi) => {
        if (!isos.has(f.properties.iso)) return;
        const rings = ringsOf(f.geometry);
        const perRing = this.classes.classes[fi] ?? [];
        rings.forEach((ring, ri) => {
          const bits = perRing[ri] ?? '';
          for (let i = 1; i < ring.length; i++) {
            const flag = bits[i - 1];
            if (flag === '-') continue;   // degenerate, antimeridian, or internal
            push(flag === '1' ? landPos : coastPos, ring[i - 1]!, ring[i]!, R);
          }
        });
      });
      /* The casing sits a hair inside the core so the depth buffer can separate them.
       * 0.9995 of 1.0015 is still clear of the surface at 1.0. */
      const land = new Float32Array(landPos);
      const casing = new Float32Array(land.length);
      for (let i = 0; i < land.length; i++) casing[i] = land[i]! * 0.9995;
      built = { land, casing, coast: new Float32Array(coastPos) };
      this.cache.set(key, built);
    }
    this.land.geometry.setPositions(built.land);
    this.landCasing.geometry.setPositions(built.casing);
    this.coast.geometry.setPositions(built.coast);
    this.land.visible = built.land.length > 0;
    this.landCasing.visible = this.land.visible;   // same geometry, so same story
    this.coast.visible = built.coast.length > 0;
  }

  /**
   * LineMaterial converts its pixel width using the viewport size, so this MUST be kept
   * current or every line is the wrong thickness. It is the standard fat-line trap.
   */
  setResolution(width: number, height: number): void {
    for (const m of this.materials) m.resolution.set(width, height);
  }

  /** Outline one country - its real shape, not a disc over the top of it. */
  showOutline(iso: string, color: string): void {
    const pos: number[] = [];
    for (const f of this.geo.features) {
      if (f.properties.iso !== iso) continue;
      for (const ring of ringsOf(f.geometry)) {
        for (let i = 1; i < ring.length; i++) {
          const a = ring[i - 1]!, b = ring[i]!;
          if (Math.abs(a[0]! - b[0]!) > 180) continue;
          push(pos, a, b, R_HIGHLIGHT);
        }
      }
    }
    if (!pos.length) { this.highlight.visible = false; return; }
    const g = new LineSegmentsGeometry();
    g.setPositions(new Float32Array(pos));
    this.highlight.geometry.dispose();
    this.highlight.geometry = g;
    this.highlightMat.color.set(color);
    this.highlightMat.opacity = 1;
    this.highlight.visible = true;
  }

  setOutlineOpacity(o: number): void {
    this.highlightMat.opacity = o;
    if (o <= 0) this.highlight.visible = false;
  }

  hideOutline(): void {
    this.highlight.visible = false;
    this.highlightMat.opacity = 0;
  }

  /** Coastline is the cheap thing to drop if the line count costs too much. */
  setCoastVisible(v: boolean): void {
    this.coast.visible = v;
  }

  dispose(): void {
    for (const o of [this.land, this.landCasing, this.coast, this.highlight]) {
      o.geometry.dispose();
    }
    for (const m of this.materials) m.dispose();
  }
}
