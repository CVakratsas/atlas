# Third-party data and licences

Atlas ships generated data and imagery derived from the sources below. Provenance and
regeneration steps are in [`docs/data-sources.md`](docs/data-sources.md).

## flag-icons — MIT

`public/data/flags/*.svg` are derived from [flag-icons](https://github.com/lipis/flag-icons)
(optimised, renamed to ISO 3166-1 alpha-3). MIT requires this notice travel with them.

```
MIT License

Copyright (c) 2013 Panayiotis Lipiridis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## world-countries — ODbL 1.0

Country names, ISO codes, capitals, regions and land borders derive from
[mledoze/countries](https://github.com/mledoze/countries), licensed
[ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). Our corrections to it (Vatican
City's UN status, Sri Lanka's border with India, and the absorbed territories) are
documented in [`docs/entity-decisions.md`](docs/entity-decisions.md).

## Natural Earth — public domain

Country geometry (50m admin-0) and population estimates come from
[Natural Earth](https://www.naturalearthdata.com/about/terms-of-use/), which places no
restrictions on use.

## NASA imagery — public domain

`public/textures/earth/*` are downscaled from NASA Blue Marble Next Generation and Black
Marble. [NASA imagery is public domain](https://www.nasa.gov/nasa-brand-center/images-and-media/).

## three.js — MIT

Used as a dependency, not vendored. Copyright (c) 2010-2024 three.js authors.
