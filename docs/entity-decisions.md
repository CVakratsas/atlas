# Which places count, and why

There is no neutral answer to "what is a country". Getting this wrong quietly is worse
than getting it wrong loudly, so Atlas states its basis, applies it consistently, and
says so in the app.

## The basis

**Atlas quizzes 197 entities:**

- the **193 UN member states**
- the **2 UN observer states** — Vatican City (Holy See) and Palestine
- **2 de facto states** — **Kosovo** and **Taiwan**

> Note: our upstream dataset (`world-countries`) marks Vatican City as a UN *member*.
> It is not — it is an observer. The correction is in `scripts/overrides.mjs`.

## Why Kosovo and Taiwan are included

Both control their territory, have defined borders, and are what a player means when they
point at that part of the map. Kosovo is recognised by roughly half of UN members; Taiwan
by few states, but treated as distinct by nearly everyone in practice.

The original basis was UN members and observers alone. That left Kosovo drawn on the map
but never asked about and — because entities outside the game got no fill — reading as a
hole in Europe rather than as a deliberate omission. Including them is the change that
makes the map match what players expect.

## Territory drawn as part of another country

| Territory | Drawn as part of | Why |
|---|---|---|
| Northern Cyprus | **Cyprus** | Recognised only by Türkiye. |
| Somaliland | **Somalia** | Recognised by no UN member. |
| Hong Kong | **China** | A special administrative region of the PRC. |
| Macau | **China** | Likewise. |

This is the position almost every country takes, not a novel one.

It also fixes a real defect. Keeping them separate meant that asking for **Cyprus** lit
only **62%** of the island and asking for **Somalia** only **74%** of the country, while
Hong Kong and Macau showed as notches cut out of China's south-east coast. The missing
parts belonged to entities the player could never be asked about and which drew blank. A
player has no way to read that as anything but a bug.

Where absorbed territory meets its parent, the old boundary is **not drawn**: the Green
Line through Cyprus, Somaliland's edge and Hong Kong's border with Guangdong are all
internal, and drawing them would put a line through the middle of a country the game
treats as whole.

### The one that is not absorbed

The **Siachen Glacier** is the only other place in the world whose territory shares a land
border with a country we quiz — every other unfilled feature (Greenland, Puerto Rico, the
Falklands, French Polynesia and 35 more) is an island in open sea and carves no hole.

It is left neutral. Natural Earth records its sovereign as "Kashmir" rather than any
state, and India, Pakistan and China all claim it. Filling it in would be taking a side,
which is the same reasoning that keeps Western Sahara separate. It is a sliver about one
degree across, high in the Karakoram.

## Rendered but never quizzed

**Western Sahara**, alone. It is drawn, labelled, and filled in a neutral grey so it reads
as deliberately outside the game rather than as missing map.

It is not absorbed into Morocco because the UN treats it as a non-self-governing territory
whose status is unresolved. Drawing it as Morocco would be the political claim; leaving it
as its own neutral shape is the one position that asserts nothing.

## Disputed borders

Disputed boundaries — Kashmir, Crimea, the Golan — are drawn in the same neutral weight as
every other border, with the source named. Atlas does not resolve them and does not pretend
the ambiguity is absent. Boundary geometry is Natural Earth's, which is explicitly designed
for this: it ships de facto boundaries with disputed areas flagged rather than silently
assigned.

## Territories and adjacency

Overseas territories are **excluded from the neighbour graph**. "France borders Brazil" is
true via French Guiana, and pedagogically confusing in a continent-scoped game. The same
applies to Hong Kong and Macau (China) and Gibraltar (Spain).

Spain **keeps** its border with Morocco: Ceuta and Melilla are integral parts of Spain, not
overseas territories.

## Continents are geographic

A country's region is where it is, not who it aligns with. Kosovo is in Europe; Taiwan is
in Asia. The Americas are split into North (including Central America and the Caribbean)
and South, because a globe shows about a hemisphere and the full continent spans 137° of
longitude by 128° of latitude — Alaska and Tierra del Fuego cannot both be visible and
clickable at once.

## Capitals with more than one answer

Where a country has several capitals or a contested one, Atlas asks for the conventional
answer and **accepts the others as correct** rather than marking them wrong.

| Country | Asked | Also accepted | Why |
|---|---|---|---|
| South Africa | Pretoria | Cape Town, Bloemfontein | Three constitutional capitals; Pretoria is the seat of the executive. |
| Bolivia | Sucre | La Paz | Sucre is constitutional; La Paz is the seat of government. |
| Sri Lanka | Sri Jayawardenepura Kotte | Colombo, Kotte | Kotte is official; Colombo is the commercial centre and the common answer. |
| Eswatini | Mbabane | Lobamba | Mbabane administrative; Lobamba royal and legislative. |
| Netherlands | Amsterdam | The Hague | Amsterdam is constitutional; The Hague is the seat of government. |
| Palestine | Ramallah | (East) Jerusalem | Ramallah is the de facto administrative seat; the declared capital is disputed. |
| Ivory Coast | Yamoussoukro | Abidjan | Yamoussoukro official since 1983; Abidjan remains the largest city. |
| Benin | Porto-Novo | Cotonou | Porto-Novo official; Cotonou is the seat of government. |
| Myanmar | Naypyidaw | Nay Pyi Taw | Capital moved from Yangon in 2006; Yangon is a distractor, not an answer. |

## Where this is enforced

All of it lives in `scripts/overrides.mjs` and is applied by `scripts/build-countries.mjs`,
which **fails the build** if the member count is not 193, the observer count is not 2, the
de facto count is not 2, the quizzable total is not 197, any country lacks a capital, or an
absorbed territory survives as an entity. The three categories are counted separately on
purpose: adding de facto states must not be able to hide a change in UN membership behind a
single total. No other file is allowed to special-case a country.
