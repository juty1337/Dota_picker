#!/usr/bin/env python3
"""Build local Dota Picker data from OpenDota heroStats.

The site never talks to the Dota 2 client or game memory. This script only
refreshes local JSON files from a public HTTP API so the frontend can keep
working from local files after the update.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
HERO_STATS_URL = "https://api.opendota.com/api/heroStats"
RANK_BUCKETS = tuple(str(index) for index in range(1, 9))

ROLE_TO_APP_ROLES = {
    "Carry": ("carry",),
    "Nuker": ("mid", "soft"),
    "Initiator": ("offlane", "soft"),
    "Disabler": ("soft", "hard"),
    "Durable": ("offlane",),
    "Escape": ("mid", "carry"),
    "Support": ("hard", "soft"),
    "Pusher": ("offlane", "carry"),
    "Jungler": ("offlane",),
}

ROLE_TO_TAGS = {
    "Carry": ("scaling",),
    "Nuker": ("burst",),
    "Initiator": ("initiation",),
    "Disabler": ("disable", "stun"),
    "Durable": ("durable",),
    "Escape": ("mobility",),
    "Support": ("save",),
    "Pusher": ("tower", "push"),
    "Jungler": ("farm",),
}

ATTRIBUTE_MAP = {
    "str": "str",
    "agi": "agi",
    "int": "int",
    "all": "universal",
}

DEFAULT_DRAFT_DATA = {
    "weights": {
        "meta": 35,
        "counter": 30,
        "synergy": 20,
        "role": 10,
        "needs": 5,
    },
    "matchups": {},
    "synergies": {},
    "teamNeeds": {
        "stun": "Надежный стан",
        "disable": "Долгий контроль",
        "initiation": "Инициация",
        "teamfight": "Командный файт",
        "tower": "Урон по зданиям",
        "save": "Сейв союзника",
        "wave_clear": "Чистка волн",
        "scaling": "Поздняя игра",
    },
}


def main() -> int:
    parser = argparse.ArgumentParser(description="Update local Dota Picker JSON data.")
    parser.add_argument("--patch", default="7.41c", help="Patch label to write into draft-data.json.")
    parser.add_argument("--output", default=str(DATA_DIR), help="Output directory for JSON files.")
    parser.add_argument(
        "--keep-draft-knowledge",
        action="store_true",
        help="Keep existing matchups/synergies/teamNeeds when refreshing patch metadata.",
    )
    args = parser.parse_args()

    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    try:
      raw_hero_stats = fetch_json(HERO_STATS_URL)
    except urllib.error.URLError as error:
      print(f"Failed to fetch OpenDota heroStats: {error}", file=sys.stderr)
      return 1

    heroes = build_heroes(raw_hero_stats)
    draft_data = build_draft_data(args.patch, output_dir, args.keep_draft_knowledge)

    write_json(output_dir / "heroes.json", heroes)
    write_json(output_dir / "draft-data.json", draft_data)

    print(f"Wrote {len(heroes)} heroes to {output_dir / 'heroes.json'}")
    print(f"Wrote draft metadata for patch {args.patch} to {output_dir / 'draft-data.json'}")
    return 0


def fetch_json(url: str) -> Any:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            "User-Agent": "DotaPickerLocal/0.1",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def build_heroes(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    totals_by_hero = {row["id"]: get_ranked_totals(row) for row in rows}
    total_picks = sum(totals["picks"] for totals in totals_by_hero.values()) or 1

    heroes = []
    for row in rows:
        totals = totals_by_hero[row["id"]]
        picks = totals["picks"]
        wins = totals["wins"]
        win_rate = (wins / picks * 100) if picks else 50.0
        pick_rate = picks / total_picks * 1000
        localized_name = row["localized_name"]
        dota_roles = row.get("roles") or []

        heroes.append(
            {
                "id": slugify(localized_name),
                "dotaId": row["id"],
                "name": localized_name,
                "attribute": ATTRIBUTE_MAP.get(row.get("primary_attr"), "universal"),
                "roles": infer_app_roles(dota_roles),
                "tags": infer_tags(row, dota_roles),
                "winRate": round(win_rate, 1),
                "pickRate": round(pick_rate, 1),
                "image": image_slug(row["name"]),
            }
        )

    return sorted(heroes, key=lambda hero: hero["name"])


def get_ranked_totals(row: dict[str, Any]) -> dict[str, int]:
    picks = sum(int(row.get(f"{bucket}_pick") or 0) for bucket in RANK_BUCKETS)
    wins = sum(int(row.get(f"{bucket}_win") or 0) for bucket in RANK_BUCKETS)
    return {"picks": picks, "wins": wins}


def infer_app_roles(dota_roles: list[str]) -> list[str]:
    roles: list[str] = []
    for dota_role in dota_roles:
        for role in ROLE_TO_APP_ROLES.get(dota_role, ()):
            if role not in roles:
                roles.append(role)

    if not roles:
        roles.append("mid")

    return roles[:3]


def infer_tags(row: dict[str, Any], dota_roles: list[str]) -> list[str]:
    tags: list[str] = []

    if row.get("attack_type") == "Ranged":
        tags.append("ranged")

    for dota_role in dota_roles:
        for tag in ROLE_TO_TAGS.get(dota_role, ()):
            if tag not in tags:
                tags.append(tag)

    if "Initiator" in dota_roles or "Disabler" in dota_roles:
        tags.append("teamfight")
    if "Support" in dota_roles and "save" not in tags:
        tags.append("save")
    if "Carry" in dota_roles and "scaling" not in tags:
        tags.append("scaling")

    return dedupe(tags)


def build_draft_data(patch: str, output_dir: Path, keep_existing: bool) -> dict[str, Any]:
    draft_data = json.loads(json.dumps(DEFAULT_DRAFT_DATA, ensure_ascii=False))
    existing_path = output_dir / "draft-data.json"

    if keep_existing and existing_path.exists():
        with existing_path.open("r", encoding="utf-8") as file:
            existing = json.load(file)
        for key in ("weights", "matchups", "synergies", "teamNeeds"):
            if key in existing:
                draft_data[key] = existing[key]

    draft_data["patch"] = {
        "version": patch,
        "updatedAt": date.today().isoformat(),
        "source": "OpenDota heroStats + local draft knowledge",
        "rankBracket": "all ranked buckets",
    }
    return draft_data


def image_slug(command_name: str) -> str:
    return command_name.replace("npc_dota_hero_", "")


def slugify(name: str) -> str:
    text = name.lower().replace("'", "")
    text = re.sub(r"[^a-z0-9]+", "_", text)
    return text.strip("_")


def dedupe(values: list[str]) -> list[str]:
    result = []
    for value in values:
        if value not in result:
            result.append(value)
    return result


def write_json(path: Path, value: Any) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as file:
        json.dump(value, file, ensure_ascii=False, indent=2)
        file.write("\n")


if __name__ == "__main__":
    raise SystemExit(main())
