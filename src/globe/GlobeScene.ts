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
import {
  clampPitch, distanceForBounds, halfFov, homeDistance, orientationFor, shortestYaw,
} from './orientation';
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
  /** Touch or pen. Decides tap slop and how big a hit target has to be. */
  coarsePointer: boolean;
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
  /* Overwritten by the first resize, which is the first moment the aspect is known. */
  private distance = homeDistance(1.6);
  /** The region currently framed, so a resize can re-fit it. null is the home view. */
  private bounds: readonly [number, number, number, number] | null = null;
  /** Set once the player zooms by hand: after that a resize must not overrule them. */
  private userZoomed = false;
  /** How far the planet is lifted up the screen, in world units. See `homeLift`. */
  private lift = 0;
  private autoRotate = true;
  private autoSpeed = 0.055;
  private tween: Tween | null = null;
  private wrongUntil = 0;
  private revealUntil = 0;

  private raf = 0;
  private last = 0;
  private disposed = false;
  private resizeObserver: ResizeObserver | null = null;
  private readonly coarse: boolean;

  /* Every pointer currently down, by id. A single object could not tell one finger from
   * two, which is why a pinch used to spin the globe: both fingers drove the rotation. */
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private moved = 0;
  private multiTouch = false;
  /** Finger separation and midpoint at the last move, for the pinch. */
  private pinchSpread = 0;
  private pinchMid = { x: 0, y: 0 };

  constructor(init: GlobeInit) {
    this.container = init.container;
    this.reducedMotion = init.reducedMotion;
    this.coarse = init.coarsePointer;
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
    /* A ResizeObserver, not just the window event. Mobile browsers do fire `resize` on
     * rotation, but can report the pre-rotation size when they do - which leaves the
     * camera's aspect disagreeing with the canvas until something else nudges it, and
     * that disagreement is a genuinely stretched globe. The observer fires after layout,
     * with the size the element actually has. */
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(this.resize);
      this.resizeObserver.observe(this.container);
    }
    window.addEventListener('resize', this.resize);
    // The URL bar sliding away changes the viewport without always resizing the element.
    window.visualViewport?.addEventListener('resize', this.resize);

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
    el.addEventListener('pointercancel', this.onCancel);
    el.addEventListener('wheel', this.onWheel, { passive: false });
  }

  /** Midpoint and separation of the first two fingers down. */
  private gesture(): { mid: { x: number; y: number }; spread: number } {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return { mid: { x: a?.x ?? 0, y: a?.y ?? 0 }, spread: 0 };
    return {
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      spread: Math.hypot(a.x - b.x, a.y - b.y),
    };
  }

  /** How far out the camera may pull. Must clear the home view, which grows on a phone. */
  private maxDistance(): number {
    return Math.max(6, homeDistance(this.camera.aspect, this.camera.fov) * 1.15);
  }

  private setDistance(d: number): void {
    this.distance = Math.max(1.35, Math.min(this.maxDistance(), d));
    this.userZoomed = true;
  }

  /** Drag, in screen pixels. Slower when zoomed in, so the gearing feels constant. */
  private rotateBy(dx: number, dy: number): void {
    const k = 0.0052 * Math.min(1.4, this.distance / 2.2);
    this.yaw += dx * k;
    this.pitch = clampPitch(this.pitch + dy * k);
  }

  private onDown = (e: PointerEvent): void => {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 1) {
      this.moved = 0;
      this.multiTouch = false;
    } else {
      // A second finger: this gesture is a pinch from here on, and never a tap.
      this.multiTouch = true;
      const g = this.gesture();
      this.pinchSpread = g.spread;
      this.pinchMid = g.mid;
    }
    // Capture can be refused - a pointer already released, or a synthetic event - and
    // this must not abort the handler half way through and strand the gesture state.
    try { this.renderer.domElement.setPointerCapture(e.pointerId); } catch { /* fine */ }
    this.renderer.domElement.style.cursor = 'grabbing';
  };

  private onMove = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    // Dragging always wins over autorotation - the player has taken the wheel.
    this.autoRotate = false;
    this.tween = null;

    if (this.pointers.size >= 2) {
      /* Pinch. Fingers spreading apart pulls the camera in, and the midpoint still turns
       * the globe, so zooming and aiming are one gesture rather than two. Each finger's
       * move event moves the midpoint half as far, and both fire, so this composes. */
      const g = this.gesture();
      if (this.pinchSpread > 0 && g.spread > 0) {
        this.setDistance(this.distance * (this.pinchSpread / g.spread));
      }
      this.rotateBy(g.mid.x - this.pinchMid.x, g.mid.y - this.pinchMid.y);
      this.pinchSpread = g.spread;
      this.pinchMid = g.mid;
      return;
    }

    this.moved += Math.abs(dx) + Math.abs(dy);
    this.rotateBy(dx, dy);
  };

  private onUp = (e: PointerEvent): void => {
    const had = this.pointers.delete(e.pointerId);
    this.renderer.domElement.style.cursor = 'grab';
    try { this.renderer.domElement.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    // Fingers still down: the gesture is not over, and lifting one of them is not a tap.
    if (this.pointers.size > 0) return;

    /* A drag is not a click, and neither is a pinch. A finger smears further than a mouse
     * does on the way up, so touch gets more slop than the 6px a pointing device needs. */
    const slop = this.coarse ? 12 : 6;
    const tap = had && !this.multiTouch && this.moved <= slop;
    this.multiTouch = false;
    this.pinchSpread = 0;
    if (tap) this.pick(e.clientX, e.clientY);
  };

  /**
   * The browser took the gesture away - a system edge swipe, say. Whatever it was, it
   * ended without the player lifting a finger, so it is not a tap.
   */
  private onCancel = (e: PointerEvent): void => {
    this.multiTouch = true;
    this.onUp(e);
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.tween = null;
    this.setDistance(this.distance + e.deltaY * 0.0016);
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
     * you can see; the two used to be unrelated constants.
     *
     * Touch gets the same radius as a mouse, deliberately - see the note in screen.ts. */
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
    const aspect = w / h;
    const reshaped = Math.abs(aspect - this.camera.aspect) > 1e-4;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.updateLineResolution();
    /* A new shape of window needs a new distance: what framed a region in landscape shows
     * a third of its width in portrait. Skipped mid-flight, and skipped once the player
     * has zoomed by hand - re-framing over the top of that would be rude. */
    if (reshaped && !this.tween && !this.userZoomed) this.refit();
  };

  /**
   * How far to lift the planet up the screen, in world units.
   *
   * Portrait home screen only. The menu stacks into the bottom half of a phone, and a
   * centred planet sits squarely behind it - so the planet centres in the space that is
   * left instead, which is the composition the desktop layout already has. During a round
   * this is zero: the board wants the middle of the screen.
   */
  private homeLift(): number {
    if (this.bounds || this.camera.aspect >= 0.9) return 0;
    const { v } = halfFov(this.camera.fov, this.camera.aspect);
    // 15% of the visible height, measured at the depth the planet sits at.
    return 2 * this.distance * Math.tan(v) * 0.15;
  }

  /** Put the camera where the current view - a region, or the whole planet - wants it. */
  private refit(): void {
    this.distance = this.bounds
      ? distanceForBounds(this.bounds, this.camera.aspect, this.camera.fov)
      : homeDistance(this.camera.aspect, this.camera.fov);
  }

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
      /* Eased rather than tweened: the lift changes when the player leaves the home view,
       * which already has a tween of its own, and a second one to keep in step with it
       * would be more machinery than a one-line follow. */
      const wanted = this.homeLift();
      this.lift += (wanted - this.lift) * (this.reducedMotion ? 1 : Math.min(1, dt * 3));
      this.earth.group.position.y = this.lift;
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
    const toDist = distanceForBounds(bounds, this.camera.aspect, this.camera.fov);

    // Remembered so a rotation mid-round re-frames the region rather than leaving it
    // half off the screen.
    this.bounds = bounds;
    this.userZoomed = false;
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
    this.bounds = null;
    this.userZoomed = false;
    const p = new Promise<void>((resolve) => {
      this.tween = {
        fromYaw: this.yaw, toYaw: this.yaw,
        fromPitch: this.pitch, toPitch: 0.12,
        fromDist: this.distance, toDist: homeDistance(this.camera.aspect, this.camera.fov),
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
    // Facing away from the camera means it is on the far side of the planet. Tested
    // before the lift is added, since the lift moves the whole planet and cannot change
    // which side of it a place is on.
    if (world.z <= 0.04) return null;
    world.add(this.earth.group.position);
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
    this.resizeObserver?.disconnect();
    window.removeEventListener('resize', this.resize);
    window.visualViewport?.removeEventListener('resize', this.resize);
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onDown);
    el.removeEventListener('pointermove', this.onMove);
    el.removeEventListener('pointerup', this.onUp);
    el.removeEventListener('pointercancel', this.onCancel);
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
