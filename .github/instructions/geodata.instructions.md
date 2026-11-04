---
description: Rules for changing the Mława geographic data pipeline
applyTo: 'scripts/**,src/data/**,src/city/**'
---

# Geographic data

- The GUGiK powiat mławski 2017 CityGML archive used here stores positions as easting, northing, elevation. Pass the first two values to `proj4` in that order; for example, Mława's centre is approximately `[592563, 583880]` in EPSG:2180 and `[20.3833, 53.1122]` in longitude/latitude.
- LoD2 sidecars address buildings by their index in an OSM chunk and are valid only for the exact `cityGenerated` manifest timestamp. Rebuild them with `npm run data:lod2` after changing or regenerating city chunks; do not silently apply stale sidecars.
- GUGiK models are 2017 data, spatially matched and flattened for visualization, not current survey-grade building measurements. Preserve OpenStreetMap and GUGiK attribution when changing the pipeline or interface.
