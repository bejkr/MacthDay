"use client";

import { ArrowLeftRight, Dices, Lock, LockOpen, Scale, Star } from "lucide-react";
import { useMemo, useState } from "react";
import { saveLineupAction } from "@/lib/actions/matches";
import type { PlayerLite } from "@/lib/data";
import { cn, POSITION_SHORT } from "@/lib/format";
import { balanceTeams, randomTeams, type Locks, type Side, type TeamPlayer } from "@/lib/teams";
import { PlayerAvatar } from "./player-avatar";
import { Button } from "./ui/button";
import { useAction } from "./use-action";

type Props = {
  matchId: string;
  /** Hráči, ktorí potvrdili účasť. */
  players: PlayerLite[];
  saved: { a: string[]; b: string[] };
  teamAName: string;
  teamBName: string;
};

type Assignment = Record<string, Side>;

function initialAssignment(players: PlayerLite[], saved: Props["saved"]): Assignment {
  const ids = new Set(players.map((p) => p.id));
  const out: Assignment = {};
  for (const id of saved.a) if (ids.has(id)) out[id] = "A";
  for (const id of saved.b) if (ids.has(id)) out[id] = "B";
  // Noví potvrdení hráči, ktorí v uloženej zostave ešte nie sú → do menšieho tímu.
  for (const p of players) {
    if (out[p.id]) continue;
    const a = Object.values(out).filter((s) => s === "A").length;
    const b = Object.values(out).filter((s) => s === "B").length;
    out[p.id] = a <= b ? "A" : "B";
  }
  return out;
}

const key = (assignment: Assignment, side: Side) =>
  Object.entries(assignment).filter(([, s]) => s === side).map(([id]) => id).sort().join(",");

/** Rozdelenie tímov: automaticky vyrovnané, náhodné alebo ručne doladené; hráčov možno uzamknúť. */
export function TeamBuilder({ matchId, players, saved, teamAName, teamBName }: Props) {
  const hasSaved = saved.a.length + saved.b.length > 0;
  const [assignment, setAssignment] = useState<Assignment>(() => {
    if (hasSaved) return initialAssignment(players, saved);
    // Pevný "náhodný" zdroj: server aj prehliadač musia vyrenderovať rovnaký prvý návrh.
    const split = balanceTeams(players.map(toTeamPlayer), {}, () => 0.42);
    return Object.fromEntries([...split.a.map((id) => [id, "A"]), ...split.b.map((id) => [id, "B"])]) as Assignment;
  });
  const [locked, setLocked] = useState<Record<string, boolean>>({});
  const [savedKey, setSavedKey] = useState(() => (hasSaved ? `${[...saved.a].sort().join(",")}|${[...saved.b].sort().join(",")}` : ""));

  const teamA = useMemo(() => players.filter((p) => assignment[p.id] === "A"), [players, assignment]);
  const teamB = useMemo(() => players.filter((p) => assignment[p.id] === "B"), [players, assignment]);
  const sumA = teamA.reduce((s, p) => s + p.skill, 0);
  const sumB = teamB.reduce((s, p) => s + p.skill, 0);
  const currentKey = `${key(assignment, "A")}|${key(assignment, "B")}`;
  const dirty = currentKey !== savedKey;

  const { run, pending } = useAction(saveLineupAction, {
    success: "Zostavy uložené.",
    onSuccess: () => setSavedKey(currentKey),
  });

  function generate(mode: "balanced" | "random") {
    const locks: Locks = {};
    for (const p of players) if (locked[p.id]) locks[p.id] = assignment[p.id];
    const input = players.map(toTeamPlayer);
    const split = mode === "balanced" ? balanceTeams(input, locks) : randomTeams(input, locks);
    setAssignment(Object.fromEntries([...split.a.map((id) => [id, "A"]), ...split.b.map((id) => [id, "B"])]) as Assignment);
  }

  const move = (id: string) => setAssignment((prev) => ({ ...prev, [id]: prev[id] === "A" ? "B" : "A" }));
  const toggleLock = (id: string) => setLocked((prev) => ({ ...prev, [id]: !prev[id] }));

  if (players.length < 2) {
    return <p className="px-4 pb-4 text-sm text-muted">Na rozdelenie tímov treba aspoň dvoch potvrdených hráčov.</p>;
  }

  const column = (name: string, team: PlayerLite[], sum: number, side: Side) => (
    <div className="min-w-0 flex-1">
      <div className="mb-2 flex items-end justify-between gap-2">
        <h3 className="display truncate text-lg text-ink">{name}</h3>
        <span className="flex items-center gap-1 text-xs text-muted">
          <Star className="size-3 fill-warning text-warning" aria-hidden />
          <span className="num text-base text-ink">{sum}</span>
          <span>· {team.length}</span>
        </span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {team.map((p) => (
          <li key={p.id} className={cn("flex items-center gap-1.5 rounded-xl border px-1.5 py-1.5", locked[p.id] ? "border-primary/40 bg-primary/[0.06]" : "border-line bg-bg/50")}>
            <PlayerAvatar nickname={p.nickname} avatarUrl={p.avatarUrl} color={p.avatarColor} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-ink">{p.nickname}</span>
              <span className="block text-[0.6875rem] text-muted">
                {"★".repeat(p.skill)}
                {p.position ? ` · ${POSITION_SHORT[p.position]}` : ""}
              </span>
            </span>
            <button
              type="button"
              onClick={() => toggleLock(p.id)}
              aria-pressed={!!locked[p.id]}
              aria-label={locked[p.id] ? `Odomknúť hráča ${p.nickname}` : `Uzamknúť hráča ${p.nickname} v tíme`}
              className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", locked[p.id] ? "text-primary" : "text-muted hover:text-ink")}
            >
              {locked[p.id] ? <Lock className="size-4" /> : <LockOpen className="size-4" />}
            </button>
            <button
              type="button"
              onClick={() => move(p.id)}
              aria-label={`Presunúť hráča ${p.nickname} do tímu ${side === "A" ? teamBName : teamAName}`}
              className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-elevated text-ink active:scale-95"
            >
              <ArrowLeftRight className="size-4" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );

  const diff = Math.abs(sumA - sumB);

  return (
    <div className="px-4 pb-4">
      <div className="mb-3 flex gap-2">
        <Button variant="secondary" size="sm" className="flex-1" onClick={() => generate("balanced")} icon={<Scale className="size-4" />}>
          Vyrovnať
        </Button>
        <Button variant="secondary" size="sm" className="flex-1" onClick={() => generate("random")} icon={<Dices className="size-4" />}>
          Náhodne
        </Button>
      </div>
      <div className="flex gap-3">
        {column(teamAName, teamA, sumA, "A")}
        {column(teamBName, teamB, sumB, "B")}
      </div>
      <p className="mt-3 text-center text-xs text-muted">
        Rozdiel hodnotení: <span className={cn("font-semibold", diff <= 1 ? "text-primary" : "text-warning")}>{diff}</span>
        {" · "}zámok drží hráča v tíme pri ďalšom miešaní
      </p>
      <Button className="mt-3 w-full" loading={pending} disabled={!dirty} onClick={() => run({ matchId, teamA: teamA.map((p) => p.id), teamB: teamB.map((p) => p.id) })}>
        {dirty ? "Uložiť zostavy" : "Zostavy sú uložené"}
      </Button>
    </div>
  );
}

function toTeamPlayer(p: PlayerLite): TeamPlayer {
  return { id: p.id, skill: p.skill, position: p.position };
}
