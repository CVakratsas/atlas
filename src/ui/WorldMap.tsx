/*
 * The map. SVG rather than Canvas: hit-testing comes free, which map mode needs, and
 * every country can be a real focusable element with a real ARIA label rather than a
 * synthetic one reconstructed from pointer coordinates.
 */
import { useMemo } from 'react';
import { CONTINENT_BOUNDS, fitViewBox, project, ringsToPath, type Projection } from '../engine/geo';
import type { AtlasData } from '../data/load';
import s from './WorldMap.module.css';

export type CountryMark = 'neighbour' | 'correct' | 'wrong' | 'selected';

interface GeoFeature {
  properties: { iso: string; kind: 'quiz' | 'disputed' | 'context'; name: string };
  geometry: { type: 'Polygon' | 'MultiPolygon'; coordinates: number[][][] | number[][][][] };
}
export interface WorldGeo { features: GeoFeature[] }

interface Props {
  geo: WorldGeo;
  data: AtlasData;
  /** Continent name, or 'World'. */
  scope?: string;
  projection?: Projection;
  /** Per-ISO visual state: the amber fill on a correct answer, a lift for neighbours. */
  marks?: Record<string, CountryMark>;
  /** Null when the click landed on the ocean — a misclick, not a wrong answer. */
  onSelect?: (iso: string | null) => void;
  /** Review mode labels every country; the quiz modes do not. */
  showLabels?: boolean;
  interactive?: boolean;
}

export function WorldMap({
  geo, data, scope = 'World', projection = 'equirectangular',
  marks = {}, onSelect, showLabels = false, interactive = true,
}: Props) {
  const bounds = CONTINENT_BOUNDS[scope] ?? CONTINENT_BOUNDS['World']!;
  const view = useMemo(() => fitViewBox(bounds, projection), [bounds, projection]);

  // Paths are expensive to build and never change for a given projection.
  const paths = useMemo(() => geo.features.map((f) => ({
    iso: f.properties.iso,
    kind: f.properties.kind,
    name: f.properties.name,
    d: ringsToPath(f.geometry.coordinates, f.geometry.type, projection),
  })), [geo, projection]);

  const inScope = useMemo(() => {
    if (scope === 'World') return null;
    return new Set(data.quizzable.filter((c) => c.continent === scope).map((c) => c.iso));
  }, [data, scope]);

  const visible = (iso: string) => !inScope || inScope.has(iso);
  const labelSize = Math.max(0.9, view.width / 130);

  return (
    <svg
      className={s.svg}
      viewBox={view.toString()}
      role="group"
      aria-label={scope === 'World' ? 'World map' : `Map of ${scope}`}
      onClick={(e) => { if (e.target === e.currentTarget) onSelect?.(null); }}
    >
      {/* Ocean backdrop, so a click anywhere that is not a country reads as a miss
          rather than doing nothing at all. */}
      <rect x={view.x} y={view.y} width={view.width} height={view.height} fill="var(--ocean)"
            onClick={() => onSelect?.(null)} />

      {paths.map((p) => {
        const isQuiz = p.kind === 'quiz' && visible(p.iso);
        const clickable = interactive && isQuiz && !!onSelect;
        const mark = marks[p.iso];
        const cls = [
          s.country,
          p.kind === 'context' ? s.context : '',
          p.kind === 'quiz' && !visible(p.iso) ? s.out : '',
          p.kind === 'disputed' ? s.disputed : '',
          clickable ? s.interactive : '',
          mark ? s[mark] : '',
        ].filter(Boolean).join(' ');

        return (
          <path
            key={p.iso}
            className={cls}
            d={p.d}
            {...(clickable ? {
              role: 'button',
              tabIndex: 0,
              'aria-label': p.name,
              onClick: (e: React.MouseEvent) => { e.stopPropagation(); onSelect?.(p.iso); },
              onKeyDown: (e: React.KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect?.(p.iso); }
              },
            } : { 'aria-hidden': true, pointerEvents: 'none' as const })}
          />
        );
      })}

      {/* Every country has real geometry at 50m, so there are no stand-in markers here
          any more - the globe handles small countries with screen-space markers. */}

      {showLabels && paths.filter((p) => p.kind === 'quiz' && visible(p.iso)).map((p) => {
        const anchor = data.adjacency[p.iso]?.labelPoint;
        if (!anchor) return null;
        const pt = project(anchor[0], anchor[1], projection);
        return (
          <text key={`l-${p.iso}`} className={s.label} x={pt.x} y={pt.y}
                fontSize={labelSize} aria-hidden>
            {p.name}
          </text>
        );
      })}
    </svg>
  );
}
