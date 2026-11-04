# Mała Mława

An interactive isometric 3D map of Mława with a city-builder-inspired view. The map uses its own code and Mława data.

## Run locally

Use a recent Node.js version compatible with Vite 7 and a browser with WebGL 2:

```sh
npm ci
npm run dev
```

Open the local address printed by Vite. `npm run build` checks TypeScript and creates a production build in `dist/`.

Drag to pan, scroll or use +/− to zoom, and right-drag or use Q/E to rotate. WASD and the arrow keys also pan. Choose a place or click a building to open its details. The map starts in a sharper, anti-aliased view; the settings panel also offers pixel and retro styles, seasons, landmark pins, and simulated cars. Live solar lighting uses the device clock; live weather is optional and contacts Open-Meteo only when enabled. The cars are decorative and do not represent live traffic.

The “Uratuj liska” button opens an original rolling-block puzzle. The first five levels are handcrafted; from level six onward, new numbered levels are generated locally and checked for a winning path. Use the on-screen arrows, a swipe, or the arrow/WASD keys, and stand the present upright on the paw. Each win reveals the next level; use the arrows beside the level numbers to revisit unlocked levels. The “Zobacz liska w lesie” button flies to the animated rescue scene in the northern forest; the scene also opens the game.

The rescue meter is a personal, account-free goal: finishing the first 20 consecutive levels opens the cage, and further levels remain available. Replaying a level does not add progress. Completed levels and personal bests are saved only in that browser when local storage is available, including progress from the original five-level version. The prototype does not have a shared city-wide counter or prize system; those would require a backend.

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
