/*
 * Hand-maintained corrections to the upstream datasets, and the entity ruling.
 * Every entry here is a judgement call; docs/entity-decisions.md explains the basis.
 * Nothing else in the build is allowed to special-case a country.
 */

/* world-countries marks Vatican City as `unMember: true`. It is not a UN member — it is a
 * UN observer state, alongside Palestine. The upstream flag is simply wrong, and correcting
 * it here is what makes the count 193 + 2 rather than a coincidental 195. */
export const UN_MEMBER_FIXES = { VAT: false };

/* Observer states: not members, but quizzable under our stated basis. */
export const OBSERVER_STATES = ['VAT', 'PSE'];

/*
 * De facto states we do quiz, despite not being UN members or observers.
 *
 * Both control their territory, have defined borders, and are what a player means when
 * they point at that part of the map. Leaving them out left visible holes in Europe and
 * off the coast of China. Kosovo is recognised by roughly half the UN; Taiwan by few
 * states but treated as distinct by nearly everyone in practice.
 */
export const DE_FACTO_STATES = {
  KOS: { note: 'Declared independence 2008; recognised by roughly half of UN members.' },
  TWN: { note: 'Self-governing since 1949; claimed by the PRC.' },
};

/*
 * Territory drawn as part of another country rather than on its own.
 *
 * Each of these is internationally regarded as part of the state that absorbs it here -
 * the position almost every country takes, not a novel one. Keeping them separate left
 * visible holes: asking for Cyprus lit only 62% of the island, asking for Somalia only
 * 74% of the country, and Hong Kong and Macau showed as notches cut out of China's coast.
 *
 * NOT absorbed, deliberately: the Siachen Glacier. It is the only other feature in the
 * world that shares a land border with a country we quiz, but Natural Earth files its
 * sovereign as "Kashmir" rather than any state, and India, Pakistan and China all claim
 * it. Filling it in would be taking a side, so it stays neutral - the same reasoning that
 * keeps Western Sahara separate.
 */
export const ABSORBED_INTO = {
  CYN: 'CYP',   // Northern Cyprus -> Cyprus. Recognised only by Türkiye.
  SOL: 'SOM',   // Somaliland -> Somalia. Recognised by no UN member.
  HKG: 'CHN',   // Hong Kong -> China. A special administrative region of the PRC.
  MAC: 'CHN',   // Macau -> China. Likewise.
};

/*
 * Rendered on the map, labelled, dashed border - never quizzed, never a distractor.
 *
 * Western Sahara alone. The UN treats it as a non-self-governing territory whose status
 * is unresolved, so drawing it as Morocco would be the political claim; leaving it as its
 * own neutral shape is the one position that asserts nothing.
 */
export const RENDERED_ONLY = {
  ESH: { name: 'Western Sahara',   note: 'Non-self-governing territory; sovereignty unresolved.' },
};

/* Codes that differ between our sources. world-countries uses UNK for Kosovo,
 * Natural Earth uses KOS (via ADM0_A3). We standardise on the Natural Earth code. */
export const ISO_ALIASES = { UNK: 'KOS' };

/*
 * Capitals. `primary` is the answer we ask for; `accept` are also marked correct.
 * Only countries where the upstream value is wrong, contested, or plural appear here.
 */
export const CAPITALS = {
  // Three constitutional capitals. Pretoria is the seat of the executive and the
  // conventional single answer; the other two are accepted rather than marked wrong.
  ZAF: { primary: 'Pretoria', accept: ['Cape Town', 'Bloemfontein'] },
  // Sucre is the constitutional capital; La Paz is the seat of government.
  BOL: { primary: 'Sucre', accept: ['La Paz'] },
  // Sri Jayawardenepura Kotte is the official capital; Colombo is the commercial
  // centre and what most people answer. Both are accepted.
  LKA: { primary: 'Sri Jayawardenepura Kotte', accept: ['Colombo', 'Kotte'] },
  // Mbabane is the administrative capital; Lobamba the royal and legislative one.
  SWZ: { primary: 'Mbabane', accept: ['Lobamba'] },
  // Ramallah is the de facto administrative seat. Palestine's declared capital is
  // East Jerusalem, which is disputed; we ask for neither and accept both.
  PSE: { primary: 'Ramallah', accept: ['East Jerusalem', 'Jerusalem'] },
  // Amsterdam is the constitutional capital; The Hague is the seat of government.
  NLD: { primary: 'Amsterdam', accept: ['The Hague'] },
  CIV: { primary: 'Yamoussoukro', accept: ['Abidjan'] },
  BEN: { primary: 'Porto-Novo', accept: ['Cotonou'] },
  // 'Nay Pyi Taw' is the same place spelled differently, so it is accepted. Yangon is
  // not — it stopped being the capital in 2006, and it is a misconception distractor.
  MMR: { primary: 'Naypyidaw', accept: ['Nay Pyi Taw'] },
};

/* Extra accepted spellings for country names, on top of upstream altSpellings. */
export const NAME_ALIASES = {
  CIV: ["Cote d'Ivoire", "Côte d'Ivoire"],
  TUR: ['Turkey'],
  CZE: ['Czech Republic'],
  COD: ['DRC', 'Democratic Republic of the Congo', 'Congo-Kinshasa'],
  COG: ['Republic of the Congo', 'Congo-Brazzaville'],
  SWZ: ['Swaziland'],
  MKD: ['Macedonia'],
  NLD: ['Holland'],
  GBR: ['Britain', 'Great Britain', 'UK'],
  USA: ['America', 'US', 'United States of America'],
  ARE: ['UAE'],
  KOR: ['South Korea'],
  PRK: ['North Korea'],
  MMR: ['Burma'],
  TLS: ['East Timor'],
  CPV: ['Cape Verde', 'Cabo Verde'],
};

/*
 * Capitals people confidently answer that are wrong — the highest-teaching-value
 * distractors there are. Included automatically once an item has been seen once.
 */
export const MISCONCEPTION_CAPITALS = {
  TUR: 'Istanbul',   CHE: 'Zurich',      BRA: 'Rio de Janeiro', USA: 'New York',
  AUS: 'Sydney',     CAN: 'Toronto',     MMR: 'Yangon',         TZA: 'Dar es Salaam',
  NGA: 'Lagos',      KAZ: 'Almaty',      MAR: 'Casablanca',     IND: 'Mumbai',
  VNM: 'Ho Chi Minh City', CHN: 'Shanghai',      ZAF: 'Johannesburg',
  PAK: 'Karachi',    ECU: 'Guayaquil',   CMR: 'Douala',
  SAU: 'Mecca',      ISR: 'Tel Aviv',    NZL: 'Auckland',       ITA: 'Milan',
};
