// Rozdeľovanie hráčov do dvoch vyrovnaných tímov. Čistá logika bez závislostí –
// beží v prehliadači (okamžitá odozva) a je pokrytá testami v teams.test.ts.

export type Side = "A" | "B";
export type Position = "GK" | "DEF" | "MID" | "ATT";
export type TeamPlayer = { id: string; skill: number; position: Position | null };
export type Locks = Record<string, Side | undefined>;
export type Split = { a: string[]; b: string[] };

const POSITIONS: Position[] = ["GK", "DEF", "MID", "ATT"];
// Brankár na jednej strane a žiadny na druhej bolí viac než nerovnováha v poli.
const POSITION_WEIGHT: Record<Position, number> = { GK: 6, DEF: 2, MID: 2, ATT: 2 };
const SKILL_WEIGHT = 10;
const EXHAUSTIVE_LIMIT = 20;

export const teamSkill = (team: TeamPlayer[]) => team.reduce((sum, p) => sum + p.skill, 0);

/** Čím nižšie, tým vyrovnanejšie. Hlavné kritérium je rozdiel súčtu hodnotení. */
export function splitCost(a: TeamPlayer[], b: TeamPlayer[]) {
  let cost = Math.abs(teamSkill(a) - teamSkill(b)) * SKILL_WEIGHT;
  for (const pos of POSITIONS) {
    const diff = a.filter((p) => p.position === pos).length - b.filter((p) => p.position === pos).length;
    cost += Math.abs(diff) * POSITION_WEIGHT[pos];
  }
  return cost;
}

function shuffle<T>(items: T[], rng: () => number) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function partition(players: TeamPlayer[], locks: Locks) {
  const lockedA = players.filter((p) => locks[p.id] === "A");
  const lockedB = players.filter((p) => locks[p.id] === "B");
  const free = players.filter((p) => !locks[p.id]);
  return { lockedA, lockedB, free };
}

/** Koľko voľných hráčov má ísť do tímu A, aby boli tímy čo najrovnejšie veľké. */
function targetsForA(total: number, lockedA: number, lockedB: number, free: number) {
  const sizes = total % 2 === 0 ? [total / 2] : [Math.floor(total / 2), Math.ceil(total / 2)];
  const targets = new Set<number>();
  for (const size of sizes) {
    // Ak je uzamknutých priveľa na jednej strane, vyrovnáme aspoň ako sa dá.
    targets.add(Math.min(free, Math.max(0, size - lockedA)));
  }
  void lockedB;
  return [...targets];
}

function* combinations(n: number, k: number): Generator<number[]> {
  if (k < 0 || k > n) return;
  const idx = Array.from({ length: k }, (_, i) => i);
  while (true) {
    yield idx;
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i--;
    if (i < 0) return;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
}

const toSplit = (a: TeamPlayer[], b: TeamPlayer[]): Split => ({ a: a.map((p) => p.id), b: b.map((p) => p.id) });

/**
 * Vyrovnané tímy: minimalizuje rozdiel súčtu hodnotení, drží rovnaký počet hráčov
 * (pri nepárnom počte rozdiel 1), rešpektuje uzamknutých hráčov a snaží sa
 * rozložiť pozície. Pri viacerých rovnako dobrých riešeniach vyberie náhodné,
 * takže opakované kliknutie ponúkne inú variantu.
 */
export function balanceTeams(players: TeamPlayer[], locks: Locks = {}, rng: () => number = Math.random): Split {
  const { lockedA, lockedB, free: freeOrdered } = partition(players, locks);
  const free = shuffle(freeOrdered, rng);
  const targets = targetsForA(players.length, lockedA.length, lockedB.length, free.length);

  if (free.length <= EXHAUSTIVE_LIMIT) {
    let best = Infinity;
    let bestCount = 0;
    let chosen: Split | null = null;
    for (const k of targets) {
      for (const combo of combinations(free.length, k)) {
        const inA = new Set(combo);
        const a = [...lockedA, ...free.filter((_, i) => inA.has(i))];
        const b = [...lockedB, ...free.filter((_, i) => !inA.has(i))];
        const cost = splitCost(a, b);
        if (cost < best) {
          best = cost;
          bestCount = 1;
          chosen = toSplit(a, b);
        } else if (cost === best) {
          bestCount++;
          if (rng() < 1 / bestCount) chosen = toSplit(a, b); // reservoir sampling
        }
      }
    }
    if (chosen) return chosen;
  }

  // Väčšie skupiny: hadie rozdelenie podľa hodnotenia + vylepšovanie výmenami.
  const sorted = [...free].sort((x, y) => y.skill - x.skill);
  const a = [...lockedA];
  const b = [...lockedB];
  const sizeA = lockedA.length + targets[0];
  for (const p of sorted) {
    const aFull = a.length >= sizeA;
    const bFull = b.length >= players.length - sizeA;
    if (aFull) b.push(p);
    else if (bFull) a.push(p);
    else if (teamSkill(a) <= teamSkill(b)) a.push(p);
    else b.push(p);
  }
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < a.length && !improved; i++) {
      if (locks[a[i].id]) continue;
      for (let j = 0; j < b.length; j++) {
        if (locks[b[j].id]) continue;
        const before = splitCost(a, b);
        [a[i], b[j]] = [b[j], a[i]];
        if (splitCost(a, b) < before) {
          improved = true;
          break;
        }
        [a[i], b[j]] = [b[j], a[i]];
      }
    }
  }
  return toSplit(a, b);
}

/** Čisto náhodné rozdelenie s rovnakým počtom hráčov; uzamknutí ostávajú na mieste. */
export function randomTeams(players: TeamPlayer[], locks: Locks = {}, rng: () => number = Math.random): Split {
  const { lockedA, lockedB, free } = partition(players, locks);
  const shuffled = shuffle(free, rng);
  const targets = targetsForA(players.length, lockedA.length, lockedB.length, free.length);
  const k = targets[Math.floor(rng() * targets.length)];
  return toSplit([...lockedA, ...shuffled.slice(0, k)], [...lockedB, ...shuffled.slice(k)]);
}
