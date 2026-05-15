# Dota Picker

Local draft assistant for Dota 2. The app is a React/Vite frontend with local
JSON data, so it can run on `localhost` without reading Dota 2 memory.

## Run locally

From the repository folder:

```bash
npm install
npm run dev
```

Then open:

```text
http://localhost:5173
```

## Update data

```bash
npm run update:data
```

This runs `tools/update_data.py`, downloads public OpenDota `heroStats`, and
rewrites `data/heroes.json` plus patch metadata in `data/draft-data.json`.

## Current scope

- Manual draft board for allies, enemies and bans.
- Patch/data status block.
- Role-aware recommendations.
- Formula-based scoring with meta, counters, synergy, role fit and draft needs.
- Full hero list generated from OpenDota `heroStats`.
- Explainable settings with inline help.

## Next steps

- Add richer matchup/synergy import.
- Add optional Dota 2 Game State Integration receiver.
- Add personal hero pool and rank filters.
