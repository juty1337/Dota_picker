const ROLE_LABELS = {
  carry: "Carry",
  mid: "Mid",
  offlane: "Offlane",
  soft: "Soft Support",
  hard: "Hard Support"
};

const TAG_LABELS = {
  stun: "стан",
  disable: "контроль",
  initiation: "инициация",
  teamfight: "тимфайт",
  tower: "пуш",
  save: "сейв",
  wave_clear: "чистка волн",
  scaling: "лейт",
  sustain: "выживаемость",
  silence: "сайленс",
  catch: "ловля",
  burst: "burst",
  durable: "фронтлайн",
  global: "глобальное влияние",
  aura: "ауры"
};

const TAG_COUNTERS = {
  illusion: ["stun", "cleave", "wave_clear", "teamfight"],
  scaling: ["tempo", "push", "catch"],
  mobility: ["silence", "catch", "disable"],
  sustain: ["anti_heal", "burst"],
  durable: ["anti_tank", "percent_damage", "break"],
  ranged: ["initiation", "catch", "backline_access"],
  split_push: ["global", "catch", "wave_clear"]
};

const ROLE_FALLBACKS = {
  carry: ["mid"],
  mid: ["carry", "offlane"],
  offlane: ["mid", "soft"],
  soft: ["hard", "offlane"],
  hard: ["soft"]
};

export function getRecommendations(heroes, draftData, state) {
  const selectedIds = getSelectedIds(state);
  const availableHeroes = heroes.filter((hero) => !selectedIds.has(hero.id));
  const allies = resolveHeroes(heroes, state.allies);
  const enemies = resolveHeroes(heroes, state.enemies);
  const weights = { ...draftData.weights, ...state.weights };

  return availableHeroes
    .map((hero) => {
      const meta = scoreMeta(hero);
      const counter = scoreCounters(hero, enemies, draftData);
      const synergy = scoreSynergy(hero, allies, draftData);
      const role = scoreRole(hero, state.role);
      const needs = scoreNeeds(hero, allies, draftData);

      const rawScore =
        meta.value * (weights.meta / 100) +
        counter.value * (weights.counter / 100) +
        synergy.value * (weights.synergy / 100) +
        role.value * (weights.role / 100) +
        needs.value * (weights.needs / 100);

      const confidence = getConfidence(hero, counter.samples, synergy.samples);
      const score = clamp(Math.round(rawScore + 50 + confidence.adjustment), 0, 100);

      return {
        hero,
        score,
        confidence: confidence.label,
        parts: { meta, counter, synergy, role, needs },
        reasons: buildReasons(hero, { meta, counter, synergy, role, needs })
      };
    })
    .sort((a, b) => b.score - a.score || b.hero.winRate - a.hero.winRate)
    .slice(0, 12);
}

export function getTeamSummary(heroes, draftData, state) {
  const allies = resolveHeroes(heroes, state.allies);
  const tags = new Set(allies.flatMap((hero) => hero.tags ?? []));
  const needs = Object.entries(draftData.teamNeeds).map(([tag, label]) => ({
    tag,
    label,
    present: tags.has(tag)
  }));

  return {
    strengths: needs.filter((need) => need.present).slice(0, 5),
    missing: needs.filter((need) => !need.present).slice(0, 5)
  };
}

export function getRoleLabel(role) {
  return ROLE_LABELS[role] ?? role;
}

export function getTagLabel(tag) {
  return TAG_LABELS[tag] ?? tag.replaceAll("_", " ");
}

function scoreMeta(hero) {
  const winRate = Number(hero.winRate ?? 50);
  const pickRate = Number(hero.pickRate ?? 0);
  const winRateScore = (winRate - 50) * 7;
  const pickRateScore = Math.min(pickRate, 15) * 0.45;
  const value = clamp(winRateScore + pickRateScore, -22, 26);

  return {
    value,
    label: `${winRate.toFixed(1)}% WR, ${pickRate.toFixed(1)}% pick`
  };
}

function scoreRole(hero, selectedRole) {
  if (!selectedRole || selectedRole === "any") {
    return { value: 8, label: "без фильтра роли" };
  }

  if (hero.roles.includes(selectedRole)) {
    return { value: 20, label: `подходит на ${getRoleLabel(selectedRole)}` };
  }

  const fallbackRoles = ROLE_FALLBACKS[selectedRole] ?? [];
  if (hero.roles.some((role) => fallbackRoles.includes(role))) {
    return { value: 5, label: `можно адаптировать под ${getRoleLabel(selectedRole)}` };
  }

  return { value: -24, label: `не основной ${getRoleLabel(selectedRole)}` };
}

function scoreCounters(hero, enemies, draftData) {
  if (enemies.length === 0) {
    return { value: 0, label: "враги еще не выбраны", samples: 0, positive: [], negative: [] };
  }

  const ownMatchups = draftData.matchups[hero.id] ?? {};
  const values = enemies.map((enemy) => {
    const direct = ownMatchups[enemy.id];
    const heuristic = getTagCounterScore(hero, enemy);
    return {
      enemy,
      value: typeof direct === "number" ? direct : heuristic,
      direct: typeof direct === "number"
    };
  });

  const average = values.reduce((sum, item) => sum + item.value, 0) / values.length;
  const directSamples = values.filter((item) => item.direct).length;
  const positive = values.filter((item) => item.value >= 3).sort((a, b) => b.value - a.value);
  const negative = values.filter((item) => item.value <= -3).sort((a, b) => a.value - b.value);

  return {
    value: clamp(average * 4, -30, 30),
    label: explainMatchups(positive, negative),
    samples: directSamples,
    positive,
    negative
  };
}

