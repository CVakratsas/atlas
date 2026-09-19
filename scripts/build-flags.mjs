/*
 * One SVG per country into public/data/flags/. Source: flag-icons (MIT) 4x3 set.
 * Emoji flags are deliberately not used — the brief is right that they render
 * inconsistently across platforms and are unreadable at size.
 * Licence attribution lives in docs/data-sources.md.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, '..', 'public', 'data', 'flags');
mkdirSync(dir, { recursive: true });

const countries = JSON.parse(readFileSync(join(here, '..', 'public', 'data', 'countries.json'), 'utf8'));
// Kosovo and Taiwan have flags in the set even though they are never quizzed —
// review mode still shows them on the map.
const EXTRA = { KOS: 'xk', TWN: 'tw' };
const wanted = countries
  .map((c) => ({ iso: c.iso, code: (c.iso2 ?? EXTRA[c.iso])?.toLowerCase() }))
  .filter((c) => c.code);

/* Light, dependency-free minify: drop XML prologue, comments, metadata and
 * inter-tag whitespace. Typically 10-20% off; svgo would do better but is not
 * worth a build dependency for files this small. */
const minify = (svg) => svg
  .replace(/<\?xml[^>]*\?>/g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<metadata>[\s\S]*?<\/metadata>/g, '')
  .replace(/>\s+</g, '><')
  .replace(/\s{2,}/g, ' ')
  .trim();

const BASE = 'https://cdn.jsdelivr.net/npm/flag-icons@7.5.0/flags/4x3';
let fetched = 0, cached = 0, bytes = 0;
const failures = [];

const batch = 12;
for (let i = 0; i < wanted.length; i += batch) {
  await Promise.all(wanted.slice(i, i + batch).map(async ({ iso, code }) => {
    const dest = join(dir, `${iso}.svg`);
    if (existsSync(dest)) { cached++; bytes += readFileSync(dest).length; return; }
    try {
      const res = await fetch(`${BASE}/${code}.svg`);
      if (!res.ok) { failures.push(`${iso} (${code}): HTTP ${res.status}`); return; }
      const svg = minify(await res.text());
      if (!svg.startsWith('<svg')) { failures.push(`${iso}: not an SVG`); return; }
      writeFileSync(dest, svg);
      fetched++; bytes += svg.length;
    } catch (e) { failures.push(`${iso} (${code}): ${e.message}`); }
  }));
  process.stdout.write(`\r  flags ${Math.min(i + batch, wanted.length)}/${wanted.length}`);
}

process.stdout.write('\r');
console.log(`  flags               ${fetched} fetched, ${cached} cached, ${(bytes / 1024).toFixed(0)} KB total`);
if (failures.length) { console.error(`  MISSING FLAGS:\n    ${failures.join('\n    ')}`); process.exit(1); }
