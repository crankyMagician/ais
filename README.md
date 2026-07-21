# AIS Dark Tracker

Live marine traffic plus detection and analysis of vessels that stop
transmitting AIS ("going dark"). Static Next.js site on GitHub Pages; all data
collection runs in scheduled GitHub Actions. No servers.

## How it works

- The live map connects straight from the browser to Digitraffic's open Baltic
  AIS feed (MQTT over WebSocket, no key) on an OpenFreeMap basemap.
- Every 20 minutes a GitHub Actions job samples aisstream.io for ~10 minutes
  across six watch regions (Baltic, Black Sea, Eastern Mediterranean, Persian
  Gulf, Gulf of Guinea, South China Sea), updates per-vessel state, detects
  signal-loss events, classifies them, and publishes JSON to the `data`
  branch. The branch holds a single orphan commit that is force-pushed each
  run: the tip is the state, so the repo never bloats.
- The site fetches the `data` branch through raw.githubusercontent.com at
  runtime, so data updates need no site rebuild.

Detection only trusts absence when the pipeline itself was healthy: collector
downtime and degraded receiver coverage are subtracted from every absence
clock, mass disappearances trip a circuit breaker, and region boundaries are
treated as coverage cliffs. See `/why` on the site for methodology and limits.

## Setup

1. Create a free API key at [aisstream.io](https://aisstream.io) (GitHub
   sign-in).
2. `gh secret set AISSTREAM_API_KEY` in this repo.
3. Enable GitHub Pages with the "GitHub Actions" source.

The `collect` workflow then runs on its own; the first events appear after a
~2 hour warmup.

## Development

```
npm install
npm run dev            # site at localhost:3000
npm test               # pipeline unit tests
npm run collect -- --state /tmp/s --out /tmp/o --window-min 3   # needs AISSTREAM_API_KEY
npx tsx pipeline/src/run.ts --state /tmp/s --out /tmp/o --replay fixture.ndjson  # offline
```

Detection thresholds live in `pipeline/src/config/thresholds.ts`, watch
regions in `pipeline/src/config/regions.ts`, curated risk zones in
`pipeline/data-static/risk-zones.geojson`.
