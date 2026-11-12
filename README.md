# PUBTA — Public Transportation Assistant

A commuter's trip planner for **Caloocan, Malabon, Navotas and Valenzuela** (and the roads that connect them to Quezon City and Manila).
Tell it where you are and where you're going; it tells you **where to wait, which jeepney / bus / UV Express / train to take, where to get off, how much it costs and how long it takes** — as plain step-by-step directions.

* **Every kind of ride:** jeepneys, city buses, the EDSA Carousel, UV Express, LRT-1 / LRT-2 / MRT-3, tricycles (as first/last-mile feeders) and walking.
* **Proper fares:** current LTFRB/LRMC fares, distance-based, with 20 % student / senior / PWD discounts (50 % on trains). Every fare says how trustworthy it is.
* **Honest travel times:** by mode, by time of day (morning/evening rush, weekends), including waiting and walking.
* **Real places:** search landmarks, schools, malls, stations, barangays and roads ("UE", "MCU", "Monumento", "Victory Mall"), use your location, or tap the map.
* **Explains the ride:** "Wait on the side of the road for vehicles heading south, flag down a jeepney with the signboard *Monumento–Malabon via Letre*, say *Para po* at Areneta Square Mall…"

---

## Quick start

```powershell
cd Others\route-api
npm ci            # first time only
npm start
```

Open **http://localhost:8000/PUBTASYSTEM.html**. That single command serves both the website and the API.

| Want to… | Do this |
|---|---|
| Test on your phone (same Wi-Fi) | `HOST=0.0.0.0` in `Others/route-api/.env`, restart, open the “on your network” address it prints |
| Use VS Code **Live Server** (port 5501) | Works — the page finds the API on `localhost:8000` automatically (start `npm start` too) |
| Run the tests | `npm test` (in `Others/route-api`) |

Requires **Node 20+**. The transit data (`data/network.json`, `places.json`, `areas.json`) is already built and committed-ready; you only rebuild it to refresh it (see *Updating the data*).

---

## How it works

```
 browser (PUBTASYSTEM.html)                       server (Others/route-api)
 ┌──────────────────────────┐   /api/plan         ┌───────────────────────────────────────────────┐
 │ search boxes, options,   │ ──────────────────▶ │ planner.js   A* search over board/alight legs  │
 │ result cards, map        │ ◀────────────────── │ fares.js     fares.json   instructions.js     │
 │ (MapLibre + OpenFreeMap) │   itineraries       │ network.js   places.js    areas.js            │
 └──────────────────────────┘                     └───────────────▲───────────────────────────────┘
                                                                    │ built offline by scripts/*
                                   OpenStreetMap routes  +  DOTC/LTFRB GTFS (jeepneys)  +  curated files
```

### The network
A **line** is one route in one direction (e.g. "EDSA Carousel northbound", "Monumento–Malabon via Letre"). Each line becomes **boarding points**:

* trains, the Carousel, UV Express → only at their stops/stations;
* jeepneys → every ~250 m, because jeepneys can be flagged down anywhere along the road.

### Routes that follow the roads (`src/roads.js`)
Nothing is drawn "as the crow flies". PUBTA carries the **street network of the whole area** (about 160,000 road pieces — every mapped street, lane and footpath — in a 2 MB file, `data/roads.bin.gz`) and uses it three ways:

