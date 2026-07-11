# Assets & Art Pipeline

How we make and manage art. Direction lives in [GAME-DESIGN.md](GAME-DESIGN.md#art-direction);
this is the *how*.

## Art direction (summary)

**Slightly dark and grotty, but humorous.** Grimy survival-horror palette, comic item/enemy visuals,
visual gags. Readable at small pixel sizes. Consistent base resolution + nearest-neighbour scaling.

## Approach (phased)

1. **Placeholder-first.** Coloured rects / programmatic tiles so mechanics get built fast (decided —
   see DECISIONS.md). Art is *not* on the critical path for the MVP slice.
2. **Free CC0 tilesets** to make it look game-like quickly without drawing everything (see shortlist).
3. **Gemini-generated bespoke assets** for characterful, on-theme items/enemies where stock art
   doesn't fit the dark-comic identity.

## Base tileset — chosen (2026-07-11)

**[Zombie Apocalypse Tileset](https://ittaimanero.itch.io/zombie-apocalypse-tileset)** by Ittai
Manero, staged at
[`public/assets/tilesets/zombie-apocalypse/`](../public/assets/tilesets/zombie-apocalypse/) (see
that folder's own `README.md` for the category index + Phaser loading notes). 16×16, matches
`TILE_SIZE`, on-theme (post-apoc scenery, zombies, weapons, UI). Beat the CC-BY-SA OpenGameArt
alternative on content breadth (environment + characters + items in one coherent pack vs.
terrain-only).

**Licence is not CC0** — free for personal + commercial use, credit appreciated, no redistributing
the assets themselves standalone. Full terms in that folder's `LICENSE.md`; keep it alongside the
assets if this repo or a build ever goes public.

Still evaluation-stage: staged in the repo, not yet wired into the Phaser loader (that's the next
step, once we're past placeholders per the phased approach below).

<details>
<summary>Other candidates considered</summary>

Prefer **CC0 / Creative Commons Zero** (free commercial use, no attribution needed) where content
needs are equal. On itch.io, filter by CC0 + tags `tileset`, `top-down`, `zombies`, `pixel-art`.

- **Kenney** ([kenney.nl](https://kenney.nl)) — huge library of CC0 pixel/top-down packs. Reliable,
  consistent, genuinely free, but skews clean/colourful (tanks, shooters) rather than the grimy
  survival-horror mood — good CC0 fallback for UI/generic props, not the base environment look.
- **[Post-Apocalyptic 16×16 Tileset](https://opengameart.org/content/post-apocalyptic-16x16-tileset-update1)**
  (OpenGameArt, CC-BY-SA 3.0) — right mood, true open licence, but terrain-only (single PNG, no
  buildings/props/characters) — would need pairing with another pack.
- **RGS_Dev** CC0 top-down tileset template (16×16, colour variants) — good for prototyping, not
  evaluated in depth once Zombie Apocalypse covered the need.

Sources: [itch.io CC0 assets](https://itch.io/game-assets/assets-cc0) ·
[itch.io CC0 tilesets](https://itch.io/game-assets/assets-cc0/tag-tileset) ·
[itch.io free zombie assets](https://itch.io/game-assets/free/tag-zombies) ·
[itch.io pixel-art + zombies](https://itch.io/game-assets/tag-pixel-art/tag-zombies) ·
[Kenney](https://kenney.nl)

</details>

## AI pixel-art trials — Retro Diffusion & PixelLab

Two free-tier AI pixel-art services worth trialling alongside/against Gemini, since both are
purpose-built for pixel art (unlike a general image model, which needs heavy downscale/quantise
post-processing to look right). CLI wrappers + full API details:
[`scripts/gen-art/`](../scripts/gen-art/README.md).

- **Retro Diffusion** — has dedicated *tile* styles (`rd_tile__single_tile`, `rd_tile__tileset`,
  seamless `tile_x`/`tile_y` options) purpose-built for environment art, a real advantage over
  PixelLab for this pack's use case.
- **PixelLab** — `bitforge` model takes a `style_image` reference, potentially useful for matching
  new bespoke sprites to the Zombie Apocalypse pack's existing look. No dedicated tileset endpoint
  despite the marketing — same pixflux/bitforge endpoints, just prompted for tile-shaped subjects.

Compare a few equivalent prompts across both (+ Gemini) before settling on a default; see the
gen-art README's "What to compare" section.

## Gemini asset generation (via guppi)

Matt's home server (**guppi** repo / Beelink) has a working Gemini image-gen setup we can mirror.
The API key is `GEMINI_API_KEY`, stored in `guppi/house-helper/.env` (**gitignored — never commit
it**, and it's on the home LAN, not reachable from a cloud dev sandbox).

Reference implementation to copy from: **`guppi/house-helper/catalog_icons.py`**. Key facts:

- **Model:** `gemini-2.5-flash-image` (aka *"Nano Banana"*) — image generation.
- **Endpoint:** `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent`
- **Auth:** header `x-goog-api-key: <GEMINI_API_KEY>`.
- Returns a ~1024px PNG (inline base64) on a solid background; guppi post-processes (square-crop →
  alpha key-out → resize). For pixel-art game assets we'd instead **downscale hard to the target
  pixel grid** (e.g. 16×16 / 32×32) with nearest-neighbour, and likely quantise the palette.

Practical workflow (proposed, to firm up when we start generating):

1. Write a tight prompt per asset — enforce the dark-grotty-but-funny style, transparent/flat
   background, top-down or item-icon framing, low detail suited to pixel downscaling.
2. Generate at high res via the endpoint above.
3. Downscale to the pixel grid + palette-quantise → sprite/atlas.
4. Commit the *processed* sprite (not the raw 1024px) into the repo's assets dir; note its origin.

> Because generation needs the LAN key, expect to run the generation step from a machine that can
> reach guppi (or with the key exported locally), then commit the resulting sprites so cloud/other
> devices just consume them.

## Where assets live (proposed)

- `public/assets/` (or `src/assets/`) — sprites/tilesets/atlases the game loads (path finalised with
  the Vite scaffold).
- `docs/assets/reference/` — reference material (e.g. the Google Maps screenshot of Mostowa).
- Licence notes travel with any third-party pack.
