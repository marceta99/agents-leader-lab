# Design system: Agents Leader Lab

Every screen follows this file. Tokens and base components live in `frontend/src/index.css`; use them, do not invent new colours or fonts.

## Brief

- **Subject.** A research lab where four AI agents share one room and move eight chairs. Their goals look like they clash, and the measurement checks who ended up steering whom.
- **Audience.** Curious researchers and builders. They come to watch agents organise and to run their own experiments.
- **Primary job.**
  - **Landing:** show the room alive in the first second.
  - **App:** set up a run, watch it, read who led.
- **Reference.** jjettas.com/foundation. We take its *spirit*, not its look:
  - a tactile surface;
  - huge heavy condensed type;
  - physical objects (tilted prints) lying on that surface;
  - a diagonal dark panel;
  - one calm, deliberate motion moment.

  Our physical objects are the room, chairs and agents (3D) and the chat messages printed as index cards.

## Colour

| Token | Hex | Use |
|---|---|---|
| `--paper` | `#E6E8EE` | page surface: cool plaster grey with a faint noise texture, never cream |
| `--sheet` | `#F7F8FA` | raised surfaces: forms, tables, panels |
| `--ink` | `#1C1838` | text, primary buttons, the dark diagonal panel; a deep indigo, not black |
| `--ink-2` | `#55526F` | secondary text |
| `--line` | `rgba(28,24,56,.14)` | borders, rules |
| `--focus` | `#4F3BF0` | links, focus rings, selected states |
| `--z1..--z4` | `#E3B341 #7CC3E6 #9CCB7A #EE9AA2` | the four room zones. Also the only decorative accents, and only where the room or zones are meant. |
| agent colours | Sam `#E4572E`, Sky `#2E86AB`, Sol `#8E5CD9`, Sage `#17A398` (older runs: Ada, Bo, Cy, Dee) | the same everywhere (3D, chat, panels) |
| style tags | directive `#C2410C`, non-directive `#1D6FD1`, other `#8A8FA3` | chat style labels |
| `--danger` / `--ok` | `#C2362B` / `#2E8B57` | errors / success |

## Type

- **Display: "Big Shoulders Display", 800–900.** Used for page titles, the hero and big numbers.
  - Tight leading (0.9), slight negative tracking, sentence case.
  - It is part of the design: set it big. The hero headline is ~9–14vw on desktop.
- **Text and UI: "Archivo", 400/500/600.** Base 16px, line-height 1.55, max line length about 70 characters. Numbers use `font-variant-numeric: tabular-nums`.
- **No all-caps labels, no monospace labels, no eyebrow labels above every heading.** Do not accent single words in a headline (no lone italic or coloured word).

## Surfaces and shape

- **Page:** `--paper` with the noise texture (already on `body`).
- **Sheets:** `.panel` with radius 16px, a 1px `--line` border, and the "object on a table" shadow `--shadow-object`.
- **Hierarchy:** one radius does not fit all.

  | Element | Radius |
  |---|---|
  | page-level sheets | 16 |
  | inputs | 10 |
  | tags and chips | 999 |
  | primary buttons | 999 (pill, like the reference) |
  | tilted cards (landing only) | 6 |

- **Tilted cards:** only on the landing page. They are index cards with a paper edge, rotated -4°..5°, with `--shadow-lift`.

## Motion

- **One orchestrated moment on the landing page.** A diagonal ink panel wipes away, the chairs drop onto the floor with a soft spring, then the agents start walking. Nothing else animates on its own except the live room.
- **Interaction motion is welcome.** Use 120–200ms ease-out for press, open and expand. Exits are faster than entrances.
- **Reduced motion:** `prefers-reduced-motion: reduce` turns off the wipe, the drop and the camera drift; the room renders static.
- **Animate only `transform` and `opacity`.**

## Layout

- Left-aligned, editorial and asymmetric on the landing page. App pages are left-aligned in a 1200px column.
- Mobile first:
  - no horizontal scroll at 360px;
  - tap targets at least 44px;
  - the top bar collapses into a menu below 900px.
- Spacing scale (px): 4, 8, 12, 16, 24, 32, 48, 72, 112.

## Quality floor (from ui-ux-pro-max)

- Text contrast is at least 4.5:1.
- Keyboard focus is visible (`:focus-visible` ring in `--focus`).
- Every input has a visible label; errors appear next to the field and say how to fix it.
- Loading and empty states give direction ("No experiments yet. Create your first one.").
- Never encode meaning by colour alone: style tags carry text, and goal chips carry ✓ plus text.
- 3D canvases:
  - device pixel ratio capped at 2;
  - lazy-loaded;
  - a static fallback while loading;
  - no layout shift (the canvas box reserves its height).

## Copy

Plain verbs and sentence case. Buttons say what happens: "Launch experiment", "Save key", "Stop experiment". Errors explain what went wrong and how to fix it, without apologising.
