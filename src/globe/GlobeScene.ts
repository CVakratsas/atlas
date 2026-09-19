/*
 * The globe: renderer, camera, input, and the frame loop.
 *
 * Knows nothing about React. Game state is pushed in through the imperative methods at
 * the bottom; clicks come back out through `onPick`. Nothing here re-renders React, so a
 * 60fps scene never fights the component tree.
 */
import {
  BufferGeometry, Euler, Float32BufferAttribute,
  Mesh, PerspectiveCamera, Points, PointsMaterial,
  Raycaster, Scene, ShaderMaterial, Vector2, Vector3, WebGLRenderer,
} from 'three';
import { Borders, type BorderClasses, type BorderGeo } from './borders';

/** Every Earth material is a ShaderMaterial; this narrows to its uniforms safely. */
const uniformsOf = (m: Mesh): Record<string, { value: unknown }> =>
  (m.material as ShaderMaterial).uniforms;
import { buildEarth, loadEarthMaps, type EarthMeshes } from './earth';
import { CountryOverlay, type OverlayFeature } from './overlay';
import { Markers, type MarkerCountry } from './markers';
import { kmForPixels, MARKER_RADIUS_PX } from './screen';
import { buildPickIndex, countryAt, latLonFromLocal, sphereVector, type PickIndex } from './picking';
import { clampPitch, distanceForBounds, orientationFor, shortestYaw } from './orientation';
import { TARGET, WRONG } from './palette';

const easeInOut = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;

export interface GlobeInit {
  container: HTMLElement;
  /* One parsed world-simplified.geojson, consumed three ways: the picker keeps outer
   * rings, the border renderer walks every ring, and the overlay fills every ring. */
  geo: Parameters<typeof buildPickIndex>[0] & BorderGeo;
  borderClasses: BorderClasses & { radii: Record<string, number> };
  /** Quizzable countries, for the markers. */
  markerCountries: MarkerCountry[];
  /** Drawn but never asked about. */
  neutral: ReadonlySet<string>;
  adjacency: Record<string, { labelPoint: [number, number] }>;
  baseUrl: string;
  reducedMotion: boolean;
  isMobile: boolean;
}

interface Tween {
  fromYaw: number; toYaw: number;
  fromPitch: number; toPitch: number;
  fromDist: number; toDist: number;
  start: number; duration: number;
  resolve: () => void;
}

export class GlobeScene {
  onPick: ((iso: string | null) => void) | null = null;

  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly raycaster = new Raycaster();
  private readonly container: HTMLElement;
  private readonly reducedMotion: boolean;

  private earth: EarthMeshes | null = null;
  private overlay: CountryOverlay | null = null;
  private index: PickIndex;
  private borders: Borders | null = null;
  private markers: Markers | null = null;
  private neutral: ReadonlySet<string> = new Set();

  private yaw = 0;
  private pitch = 0;
  private distance = 3.45;
  private autoRotate = true;
  private autoSpeed = 0.055;
  private tween: Tween | null = null;
  private wrongUntil = 0;
  private revealUntil = 0;

  private raf = 0;
  private last = 0;
  private disposed = false;
  private readonly pointer = { down: false, moved: 0, x: 0, y: 0, t: 0 };

  constructor(init: GlobeInit) {
    this.container = init.container;
    this.reducedMotion = init.reducedMotion;
    this.index = buildPickIndex(init.geo, init.markerCountries);

    this.renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x070b14, 1);
    init.container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.touchAction = 'none';
    this.renderer.domElement.style.cursor = 'grab';

    this.camera = new PerspectiveCamera(42, 1, 0.1, 100);
    this.camera.position.set(0, 0, this.distance);

    this.scene.add(this.buildStars());
    if (init.reducedMotion) this.autoRotate = false;

    this.attachInput();
    this.resize();
    window.addEventListener('resize', this.resize);