function scoreSynergy(hero, allies, draftData) {
  if (allies.length === 0) {
    return { value: 0, label: "союзники еще не выбраны", samples: 0, positive: [] };
  }

  const values = allies.map((ally) => {
    const direct =
      draftData.synergies[hero.id]?.[ally.id] ??
      draftData.synergies[ally.id]?.[hero.id];
    const heuristic = getTagSynergyScore(hero, ally);
    return {
      ally,
      value: typeof direct === "number" ? direct : heuristic,
      direct: typeof direct === "number"
    };
  });

  const average = values.reduce((sum, item) => sum + item.value, 0) / values.length;
  const directSamples = values.filter((item) => item.direct).length;
  const positive = values.filter((item) => item.value >= 3).sort((a, b) => b.value - a.value);

  return {
    value: clamp(average * 3.2, -8, 26),
    label: positive.length
      ? `сильная связка с ${positive.slice(0, 2).map((item) => item.ally.name).join(", ")}`
      : "нейтральная синергия",
    samples: directSamples,
    positive
  };
}

function scoreNeeds(hero, allies, draftData) {
  const existingTags = new Set(allies.flatMap((ally) => ally.tags ?? []));
  const covered = Object.keys(draftData.teamNeeds).filter(
    (tag) => !existingTags.has(tag) && hero.tags.includes(tag)
  );

  return {
    value: clamp(covered.length * 5, 0, 20),
    label: covered.length
      ? `закрывает: ${covered.slice(0, 3).map(getTagLabel).join(", ")}`
      : "не закрывает ключевой пробел"
  };
}

function getTagCounterScore(hero, enemy) {
  let value = 0;
  for (const enemyTag of enemy.tags ?? []) {
    const counterTags = TAG_COUNTERS[enemyTag] ?? [];
    value += hero.tags.filter((tag) => counterTags.includes(tag)).length * 1.4;
  }

  if (enemy.tags.includes("ranged") && hero.tags.includes("initiation")) value += 1.5;
  if (enemy.tags.includes("mobility") && hero.tags.includes("silence")) value += 2;
  if (enemy.tags.includes("durable") && hero.tags.includes("break")) value += 2;
  if (
    enemy.tags.includes("illusion") &&
    !hero.tags.some((tag) => ["cleave", "wave_clear", "teamfight"].includes(tag))
  ) {
    value -= 2;
  }

  return clamp(value, -4, 5);
}

function getTagSynergyScore(hero, ally) {
  let value = 0;
  const heroTags = new Set(hero.tags);
  const allyTags = new Set(ally.tags);

  if (heroTags.has("teamfight") && allyTags.has("teamfight")) value += 2;
  if (heroTags.has("stun") && allyTags.has("burst")) value += 2;
  if (heroTags.has("setup") && allyTags.has("stun")) value += 2;
  if (heroTags.has("save") && allyTags.has("scaling")) value += 2;
  if (heroTags.has("tower") && allyTags.has("disable")) value += 1.5;
  if (heroTags.has("aura") && allyTags.has("durable")) value += 1.5;
  if (heroTags.has("initiation") && allyTags.has("global")) value += 1;

  return clamp(value, 0, 5);
}

function explainMatchups(positive, negative) {
  if (positive.length && negative.length) {
    return `хорош против ${positive[0].enemy.name}, риск против ${negative[0].enemy.name}`;
  }
  if (positive.length) {
    return `хорош против ${positive.slice(0, 2).map((item) => item.enemy.name).join(", ")}`;
  }
  if (negative.length) {
    return `опасный матчап: ${negative.slice(0, 2).map((item) => item.enemy.name).join(", ")}`;
  }
  return "матчапы нейтральные";
}

function buildReasons(hero, parts) {
  const reasons = [];

  if (parts.counter.positive.length) {
    reasons.push(`Контрит: ${parts.counter.positive.slice(0, 3).map((item) => item.enemy.name).join(", ")}`);
  }

  if (parts.synergy.positive.length) {
    reasons.push(`Сочетается с: ${parts.synergy.positive.slice(0, 3).map((item) => item.ally.name).join(", ")}`);
  }

  if (parts.needs.value > 0) {
    reasons.push(parts.needs.label);
  }

  if (parts.role.value > 0) {
    reasons.push(parts.role.label);
  }

  if (parts.counter.negative.length) {
    reasons.push(`Риск: ${parts.counter.negative.slice(0, 2).map((item) => item.enemy.name).join(", ")}`);
  }

  if (reasons.length === 0) {
    reasons.push(`${hero.name} выглядит нейтральным пиком по текущему драфту`);
  }

  return reasons;
}

function getConfidence(hero, counterSamples, synergySamples) {
  const sampleScore = counterSamples + synergySamples + Math.min(Number(hero.pickRate ?? 0) / 4, 4);
  if (sampleScore >= 7) return { label: "high", adjustment: 2 };
  if (sampleScore >= 3) return { label: "medium", adjustment: 0 };
  return { label: "low", adjustment: -3 };
}

function getSelectedIds(state) {
  return new Set([...state.allies, ...state.enemies, ...state.bans].filter(Boolean));
}

function resolveHeroes(heroes, ids) {
  const byId = new Map(heroes.map((hero) => [hero.id, hero]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
