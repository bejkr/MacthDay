"use client";

import { Plus, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { saveResultAction } from "@/lib/actions/matches";
import type { PlayerLite } from "@/lib/data";
import { cn } from "@/lib/format";
import { PlayerAvatar } from "./player-avatar";
import { Button } from "./ui/button";
import { Card, CardHeader } from "./ui/card";
import { Field, Input, Segmented, Select, Stepper, Textarea } from "./ui/form";
import { useToast } from "./ui/toast";
import { useAction } from "./use-action";

type Side = "A" | "B";
type Slot = Side | "none";
type GoalDraft = { key: number; team: Side; scorerId: string; assistId: string; isOwnGoal: boolean };

export type ResultInitial = {
  startsAt: string;
  seasonId: string;
  location: string;
  kind: "internal" | "external";
  teamAName: string;
  teamBName: string;
  scoreA: number;
  scoreB: number;
  resultNote: string;
  mvpMode: "vote" | "manual" | "none";
  mvpPlayerId: string | null;
  lineup: Record<string, Side>;
  goals: Omit<GoalDraft, "key">[];
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

export function ResultForm({ matchId, initial, players, seasons, voteHours, votingStarted }: Props) {
  const router = useRouter();
  const toast = useToast();
  const nextKey = useRef(initial.goals.length + 1);
  const [v, setV] = useState(initial);
  const [goals, setGoals] = useState<GoalDraft[]>(() => initial.goals.map((g, i) => ({ ...g, key: i + 1 })));
  const set = <K extends keyof ResultInitial>(key: K, value: ResultInitial[K]) => setV((prev) => ({ ...prev, [key]: value }));

  const external = v.kind === "external";
  const inTeam = (side: Side) => players.filter((p) => v.lineup[p.id] === side);
  const lineupPlayers = players.filter((p) => v.lineup[p.id]);

  const { run, pending } = useAction(saveResultAction, {
    success: "Výsledok uložený, štatistiky sú prepočítané.",
    onSuccess: (data) => router.replace(`/zapasy/${data.id}`),
  });

  function setSlot(playerId: string, slot: Slot) {
    setV((prev) => {
      const lineup = { ...prev.lineup };
      if (slot === "none") delete lineup[playerId];
      else lineup[playerId] = slot;
      return { ...prev, lineup, mvpPlayerId: slot === "none" && prev.mvpPlayerId === playerId ? null : prev.mvpPlayerId };
    });
    if (slot === "none") {
      setGoals((list) => list.filter((g) => g.scorerId !== playerId).map((g) => (g.assistId === playerId ? { ...g, assistId: "" } : g)));
    }
  }

  function setKind(kind: "internal" | "external") {
    setV((prev) => ({
      ...prev,
      kind,
      // Proti súperovi hrajú všetci naši v jednom tíme.
      lineup: kind === "external" ? Object.fromEntries(Object.keys(prev.lineup).map((id) => [id, "A" as Side])) : prev.lineup,
    }));
    if (kind === "external") setGoals((list) => list.filter((g) => g.team === "A" && !g.isOwnGoal));
  }

  function addGoal(team: Side) {
    setGoals((list) => [...list, { key: nextKey.current++, team, scorerId: "", assistId: "", isOwnGoal: false }]);
    // Skóre nikdy nesmie byť nižšie ako počet zapísaných gólov.
    const count = goals.filter((g) => g.team === team).length + 1;
    if (team === "A" && count > v.scoreA) set("scoreA", count);
    if (team === "B" && count > v.scoreB) set("scoreB", count);
  }

  const updateGoal = (key: number, patch: Partial<GoalDraft>) =>
    setGoals((list) => list.map((g) => (g.key === key ? { ...g, ...patch } : g)));
  const removeGoal = (key: number) => setGoals((list) => list.filter((g) => g.key !== key));

  function submit() {
    if (goals.some((g) => !g.scorerId)) {
      toast.error("Pri každom góle vyber strelca alebo gól odstráň.");
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
      scoreA: v.scoreA,
      scoreB: v.scoreB,
      resultNote: v.resultNote,
      mvpMode: v.mvpMode,
      mvpPlayerId: v.mvpMode === "manual" ? v.mvpPlayerId : null,
      lineup: Object.entries(v.lineup).map(([playerId, team]) => ({ playerId, team })),
      goals: goals.map((g) => ({ team: g.team, scorerId: g.scorerId, assistId: g.assistId || null, isOwnGoal: g.isOwnGoal })),
    });
  }

  const goalsA = goals.filter((g) => g.team === "A").length;
  const goalsB = goals.filter((g) => g.team === "B").length;

  return (
    <form
      className="flex flex-col gap-4 pb-24"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {/* Základ */}
      <Card className="flex flex-col gap-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Dátum a čas zápasu">
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
          <span className="text-sm font-medium text-ink">Typ zápasu</span>
          <Segmented
            label="Typ zápasu"
            value={v.kind}
            onChange={setKind}
            options={[
              { value: "internal", label: "Medzi sebou" },
              { value: "external", label: "Proti súperovi" },
            ]}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label={external ? "Náš tím" : "Názov tímu A"}>
            {(id) => <Input id={id} value={v.teamAName} onChange={(e) => set("teamAName", e.target.value)} maxLength={30} required />}
          </Field>
          <Field label={external ? "Súper" : "Názov tímu B"}>
            {(id) => <Input id={id} value={v.teamBName} onChange={(e) => set("teamBName", e.target.value)} maxLength={30} required />}
          </Field>
        </div>
      </Card>

      {/* Zostavy */}
      <Card>
        <CardHeader title={external ? "Kto nastúpil" : "Zostavy"} action={<span className="text-xs text-muted">{lineupPlayers.length} hráčov</span>} />
        <ul className="flex flex-col gap-2.5 p-4">
          {players.map((p) => (
            <li key={p.id} className="flex items-center gap-2.5">
              <PlayerAvatar nickname={p.nickname} avatarUrl={p.avatarUrl} color={p.avatarColor} size="sm" dimmed={!v.lineup[p.id]} />
              <span className={cn("min-w-0 flex-1 truncate text-sm font-medium", v.lineup[p.id] ? "text-ink" : "text-muted")}>{p.nickname}</span>
              <Segmented<Slot>
                className="w-40 shrink-0"
                label={`Tím hráča ${p.nickname}`}
                value={v.lineup[p.id] ?? "none"}
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

      {/* Skóre */}
      <Card className="p-4">
        <h2 className="eyebrow mb-4">Výsledok</h2>
        <div className="flex items-start justify-around gap-2">
          <div className="flex min-w-0 flex-col items-center gap-3">
            <span className="max-w-full truncate text-sm font-semibold text-ink">{v.teamAName || "Tím A"}</span>
            <Stepper label={`Skóre ${v.teamAName}`} size="lg" value={v.scoreA} min={goalsA} onChange={(n) => set("scoreA", n)} />
          </div>
          <span className="num mt-9 text-5xl text-muted/40" aria-hidden>:</span>
          <div className="flex min-w-0 flex-col items-center gap-3">
            <span className="max-w-full truncate text-sm font-semibold text-ink">{v.teamBName || "Tím B"}</span>
            <Stepper label={`Skóre ${v.teamBName}`} size="lg" value={v.scoreB} min={goalsB} onChange={(n) => set("scoreB", n)} />
          </div>
        </div>
      </Card>

      {/* Góly */}
      <Card>
        <CardHeader title="Strelci a asistencie" />
        <div className="flex flex-col gap-3 p-4">
          {goals.length === 0 ? <p className="text-sm text-muted">Pridaj góly, aby sa hráčom započítali do štatistík.</p> : null}
          {goals.map((g, index) => {
            const scoringTeam = g.isOwnGoal ? (g.team === "A" ? "B" : "A") : g.team;
            const scorers = inTeam(scoringTeam);
            const assistants = inTeam(g.team).filter((p) => p.id !== g.scorerId);
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
            <Button variant="secondary" className="min-w-0 flex-1" onClick={() => addGoal("A")} disabled={inTeam("A").length === 0 && inTeam("B").length === 0} icon={<Plus className="size-4" />}>
              <span className="truncate">Gól {v.teamAName}</span>
            </Button>
            {!external ? (
              <Button variant="secondary" className="min-w-0 flex-1" onClick={() => addGoal("B")} disabled={inTeam("A").length === 0 && inTeam("B").length === 0} icon={<Plus className="size-4" />}>
                <span className="truncate">Gól {v.teamBName}</span>
              </Button>
            ) : null}
          </div>
          {external ? <p className="text-xs text-muted">Góly súpera stačí zadať vo výsledku, strelcov nemajú.</p> : null}
        </div>
      </Card>

      {/* MVP */}
      <Card className="flex flex-col gap-3 p-4">
        <h2 className="eyebrow">MVP zápasu</h2>
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
              : `Po uložení sa hráčom zo zostavy otvorí hlasovanie na ${voteHours} h a príde im upozornenie.`}
          </p>
        ) : null}
        {v.mvpMode !== "vote" && votingStarted ? <p className="text-xs text-warning">Pozor: doterajšie hlasy sa po uložení zahodia.</p> : null}
        {v.mvpMode === "manual" ? (
          <Select aria-label="MVP zápasu" value={v.mvpPlayerId ?? ""} onChange={(e) => set("mvpPlayerId", e.target.value || null)}>
            <option value="">Vyber hráča…</option>
            {lineupPlayers.map((p) => (
              <option key={p.id} value={p.id}>{p.nickname}</option>
            ))}
          </Select>
        ) : null}
      </Card>

      <Card className="p-4">
        <Field label="Poznámka k zápasu">
          {(id) => <Textarea id={id} value={v.resultNote} onChange={(e) => set("resultNote", e.target.value)} maxLength={500} />}
        </Field>
      </Card>

      {/* Tlačidlá držia pri spodnom okraji aj pri dlhom formulári */}
      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 border-t border-line bg-bg/95 px-4 py-3 backdrop-blur-md lg:bottom-0 lg:left-64">
        <div className="mx-auto flex max-w-2xl gap-2.5">
          <Button variant="secondary" className="flex-none" onClick={() => router.back()}>Späť</Button>
          <Button type="submit" className="flex-1" loading={pending}>
            Uložiť výsledok {v.scoreA}:{v.scoreB}
          </Button>
        </div>
      </div>
    </form>
  );
}
