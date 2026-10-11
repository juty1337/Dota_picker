import { useEffect, useMemo, useState } from "react";
import { getRecommendations, getRoleLabel, getTeamSummary } from "./scoring.js";
import heroesUrl from "../data/heroes.json?url";
import draftDataUrl from "../data/draft-data.json?url";

const STORAGE_KEY = "dota-picker-state-v2";
const HERO_IMAGE_BASE = "https://cdn.akamai.steamstatic.com/apps/dota2/images/dota_react/heroes";

const DEFAULT_STATE = {
  allies: [null, null, null, null, null],
  enemies: [null, null, null, null, null],
  bans: [],
  activeBucket: "ally",
  selectedSlot: null,
  role: "mid",
  rank: "all",
  search: "",
  attribute: "all",
  selectedRecommendation: null,
  weights: {
    meta: 35,
    counter: 30,
    synergy: 20,
    role: 10,
    needs: 5
  }
};

const ROLE_OPTIONS = [
  ["carry", "Carry"],
  ["mid", "Mid"],
  ["offlane", "Offlane"],
  ["soft", "Soft"],
  ["hard", "Hard"]
];

const BUCKET_OPTIONS = [
  ["ally", "Союзник"],
  ["enemy", "Противник"],
  ["ban", "Бан"]
];

const ATTRIBUTE_OPTIONS = [
  ["all", "Все атрибуты"],
  ["str", "Strength"],
  ["agi", "Agility"],
  ["int", "Intelligence"],
  ["universal", "Universal"]
];

const WEIGHT_LABELS = {
  meta: "Мета",
  counter: "Контрпики",
  synergy: "Синергия",
  role: "Роль",
  needs: "Пробелы драфта"
};

const WEIGHT_HELP = {
  meta: "Общий винрейт и популярность героя в текущих данных.",
  counter: "Насколько сильно герой должен отвечать на уже выбранных противников.",
  synergy: "Связки с союзниками: сетапы, сейвы, комбо и общий план игры.",
  role: "Насколько строго герой должен подходить под выбранную роль.",
  needs: "Насколько герой закрывает то, чего команде не хватает: контроль, пуш, сейв, тимфайт."
};

export default function App() {
  const [heroes, setHeroes] = useState([]);
  const [draftData, setDraftData] = useState(null);
  const [state, setState] = usePersistentState();
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function loadData() {
      try {
        const [heroesResponse, draftResponse] = await Promise.all([
          fetch(heroesUrl),
          fetch(draftDataUrl)
        ]);

        if (!heroesResponse.ok || !draftResponse.ok) {
          throw new Error("Local JSON files were not found.");
        }

        const [loadedHeroes, loadedDraftData] = await Promise.all([
          heroesResponse.json(),
          draftResponse.json()
        ]);

        if (cancelled) return;

        setHeroes(loadedHeroes);
        setDraftData(loadedDraftData);
        setState((current) => ({
          ...current,
          weights: {
            ...loadedDraftData.weights,
            ...current.weights
          }
        }));
      } catch (error) {
        if (!cancelled) setLoadError(error);
      }
    }

    loadData();
    return () => {
      cancelled = true;
    };
  }, [setState]);

  const selectedIds = useMemo(() => getSelectedIds(state), [state]);
  const filteredHeroes = useMemo(
    () => filterHeroes(heroes, state.search, state.attribute),
    [heroes, state.search, state.attribute]
  );
  const recommendations = useMemo(() => {
    if (!draftData) return [];
    return getRecommendations(heroes, draftData, state);
  }, [heroes, draftData, state]);
  const selectedRecommendation = useMemo(
    () =>
      recommendations.find((item) => item.hero.id === state.selectedRecommendation) ??
      recommendations[0],
    [recommendations, state.selectedRecommendation]
  );
  const teamSummary = useMemo(() => {
    if (!draftData) return { strengths: [], missing: [] };
    return getTeamSummary(heroes, draftData, state);
  }, [heroes, draftData, state]);

  function updateState(patch) {
    setState((current) => ({ ...current, ...patch }));
  }

  function assignHero(heroId) {
    if (selectedIds.has(heroId)) {
      removeHero(heroId);
      return;
    }

    if (state.activeBucket === "ban") {
      updateState({
        bans: [...state.bans, heroId].slice(0, 12),
        selectedRecommendation: null
      });
      return;
    }

    const key = state.activeBucket === "ally" ? "allies" : "enemies";
    const next = [...state[key]];
    const slotIndex =
      state.selectedSlot?.bucket === state.activeBucket
        ? state.selectedSlot.index
        : next.findIndex((item) => item === null);

    if (slotIndex === -1) return;

    next[slotIndex] = heroId;
    updateState({ [key]: next, selectedSlot: null, selectedRecommendation: null });
  }

  function removeHero(heroId) {
    updateState({
      allies: state.allies.map((id) => (id === heroId ? null : id)),
      enemies: state.enemies.map((id) => (id === heroId ? null : id)),
      bans: state.bans.filter((id) => id !== heroId),
      selectedRecommendation: null
    });
  }

  function resetDraft() {
    setState({
      ...DEFAULT_STATE,
      weights: { ...(draftData?.weights ?? DEFAULT_STATE.weights) }
    });
  }

  if (loadError) {
    return (
      <main className="app-shell error-state">
        <h1>Dota Picker</h1>
        <p>
          Не удалось загрузить локальные данные. Для React-версии запусти Vite:
          <code>npm install</code>, затем <code>npm run dev</code>.
        </p>
      </main>
    );
  }

  if (!draftData) {
    return (
      <main className="app-shell is-loading">
        <p>Загружаю Dota Picker...</p>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <Topbar patch={draftData.patch} />

      <section className="workspace">
        <DraftPanel
          heroes={heroes}
          state={state}
          teamSummary={teamSummary}
          onState={updateState}
        />
        <RecommendationsPanel
          recommendations={recommendations}
          selected={selectedRecommendation}
          onSelect={(heroId) => updateState({ selectedRecommendation: heroId })}
          onReset={resetDraft}
        />
      </section>

      <HeroPool
        heroes={filteredHeroes}
        totalHeroes={heroes.length}
        selectedIds={selectedIds}
        state={state}
        onSearch={(search) => updateState({ search })}
        onAttribute={(attribute) => updateState({ attribute })}
        onBucket={(activeBucket) => updateState({ activeBucket, selectedSlot: null })}
        onHero={assignHero}
      />

      <SettingsPanel
        patch={draftData.patch}
        weights={state.weights}
        onWeight={(key, value) =>
          updateState({
            weights: {
              ...state.weights,
              [key]: value
            }
          })
        }
      />
    </main>
  );
}

