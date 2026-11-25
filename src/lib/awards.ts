// Ocenenia hracieho večera – vypočítané zo zápisu (góly, zostavy, dochádzka).
// Čistá logika bez závislostí, pokrytá testami v awards.test.ts.

export type AwardKey =
  | "hattrick" | "top_scorer" | "playmaker" | "duo" | "own_goal"
  | "winner" | "unlucky" | "last_minute" | "maybe_came" | "surprise";

export type Award = {
  key: AwardKey;
  title: string;
  /** Ocenení hráči (pri rovnosti viacerí). Pri „Duo“ je poradie nahrávač → strelec. */
  playerIds: string[];
  /** Krátke vysvetlenie, napr. „4 góly“. */
  detail: string;
};

export type AwardInput = {
  games: { id: string; seq: number; scoreA: number; scoreB: number }[];
  lineup: { gameId: string; playerId: string; team: "A" | "B" }[];
  goals: { gameId: string; team: "A" | "B"; scorerId: string; assistId: string | null; isOwnGoal: boolean }[];
  /** Odpovede na termín (prídem / možno / neprídem) s časom poslednej zmeny. */
  attendance: { playerId: string; status: "yes" | "no" | "maybe"; updatedAt: string }[];
};

function plural(n: number, one: string, few: string, many: string) {
  return n === 1 ? `${n} ${one}` : n >= 2 && n <= 4 ? `${n} ${few}` : `${n} ${many}`;
}

/** Hráči s najvyššou hodnotou (aspoň min). Pri rovnosti všetci. */
function leaders(counts: Map<string, number>, min: number): { ids: string[]; value: number } | null {
  let best = 0;
  for (const v of counts.values()) best = Math.max(best, v);
  if (best < min) return null;
  return { ids: [...counts.entries()].filter(([, v]) => v === best).map(([id]) => id), value: best };
}

const inc = (map: Map<string, number>, key: string, by = 1) => map.set(key, (map.get(key) ?? 0) + by);

export function computeAwards(input: AwardInput): Award[] {
  const { games, lineup, goals, attendance } = input;
  if (games.length === 0) return [];
  const awards: Award[] = [];
  const played = new Set(lineup.map((l) => l.playerId));
  const multi = games.length > 1;

  // 🔥 Hetrik – 3+ góly v jednom zápase
  const hattricks = new Map<string, number>();
  for (const g of games) {
    const perGame = new Map<string, number>();
    for (const goal of goals) if (goal.gameId === g.id && !goal.isOwnGoal) inc(perGame, goal.scorerId);
    for (const [pid, n] of perGame) if (n >= 3) hattricks.set(pid, Math.max(hattricks.get(pid) ?? 0, n));
  }
  if (hattricks.size > 0) {
    const max = Math.max(...hattricks.values());
    awards.push({ key: "hattrick", title: "Hetrik", playerIds: [...hattricks.keys()], detail: max > 3 ? `${max} góly v jednom zápase` : "3 góly v jednom zápase" });
  }

  // 🎯 Kanonier večera – najviac gólov (aspoň 2)
  const scored = new Map<string, number>();
  for (const goal of goals) if (!goal.isOwnGoal) inc(scored, goal.scorerId);
  const top = leaders(scored, 2);
  if (top) awards.push({ key: "top_scorer", title: "Kanonier večera", playerIds: top.ids, detail: plural(top.value, "gól", "góly", "gólov") });

  // 🤝 Nahrávač – najviac asistencií (aspoň 2)
  const assisted = new Map<string, number>();
  for (const goal of goals) if (goal.assistId) inc(assisted, goal.assistId);
  const pm = leaders(assisted, 2);
  if (pm) awards.push({ key: "playmaker", title: "Nahrávač", playerIds: pm.ids, detail: plural(pm.value, "asistencia", "asistencie", "asistencií") });

  // 👯 Duo večera – rovnaká dvojica nahrávka → gól aspoň 2×
  const pairs = new Map<string, number>();
  for (const goal of goals) if (goal.assistId && !goal.isOwnGoal) inc(pairs, `${goal.assistId}>${goal.scorerId}`);
  const duo = leaders(pairs, 2);
  if (duo) {
    const [assist, scorer] = duo.ids[0].split(">");
    awards.push({ key: "duo", title: "Duo večera", playerIds: [assist, scorer], detail: `nahrávka → gól ${duo.value}×` });
  }

  // 🪵 Drevená noha – vlastný gól
  const own = new Map<string, number>();
  for (const goal of goals) if (goal.isOwnGoal) inc(own, goal.scorerId);
  if (own.size > 0) {
    const n = Math.max(...own.values());
    awards.push({ key: "own_goal", title: "Drevená noha", playerIds: [...own.keys()], detail: n > 1 ? `${n} vlastné góly` : "vlastný gól" });
  }

  // 🏆 Víťaz večera / 🌧️ Smoliar – len pri viacerých zápasoch
  if (multi) {
    const wins = new Map<string, number>();
    const losses = new Map<string, number>();
    const appearances = new Map<string, number>();
    for (const l of lineup) {
      const g = games.find((x) => x.id === l.gameId);
      if (!g) continue;
      inc(appearances, l.playerId);
      const own = l.team === "A" ? g.scoreA : g.scoreB;
      const other = l.team === "A" ? g.scoreB : g.scoreA;
      if (own > other) inc(wins, l.playerId);
      else if (own < other) inc(losses, l.playerId);
    }
    const w = leaders(wins, 2);
    if (w) awards.push({ key: "winner", title: "Víťaz večera", playerIds: w.ids, detail: plural(w.value, "výhra", "výhry", "výhier") });

    const allLost = [...losses.entries()].filter(([pid, n]) => n >= 2 && n === appearances.get(pid)).map(([pid]) => pid);
    if (allLost.length > 0) {
      const n = losses.get(allLost[0]) ?? 0;
      awards.push({ key: "unlucky", title: "Smoliar", playerIds: allLost, detail: `prehral všetky ${n} zápasy` });
    }
  }

  // ⏰ Na poslednú chvíľu – kto z hrajúcich potvrdil „Prídem“ ako posledný (ak potvrdili aspoň 4)
  const confirmed = attendance.filter((a) => a.status === "yes" && played.has(a.playerId));
  if (confirmed.length >= 4) {
    const last = confirmed.reduce((x, y) => (Date.parse(y.updatedAt) > Date.parse(x.updatedAt) ? y : x));
    awards.push({ key: "last_minute", title: "Na poslednú chvíľu", playerIds: [last.playerId], detail: "potvrdil účasť ako posledný" });
  }

  // 🤷 Večné možno – napísal „Možno“ (alebo „Neprídem“), ale prišiel
  const maybe = attendance.filter((a) => (a.status === "maybe" || a.status === "no") && played.has(a.playerId)).map((a) => a.playerId);
  if (maybe.length > 0) awards.push({ key: "maybe_came", title: "Večné možno", playerIds: maybe, detail: "nepotvrdil, ale prišiel" });

  // ✨ Prekvapenie – prišiel bez akejkoľvek odpovede (len ak sa vôbec niekto prihlasoval)
  if (attendance.length > 0) {
    const answered = new Set(attendance.map((a) => a.playerId));
    const surprise = [...played].filter((pid) => !answered.has(pid));
    if (surprise.length > 0) awards.push({ key: "surprise", title: "Prekvapenie", playerIds: surprise, detail: "prišiel bez ohlásenia" });
  }

  return awards;
}
