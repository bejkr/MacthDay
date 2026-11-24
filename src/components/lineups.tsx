import Link from "next/link";
import type { PlayerLite } from "@/lib/data";
import { cn, POSITION_SHORT } from "@/lib/format";
import { PlayerAvatar } from "./player-avatar";

type TeamProps = {
  name: string;
  players: PlayerLite[];
  /** Doplnok pri mene (góly, asistencie, MVP). */
  extra?: (player: PlayerLite) => React.ReactNode;
  winner?: boolean;
};

function Team({ name, players, extra, winner }: TeamProps) {
  return (
    <div className="min-w-0 flex-1">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className={cn("display truncate text-lg", winner ? "text-primary" : "text-ink")}>{name}</h3>
        <span className="text-xs text-muted">{players.length}</span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {players.map((p) => (
          <li key={p.id}>
            <Link href={`/hraci/${p.id}`} className="flex items-center gap-2 rounded-xl bg-bg/50 px-2 py-1.5 hover:bg-elevated">
              <PlayerAvatar nickname={p.nickname} avatarUrl={p.avatarUrl} color={p.avatarColor} size="sm" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{p.nickname}</span>
              {extra?.(p)}
              {p.position ? <span className="text-[0.625rem] font-semibold text-muted">{POSITION_SHORT[p.position]}</span> : null}
            </Link>
          </li>
        ))}
        {players.length === 0 ? <li className="rounded-xl border border-dashed border-line px-2 py-3 text-center text-xs text-muted">Nikto</li> : null}
      </ul>
    </div>
  );
}

type Props = {
  teamAName: string;
  teamBName: string;
  teamA: PlayerLite[];
  teamB: PlayerLite[];
  extra?: (player: PlayerLite) => React.ReactNode;
  winner?: "A" | "B" | null;
  /** Zápas proti externému súperovi – druhý tím nemá našich hráčov. */
  single?: boolean;
};

export function Lineups({ teamAName, teamBName, teamA, teamB, extra, winner, single }: Props) {
  return (
    <div className="flex gap-3">
      <Team name={teamAName} players={teamA} extra={extra} winner={winner === "A"} />
      {single ? null : <Team name={teamBName} players={teamB} extra={extra} winner={winner === "B"} />}
    </div>
  );
}
