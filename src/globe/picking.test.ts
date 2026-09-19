/*
 * The picking transform is the highest-risk code in Atlas. A sign error produces a globe
 * that looks flawless and returns the wrong country on every click - Portugal reads as
 * Spain, or the whole planet is mirrored. None of that is visible by eye.
 *
 * So these tests assert against real coordinates, at the poles, at the antimeridian, and
 * with the globe rotated - because a transform that forgets the mesh's rotation passes
 * every test taken at rotation zero.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPickIndex, countryAt, latLonFromLocal } from './picking';

const dir = join(process.cwd(), 'public', 'data');
const read = <T>(f: string): T => JSON.parse(readFileSync(join(dir, f), 'utf8')) as T;

/* Every quizzable country is a potential marker; which are drawn depends on zoom. */
const adjacency = read<Record<string, { labelPoint: [number, number] }>>('adjacency.json');
const countries = read<{ iso: string; quizzable: boolean }[]>('countries.json');
const radii = read<{ radii: Record<string, number> }>('borders.json').radii;
const markers = countries
  .filter((c) => c.quizzable && adjacency[c.iso])
  .map((c) => ({ iso: c.iso, labelPoint: adjacency[c.iso]!.labelPoint, radius: radii[c.iso] ?? 0 }));
const index = buildPickIndex(read('world-simplified.geojson'), markers);

/** The forward transform, mirroring THREE.SphereGeometry's UV convention exactly. */
function unitVectorAt(lon: number, lat: number): [number, number, number] {
  const rad = Math.PI / 180;
  const theta = (90 - lat) * rad;   // from the north pole
  const phi = (lon + 180) * rad;    // u * 2PI
  return [
    -Math.cos(phi) * Math.sin(theta),
    Math.cos(theta),
    Math.sin(phi) * Math.sin(theta),
  ];
}

describe('latLonFromLocal', () => {
  it('round-trips every corner of the coordinate space', () => {
    const cases: [number, number][] = [
      [0, 0], [10, 53], [-9.14, 38.72], [139.7, 35.7], [-58.4, -34.6],
      [179.9, 0], [-179.9, 0], [0, 89.9], [0, -89.9], [90, 45], [-90, -45],
    ];
    for (const [lon, lat] of cases) {
      const [x, y, z] = unitVectorAt(lon, lat);
      const [gotLon, gotLat] = latLonFromLocal(x, y, z);
      expect(gotLat, `lat for ${lon},${lat}`).toBeCloseTo(lat, 6);
      // Longitude is meaningless at the poles.
      if (Math.abs(lat) < 89) expect(gotLon, `lon for ${lon},${lat}`).toBeCloseTo(lon, 6);
    }
  });

  it('puts the prime meridian at +X and the north pole at +Y', () => {
    // If this is wrong, the texture and the picking disagree and every click is offset.
    expect(latLonFromLocal(1, 0, 0)[0]).toBeCloseTo(0, 6);
    expect(latLonFromLocal(0, 1, 0)[1]).toBeCloseTo(90, 6);
    expect(latLonFromLocal(0, 0, 1)[0]).toBeCloseTo(-90, 6);   // NOT +90 - the sign trap
    // Canonical range is [-180, 180), so the antimeridian reports as -180.
    expect(latLonFromLocal(-1, 0, 0)[0]).toBeCloseTo(-180, 6);
  });

  it('tolerates a non-unit vector', () => {
    const [lon, lat] = latLonFromLocal(3, 0, 0);
    expect(lon).toBeCloseTo(0, 6);
    expect(lat).toBeCloseTo(0, 6);
  });
});