    void this.load(init);
  }

  private async load(init: GlobeInit): Promise<void> {
    const caps = this.renderer.capabilities;
    const maps = await loadEarthMaps(init.baseUrl, {
      maxTextureSize: caps.maxTextureSize,
      maxAnisotropy: caps.getMaxAnisotropy(),
      isMobile: init.isMobile,
    });
    if (this.disposed) return;

    /* Built from the raw geometry rather than from the pick index: the index keeps only
     * outer rings, which is right for hit-testing but fills enclaves in. */
    const features: OverlayFeature[] = init.geo.features.map((f) => {
      const polys = f.geometry.type === 'Polygon'
        ? [f.geometry.coordinates as number[][][]]
        : (f.geometry.coordinates as number[][][][]);
      return {
        iso: f.properties.iso,
        rings: polys.flat().filter((r) => r && r.length >= 3),
      };
    });
    this.overlay = new CountryOverlay(features);
    this.neutral = init.neutral;
    this.overlay.texture.anisotropy = caps.getMaxAnisotropy();

    this.earth = buildEarth(maps, this.overlay.texture);
    this.scene.add(this.earth.group);

    // The sun sits just off the camera axis: the face the player is working on stays lit,
    // while the limb keeps a terminator so the planet still reads as a sphere in space.
    const sun = new Vector3(0.45, 0.25, 0.86).normalize();
    for (const m of [this.earth.surface, this.earth.clouds, this.earth.atmosphere]) {
      const u = uniformsOf(m);
      const slot = u['uSunDir'] ?? u['sunDir'];
      if (slot) slot.value = sun;
    }

    this.borders = new Borders(init.geo, init.borderClasses);
    this.updateLineResolution();
    this.earth.group.add(
      this.borders.landCasing, this.borders.land, this.borders.coast, this.borders.highlight);

    this.markers = new Markers(init.markerCountries, this.renderer.getPixelRatio());
    this.earth.group.add(this.markers.points);

    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private buildStars(): Points {
    const n = 2400;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      // Uniform on a sphere: acos of a uniform variable, not a uniform angle, or the
      // stars bunch visibly at the poles.
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = 40 + Math.random() * 20;
      const s = Math.sqrt(1 - u * u);
      pos[i * 3] = Math.cos(a) * s * r;
      pos[i * 3 + 1] = u * r;
      pos[i * 3 + 2] = Math.sin(a) * s * r;
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(pos, 3));
    return new Points(g, new PointsMaterial({
      color: 0xbcd4ec, size: 0.16, sizeAttenuation: true, transparent: true, opacity: 0.85,
    }));
  }

  // --- input ---------------------------------------------------------------------

  private attachInput(): void {
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
  }

  private onDown = (e: PointerEvent): void => {
    this.pointer.down = true;
    this.pointer.moved = 0;
    this.pointer.x = e.clientX;
    this.pointer.y = e.clientY;
    this.pointer.t = performance.now();
    this.renderer.domElement.setPointerCapture(e.pointerId);
    this.renderer.domElement.style.cursor = 'grabbing';
  };

  private onMove = (e: PointerEvent): void => {
    if (!this.pointer.down) return;
    const dx = e.clientX - this.pointer.x;
    const dy = e.clientY - this.pointer.y;
    this.pointer.moved += Math.abs(dx) + Math.abs(dy);
    this.pointer.x = e.clientX;
    this.pointer.y = e.clientY;
    // Dragging always wins over autorotation - the player has taken the wheel.
    this.autoRotate = false;
    this.tween = null;
    const k = 0.0052 * Math.min(1.4, this.distance / 2.2);
    this.yaw += dx * k;
    this.pitch = clampPitch(this.pitch + dy * k);
  };

  private onUp = (e: PointerEvent): void => {
    const wasDown = this.pointer.down;
    this.pointer.down = false;
    this.renderer.domElement.style.cursor = 'grab';
    try { this.renderer.domElement.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    // A drag is not a click. 6px of slop covers a shaky hand without swallowing taps.
    if (!wasDown || this.pointer.moved > 6) return;
    this.pick(e.clientX, e.clientY);
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.tween = null;
    this.distance = Math.max(1.35, Math.min(6, this.distance + e.deltaY * 0.0016));
  };

  private pick(clientX: number, clientY: number): void {
    if (!this.earth || !this.onPick) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.earth.surface, false)[0];
    if (!hit) { this.onPick(null); return; }

    // Into the globe's own frame, which removes the current rotation. Skipping this is
    // the classic failure: every click is wrong by however far the planet has spun.
    const local = this.earth.surface.worldToLocal(hit.point.clone());
    const [lon, lat] = latLonFromLocal(local.x, local.y, local.z);

    /* The hit area is the marker, converted from the size it is DRAWN at to kilometres
     * at this zoom. Deriving both from one number is what makes the target match what
     * you can see; the two used to be unrelated constants. */
    const height = this.container.clientHeight || 1;
    const dotRadiusKm = kmForPixels(MARKER_RADIUS_PX, this.distance, this.camera.fov, height);
    const marked = this.markers?.visibleSet();
    this.onPick(countryAt(lon, lat, this.index,
      marked ? { dotRadiusKm, markedOnly: marked } : { dotRadiusKm }));
  }

  // --- loop ----------------------------------------------------------------------

  private resize = (): void => {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.updateLineResolution();
  };

  /*
   * LineMaterial divides its width by this, so it must be CSS pixels, not the backing
   * store. Passing the backing store makes every line half as thick on a retina display
   * while looking perfect on a 1x monitor - which is exactly the kind of bug that only
   * shows up on someone else's machine.
   */
  private updateLineResolution(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (w && h) this.borders?.setResolution(w, h);
  }

  private frame = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;

    if (this.tween) {
      const t = Math.min(1, (now - this.tween.start) / this.tween.duration);
      const e = easeInOut(t);
      this.yaw = this.tween.fromYaw + (this.tween.toYaw - this.tween.fromYaw) * e;
      this.pitch = this.tween.fromPitch + (this.tween.toPitch - this.tween.fromPitch) * e;
      this.distance = this.tween.fromDist + (this.tween.toDist - this.tween.fromDist) * e;
      if (t >= 1) { const done = this.tween.resolve; this.tween = null; done(); }
    } else if (this.autoRotate) {
      this.yaw += this.autoSpeed * dt;
    }

    if (this.earth) {
      this.earth.group.quaternion.setFromEuler(new Euler(this.pitch, this.yaw, 0, 'XYZ'));
      this.earth.clouds.rotation.y += dt * 0.004;
      const shift = uniformsOf(this.earth.surface)['uCloudShift'];
      if (shift) shift.value = -this.earth.clouds.rotation.y / (Math.PI * 2);
    }

    if (this.borders?.highlight.visible) {
      const until = Math.max(this.revealUntil, this.wrongUntil);
      const left = until - now;
      if (left <= 0) this.borders.hideOutline();
      else {
        // Fade out over the last 400ms, with a gentle pulse while it is up.
        const pulse = this.reducedMotion ? 1 : 0.84 + Math.sin(now / 200) * 0.16;
        this.borders.setOutlineOpacity(Math.min(1, left / 500) * pulse);
      }
    }

    /* Which markers are needed depends on the zoom AND on what has just been found, so
     * this runs every frame rather than only when the camera moves - otherwise a badge
     * would not appear until you happened to nudge the globe. It is a couple of hundred
     * comparisons with no allocation. */
    this.markers?.update(this.distance, this.camera.fov, this.container.clientHeight || 1);

    this.camera.position.set(0, 0, this.distance);
    this.camera.lookAt(0, 0, 0);
    this.renderer.render(this.scene, this.camera);
  };

  // --- the API React drives ------------------------------------------------------

  setAutoRotate(on: boolean): void {
    this.autoRotate = on && !this.reducedMotion;
  }

  /** Full repaint of the country layer. Round start and reset only. */
  setOverlay(inScope: ReadonlySet<string>, found: ReadonlySet<string>, hue: string): void {
    this.overlay?.paint({ inScope, found, hue, neutral: this.neutral });
    this.markers?.setState(inScope, found, hue);
  }

  /** Which countries' borders to draw. null clears them - the home-screen state. */
  setBorderScope(isos: ReadonlySet<string> | null): void {
    this.borders?.setScope(isos);
  }

  /** Light one country up. Cheap - it does not redraw the other 196. */
  markFound(iso: string): void {
    this.overlay?.markFound(iso);
    this.markers?.markFound(iso);
  }

  /**
   * Trace a country's real outline. Used when the player skips - NEVER to mark the
   * country currently being asked for, which would simply hand them the answer.
   */
  reveal(iso: string | null, ms = 1800): void {
    if (!this.borders || !iso) { this.borders?.hideOutline(); return; }
    this.borders.showOutline(iso, TARGET);
    this.revealUntil = performance.now() + ms;
    this.wrongUntil = 0;
  }

  hideReveal(): void {
    this.borders?.hideOutline();
    this.revealUntil = 0;
    this.wrongUntil = 0;
  }

  /**
   * Outline a wrongly-clicked country in red. Its actual shape, briefly - which tells the
   * player what they clicked, where a blob over the top of it would not.
   */
  flashWrong(iso: string): void {
    if (!this.borders) return;
    this.borders.showOutline(iso, WRONG);
    this.wrongUntil = performance.now() + 1300;
    this.revealUntil = 0;
  }

  /** Rotate to face a region and come to rest. Resolves when the motion ends. */
  flyTo(
    bounds: readonly [number, number, number, number],
    opts: { duration?: number } = {},
  ): Promise<void> {
    const [w, s, e, n] = bounds;
    const { yaw, pitch } = orientationFor((w + e) / 2, (s + n) / 2);
    const duration = this.reducedMotion ? 0 : (opts.duration ?? 1800);
    const toDist = distanceForBounds(bounds, this.camera.aspect);

    this.autoRotate = false;
    if (duration === 0) {
      this.yaw = yaw; this.pitch = clampPitch(pitch); this.distance = toDist;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.tween = {
        fromYaw: this.yaw,
        // Shortest path, so Asia -> Americas does not unwind the long way round.
        toYaw: shortestYaw(this.yaw, yaw),
        fromPitch: this.pitch, toPitch: clampPitch(pitch),
        fromDist: this.distance, toDist,
        start: performance.now(), duration, resolve,
      };
    });
  }

  /** Back to the free-spinning home pose. */
  reset(): Promise<void> {
    const p = new Promise<void>((resolve) => {
      this.tween = {
        fromYaw: this.yaw, toYaw: this.yaw,
        fromPitch: this.pitch, toPitch: 0.12,
        fromDist: this.distance, toDist: 3.45,
        start: performance.now(), duration: this.reducedMotion ? 0 : 900, resolve,
      };
    });
    return p.then(() => { this.setAutoRotate(true); });
  }

  /**
   * Where a place currently sits on screen, in CSS pixels, or null if it is round the
   * back. Used by the end-to-end tests to click a specific country, and handy for
   * pinning a label to the globe later.
   */
  screenPositionOf(lon: number, lat: number): { x: number; y: number } | null {
    if (!this.earth) return null;
    const local = new Vector3(...sphereVector(lon, lat));
    const world = local.clone().applyQuaternion(this.earth.group.quaternion);
    // Facing away from the camera means it is on the far side of the planet.
    if (world.z <= 0.04) return null;
    const p = world.project(this.camera);
    const rect = this.renderer.domElement.getBoundingClientRect();
    return {
      x: rect.left + ((p.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - p.y) / 2) * rect.height,
    };
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onDown);
    el.removeEventListener('pointermove', this.onMove);
    el.removeEventListener('pointerup', this.onUp);
    el.removeEventListener('pointercancel', this.onUp);
    el.removeEventListener('wheel', this.onWheel);
    this.overlay?.dispose();
    this.borders?.dispose();
    this.markers?.dispose();
    this.scene.traverse((o) => {
      const m = o as Mesh;
      m.geometry?.dispose?.();
      const mat = m.material;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose?.();
    });
    this.renderer.dispose();
    el.remove();
  }
}
