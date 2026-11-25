"use client";

import { Plus, Shuffle, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { saveResultAction } from "@/lib/actions/matches";
import type { PlayerLite } from "@/lib/data";
import { cn } from "@/lib/format";
import { balanceTeams } from "@/lib/teams";
import { PlayerAvatar } from "./player-avatar";
import { Button } from "./ui/button";
import { Card, CardHeader } from "./ui/card";
import { Field, Input, Segmented, Select, Stepper, Textarea } from "./ui/form";
import { useToast } from "./ui/toast";
import { useAction } from "./use-action";

type Side = "A" | "B";
type Slot = Side | "none";
type GoalDraft = { key: number; team: Side; scorerId: string; assistId: string; isOwnGoal: boolean };
type GameDraft = { key: number; scoreA: number; scoreB: number; lineup: Record<string, Side>; goals: GoalDraft[] };

export type ResultGameInitial = {
  scoreA: number;
  scoreB: number;
  lineup: Record<string, Side>;
  goals: { team: Side; scorerId: string; assistId: string; isOwnGoal: boolean }[];
};

export type ResultInitial = {
  startsAt: string;
  seasonId: string;
  location: string;
  kind: "internal" | "external";
  teamAName: string;
  teamBName: string;
  resultNote: string;
  mvpMode: "vote" | "manual" | "none";
  mvpPlayerId: string | null;
  games: ResultGameInitial[];
};

type Props = {
  matchId: string | null;
  initial: ResultInitial;
  players: PlayerLite[];
  seasons: { id: string; name: string }[];
  voteHours: number;
  /** Hlasovanie už beží alebo skončilo – zmena režimu by zahodila hlasy. */
  votingStarted: boolean;
};

/**
 * Zápis výsledku hracieho večera. Večer má jeden alebo viac zápasov; každý má
 * vlastnú zostavu (tímy sa medzi zápasmi miešajú), skóre a góly. MVP je za celý večer.
 */
export function ResultForm({ matchId, initial, players, seasons, voteHours, votingStarted }: Props) {
  const router = useRouter();
  const toast = useToast();
  // Kľúče pre React: počiatočné sa očíslujú priamo, nové pokračujú od 100 000.
  const nextKey = useRef(100_000);
  const key = () => nextKey.current++;

  const [v, setV] = useState(() => {
    const { games: _games, ...rest } = initial;
    void _games;
    return rest;
  });
  const [games, setGames] = useState<GameDraft[]>(() => {
    let n = 1;
    return initial.games.map((g) => ({ ...g, key: n++, goals: g.goals.map((goal) => ({ ...goal, key: n++ })) }));
  });
  const [active, setActive] = useState(0);
  const set = <K extends keyof typeof v>(k: K, value: (typeof v)[K]) => setV((prev) => ({ ...prev, [k]: value }));

  const external = v.kind === "external";
  const game = games[active];
  const byId = new Map(players.map((p) => [p.id, p]));
  const inTeam = (g: GameDraft, s: Side) => players.filter((p) => g.lineup[p.id] === s);
  const eveningPlayers = players.filter((p) => games.some((g) => g.lineup[p.id]));

  const { run, pending } = useAction(saveResultAction, {
    success: games.length > 1 ? "Večer uložený, štatistiky sú prepočítané." : "Výsledok uložený, štatistiky sú prepočítané.",
    onSuccess: (data) => router.replace(`/zapasy/${data.id}`),
  });

  // ── úpravy aktívneho zápasu ──
  const updateGame = (patch: (g: GameDraft) => GameDraft) =>
    setGames((list) => list.map((g, i) => (i === active ? patch(g) : g)));

  function setSlot(playerId: string, slot: Slot) {
    updateGame((g) => {
      const lineup = { ...g.lineup };
      if (slot === "none") delete lineup[playerId];
      else lineup[playerId] = slot;
      // góly, ktoré po zmene zostavy nedávajú zmysel, preč
      const goals =
        slot === "none" || g.lineup[playerId] !== slot
          ? g.goals.filter((x) => x.scorerId !== playerId).map((x) => (x.assistId === playerId ? { ...x, assistId: "" } : x))
          : g.goals;
      return { ...g, lineup, goals };
    });
    if (slot === "none" && v.mvpPlayerId === playerId && !games.some((g, i) => i !== active && g.lineup[playerId])) {
      set("mvpPlayerId", null);
    }
  }

  function setKind(kind: "internal" | "external") {
    set("kind", kind);
    if (kind === "external") {
      // Proti súperovi hrajú všetci naši za jeden tím.
      setGames((list) =>
        list.map((g) => ({
          ...g,
          lineup: Object.fromEntries(Object.keys(g.lineup).map((id) => [id, "A" as Side])),
          goals: g.goals.filter((x) => x.team === "A" && !x.isOwnGoal),
        })),
      );
    }
  }

  function addGoal(team: Side) {
    updateGame((g) => {
      const count = g.goals.filter((x) => x.team === team).length + 1;
      return {
        ...g,
        goals: [...g.goals, { key: key(), team, scorerId: "", assistId: "", isOwnGoal: false }],
        // skóre nikdy nesmie byť nižšie ako počet zapísaných gólov
        scoreA: team === "A" ? Math.max(g.scoreA, count) : g.scoreA,
        scoreB: team === "B" ? Math.max(g.scoreB, count) : g.scoreB,
      };
    });
  }
  const updateGoal = (k: number, patch: Partial<GoalDraft>) =>
    updateGame((g) => ({ ...g, goals: g.goals.map((x) => (x.key === k ? { ...x, ...patch } : x)) }));
  const removeGoal = (k: number) => updateGame((g) => ({ ...g, goals: g.goals.filter((x) => x.key !== k) }));

  // ── zápasy večera ──
  function addGame() {
    const from = games[active] ?? games[games.length - 1];
    setGames((list) => [...list, { key: key(), scoreA: 0, scoreB: 0, lineup: { ...(from?.lineup ?? {}) }, goals: [] }]);
    setActive(games.length);
  }

  function removeGame(index: number) {
    if (games.length <= 1) return;
    if (!window.confirm(`Odstrániť zápas ${index + 1} aj s gólmi?`)) return;
    setGames((list) => list.filter((_, i) => i !== index));
    setActive((a) => Math.max(0, a >= index ? a - 1 : a));
  }

  /** Premieša hráčov aktívneho zápasu do dvoch vyrovnaných tímov (podľa hodnotení, s náhodou). */
  function shuffleTeams() {
    const ids = Object.keys(game.lineup);
    if (ids.length < 2) {
      toast.error("Na premiešanie treba aspoň dvoch hráčov v zostave.");
      return;
    }
    if (game.goals.length > 0 && !window.confirm("Premiešanie zmaže góly zapísané v tomto zápase. Pokračovať?")) return;
    const split = balanceTeams(
      ids.map((id) => byId.get(id)).filter((p): p is PlayerLite => !!p).map((p) => ({ id: p.id, skill: p.skill, position: p.position })),
    );
    updateGame((g) => ({
      ...g,
      goals: [],
      lineup: Object.fromEntries([...split.a.map((id) => [id, "A" as Side]), ...split.b.map((id) => [id, "B" as Side])]),
    }));
  }

  function submit() {
    const bad = games.findIndex((g) => g.goals.some((x) => !x.scorerId));
    if (bad >= 0) {
      setActive(bad);
      toast.error(`V zápase ${bad + 1} vyber pri každom góle strelca alebo gól odstráň.`);
      return;
    }
    const empty = games.findIndex((g) => Object.keys(g.lineup).length === 0);
    if (empty >= 0) {
      setActive(empty);
      toast.error(`Zápas ${empty + 1} nemá nikoho v zostave.`);
      return;
    }
    run({
      matchId,
      startsAt: v.startsAt || null,
      seasonId: v.seasonId || null,
      location: v.location,
      kind: v.kind,
      teamAName: v.teamAName,
      teamBName: v.teamBName,
      resultNote: v.resultNote,
      mvpMode: v.mvpMode,
      mvpPlayerId: v.mvpMode === "manual" ? v.mvpPlayerId : null,
      games: games.map((g) => ({
        scoreA: g.scoreA,
        scoreB: g.scoreB,
        lineup: Object.entries(g.lineup).map(([playerId, team]) => ({ playerId, team })),
        goals: g.goals.map((x) => ({ team: x.team, scorerId: x.scorerId, assistId: x.assistId || null, isOwnGoal: x.isOwnGoal })),
      })),
    });
  }

  const goalsA = game.goals.filter((x) => x.team === "A").length;
  const goalsB = game.goals.filter((x) => x.team === "B").length;
  const lineupCount = Object.keys(game.lineup).length;

  return (
    <form
      className="flex flex-col gap-4 pb-24"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {/* Večer */}
      <Card className="flex flex-col gap-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Dátum a čas">
            {(id) => <Input id={id} type="datetime-local" value={v.startsAt} onChange={(e) => set("startsAt", e.target.value)} required />}
          </Field>
          <Field label="Sezóna">
            {(id) => (
              <Select id={id} value={v.seasonId} onChange={(e) => set("seasonId", e.target.value)}>
                {seasons.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Field label="Miesto">
          {(id) => <Input id={id} value={v.location} onChange={(e) => set("location", e.target.value)} maxLength={120} />}
        </Field>
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink">Typ</span>
          <Segmented
            label="Typ"
            value={v.kind}
            onChange={setKind}
            options={[
              { value: "internal", label: "Medzi sebou" },
              { value: "external", label: "Proti súperovi" },
            ]}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={external ? "Náš tím" : "Tím A"} hint={external ? undefined : "napr. Biele"}>
            {(id) => <Input id={id} value={v.teamAName} onChange={(e) => set("teamAName", e.target.value)} maxLength={30} required />}
          </Field>
          <Field label={external ? "Súper" : "Tím B"} hint={external ? undefined : "napr. Farebné"}>
            {(id) => <Input id={id} value={v.teamBName} onChange={(e) => set("teamBName", e.target.value)} maxLength={30} required />}
          </Field>
        </div>
      </Card>

      {/* Zápasy večera */}
      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="eyebrow">Zápasy večera</h2>
          <span className="text-xs text-muted">{games.length === 1 ? "1 zápas" : `${games.length} zápasy`}</span>
        </div>
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="tablist" aria-label="Zápasy večera">
          {games.map((g, i) => (
            <button
              key={g.key}
              type="button"
              role="tab"
              aria-selected={i === active}
              onClick={() => setActive(i)}
              className={cn(
                "flex h-11 shrink-0 items-center gap-2 rounded-xl border px-3 text-sm font-semibold transition-colors",
                i === active ? "border-primary bg-primary/10 text-ink" : "border-line bg-surface text-muted hover:text-ink",
              )}
            >
              Zápas {i + 1}
              <span className={cn("num text-base", i === active ? "text-primary" : "text-ink")}>
                {g.scoreA}:{g.scoreB}
              </span>
            </button>
          ))}
          <button
            type="button"
            onClick={addGame}
            disabled={games.length >= 30}
            className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl border border-dashed border-line-strong px-3 text-sm font-semibold text-primary disabled:opacity-40"
          >
            <Plus className="size-4" aria-hidden />
            Ďalší zápas
          </button>
        </div>
        {games.length > 1 || active > 0 ? (
          <p className="mt-1.5 text-xs text-muted">Nový zápas prevezme zostavu z práve otvoreného – uprav ju alebo tímy premiešaj.</p>
        ) : null}
      </div>

      {/* Zostava aktívneho zápasu */}
      <Card>
        <CardHeader
          title={external ? `Zápas ${active + 1} · kto hral` : `Zápas ${active + 1} · tímy`}
          action={
            <div className="flex items-center gap-1">
              {!external ? (
                <Button variant="ghost" size="sm" onClick={shuffleTeams} icon={<Shuffle className="size-4" />}>
                  Premiešať
                </Button>
              ) : null}
              {games.length > 1 ? (
                <button
                  type="button"
                  onClick={() => removeGame(active)}
                  className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-elevated hover:text-danger"
                  aria-label={`Odstrániť zápas ${active + 1}`}
                >
                  <Trash2 className="size-4" />
                </button>
              ) : null}
            </div>
          }
        />
        <p className="px-4 pt-1 text-xs text-muted">{lineupCount} v zostave</p>
        <ul className="flex flex-col gap-2.5 p-4 pt-3">
          {players.map((p) => (
            <li key={p.id} className="flex items-center gap-2.5">
              <PlayerAvatar nickname={p.nickname} avatarUrl={p.avatarUrl} color={p.avatarColor} size="sm" dimmed={!game.lineup[p.id]} />
              <span className={cn("min-w-0 flex-1 truncate text-sm font-medium", game.lineup[p.id] ? "text-ink" : "text-muted")}>{p.nickname}</span>
              <Segmented<Slot>
                className="w-40 shrink-0"
                label={`Tím hráča ${p.nickname} v zápase ${active + 1}`}
                value={game.lineup[p.id] ?? "none"}
                onChange={(slot) => setSlot(p.id, slot)}
                options={
                  external
                    ? [{ value: "A", label: "Hral" }, { value: "none", label: "Nehral" }]
                    : [{ value: "A", label: "A" }, { value: "B", label: "B" }, { value: "none", label: "–" }]
                }
              />
            </li>
          ))}
        </ul>
      </Card>

      {/* Skóre aktívneho zápasu */}
      <Card className="p-4">
        <h2 className="eyebrow mb-4">Zápas {active + 1} · výsledok</h2>
        <div className="flex items-start justify-around gap-2">
          <div className="flex min-w-0 flex-col items-center gap-3">
            <span className="max-w-full truncate text-sm font-semibold text-ink">{v.teamAName || "Tím A"}</span>
            <Stepper label={`Skóre ${v.teamAName}`} size="lg" value={game.scoreA} min={goalsA} onChange={(n) => updateGame((g) => ({ ...g, scoreA: n }))} />
          </div>
          <span className="num mt-9 text-5xl text-muted/40" aria-hidden>:</span>
          <div className="flex min-w-0 flex-col items-center gap-3">
            <span className="max-w-full truncate text-sm font-semibold text-ink">{v.teamBName || "Tím B"}</span>
            <Stepper label={`Skóre ${v.teamBName}`} size="lg" value={game.scoreB} min={goalsB} onChange={(n) => updateGame((g) => ({ ...g, scoreB: n }))} />
          </div>
        </div>
      </Card>

      {/* Góly aktívneho zápasu */}
      <Card>
        <CardHeader title={`Zápas ${active + 1} · strelci a asistencie`} />
        <div className="flex flex-col gap-3 p-4">
          {game.goals.length === 0 ? <p className="text-sm text-muted">Pridaj góly, aby sa hráčom započítali do štatistík.</p> : null}
          {game.goals.map((g, index) => {
            const scoringTeam = g.isOwnGoal ? (g.team === "A" ? "B" : "A") : g.team;
            const scorers = inTeam(game, scoringTeam);
            const assistants = inTeam(game, g.team).filter((p) => p.id !== g.scorerId);
            return (
              <div key={g.key} className="rounded-2xl border border-line bg-bg/50 p-3">
                <div className="mb-2.5 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-muted">
                    Gól {index + 1} · <span className="text-primary">{g.team === "A" ? v.teamAName : v.teamBName}</span>
                  </span>
                  <button type="button" onClick={() => removeGoal(g.key)} className="-m-1 flex size-8 items-center justify-center rounded-lg text-muted hover:bg-elevated hover:text-danger" aria-label={`Odstrániť gól ${index + 1}`}>
                    <X className="size-4" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Select aria-label="Strelec" value={g.scorerId} onChange={(e) => updateGoal(g.key, { scorerId: e.target.value, assistId: g.assistId === e.target.value ? "" : g.assistId })}>
                    <option value="">Strelec…</option>
                    {scorers.map((p) => (
                      <option key={p.id} value={p.id}>{p.nickname}</option>
                    ))}
                  </Select>
                  <Select aria-label="Asistent" value={g.assistId} disabled={g.isOwnGoal} onChange={(e) => updateGoal(g.key, { assistId: e.target.value })}>
                    <option value="">{g.isOwnGoal ? "–" : "Bez asistencie"}</option>
                    {assistants.map((p) => (
                      <option key={p.id} value={p.id}>{p.nickname}</option>
                    ))}
                  </Select>
                </div>
                {!external ? (
                  <label className="mt-2.5 flex items-center gap-2 text-xs text-muted">
                    <input
                      type="checkbox"
                      className="size-4 accent-[#B7F36B]"
                      checked={g.isOwnGoal}
                      onChange={(e) => updateGoal(g.key, { isOwnGoal: e.target.checked, scorerId: "", assistId: "" })}
                    />
                    Vlastný gól (dal ho hráč druhého tímu, do štatistík sa mu nepočíta)
                  </label>
                ) : null}
              </div>
            );
          })}
          <div className="flex gap-2">
            <Button variant="secondary" className="min-w-0 flex-1" onClick={() => addGoal("A")} disabled={lineupCount === 0} icon={<Plus className="size-4" />}>
              <span className="truncate">Gól {v.teamAName}</span>
            </Button>
            {!external ? (
              <Button variant="secondary" className="min-w-0 flex-1" onClick={() => addGoal("B")} disabled={lineupCount === 0} icon={<Plus className="size-4" />}>
                <span className="truncate">Gól {v.teamBName}</span>
              </Button>
            ) : null}
          </div>
          {external ? <p className="text-xs text-muted">Góly súpera stačí zadať vo výsledku, strelcov nemajú.</p> : null}
        </div>
      </Card>

      {/* MVP večera */}
      <Card className="flex flex-col gap-3 p-4">
        <h2 className="eyebrow">MVP večera</h2>
        <Segmented
          label="Spôsob určenia MVP"
          value={v.mvpMode}
          onChange={(mode) => set("mvpMode", mode)}
          options={[
            { value: "vote", label: "Hlasovanie" },
            { value: "manual", label: "Určím ja" },
            { value: "none", label: "Bez MVP" },
          ]}
        />
        {v.mvpMode === "vote" ? (
          <p className="text-xs text-muted">
            {votingStarted
              ? "Hlasovanie už bolo otvorené – hlasy hráčov, ktorí ostali v zostave, sa zachovajú."
              : `Po uložení sa hráčom, čo hrali aspoň jeden zápas, otvorí hlasovanie na ${voteHours} h.`}
          </p>
        ) : null}
        {v.mvpMode !== "vote" && votingStarted ? <p className="text-xs text-warning">Pozor: doterajšie hlasy sa po uložení zahodia.</p> : null}
        {v.mvpMode === "manual" ? (
          <Select aria-label="MVP večera" value={v.mvpPlayerId ?? ""} onChange={(e) => set("mvpPlayerId", e.target.value || null)}>
            <option value="">Vyber hráča…</option>
            {eveningPlayers.map((p) => (
              <option key={p.id} value={p.id}>{p.nickname}</option>
            ))}
          </Select>
        ) : null}
      </Card>

      <Card className="p-4">
        <Field label="Poznámka k večeru">
          {(id) => <Textarea id={id} value={v.resultNote} onChange={(e) => set("resultNote", e.target.value)} maxLength={500} />}
        </Field>
      </Card>

      {/* Tlačidlá držia pri spodnom okraji aj pri dlhom formulári */}
      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t border-line bg-bg/95 px-4 py-3 backdrop-blur-md lg:bottom-0 lg:left-64">
        <div className="mx-auto flex max-w-2xl gap-2.5">
          <Button variant="secondary" className="flex-none" onClick={() => router.back()}>Späť</Button>
          <Button type="submit" className="flex-1" loading={pending}>
            {games.length === 1 ? `Uložiť výsledok ${games[0].scoreA}:${games[0].scoreB}` : `Uložiť večer (${games.length} zápasy)`}
          </Button>
        </div>
      </div>
    </form>
  );
}