describe('countryAt - real places', () => {
  const at = (lon: number, lat: number) => countryAt(lon, lat, index);

  it('finds major countries from their capitals', () => {
    // Coimbra, not Lisbon: at 50m the Tagus estuary is modelled, and Lisbon's own
    // coordinates land in the water. That is the data being right, not wrong.
    expect(at(-8.43, 40.21)).toBe('PRT');   // Coimbra - not Spain
    expect(at(139.69, 35.69)).toBe('JPN');  // Tokyo
    expect(at(-47.88, -15.79)).toBe('BRA'); // Brasilia
    expect(at(37.62, 55.75)).toBe('RUS');   // Moscow
    expect(at(18.42, -33.92)).toBe('ZAF');  // Cape Town
    expect(at(151.2, -33.87)).toBe('AUS');  // Sydney
    expect(at(-99.13, 19.43)).toBe('MEX');  // Mexico City
  });

  it('distinguishes neighbours that are easy to confuse', () => {
    expect(at(-3.70, 40.42)).toBe('ESP');   // Madrid, next door to Portugal
    expect(at(14.51, 46.06)).toBe('SVN');   // Ljubljana
    expect(at(17.11, 48.15)).toBe('SVK');   // Bratislava - the pair the brief names
    expect(at(2.35, 48.86)).toBe('FRA');    // Paris
    expect(at(4.35, 50.85)).toBe('BEL');    // Brussels
  });

  it('returns null for open ocean', () => {
    expect(at(-40, 30)).toBeNull();          // mid-Atlantic
    expect(at(-150, 0)).toBeNull();          // mid-Pacific
    expect(at(80, -40)).toBeNull();          // southern Indian Ocean
  });

  it('works either side of the antimeridian', () => {
    // Natural Earth splits Fiji into three parts, two west of 180 and one east of it.
    // A point on each side must resolve to the same country.
    expect(at(178.01, -17.82)).toBe('FJI');   // Viti Levu, west of 180
    expect(at(-178.596, -19.149)).toBe('FJI'); // one of Fiji's eastern islands, past 180
    expect(at(169.11, -45.28)).toBe('NZL');   // South Island
  });
});

describe('countryAt - microstates', () => {
  // The precedence rule: these all sit INSIDE another country's polygon. Without
  // dots-first they are unclickable, and in Oceania that is 8 of 14 countries.
  const at = (lon: number, lat: number) => countryAt(lon, lat, index);

  it('picks an enclave over the country that surrounds it', () => {
    expect(at(7.42, 43.73)).toBe('MCO');    // Monaco, inside France
    expect(at(12.45, 41.90)).toBe('VAT');   // Vatican City, inside Rome
    expect(at(12.46, 43.94)).toBe('SMR');   // San Marino, inside Italy
    expect(at(9.55, 47.17)).toBe('LIE');    // Liechtenstein
    expect(at(1.52, 42.51)).toBe('AND');    // Andorra
  });

  it('picks island microstates that have no polygon at all', () => {
    expect(at(103.82, 1.35)).toBe('SGP');   // Singapore
    expect(at(14.38, 35.90)).toBe('MLT');   // Malta
    expect(at(50.55, 26.07)).toBe('BHR');   // Bahrain
    expect(at(73.51, 4.18)).toBe('MDV');    // Maldives
  });

  it('covers every Oceania microstate, where this path is the main path', () => {
    const oceania = ['FSM', 'KIR', 'MHL', 'NRU', 'PLW', 'TON', 'TUV', 'WSM'];
    const dots = new Map(index.dots.map((d) => [d.iso, d]));
    for (const iso of oceania) {
      const d = dots.get(iso);
      expect(d, `${iso} has no marker`).toBeDefined();
      expect(countryAt(d!.lon, d!.lat, index), iso).toBe(iso);
    }
  });

  it('never lets a big country\'s marker steal a click inside itself', () => {
    // Every country has a marker now, not just the small ones. Without the
    // smaller-wins rule, France's own marker would win over a click in central
    // France and Italy's over a click in central Italy.
    expect(countryAt(2.5, 46.7, index)).toBe('FRA');
    expect(countryAt(12.0, 43.0, index)).toBe('ITA');
    expect(countryAt(-3.7, 40.4, index)).toBe('ESP');
    expect(countryAt(100.0, 60.0, index)).toBe('RUS');
  });

  it('lets the country under the click defend its own ground', () => {
    /*
     * The country that was hit enters the nearest-marker contest on its own behalf -
     * including when it is too big to be showing a marker, which is exactly the case a
     * marked neighbour can steal from.
     *
     * Bologna is 136 km from San Marino's marker and 59 km from Italy's own. Without this
     * it answered San Marino, because nothing ruled San Marino out: it is inside the
     * radius and smaller. With it, the nearer marker wins and the answer is Italy.
     *
     * Found on a phone, where the same 9px radius covers three times the ground.
     */
    const phone = { dotRadiusKm: 145, markedOnly: new Set(['SMR', 'VAT', 'LIE', 'MCO']) };
    expect(countryAt(11.0, 44.6, index, phone)).toBe('ITA');    // Bologna
    expect(countryAt(8.23, 46.80, index, phone)).toBe('CHE');   // central Switzerland
    expect(countryAt(2.5, 46.7, index, phone)).toBe('FRA');     // middle of France

    // ...and it must not make a microstate unreachable: standing on one still finds it.
    expect(countryAt(12.46, 43.94, index, phone)).toBe('SMR');
    expect(countryAt(9.55, 47.17, index, phone)).toBe('LIE');
  });

  it('does not let a microstate swallow its neighbourhood', () => {
    // Rome is ~20km from the Vatican but must still be Italy at a tight radius.
    expect(countryAt(12.60, 41.85, index, { dotRadiusKm: 8 })).toBe('ITA');
    // Marseille is nowhere near Monaco.
    expect(countryAt(5.37, 43.30, index)).toBe('FRA');
    // At the default radius a marker must not swallow the country around it.
    expect(countryAt(8.23, 46.80, index)).toBe('CHE');   // central Switzerland, not Liechtenstein
    expect(countryAt(11.25, 43.77, index)).toBe('ITA');  // Florence, ~99km from San Marino
    expect(countryAt(51.20, 25.30, index)).toBe('QAT');  // Qatar, not Bahrain
  });
});

