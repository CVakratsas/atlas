/*
 * The single React <-> three.js seam.
 *
 * The scene is created once and torn down once. React pushes state in through the
 * imperative handle; the scene never triggers a re-render except through `onPick`.
 */
import { useEffect, useRef, useState } from 'react';
import { GlobeScene } from './GlobeScene';
import type { AtlasData, StatesData } from '../data/load';

export const isMobile = (): boolean =>
  typeof matchMedia !== 'undefined' && matchMedia('(max-width: 759px)').matches;

/**
 * Touch or pen rather than a mouse.
 *
 * Distinct from `isMobile()` on purpose: that asks how wide the window is, which is the
 * right question for layout, while how far a gesture may smear and still count as a tap
 * turns on what is doing the pointing. A touchscreen laptop is not narrow and still needs
 * the extra slop.
 */
export const coarsePointer = (): boolean =>
  typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

export const reducedMotion = (): boolean =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

interface Options {
  data: AtlasData | null;
  geo: unknown;
  borderClasses: { classes: string[][]; radii: Record<string, number> } | null;
  /** The US states layer. Null while loading, or if it failed - the world game is unaffected. */
  states: StatesData | null;
  onPick: (iso: string | null) => void;
}

export function useGlobe({ data, geo, borderClasses, states, onPick }: Options) {
  const mount = useRef<HTMLDivElement | null>(null);
  const scene = useRef<GlobeScene | null>(null);
  const [ready, setReady] = useState(false);

  // The latest handler without re-creating the scene when it changes.
  const pick = useRef(onPick);
  pick.current = onPick;

  useEffect(() => {
    if (!mount.current || !data || !geo || !borderClasses || scene.current) return;
    const adjacency = data.adjacency as Record<string, { labelPoint: [number, number] }>;
    /* Every quizzable country gets a marker; which ones are actually drawn is decided
     * per frame from how big the country looks, not from a list. */
    const markerCountries = data.quizzable
      .filter((c) => adjacency[c.iso])
      .map((c) => ({
        iso: c.iso,
        labelPoint: adjacency[c.iso]!.labelPoint,
        radius: borderClasses.radii[c.iso] ?? 0,
      }));

    const s = new GlobeScene({
      container: mount.current,
      world: {
        geo: geo as never,
        borderClasses,
        markers: markerCountries,
        neutral: new Set(data.all.filter((c) => !c.quizzable).map((c) => c.iso)),
      },
      ...(states ? {
        states: {
          geo: states.geo as never,
          borderClasses: { classes: states.classes },
          markers: states.quizzable.map((st) => ({ iso: st.iso, labelPoint: st.labelPoint, radius: st.radius })),
          neutral: new Set(states.all.filter((st) => !st.quizzable).map((st) => st.iso)),
        },
      } : {}),
      baseUrl: import.meta.env.BASE_URL,
      reducedMotion: reducedMotion(),
      isMobile: isMobile(),
      coarsePointer: coarsePointer(),
    });
    s.onPick = (iso) => pick.current(iso);
    scene.current = s;
    // Dev-only handle so end-to-end tests can aim a click at a named country.
    if (import.meta.env.DEV) {
      (window as unknown as { __atlas?: unknown }).__atlas = s;
    }
    setReady(true);
    return () => {
      s.dispose();
      scene.current = null;
      setReady(false);
    };
  }, [data, geo, borderClasses, states]);

  return { mount, scene, ready };
}