* **Walking and tricycle legs** are routed over real streets: walkers may use footpaths and stairs and ignore one-way rules; tricycles stay on streets they can use, obey one-ways, and avoid highways when there is a choice. The distance, time and tricycle fare all come from the road path, so a stop across a river is not "close" just because it is near on the map, and the directions name the streets ("Walk about 300 m … along Samson Road → Rizal Avenue").
* **Jeepney routes from the older LTFRB data** only knew their stops, so they used to be drawn as straight pieces between stops. They are now matched stop-to-stop onto the roads jeepneys can drive (one-ways respected); a piece with no believable road path is left straight rather than guessed.
* **Gaps in OpenStreetMap routes** (where two mapped ways don't quite touch) are bridged along the road.

The walk to the first stop, every transfer walk and the last leg are all measured on the road map *inside the search*, so the planner never offers a "2-minute transfer" that is really a long detour (the transfer distances are worked out once for every stop in the background after start-up, ~10 s). If the road map is missing the planner falls back to straight lines × a detour factor (flagged `approximate`), so the app still runs.

### The planner (`src/planner.js`)
Searches a graph where you can: walk (or tricycle) to a boarding point → **ride a line from point *i* to point *j*** (exact fare for that leg) → walk to another line (a transfer) → walk to the destination.
It minimises a *generalised cost* — minutes + (fare × weight) + a penalty per vehicle change — and runs it with different weights to get the **recommended, fastest, cheapest and fewest-transfers** options. It then bans the main line of the best answers to find genuinely different alternatives, and merges "the same trip on another signboard" into one option with an *"also goes the same way"* list.
The search is **A\*** with proven lower bounds, and a test checks it returns exactly what plain Dijkstra does. Typical trips take under 0.1 s; long cross-city trips about 1 s.

### Fares (`data/config/fares.json`)
Edit a number, restart, done — no code changes. Current values (effective **2026-09-28**):

| Service | Fare |
|---|---|
| Traditional jeepney | ₱14 first 4 km, +₱2.00/km |
| Modern jeepney | ₱17 first 4 km, +₱2.40/km |
| City bus (ordinary / aircon) | ₱15 / ₱18 first 5 km, +₱2.49 / +₱2.98 per km |
| LRT-1 | ₱20 – ₱55 (interpolated by station count — see `lrmc.ph` for the exact matrix) |
| UV Express, tricycles (Caloocan, Navotas) | **estimates** |
| Tricycle (Valenzuela, Malabon) | from published city matrices (2023 / 2020 — may have changed) |

Each class is tagged `official`, `reported` or `estimate` with its source, and the app shows that tag next to the fare. Passenger discounts are in the same file.

### Travel time (`data/config/modes.json`)
Average speed per mode and time of day (am/pm rush, midday, night, weekend), expected waiting time, walking speed, and the planning limits (longest walk, hail-point spacing, tricycle range). All editable.

---

## Data — sources, accuracy and licensing

| Data | Source | Used for | Confidence |
|---|---|---|---|
| Buses, UV Express, EDSA Carousel, LRT/MRT, some jeepneys | **OpenStreetMap** (ODbL) via Overpass | the core network | medium (rail: high) |
| Jeepney routes | **DOTC/LTFRB GTFS** via [Sakay.ph](https://github.com/sakayph/gtfs) (2013–15) | extra jeepney coverage, only where OSM has no equivalent | **low** — the app labels these *"older data"* |
| Streets, lanes, footpaths (the road map) | **OpenStreetMap** (ODbL) via Overpass | walking/tricycle paths, drawing jeepney routes on roads | medium–high |
| Places, roads, city boundaries | OpenStreetMap + `data/curated/*.json` | search & city lookup | — |
| Map tiles | OpenFreeMap / OpenStreetMap | display | — |

Please read this honestly: **route data for informal transport is never perfect.** Jeepney routes change, the older DOTC data is ~10 years old, and tricycle fares vary by city and TODA. PUBTA therefore (a) tells riders to confirm the signboard, (b) marks low-confidence routes in the results, (c) lets users switch the older data off, and (d) shows when a fare is only an estimate.
The DOTC data licence allows use "for the purpose of assisting mass transportation riders"; keep the attribution in the footer. OpenStreetMap data requires the credit shown on the map.

### Improving it (the best contribution)
* Fix/add a place or alias → `data/curated/places.json` / `aliases.json`.
* A route is wrong or missing → improve it **in OpenStreetMap** (route relations), then refresh the data below. Everyone benefits.
* A fare changed → edit `data/config/fares.json`.

---

## Updating the data

```powershell
cd Others\route-api
npm run data:fetch      # downloads OpenStreetMap routes + the street map (Overpass) + the legacy GTFS into data/raw (git-ignored; ~45 min, resumable)
npm run data:build      # areas.json, roads.bin.gz, network.json, places.json   (roads are built BEFORE the network, which is matched to them)
npm test
```
`npm run data:roads` refreshes just the street map (download + build); run `npm run data:build` afterwards so the route lines are re-matched to it.
The public Overpass servers are shared and sometimes busy; the fetchers retry, rotate mirrors and cache every chunk (routes in chunks, streets in ~3 km tiles), so just re-run if one stops.
Run `node scripts/try-plan.js "UE" "SM Grand Central"` to try the planner from the command line.

---

## API (all JSON)

| Endpoint | |
|---|---|
| `POST /api/plan` | `{ from:{lat,lng,name}, to:{…}, passenger:"regular\|student\|senior\|pwd", modes:["jeepney","bus","uv","train","tricycle"], when:"2026-11-12T08:00", maxWalkM:900, includeLowConfidence:true }` → `{ itineraries:[{ tags, totalMin, fare:{regular,payable}, transfers, legs, steps, warnings, … }] }` |
| `GET /api/plan?from=lat,lng&to=lat,lng&passenger=…&modes=a,b&when=…` | same, as a link |
| `GET /api/places/search?q=…&lat=&lng=` | autocomplete |
| `GET /api/places/describe?lat=&lng=` | label for a map point |
| `GET /api/nearby?lat=&lng=&r=` | which lines can I ride near here? |
| `GET /api/network/lines?modes=…&legacy=0\|1` | GeoJSON of the network (map overlay) |
| `GET /api/config`, `GET /api/health` | modes, colours, fare info, dataset sizes |
| `GET /api/routes[/:id]` | the **original** six hand-drawn routes (legacy; served from `data/legacy-routes.json`) |

---

## Project layout

```
PUBTASYSTEM.html          the planner page (dashboard / features / about pages are unchanged)
Others/CSS/planner.css    its styles          Others/JAVASCRIPT/planner/   its scripts (no build step)
Others/vendor/maplibre-gl MapLibre GL JS 4.7.1 (BSD-3), pinned
Others/route-api/
  server.js               start here          src/    planner, fares, network, places, areas, instructions, app
  data/config/            fares.json, modes.json         data/curated/   aliases.json, places.json
  data/legacy-routes.json the original six hand-drawn routes (legacy API)
  data/*.json             built network/places/areas     data/raw/       downloads (git-ignored)
  data/roads.bin.gz       the street map (binary graph)  src/roads.js     its router (walk / tricycle / jeepney profiles)
  scripts/                fetch-osm, fetch-gtfs, build-*, try-plan       test/   node:test suites
```
`Others/JAVASCRIPT/pubtasystem*.js`, `inversebutton.js`, `PUBTA-2.css` and `pubta3system.css` belonged to the old page and are no longer loaded by it; they are left in place for reference.

## Configuration (`Others/route-api/.env`, see `.env.example`)
`PORT`, `HOST` and an optional `CORS_ORIGIN`. There are **no secrets and no database** in the project.

**Keep it that way:** `.env` is git-ignored — never commit a `.env` file, a password or an API key. If you add a service that needs one later, put the value in `.env` and only a placeholder in `.env.example`.

## Known limitations / ideas
* Times and fares are estimates, not live data (no real-time vehicle positions exist for jeepneys).
* Walking and tricycle paths follow the OpenStreetMap street map, so they are only as good as OSM: a missing lane or a one-way that is mapped wrong shows up as a wrong detour. A point more than 150 m from any mapped street falls back to a straight line (flagged `approximate`).
* Older (2013–15) jeepney lines are matched to roads from their stop lists alone, so where stops are far apart the road chosen between two stops may differ from the jeepney's real street.
* Tricycle fares for Caloocan/Navotas and UV Express fares are estimates; LRT-1 fares are interpolated.
* Ideas: street-level walking directions, saved trips, Filipino-language directions, community corrections, live LRT/MRT service status.