describe('countryAt - absorbed territory', () => {
  // The reported bug: asking for Cyprus lit only the southern 62% of the island,
  // because the north was a separate entity. Both halves must now answer 'CYP'.
  it('resolves northern Cyprus to Cyprus', () => {
    expect(countryAt(33.4, 35.3, index)).toBe('CYP');   // Kyrenia, in the north
    expect(countryAt(33.0, 34.9, index)).toBe('CYP');   // Limassol, in the south
  });

  it('resolves Hong Kong and Macau to China', () => {
    // The reported bug: playing Asia, parts of eastern China were not covered. Both are
    // separate entities in the source data and showed as notches on the coast.
    expect(countryAt(114.15, 22.35, index)).toBe('CHN');   // Hong Kong
    expect(countryAt(113.481, 22.198, index)).toBe('CHN'); // Macau
    expect(countryAt(113.3, 23.1, index)).toBe('CHN');     // Guangzhou, just inland
  });

  it('resolves Somaliland to Somalia', () => {
    expect(countryAt(45.3, 9.6, index)).toBe('SOM');    // Hargeisa
    expect(countryAt(45.3, 2.1, index)).toBe('SOM');    // Mogadishu
  });
});

describe('countryAt - Kosovo and Taiwan are real countries now', () => {
  it('finds them', () => {
    expect(countryAt(20.9, 42.6, index)).toBe('KOS');
    expect(countryAt(120.9, 23.7, index)).toBe('TWN');
  });

  it('does not confuse Kosovo with Serbia', () => {
    expect(countryAt(20.5, 44.0, index)).toBe('SRB');
  });
});

describe('countryAt - Siachen Glacier', () => {
  it('is left neutral rather than assigned to any claimant', () => {
    // The only other feature that shares a land border with a country we quiz. India,
    // Pakistan and China all claim it, so filling it in would take a side.
    expect(countryAt(77.2, 35.4, index)).toBe('KAS');
  });

  it('is never quizzable', () => {
    expect(countryAt(77.2, 35.4, index, { quizzableOnly: true })).not.toBe('KAS');
  });
});

describe('countryAt - Western Sahara', () => {
  it('can be identified, so a click on it is ignored rather than mis-scored', () => {
    expect(countryAt(-16.748, 21.377, index)).toBe('ESH');
  });

  it('is skipped entirely when asked to', () => {
    expect(countryAt(-16.748, 21.377, index, { quizzableOnly: true })).not.toBe('ESH');
  });
});

describe('the whole board is reachable', () => {
  it('every quizzable country can be hit at its own label point', () => {
    const adjacency = read<Record<string, { labelPoint: [number, number] }>>('adjacency.json');
    const countries = read<{ iso: string; name: string; quizzable: boolean; hasPolygon: boolean }[]>('countries.json');
    const unreachable: string[] = [];
    for (const c of countries.filter((x) => x.quizzable)) {
      const lp = adjacency[c.iso]?.labelPoint;
      if (!lp) { unreachable.push(`${c.iso} (no label point)`); continue; }
      const hit = countryAt(lp[0], lp[1], index);
      if (hit !== c.iso) unreachable.push(`${c.iso} ${c.name} -> ${hit ?? 'ocean'}`);
    }
    expect(unreachable).toEqual([]);
  });
});
