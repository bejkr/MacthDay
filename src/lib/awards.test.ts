// Spustenie: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { computeAwards, type AwardInput } from "./awards.ts";

const g1 = { id: "g1", seq: 1, scoreA: 4, scoreB: 1 };
const g2 = { id: "g2", seq: 2, scoreA: 0, scoreB: 2 };
const lineup = (gameId: string, a: string[], b: string[]) => [
  ...a.map((playerId) => ({ gameId, playerId, team: "A" as const })),
  ...b.map((playerId) => ({ gameId, playerId, team: "B" as const })),
];
const goal = (gameId: string, team: "A" | "B", scorerId: string, assistId: string | null = null, isOwnGoal = false) => ({ gameId, team, scorerId, assistId, isOwnGoal });

const base: AwardInput = {
  games: [g1, g2],
  lineup: [...lineup("g1", ["jano", "fero"], ["peto", "kubo"]), ...lineup("g2", ["jano", "peto"], ["fero", "kubo"])],
  goals: [
    goal("g1", "A", "jano", "fero"),
    goal("g1", "A", "jano", "fero"),
    goal("g1", "A", "jano"),
    goal("g1", "B", "fero", null, true), // vlastný gól Fera v prospech B
    goal("g2", "B", "kubo", "fero"),
    goal("g2", "B", "fero"),
  ],
  attendance: [
    { playerId: "jano", status: "yes", updatedAt: "2026-11-20T10:00:00Z" },
    { playerId: "fero", status: "yes", updatedAt: "2026-11-21T10:00:00Z" },
    { playerId: "peto", status: "maybe", updatedAt: "2026-11-21T12:00:00Z" },
    { playerId: "mato", status: "yes", updatedAt: "2026-11-22T10:00:00Z" }, // nakoniec nehral
  ],
};

const byKey = (input: AwardInput) => Object.fromEntries(computeAwards(input).map((a) => [a.key, a]));

test("hetrik, kanonier, nahrávač, duo a vlastný gól", () => {
  const a = byKey(base);
  assert.deepEqual(a.hattrick.playerIds, ["jano"]);
  assert.deepEqual(a.top_scorer.playerIds, ["jano"]);
  assert.equal(a.top_scorer.detail, "3 góly");
  assert.deepEqual(a.playmaker.playerIds, ["fero"]);
  assert.equal(a.playmaker.detail, "3 asistencie");
  assert.deepEqual(a.duo.playerIds, ["fero", "jano"]);
  assert.deepEqual(a.own_goal.playerIds, ["fero"]);
});

test("víťaz a smoliar sa udeľujú len pri viacerých zápasoch", () => {
  const a = byKey(base);
  // Kubo: g1 prehra, g2 výhra; Fero: g1 výhra, g2 výhra; Jano: výhra, prehra; Peťo: prehra, prehra
  assert.deepEqual(a.winner.playerIds, ["fero"]);
  assert.deepEqual(a.unlucky.playerIds, ["peto"]);
  const single = byKey({ ...base, games: [g1], lineup: base.lineup.filter((l) => l.gameId === "g1"), goals: base.goals.filter((x) => x.gameId === "g1") });
  assert.equal(single.winner, undefined);
  assert.equal(single.unlucky, undefined);
});

test("dochádzka: večné možno a prekvapenie, poslednú chvíľu len pri 4+ potvrdených", () => {
  const a = byKey(base);
  assert.deepEqual(a.maybe_came.playerIds, ["peto"]);
  assert.deepEqual(a.surprise.playerIds, ["kubo"]); // hral, ale neodpovedal
  assert.equal(a.last_minute, undefined); // potvrdili len 2 z hrajúcich
  const many = byKey({
    ...base,
    attendance: ["jano", "fero", "peto", "kubo"].map((playerId, i) => ({ playerId, status: "yes" as const, updatedAt: `2026-11-2${i}T10:00:00Z` })),
  });
  assert.deepEqual(many.last_minute.playerIds, ["kubo"]);
});

test("pri rovnosti dostanú ocenenie všetci, pod hranicou nikto", () => {
  const tie = byKey({
    games: [g1],
    lineup: lineup("g1", ["a", "b"], ["c"]),
    goals: [goal("g1", "A", "a"), goal("g1", "A", "a"), goal("g1", "A", "b"), goal("g1", "A", "b")],
    attendance: [],
  });
  assert.deepEqual(tie.top_scorer.playerIds.sort(), ["a", "b"]);
  const quiet = computeAwards({ games: [g1], lineup: lineup("g1", ["a"], ["b"]), goals: [goal("g1", "A", "a")], attendance: [] });
  assert.equal(quiet.length, 0);
  assert.deepEqual(computeAwards({ games: [], lineup: [], goals: [], attendance: [] }), []);
});