function Topbar({ patch }) {
  return (
    <header className="topbar">
      <div>
        <p className="eyebrow">Local draft assistant</p>
        <h1>Dota Picker</h1>
      </div>
      <div className="status-strip">
        <span className="status-pill patch">Patch {patch.version}</span>
      </div>
    </header>
  );
}

function DraftPanel({ heroes, state, teamSummary, onState }) {
  return (
    <section className="draft-panel surface">
      <div className="panel-title-row">
        <div className="title-with-help">
          <div>
            <p className="eyebrow">Draft board</p>
            <h2>Текущий драфт</h2>
          </div>
          
        </div>
        <div className="role-tabs" role="tablist" aria-label="Роль">
          {ROLE_OPTIONS.map(([value, label]) => (
            <button
              key={value}
              className={state.role === value ? "is-active" : ""}
              type="button"
              onClick={() => onState({ role: value })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="draft-columns">
        <TeamColumn
          bucket="ally"
          heroes={heroes}
          heroIds={state.allies}
          selectedSlot={state.selectedSlot}
          title="Союзники"
          onBucket={() => onState({ activeBucket: "ally", selectedSlot: null })}
          onSlot={(index, heroId) => {
            if (heroId) {
              const next = [...state.allies];
              next[index] = null;
              onState({ allies: next, selectedSlot: null, selectedRecommendation: null });
            } else {
              onState({ activeBucket: "ally", selectedSlot: { bucket: "ally", index } });
            }
          }}
        />
        <TeamColumn
          bucket="enemy"
          heroes={heroes}
          heroIds={state.enemies}
          selectedSlot={state.selectedSlot}
          title="Противники"
          onBucket={() => onState({ activeBucket: "enemy", selectedSlot: null })}
          onSlot={(index, heroId) => {
            if (heroId) {
              const next = [...state.enemies];
              next[index] = null;
              onState({ enemies: next, selectedSlot: null, selectedRecommendation: null });
            } else {
              onState({ activeBucket: "enemy", selectedSlot: { bucket: "enemy", index } });
            }
          }}
        />
      </div>

      <BanRow
        bans={state.bans}
        heroes={heroes}
        onRemove={(heroId) =>
          onState({
            bans: state.bans.filter((id) => id !== heroId),
            selectedRecommendation: null
          })
        }
      />
      <TeamSummary summary={teamSummary} />
    </section>
  );
}

function TeamColumn({ bucket, heroes, heroIds, selectedSlot, title, onBucket, onSlot }) {
  return (
    <div className={`team-column ${bucket}`}>
      <div className="team-heading">
        <span>{title}</span>
        <button className="mini-button" type="button" onClick={onBucket}>
          Добавлять сюда
        </button>
      </div>
      <div className="slots">
        {heroIds.map((heroId, index) => {
          const hero = findHero(heroes, heroId);
          const selected = selectedSlot?.bucket === bucket && selectedSlot?.index === index;
          return (
            <button
              className={`draft-slot ${selected ? "is-selected" : ""}`}
              key={`${bucket}-${index}`}
              type="button"
              onClick={() => onSlot(index, heroId)}
            >
              {hero ? <MiniHero hero={hero} /> : <span className="slot-empty">Слот {index + 1}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function BanRow({ bans, heroes, onRemove }) {
  return (
    <div className="ban-row">
      <span className="ban-label">Баны</span>
      {bans.length ? (
        <div className="ban-list">
          {bans.map((heroId) => {
            const hero = findHero(heroes, heroId);
            if (!hero) return null;
            return (
              <button className="ban-chip" key={hero.id} type="button" onClick={() => onRemove(hero.id)}>
                {hero.name}
              </button>
            );
          })}
        </div>
      ) : (
        <span className="empty-note">пока нет</span>
      )}
    </div>
  );
}

function TeamSummary({ summary }) {
  return (
    <div className="team-summary">
      <div>
        <span className="summary-label">Есть</span>
        <p>
          {summary.strengths.length
            ? summary.strengths.map((item) => item.label).join(", ")
            : "нужны первые пики"}
        </p>
      </div>
      <div>
        <span className="summary-label warning">Не хватает</span>
        <p>
          {summary.missing.length
            ? summary.missing.map((item) => item.label).join(", ")
            : "драфт закрывает базовые задачи"}
        </p>
      </div>
    </div>
  );
}

function RecommendationsPanel({ recommendations, selected, onSelect, onReset }) {
  return (
    <section className="recommendations surface">
      <div className="panel-title-row">
        <div className="title-with-help">
          <div>
            <p className="eyebrow">Recommendation engine</p>
            <h2>Лучшие пики</h2>
          </div>
          <HelpTip text="Цветной блок справа — итоговый score от 0 до 100. Зеленый означает сильную рекомендацию, желтый — нормальную, красный — спорную." />
        </div>
        <button className="ghost-button" type="button" onClick={onReset}>
          Сбросить
        </button>
      </div>
      <div className="recommendation-list">
        {recommendations.map((item, index) => (
          <RecommendationItem
            item={item}
            index={index}
            isSelected={selected?.hero.id === item.hero.id}
            key={item.hero.id}
            onSelect={onSelect}
          />
        ))}
      </div>
      {selected ? <RecommendationDetails item={selected} /> : null}
    </section>
  );
}

function RecommendationItem({ item, index, isSelected, onSelect }) {
  return (
    <button
      className={`recommendation-item ${isSelected ? "is-selected" : ""}`}
      type="button"
      onClick={() => onSelect(item.hero.id)}
    >
      <span className="rank">#{index + 1}</span>
      <span className="recommendation-hero">
        <HeroImage hero={item.hero} />
        <span>
          <strong>{item.hero.name}</strong>
          <small>{item.parts.counter.label}</small>
        </span>
      </span>
      <span className={`score-badge ${getScoreClass(item.score)}`} title="Итоговая оценка от 0 до 100">
        <strong>{item.score}</strong>
        <small>score</small>
      </span>
    </button>
  );
}

function RecommendationDetails({ item }) {
  return (
    <article className="details">
      <div className="details-hero">
        <HeroImage hero={item.hero} />
        <div>
          <p className="eyebrow">Selected recommendation</p>
          <h3>{item.hero.name}</h3>
          <p>
            {item.hero.roles.map(getRoleLabel).join(" / ")} · confidence: {item.confidence}
          </p>
        </div>
      </div>
      <ul className="reason-list">
        {item.reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
      <div className="score-breakdown">
        <BreakdownItem label="Мета" part={item.parts.meta} />
        <BreakdownItem label="Матчапы" part={item.parts.counter} />
        <BreakdownItem label="Синергия" part={item.parts.synergy} />
        <BreakdownItem label="Роль" part={item.parts.role} />
        <BreakdownItem label="Драфт" part={item.parts.needs} />
      </div>
    </article>
  );
}

function BreakdownItem({ label, part }) {
  const width = Math.min(Math.abs(part.value) * 3, 100);
  return (
    <div className="breakdown-item">
      <div>
        <strong>{label}</strong>
        <span>{part.label}</span>
      </div>
      <div className={`meter ${part.value < 0 ? "negative" : ""}`}>
        <span style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function HeroPool({
  heroes,
  totalHeroes,
  selectedIds,
  state,
  onSearch,
  onAttribute,
  onBucket,
  onHero
}) {
  return (
    <section className="pool-section surface">
      <div className="pool-toolbar">
        <div className="title-with-help">
          <div>
            <p className="eyebrow">Hero pool</p>
            <h2>Выбор героя</h2>
            <p className="pool-count">Показано {heroes.length} из {totalHeroes}</p>
          </div>
          <HelpTip text="Если героев меньше полного ростера, значит локальный JSON еще seed. Запусти npm run update:data, чтобы собрать список из OpenDota." />
        </div>
        <div className="controls">
          <BucketSwitch value={state.activeBucket} onChange={onBucket} />
          <input
            className="search-input"
            type="search"
            placeholder="Поиск героя"
            value={state.search}
            onChange={(event) => onSearch(event.target.value)}
          />
          <select
            className="select-input"
            value={state.attribute}
            onChange={(event) => onAttribute(event.target.value)}
          >
            {ATTRIBUTE_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="hero-grid">
        {heroes.map((hero) => (
          <HeroCard
            hero={hero}
            isSelected={selectedIds.has(hero.id)}
            key={hero.id}
            onClick={() => onHero(hero.id)}
          />
        ))}
      </div>
    </section>
  );
}

function BucketSwitch({ value, onChange }) {
  return (
    <div className="bucket-switch" aria-label="Куда добавлять героя">
      {BUCKET_OPTIONS.map(([bucket, label]) => (
        <button
          className={value === bucket ? "is-active" : ""}
          key={bucket}
          type="button"
          onClick={() => onChange(bucket)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function HeroCard({ hero, isSelected, onClick }) {
  return (
    <button className={`hero-card ${isSelected ? "is-picked" : ""}`} type="button" onClick={onClick}>
      <span className="hero-portrait">
        <HeroImage hero={hero} />
      </span>
      <span className="hero-card-body">
        <strong>{hero.name}</strong>
        <small>{hero.roles.map(getRoleLabel).join(" / ")}</small>
      </span>
      <span className={`attribute-dot ${hero.attribute}`} title={hero.attribute} />
    </button>
  );
}

function SettingsPanel({ patch, weights, onWeight }) {
  return (
    <section className="settings surface">
      <div className="title-with-help">
        <div>
          <p className="eyebrow">Draft settings</p>
          <h2>Настройки формулы</h2>
        </div>
        <HelpTip text="Эти ползунки меняют вес частей формулы. Например, если поднять Контрпики, сайт сильнее будет искать героев против выбранных врагов." />
      </div>
      <div className="settings-grid">
        {Object.entries(weights).map(([key, value]) => (
          <label className="slider-row" key={key}>
            <span className="slider-label">
              {WEIGHT_LABELS[key]}
              <HelpTip text={WEIGHT_HELP[key]} compact />
            </span>
            <input
              type="range"
              min="0"
              max="60"
              value={value}
              onChange={(event) => onWeight(key, Number(event.target.value))}
            />
            <strong>{value}</strong>
          </label>
        ))}
      </div>
      
    </section>
  );
}

function MiniHero({ hero }) {
  return (
    <span className="mini-hero">
      <HeroImage hero={hero} />
      <span>
        <strong>{hero.name}</strong>
        <small>{hero.roles.map(getRoleLabel).join(" / ")}</small>
      </span>
    </span>
  );
}

function HeroImage({ hero }) {
  return (
    <img
      src={`${HERO_IMAGE_BASE}/${hero.image}.png`}
      alt=""
      loading="lazy"
      onError={(event) => {
        event.currentTarget.style.display = "none";
      }}
    />
  );
}

function HelpTip({ text, compact = false }) {
  return (
    <span className={`help-tip ${compact ? "compact" : ""}`}>
      <button type="button" aria-label="Пояснение">
        ?
      </button>
      <span className="tooltip" role="tooltip">
        {text}
      </span>
    </span>
  );
}

function usePersistentState() {
  const [state, setState] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return {
        ...DEFAULT_STATE,
        ...saved,
        weights: {
          ...DEFAULT_STATE.weights,
          ...(saved?.weights ?? {})
        }
      };
    } catch {
      return DEFAULT_STATE;
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  return [state, setState];
}

function filterHeroes(heroes, search, attribute) {
  const normalizedSearch = search.trim().toLowerCase();

  return heroes.filter((hero) => {
    const matchesSearch = !normalizedSearch || hero.name.toLowerCase().includes(normalizedSearch);
    const matchesAttribute = attribute === "all" || hero.attribute === attribute;
    return matchesSearch && matchesAttribute;
  });
}

function findHero(heroes, heroId) {
  return heroes.find((hero) => hero.id === heroId);
}

function getSelectedIds(state) {
  return new Set([...state.allies, ...state.enemies, ...state.bans].filter(Boolean));
}

function getScoreClass(score) {
  if (score >= 75) return "high";
  if (score >= 58) return "medium";
  return "low";
}
