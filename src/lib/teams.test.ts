// Spustenie:  npm test   (Node má vstavaný test runner aj podporu TypeScriptu)
import assert from "node:assert/strict";
import { test } from "node:test";
import { balanceTeams, randomTeams, splitCost, teamSkill, type TeamPlayer } from "./teams.ts";

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const mk = (skills: number[], positions: (TeamPlayer["position"])[] = []): TeamPlayer[] =>
  skills.map((skill, i) => ({ id: `p${i}`, skill, position: positions[i] ?? null }));

const pick = (players: TeamPlayer[], ids: string[]) => ids.map((id) => players.find((p) => p.id === id)!);

test("rozdelí 10 hráčov na 5 + 5 s minimálnym rozdielom hodnotení", () => {
  const players = mk([5, 5, 4, 4, 3, 3, 2, 2, 1, 1]);
  const { a, b } = balanceTeams(players, {}, seeded(1));
  assert.equal(a.length, 5);
  assert.equal(b.length, 5);
  assert.equal(teamSkill(pick(players, a)), teamSkill(pick(players, b)));
  assert.equal(new Set([...a, ...b]).size, 10, "každý hráč je práve v jednom tíme");
});

test("pri nepárnom počte je rozdiel veľkosti tímov 1", () => {
  const players = mk([5, 4, 4, 3, 3, 2, 1]);
  const { a, b } = balanceTeams(players, {}, seeded(2));
  assert.equal(Math.abs(a.length - b.length), 1);
  assert.ok(Math.abs(teamSkill(pick(players, a)) - teamSkill(pick(players, b))) <= 1);
});

test("rešpektuje uzamknutých hráčov", () => {
  const players = mk([5, 5, 1, 1, 3, 3]);
  for (let seed = 0; seed < 20; seed++) {
    const { a, b } = balanceTeams(players, { p0: "A", p1: "A", p2: "B" }, seeded(seed));
    assert.ok(a.includes("p0") && a.includes("p1"), "p0 a p1 ostávajú v A");
    assert.ok(b.includes("p2"), "p2 ostáva v B");
    assert.equal(a.length, 3);
  }
});

test("rozloží brankárov do oboch tímov, ak to neškodí vyrovnanosti", () => {
  const players = mk([3, 3, 3, 3, 3, 3], ["GK", "GK", "DEF", "DEF", "ATT", "ATT"]);
  const { a, b } = balanceTeams(players, {}, seeded(3));
  assert.equal(pick(players, a).filter((p) => p.position === "GK").length, 1);
  assert.equal(pick(players, b).filter((p) => p.position === "GK").length, 1);
  assert.equal(splitCost(pick(players, a), pick(players, b)), 0);
});

test("opakované volanie ponúka rôzne rovnako dobré varianty", () => {
  const players = mk([3, 3, 3, 3, 3, 3, 3, 3]);
  const seen = new Set<string>();
  for (let seed = 0; seed < 30; seed++) seen.add([...balanceTeams(players, {}, seeded(seed)).a].sort().join(","));
  assert.ok(seen.size > 3);
});

test("zvládne aj veľkú skupinu (heuristika nad 20 voľných hráčov)", () => {
  const players = mk(Array.from({ length: 26 }, (_, i) => (i % 5) + 1));
  const { a, b } = balanceTeams(players, {}, seeded(4));
  assert.equal(a.length, 13);
  assert.equal(b.length, 13);
  assert.ok(Math.abs(teamSkill(pick(players, a)) - teamSkill(pick(players, b))) <= 1);
});

test("okrajové prípady: 0, 1 a 2 hráči", () => {
  assert.deepEqual(balanceTeams([]), { a: [], b: [] });
  const one = balanceTeams(mk([3]), {}, seeded(5));
  assert.equal(one.a.length + one.b.length, 1);
  const two = balanceTeams(mk([5, 1]), {}, seeded(6));
  assert.equal(two.a.length, 1);
  assert.equal(two.b.length, 1);
});

test("náhodné rozdelenie drží veľkosti a zámky", () => {
  const players = mk([5, 4, 3, 2, 1, 1, 2]);
  for (let seed = 0; seed < 20; seed++) {
    const { a, b } = randomTeams(players, { p6: "B" }, seeded(seed));
    assert.ok(b.includes("p6"));
    assert.equal(Math.abs(a.length - b.length), 1);
    assert.equal(new Set([...a, ...b]).size, 7);
  }
});
