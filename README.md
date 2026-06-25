# Dota Picker

Dota Picker is a local draft assistant for Dota 2. It is a React/Vite app that
works with local JSON data and gives hero recommendations based on draft state,
roles, counters, synergy and meta values.

The project is built as a portfolio frontend app: the main focus is state
management, data processing, recommendation scoring and a usable interface for
manual draft analysis.

## Features

- Manual draft board for allies, enemies and bans.
- Search and filtering by hero attributes.
- Role-aware recommendations.
- Adjustable scoring weights for meta, counters, synergy, role fit and team
  needs.
- Explanation block for recommendation reasons.
- Local JSON data for heroes and draft metadata.
- Python update script for downloading public OpenDota hero statistics.

## Tech Stack

- React 19
- Vite 7
- JavaScript
- CSS
- Python script for data update
- OpenDota public data

## Run Locally

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:5173
```

Build:

```bash
npm run build
```

## Update Data

```bash
npm run update:data
```

This command runs `tools/update_data.py`, downloads public OpenDota
`heroStats`, and rewrites `data/heroes.json` plus patch metadata in
`data/draft-data.json`.

## How Recommendations Work

The scoring logic is located in `src/scoring.js`. A recommendation score is
calculated from several parts:

- current hero win rate and pick rate;
- matchup/counter value against selected enemy heroes;
- synergy with selected allied heroes;
- fit for the selected role;
- missing team needs such as control, initiation, save or wave clear.

## Planned Improvements

- Add richer matchup and synergy import.
- Add optional Dota 2 Game State Integration receiver.
- Add personal hero pool and rank filters.
- Add tests for scoring logic.
- Deploy a public demo build.
