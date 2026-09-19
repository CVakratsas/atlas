/*
 * Markers for countries too small to click.
 *
 * A ring with a filled centre, drawn at a constant size on screen no matter the zoom, at
 * every country's label point. A marker appears only while the country itself would draw
 * smaller than the marker would - so Vatican City always has one, Luxembourg has one from
 * the world view but loses it once you zoom into Europe, and Russia never has one.
 *
 * That rule replaces a hand-kept list of 29 "small countries", which was really just the
 * set Natural Earth's 110m data happened to omit, and which put Cape Verde in and
 * Luxembourg out on no principle at all.
 */
import {
  BufferGeometry, Color, Float32BufferAttribute, NormalBlending, Points, ShaderMaterial,
} from 'three';
import { sphereVector } from './picking';
import { MARKER_RADIUS_PX, pointVisible } from './screen';
import { FOUND, MARKER_RIM } from './palette';

export interface MarkerCountry {
  iso: string;
  labelPoint: [number, number];
  /** Angular radius of the country's largest landmass, in radians. */
  radius: number;
}

/** Just clear of the surface so a marker is never swallowed by the terrain. */
const R = 1.006;

const vertex = /* glsl */ `
  attribute vec3 aColor;
  attribute float aAlpha;
  attribute float aFound;
  uniform float uSize;
  varying vec3 vColor;
  varying float vAlpha;
  varying float vFound;
  varying float vFacing;
  void main() {
    vColor = aColor;
    vAlpha = aAlpha;
    vFound = aFound;
    vec4 world = modelMatrix * vec4(position, 1.0);
    // On a unit sphere the surface normal is the position itself, so this is just the
    // rotated point. Used to hide markers on the far side of the planet.
    vec3 n = normalize((modelMatrix * vec4(position, 0.0)).xyz);
    vFacing = dot(n, normalize(cameraPosition - world.xyz));
    gl_Position = projectionMatrix * viewMatrix * world;
    gl_PointSize = uSize;
  }`;

/** Distance from p to the segment ab - used to draw the tick. */
const SEG = /* glsl */ `
  float segDist(vec2 p, vec2 a, vec2 b) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h);
  }`;

const fragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vFound;
  varying float vFacing;
  uniform vec3 uRim;
  ${SEG}
  void main() {
    // Round the back of the globe: drop it entirely rather than let it bleed through.
    if (vFacing < 0.04 || vAlpha <= 0.01) discard;
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    p.y = -p.y;                       // gl_PointCoord's y runs downward
    float d = length(p);
    if (d > 1.0) discard;

    vec3 col;
    float a;

    if (vFound > 0.5) {
      /* FOUND: a solid disc with a tick cut out of it. Shape, fill and colour all differ
       * from the unfound ring at once, which is what makes it readable at 9px - a hue
       * change on its own is invisible at that size, and in an island round most of the
       * board is that size. */
      float disc = smoothstep(0.90, 0.78, d);
      float tick = min(
        segDist(p, vec2(-0.34, 0.04), vec2(-0.08, -0.26)),
        segDist(p, vec2(-0.08, -0.26), vec2(0.36, 0.30)));
      float cut = smoothstep(0.13, 0.21, tick);   // 0 on the tick, 1 elsewhere
      col = mix(uRim, vColor, cut);
      a = disc;
      // A dark rim, so a green disc still has an edge over bright ocean or desert.
      float rim = smoothstep(0.78, 0.90, d) * smoothstep(1.0, 0.92, d);
      col = mix(col, uRim, rim);
      a = max(a, rim);
    } else {
      // UNFOUND: a hollow ring - clearly an empty slot waiting to be filled.
      float ring = smoothstep(1.0, 0.90, d) * smoothstep(0.58, 0.70, d);
      float rim = smoothstep(1.0, 0.94, d) * smoothstep(0.50, 0.58, d) * 0.55;
      col = mix(uRim, vColor, ring);
      a = max(ring, rim);
    }

    a *= vAlpha;
    // Fade in as the marker comes round the limb, so it never pops.
    a *= smoothstep(0.04, 0.22, vFacing);
    if (a <= 0.01) discard;
    gl_FragColor = vec4(col, a);
  }`;

export class Markers {
  readonly points: Points;

  private readonly order: string[] = [];
  private readonly index = new Map<string, number>();
  private readonly radii: number[] = [];
  private readonly colors: Float32BufferAttribute;
  private readonly alphas: Float32BufferAttribute;
  private readonly founds: Float32BufferAttribute;
  private readonly material: ShaderMaterial;

  private inScope: ReadonlySet<string> = new Set();
  private found: ReadonlySet<string> = new Set();
  private hue = new Color('#4CC2FF');
  private wasVisible: boolean[] = [];
  private dirty = true;

  constructor(countries: MarkerCountry[], pixelRatio: number) {
    const pos: number[] = [];
    for (const c of countries) {
      this.index.set(c.iso, this.order.length);
      this.order.push(c.iso);
      this.radii.push(c.radius);
      /* Start hidden so the STRICTER show-threshold decides the first frame. Starting
       * visible means the lenient hide-threshold applies instead, and countries that are
       * perfectly clickable on their own keep a marker they never needed. */
      this.wasVisible.push(false);
      pos.push(...sphereVector(c.labelPoint[0], c.labelPoint[1], R));
    }

    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    this.colors = new Float32BufferAttribute(new Float32Array(this.order.length * 3), 3);
    this.alphas = new Float32BufferAttribute(new Float32Array(this.order.length), 1);
    this.founds = new Float32BufferAttribute(new Float32Array(this.order.length), 1);
    g.setAttribute('aColor', this.colors);
    g.setAttribute('aAlpha', this.alphas);
    g.setAttribute('aFound', this.founds);

    this.material = new ShaderMaterial({
      uniforms: {
        uSize: { value: MARKER_RADIUS_PX * 2 * pixelRatio },
        uRim: { value: new Color(MARKER_RIM) },
      },
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthTest: false,
      // Normal, not additive: additive washes green out over bright ocean and makes a
      // cut-out tick impossible, and both are what this state depends on.
      blending: NormalBlending,
    });

    this.points = new Points(g, this.material);
    this.points.renderOrder = 7;
    this.points.frustumCulled = false;
    this.points.visible = false;
  }

  /** gl_PointSize is in device pixels, so it has to track the renderer's pixel ratio. */
  setPixelRatio(ratio: number): void {
    this.material.uniforms['uSize']!.value = MARKER_RADIUS_PX * 2 * ratio;
  }

  setState(inScope: ReadonlySet<string>, found: ReadonlySet<string>, hue: string): void {
    this.inScope = inScope;
    this.found = found;
    this.hue = new Color(hue);
    this.points.visible = inScope.size > 0;
    this.refreshColors();
  }

  markFound(iso: string): void {
    const i = this.index.get(iso);
    if (i === undefined) return;
    this.found = new Set([...this.found, iso]);
    this.writeColor(i, FOUND);
    this.colors.needsUpdate = true;
    this.founds.setX(i, 1);
    this.founds.needsUpdate = true;
    // A country can become visible by being found, not only by being small, so the
    // visibility pass has to run again rather than waiting for the camera to move.
    this.dirty = true;
  }

  private writeColor(i: number, hex: string | Color): void {
    const c = hex instanceof Color ? hex : new Color(hex);
    this.colors.setXYZ(i, c.r, c.g, c.b);
  }

  private refreshColors(): void {
    for (let i = 0; i < this.order.length; i++) {
      const iso = this.order[i]!;
      const found = this.found.has(iso);
      this.writeColor(i, found ? new Color(FOUND) : this.hue);
      this.founds.setX(i, found ? 1 : 0);
    }
    this.colors.needsUpdate = true;
    this.founds.needsUpdate = true;
    this.dirty = true;
  }

  /**
   * Recompute which markers are needed at this zoom. Cheap enough to call whenever the
   * camera moves - a couple of hundred countries, no allocation.
   */
  update(distance: number, fovDeg: number, heightPx: number): void {
    let changed = this.dirty;
    this.dirty = false;
    for (let i = 0; i < this.order.length; i++) {
      const iso = this.order[i]!;
      const want = this.inScope.has(iso)
        && pointVisible(
          this.radii[i]!, this.found.has(iso), distance, fovDeg, heightPx, this.wasVisible[i]);
      if (want !== this.wasVisible[i]) { this.wasVisible[i] = want; changed = true; }
      const target = want ? 1 : 0;
      if (this.alphas.getX(i) !== target) { this.alphas.setX(i, target); changed = true; }
    }
    if (changed) this.alphas.needsUpdate = true;
  }

  /** Which countries currently show a marker - the set the picker may prefer. */
  visibleSet(): Set<string> {
    const out = new Set<string>();
    for (let i = 0; i < this.order.length; i++) {
      if (this.wasVisible[i] && this.inScope.has(this.order[i]!)) out.add(this.order[i]!);
    }
    return out;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
