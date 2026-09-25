/*
 * The Earth: surface, clouds, atmosphere. Ported from
 * VakOps/station-portfolio/src/scene/space/earth.js and decoupled from that project's
 * `ctx` singleton so it can be owned by GlobeScene instead.
 *
 * NASA imagery is public domain; see docs/data-sources.md and scripts/fetch-earth.sh.
 * If a texture fails to load the globe still renders - it just loses that layer, rather
 * than the whole scene failing to appear.
 */
import {
  AdditiveBlending, BackSide, Color, DataTexture, Group, Mesh, RGBAFormat,
  RepeatWrapping, ShaderMaterial, SphereGeometry, SRGBColorSpace, Texture, TextureLoader,
} from 'three';
import { earthCloudShader, earthSurfaceShader } from './shaders/earth';
import { atmosphereShader } from './shaders/atmosphere';

export const EARTH = {
  radius: 1,
  cloudRadius: 1.006,
  atmoRadius: 1.045,
  tilt: 0.0,              // upright: a tilted globe makes "click that country" harder
  sunColor: '#fff4e2',
  sunIntensity: 1.25,
  twilight: '#ff9a5c',
  atmo: '#7FC4F0',
  nightIntensity: 0.55,
  cloudOpacity: 0.34,
} as const;

const flat = (hex: number): Texture => {
  const t = new DataTexture(
    new Uint8Array([(hex >> 16) & 255, (hex >> 8) & 255, hex & 255, 255]), 1, 1, RGBAFormat);
  t.needsUpdate = true;
  return t;
};

export interface EarthMaps { day: Texture; night: Texture; clouds: Texture; real: boolean }

export interface EarthQuality {
  /** Max texture dimension the GPU will accept - some cap at 8192, some lower. */
  maxTextureSize: number;
  /** Anisotropic filtering makes a sphere sharp at the limb, where most of it is. */
  maxAnisotropy: number;
  isMobile: boolean;
}

/**
 * The colour map is the difference between a crisp continent and a soft one: at Europe
 * zoom the 4K map is magnified almost twice over, while the 8K map is better than 1:1.
 *
 * The 8K map costs ~6.6 MB and about 100 MB of GPU memory, which is a bad trade on a
 * phone, so phones and GPUs that cannot allocate it stay on 4K.
 */
export function pickColorMap(q: EarthQuality): { file: string; label: string } {
  if (q.isMobile || q.maxTextureSize < 8192) return { file: 'color_4k.jpg', label: '4K' };
  return { file: 'color_8k.jpg', label: '8K' };
}

/**
 * The FIRST colour map to load: always the 4K one.
 *
 * The planet cannot appear until its colour map has arrived, and on desktop that used to
 * mean waiting for the full 6.6 MB 8K file - several seconds of empty starfield on an
 * ordinary connection. The 4K map is a quarter of that and looks right at the home view;
 * `loadColorMap` swaps the 8K one in afterwards, where `pickColorMap` says it is wanted.
 */
const FIRST_COLOR = 'color_4k.jpg';

/** Load one colour map on its own, for the upgrade that follows first paint. */
export async function loadColorMap(base: string, file: string, maxAnisotropy: number): Promise<Texture | null> {
  try {
    const t = await new TextureLoader().loadAsync(`${base}textures/earth/${file}`);
    t.colorSpace = SRGBColorSpace;
    t.wrapS = RepeatWrapping;
    t.anisotropy = maxAnisotropy;
    return t;
  } catch {
    // The 4K map is already on screen; failing to upgrade is not worth an error.
    return null;
  }
}

export async function loadEarthMaps(base: string, q: EarthQuality): Promise<EarthMaps> {
  const loader = new TextureLoader();
  const colour = { file: FIRST_COLOR };
  const urls = {
    day: `${base}textures/earth/${colour.file}`,
    night: `${base}textures/earth/night_2k.jpg`,
    clouds: `${base}textures/earth/clouds_2k.jpg`,
  };
  try {
    const [day, night, clouds] = await Promise.all(
      [urls.day, urls.night, urls.clouds].map((u) => loader.loadAsync(u)));
    day!.colorSpace = SRGBColorSpace;
    night!.colorSpace = SRGBColorSpace;
    for (const t of [day!, night!, clouds!]) {
      t.wrapS = RepeatWrapping;
      // Without this the surface goes soft wherever it turns away from the camera -
      // which on a sphere is most of what you can see.
      t.anisotropy = q.maxAnisotropy;
    }
    return { day: day!, night: night!, clouds: clouds!, real: true };
  } catch {
    // A missing texture must not cost us the scene.
    return { day: flat(0x1b3a5c), night: flat(0x000000), clouds: flat(0x000000), real: false };
  }
}

export interface EarthMeshes {
  group: Group;
  surface: Mesh;
  clouds: Mesh;
  atmosphere: Mesh;
}

export function buildEarth(maps: EarthMaps, overlay: Texture): EarthMeshes {
  const sunColor = new Color(EARTH.sunColor).multiplyScalar(EARTH.sunIntensity);
  const atmoColor = new Color(EARTH.atmo);
  const twilight = new Color(EARTH.twilight);

  const group = new Group();
  group.name = 'earth';
  group.rotation.z = EARTH.tilt;

  const surface = new Mesh(
    new SphereGeometry(EARTH.radius, 128, 96),
    new ShaderMaterial({
      uniforms: {
        dayMap: { value: maps.day },
        nightMap: { value: maps.night },
        cloudMap: { value: maps.clouds },
        overlayMap: { value: overlay },
        uSunDir: { value: null },
        uSunColor: { value: sunColor },
        uNight: { value: EARTH.nightIntensity },
        uCloudShift: { value: 0 },
        uAtmoColor: { value: atmoColor },
        uTwilightColor: { value: twilight },
        uHasClouds: { value: maps.real ? 1 : 0 },
        uOverlayTint: { value: 0.78 },
        uOverlayGlow: { value: 0.30 },
      },
      vertexShader: earthSurfaceShader.vertex,
      fragmentShader: earthSurfaceShader.fragment,
    }),
  );
  surface.name = 'surface';

  const clouds = new Mesh(
    new SphereGeometry(EARTH.cloudRadius, 96, 72),
    new ShaderMaterial({
      uniforms: {
        cloudMap: { value: maps.clouds },
        uSunDir: { value: null },
        uSunColor: { value: sunColor.clone().multiplyScalar(0.85) },
        uOpacity: { value: maps.real ? EARTH.cloudOpacity : 0 },
        uTwilightColor: { value: twilight },
      },
      vertexShader: earthCloudShader.vertex,
      fragmentShader: earthCloudShader.fragment,
      transparent: true,
      depthWrite: false,
    }),
  );
  clouds.name = 'clouds';

  const atmosphere = new Mesh(
    new SphereGeometry(EARTH.atmoRadius, 64, 48),
    new ShaderMaterial({
      uniforms: {
        color: { value: atmoColor },
        twilight: { value: twilight },
        opacity: { value: 0.26 },
        sunDir: { value: null },
      },
      vertexShader: atmosphereShader.vertex,
      fragmentShader: atmosphereShader.fragment,
      transparent: true,
      side: BackSide,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
  );
  atmosphere.name = 'atmosphere';

  // Clouds and atmosphere hang off the group so the whole planet turns together, but
  // only `surface` carries the overlay and only `surface` is raycast for picking.
  group.add(surface, clouds, atmosphere);
  return { group, surface, clouds, atmosphere };
}
