# Mała Mława

An interactive isometric 3D map of Mława with a city-builder-inspired view. The map uses its own code and Mława data.

## Run locally

Use a recent Node.js version compatible with Vite 7 and a browser with WebGL 2:

```sh
npm ci
npm run dev
```

Open the local address printed by Vite. `npm run build` checks TypeScript and creates a production build in `dist/`.

Drag to pan, scroll or use +/− to zoom, and right-drag or use Q/E to rotate. On touchscreens, pinch to zoom and twist two fingers to rotate the map in the same direction. WASD and the arrow keys also pan. Choose a place or click a building to open its details. The map starts in a sharper, anti-aliased view; the settings panel also offers pixel and retro styles, seasons, landmark pins, and simulated cars. Live solar lighting uses the device clock; live weather is optional and contacts Open-Meteo only when enabled. The cars are decorative and do not represent live traffic.

The “Uratuj liska” button opens an original rolling-block puzzle. The first five levels are handcrafted; later levels alternate between locally generated, solvable boards and occasional bridge challenges. Use the on-screen arrows, a swipe, or the arrow/WASD keys, and stand the present upright on the paw. On bridge levels, standing the present upright on a yellow switch opens or closes the matching bridges; move away and return upright to press it again. Undo also restores the previous bridge state. Each win reveals the next level; use the arrows beside the level numbers to revisit unlocked levels. The “Zobacz liska w lesie” button flies to the animated rescue scene in the northern forest; the scene also opens the game.

Completed levels and personal bests are saved in the browser, including progress from the original five-level version. When Supabase is configured, opening the game also starts an anonymous session and synchronizes those results. Existing saves on that origin are imported. The shared rescue meter counts each player's completion of each level once; replaying it can improve a personal best but does not increase the shared total. The initial goal is 1,000 completions and can be changed in the database. The cage opens for everyone when that goal is reached.

No registration is needed to play. Anonymous sessions and local saves belong to the current browser and site origin: changing devices, clearing site data, or switching between localhost, GitHub Pages and a future custom domain does not automatically transfer them. Facebook login, account recovery and prizes are not implemented. If the connection or database setup is unavailable, the game keeps working locally and retries syncing; the shared meter is marked unavailable or shows its last known result.

The optional leaderboard is opened from the game header. A player only appears after choosing a nickname and pressing **Dołącz**; they can edit it or remove their entry in the same browser. Nicknames and scores are public, so players should avoid personal information. The ranking sorts by completed levels, then by the sum of each level's personal-best moves (fewer is better). Players outside the top 25 can still see their own position. Removing a nickname hides the public entry but keeps private game results and the shared rescue contribution. Clearing browser data also removes the anonymous session needed to edit or remove that entry; the operator can delete a forgotten entry in Supabase.

After completing a level, the result screen creates a shareable PNG locally with that run's level and move count. Where the browser and device support sharing image files, **Udostępnij** opens the system share sheet. **Pobierz** also lets the player download the image and attach it to a social-media post. Available sharing destinations depend on the device; publishing is always up to the player.

## Local businesses

The **Lokale** button shows or hides small storefront signs. Nearby signs are grouped into a numbered marker; select it to choose a place. Selecting a business opens its details without highlighting a building. The list includes shops, food, services, healthcare and other mapped places inside the city boundary. An unnamed place is labelled by its category.

Business data is an OpenStreetMap snapshot, not a complete or verified directory: a place can be missing, misplaced, closed or out of date. Hi Girls is also included as a manually added, approximate location; additional manual entries can be edited in [`src/businesses/manual.ts`](src/businesses/manual.ts). No coupon or business participation is implied by a sign.

Run `npm run data:businesses` to fetch a current OpenStreetMap snapshot and regenerate [`public/data/businesses.json`](public/data/businesses.json). The script avoids replicas more than 14 days old and leaves the published data unchanged if the refresh fails. `npm run data:businesses -- --cached` rebuilds from the existing local cache without downloading, and `OVERPASS_URL` can select an Overpass endpoint. The snapshot date is shown in business details.

## Advent calendar

The calendar is temporarily disabled, including its map highlights. Its existing offers and interface remain in the project; set `ADVENT_ENABLED` to `true` in [`src/advent/calendar.ts`](src/advent/calendar.ts) to bring it back after reviewing the offers.

The calendar contains 24 days for December 2026. Hi Girls is highlighted in gold on 1, 8, 15 and 22 December; the other days feature local food businesses. **All discounts are non-redeemable examples, including the Hi Girls 30% example. The other businesses have not been confirmed as participants.** Names, addresses and approximate map pins must be checked with each business before publication. Select **Zobacz przykładowe dni** to preview the demo days immediately; a clearly labelled example also appears on the map. Confirmed future offers remain locked even in preview mode.

Edit [`src/advent/offers.ts`](src/advent/offers.ts) to change the year, businesses, descriptions, addresses, coordinates, sponsor highlights and daily offers. The optional `buildingOsmId` highlights the matching OpenStreetMap building; if unavailable, the map attempts to match the footprint containing the approximate coordinates. The pin remains available even if no building is matched. After agreeing on a real promotion and its conditions, replace that day's `example(...)` entry with an explicit offer, for example:

