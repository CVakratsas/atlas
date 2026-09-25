/*
 * The 50 US states and their capitals, keyed by USPS postal code.
 *
 * Hand-kept because Natural Earth has no capitals, and there are few enough that a table
 * a person can read beats a dependency. build-states.mjs fails the build if this table
 * and the geometry ever disagree - a state with no capital, a capital with no state, or
 * two states claiming the same capital.
 *
 * Four capitals share their name with a better-known city in a DIFFERENT state, and are
 * the ones people get wrong: Charleston (WV, not SC), Augusta (ME, not GA), Columbia (SC)
 * next to Columbus (OH), and Jackson (MS). They are listed as they are; the quiz asks for
 * the state, so the name alone is the test.
 */
export const STATE_CAPITALS = {
  AL: 'Montgomery',
  AK: 'Juneau',
  AZ: 'Phoenix',
  AR: 'Little Rock',
  CA: 'Sacramento',
  CO: 'Denver',
  CT: 'Hartford',
  DE: 'Dover',
  FL: 'Tallahassee',
  GA: 'Atlanta',
  HI: 'Honolulu',
  ID: 'Boise',
  IL: 'Springfield',
  IN: 'Indianapolis',
  IA: 'Des Moines',
  KS: 'Topeka',
  KY: 'Frankfort',
  LA: 'Baton Rouge',
  ME: 'Augusta',
  MD: 'Annapolis',
  MA: 'Boston',
  MI: 'Lansing',
  MN: 'Saint Paul',
  MS: 'Jackson',
  MO: 'Jefferson City',
  MT: 'Helena',
  NE: 'Lincoln',
  NV: 'Carson City',
  NH: 'Concord',
  NJ: 'Trenton',
  NM: 'Santa Fe',
  NY: 'Albany',
  NC: 'Raleigh',
  ND: 'Bismarck',
  OH: 'Columbus',
  OK: 'Oklahoma City',
  OR: 'Salem',
  PA: 'Harrisburg',
  RI: 'Providence',
  SC: 'Columbia',
  SD: 'Pierre',
  TN: 'Nashville',
  TX: 'Austin',
  UT: 'Salt Lake City',
  VT: 'Montpelier',
  VA: 'Richmond',
  WA: 'Olympia',
  WV: 'Charleston',
  WI: 'Madison',
  WY: 'Cheyenne',
};

/*
 * Drawn but never asked about. The District of Columbia is not a state; leaving it out
 * of the geometry would punch a hole in Maryland, so it is drawn grey - the same
 * treatment Western Sahara gets on the world map.
 */
export const NOT_A_STATE = ['DC'];
