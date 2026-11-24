"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { PlayerLite } from "@/lib/data";
import { cn } from "@/lib/format";
import type { PlayerStats } from "@/lib/supabase/database.types";
import { PlayerAvatar } from "./player-avatar";
import { Select } from "./ui/form";

const COLOR_A = "#B7F36B";
const COLOR_B = "#5AA9C9";

type Props = {
  players: PlayerLite[];
  stats: PlayerStats[];
  /** Popisy zápasov na osi X (chronologicky). */
  timeline: string[];
  /** Góly + asistencie hráča v jednotlivých zápasoch (rovnaké poradie ako timeline). */
  contributions: Record<string, number[]>;
  defaultA: string;
  defaultB: string;
};

const perMatch = (s: PlayerStats | undefined) => (s && s.matches_played > 0 ? s.goals / s.matches_played : 0);
const decimal = (n: number) => n.toFixed(2).replace(".", ",");

/** Porovnanie dvoch hráčov: čísla vedľa seba a vývoj produktivity (góly + asistencie) v čase. */
export function PlayerCompare({ players, stats, timeline, contributions, defaultA, defaultB }: Props) {
  const [a, setA] = useState(defaultA);
  const [b, setB] = useState(defaultB);
  const statOf = (id: string) => stats.find((s) => s.player_id === id);
  const pa = players.find((p) => p.id === a);
  const pb = players.find((p) => p.id === b);
  const sa = statOf(a);
  const sb = statOf(b);

  const chart = useMemo(() => {
    const cumulative = (id: string, upTo: number) =>
      (contributions[id] ?? []).slice(0, upTo + 1).reduce((sum, n) => sum + n, 0);
    return timeline.map((label, i) => ({ label, a: cumulative(a, i), b: cumulative(b, i) }));
  }, [timeline, contributions, a, b]);

  const rows: { label: string; a: number; b: number; format?: (n: number) => string }[] = [
    { label: "Zápasy", a: sa?.matches_played ?? 0, b: sb?.matches_played ?? 0 },
    { label: "Góly", a: sa?.goals ?? 0, b: sb?.goals ?? 0 },
    { label: "Asistencie", a: sa?.assists ?? 0, b: sb?.assists ?? 0 },
    { label: "MVP", a: sa?.mvps ?? 0, b: sb?.mvps ?? 0 },
    { label: "Výhry", a: sa?.wins ?? 0, b: sb?.wins ?? 0 },
    { label: "Góly na zápas", a: perMatch(sa), b: perMatch(sb), format: decimal },
    { label: "Dochádzka", a: sa?.attendance_pct ?? 0, b: sb?.attendance_pct ?? 0, format: (n) => `${n} %` },
  ];

  const picker = (value: string, onChange: (id: string) => void, other: string, label: string, color: string) => (
    <div className="min-w-0 flex-1">
      <div className="mb-1.5 flex items-center gap-1.5">
        <span className="size-2 rounded-full" style={{ backgroundColor: color }} aria-hidden />
        <span className="text-xs text-muted">{label}</span>
      </div>
      <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        {players.map((p) => (
          <option key={p.id} value={p.id} disabled={p.id === other}>{p.nickname}</option>
        ))}
      </Select>
    </div>
  );

  if (players.length < 2) return <p className="p-4 text-sm text-muted">Na porovnanie treba aspoň dvoch hráčov.</p>;

  return (
    <div className="p-4">
      <div className="flex gap-3">
        {picker(a, setA, b, "Hráč 1", COLOR_A)}
        {picker(b, setB, a, "Hráč 2", COLOR_B)}
      </div>

      <div className="mt-5 flex items-center justify-between">
        {pa ? <PlayerAvatar nickname={pa.nickname} avatarUrl={pa.avatarUrl} color={pa.avatarColor} size="lg" /> : <span />}
        <span className="display text-lg text-muted">vs</span>
        {pb ? <PlayerAvatar nickname={pb.nickname} avatarUrl={pb.avatarUrl} color={pb.avatarColor} size="lg" /> : <span />}
      </div>

      <dl className="mt-4 flex flex-col gap-3">
        {rows.map((row) => {
          const max = Math.max(row.a, row.b, 0.0001);
          const fmt = row.format ?? String;
          return (
            <div key={row.label}>
              <div className="flex items-baseline justify-between">
                <dd className={cn("num text-xl", row.a >= row.b && row.a > 0 ? "text-primary" : "text-ink")}>{fmt(row.a)}</dd>
                <dt className="text-xs text-muted">{row.label}</dt>
                <dd className={cn("num text-xl", row.b >= row.a && row.b > 0 ? "text-[#5AA9C9]" : "text-ink")}>{fmt(row.b)}</dd>
              </div>
              <div className="mt-1 flex gap-1" aria-hidden>
                <div className="flex h-1.5 flex-1 justify-end overflow-hidden rounded-full bg-elevated">
                  <div className="h-full rounded-full" style={{ width: `${(row.a / max) * 100}%`, backgroundColor: COLOR_A }} />
                </div>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-elevated">
                  <div className="h-full rounded-full" style={{ width: `${(row.b / max) * 100}%`, backgroundColor: COLOR_B }} />
                </div>
              </div>
            </div>
          );
        })}
      </dl>

      <h3 className="eyebrow mt-7 mb-3">Vývoj: góly + asistencie</h3>
      {timeline.length < 2 ? (
        <p className="text-sm text-muted">Graf sa zobrazí po aspoň dvoch odohraných zápasoch.</p>
      ) : (
        <div className="h-56 w-full" role="img" aria-label={`Kumulatívny počet gólov a asistencií: ${pa?.nickname} a ${pb?.nickname}`}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chart} margin={{ top: 6, right: 8, bottom: 0, left: -22 }}>
              <CartesianGrid stroke="rgba(245,247,243,0.06)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: "#8D9990", fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={24} />
              <YAxis allowDecimals={false} tick={{ fill: "#8D9990", fontSize: 11 }} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{ background: "#1B241F", border: "1px solid rgba(245,247,243,0.16)", borderRadius: 12, fontSize: 13 }}
                labelStyle={{ color: "#8D9990" }}
                itemStyle={{ color: "#F5F7F3" }}
                cursor={{ stroke: "rgba(245,247,243,0.16)" }}
              />
              <Line type="monotone" dataKey="a" name={pa?.nickname} stroke={COLOR_A} strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
              <Line type="monotone" dataKey="b" name={pb?.nickname} stroke={COLOR_B} strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