```ts
{
  day: 2,
  business: businesses.tradycja,
  discount: '15% na posiłek',
  example: false,
  coupon: 'KOD-USTALONY-Z-LOKALEM',
  terms: 'Uzgodnione warunki i ograniczenia oferty.',
  validThrough: '2026-12-02',
},
```

The example code and conditions above are placeholders, not an actual promotion. `validThrough` is an inclusive `YYYY-MM-DD` date; if omitted, the offer expires after its calendar day. Confirmed, unexpired offers automatically add a clickable map marker and highlight the matching building, and disappear from the live map when they expire. If several offers for one business overlap, its marker opens the most recent one; earlier doors remain visitable. The normal calendar unlocks days according to the visitor's device clock in the `Europe/Warsaw` time zone. The calendar is part of the static site and needs no Supabase setup, but future offers are included in the frontend and the device clock can be changed; neither the schedule nor coupon codes are secret or tamper-proof.

## Shared rescue setup

1. In a dedicated Supabase project, enable **Authentication → Sign In / Providers → Anonymous Sign-Ins**. Anonymous users use the `authenticated` database role, so review any existing policies in a shared project before enabling it.
2. Open **SQL Editor**, paste and run [`supabase/fox-rescue.sql`](supabase/fox-rescue.sql). It creates the tables and restricted functions without deleting existing results. Each player's results are private to their own anonymous session; only the aggregate rescue progress is public.
3. In the same SQL Editor, paste and run [`supabase/fox-leaderboard.sql`](supabase/fox-leaderboard.sql) to add the opt-in leaderboard. The public ranking returns nicknames and aggregate scores, not user IDs or non-participating players. The script can be rerun without removing results or nicknames.
4. Copy `.env.example` to `.env.local` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` from the project's **Connect** dialog. Restart the Vite development server after changing them.
5. For GitHub Pages, set repository Actions variables with those same names and redeploy. The publishable key is intentionally included in the website; never use a Supabase secret or `service_role` key in a `VITE_` variable.

To change the initial community goal later, run `update public.fox_rescue_settings set goal = 1000 where id = true;` in the SQL Editor with the desired value. The shared total counts stored results, so deleting anonymous users also removes their contributions. Cloud synchronization supports the first 1,000,000 levels; later levels remain playable locally.

The leaderboard is for fun: results and imported local saves are reported by the browser and can be manipulated, and nicknames are neither unique nor moderated. Before awarding vouchers or treating rankings as competitive, add server-side solution verification, abuse controls, nickname moderation and a privacy notice. Supabase recommends CAPTCHA for anonymous sign-ins; the current client does not yet collect a CAPTCHA token, so enabling CAPTCHA before adding that support would prevent new guest sessions.

## Publishing

The GitHub Actions workflow builds and publishes the site to GitHub Pages whenever changes are pushed to `main`. In the repository's Pages settings, select **GitHub Actions** as the deployment source. A custom domain can be added there after it has been registered.

## Map data

- Streets, land use, most building footprints and landmark metadata come from [OpenStreetMap contributors](https://www.openstreetmap.org/copyright), under the ODbL. The checked-in roads and buildings use an OSM snapshot from 2 November 2026; recent construction can still be missing from OSM.
- The [national EGiB building register](https://www.gov.pl/web/gugik/dane-egib), supplied through GUGiK's aggregated WFS from the district register, adds 640 footprints that do not substantially overlap the OSM buildings. This snapshot was fetched on 4 November 2026; the service does not provide a per-building update date, so inclusion does not guarantee that the register reflects the latest construction.
- Approximate heights for 7,403 buildings come from [GUGiK / Geoportal's LoD1 2024 collection](https://www.geoportal.gov.pl/pl/dane/inne-dane/modele-3d-budynkow/), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The source data for the matched models in this snapshot is labelled 2023. LoD1 heights are derived from laser scanning and represent a roof-height estimate, not necessarily the roof's highest point. Explicit OSM height measurements take precedence.
- Historical [GUGiK LoD2 2017 models](https://www.geoportal.gov.pl/pl/dane/inne-dane/modele-3d-budynkow/) provide detailed roofs where their footprints closely match the current map. Where a newer height is available, a compatible old model is scaled to that height; incompatible models are not used. Other buildings use procedural roofs and OSM or estimated heights. None of the matched geometry is guaranteed to be current or survey-accurate.
- Weather, when enabled, is supplied by [Open-Meteo](https://open-meteo.com/). It requests weather for Mława's fixed coordinates, not the visitor's location.

## Rebuild the map data

```sh
npm run data
```

This uses cached downloads when available, fetches OSM and EGiB otherwise, builds the city chunks, and matches the GUGiK LoD1 and LoD2 models to them. The 2024 LoD1 and 2017 LoD2 archives for powiat mławski are approximately 10 MB and 17 MB respectively. The `unzip` command must be available; downloads are cached in `scripts/.cache/`.

To request fresh OSM and EGiB snapshots rather than reuse their caches, run `npm run data:refresh`. This needs working Overpass and GUGiK services; an up-to-date download can still contain omissions or older source records. To use a particular Overpass instance, set `OVERPASS_URL` to its interpreter URL before running the command. To rebuild the height or roof sidecars independently, run `npm run data:lod1` or `npm run data:lod2`.

Both sidecars are tied to the exact city manifest used to generate them. If the city is rebuilt without regenerating them, the app safely falls back to the available building footprints and height estimates until the matching sidecars are rebuilt.
