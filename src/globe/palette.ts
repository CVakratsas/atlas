/** The game palette. One vivid hue per continent; green for found, red for a miss. */
export const CONTINENT_HUE: Record<string, string> = {
  Europe: '#4CC2FF',
  Africa: '#FFB020',
  Asia: '#FF5C7A',
  Americas: '#5CE1A8',
  Oceania: '#B98CFF',
};

/* Borders are a single uniform colour on purpose - see borders.ts. */
export const BORDER_LAND = '#DCEBFA';    // international boundaries, the ones that matter
export const BORDER_COAST = '#7FA8CE';   // coastline, fainter; the imagery already shows the sea

/* Drawn wider and underneath the land borders. A light line on its own has 1.16:1
 * contrast over the Sahara - effectively invisible - while reading fine over forest and
 * ocean. The casing means contrast no longer depends on what happens to be underneath. */
export const BORDER_CASING = '#0A1018';

/** Markers need an edge for the same reason a border does. */
export const MARKER_RIM = '#0A1018';

export const FOUND = '#34E5A0';
/** Drawn on the map but outside the game - Western Sahara. Deliberate, not missing. */
export const NEUTRAL = '#8A98A8';
export const WRONG = '#FF4D5E';
export const TARGET = '#FFFFFF';
export const SPACE = '#070B14';

/** Scope name -> the hue that identifies that round. */
export function scopeHue(scope: string): string {
  if (scope === 'North America' || scope === 'South America') return CONTINENT_HUE['Americas']!;
  return CONTINENT_HUE[scope] ?? '#4CC2FF';
}
