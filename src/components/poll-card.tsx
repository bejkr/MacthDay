"use client";

import Link from "next/link";
import { Check, ChevronRight, Lock, LockOpen, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { deletePollAction, setPollOpenAction, votePollAction } from "@/lib/actions/polls";
import type { PlayerLite, PollView } from "@/lib/data";
import { formatDayMonth, formatTime, formatWeekdayShort, isoToLocalInput } from "@/lib/datetime";
import { cn } from "@/lib/format";
import { EventFormButton, type EventFormValues } from "./event-form";
import { PlayerAvatar } from "./player-avatar";
import { Badge } from "./ui/card";
import { useAction } from "./use-action";

type Props = {
  poll: PollView;
  players: Record<string, PlayerLite>;
  meId: string;
  isAdmin: boolean;
  /** Predvolené hodnoty formulára termínu (zajtra 18:00), ak možnosť nemá dátum. */
  defaultEvent: EventFormValues;
};

/** Anketa na výber termínu – ťukom označíš možnosti, hlasy vidí celá partia. */
export function PollCard({ poll, players, meId, isAdmin, defaultEvent }: Props) {
  const initialMine = poll.options.filter((o) => o.voters.includes(meId)).map((o) => o.id);
  const [mine, setMine] = useState<string[]>(initialMine);
  const [showVoters, setShowVoters] = useState(false);
  // Výber sa ukáže hneď; ak ho server odmietne, vrátime posledný potvrdený.
  const confirmed = useRef(initialMine);
  const requested = useRef(initialMine);
  const vote = useAction(votePollAction, {
    onSuccess: () => {
      confirmed.current = requested.current;
    },
    onError: () => setMine(confirmed.current),
  });
  const toggleOpen = useAction(setPollOpenAction, { success: poll.status === "open" ? "Anketa uzavretá." : "Anketa je znova otvorená." });
  const remove = useAction(deletePollAction, { success: "Anketa zmazaná." });

  const canManage = isAdmin || poll.createdBy === meId;
  const author = poll.createdBy ? players[poll.createdBy] : undefined;

  // Počty s okamžitou odozvou: zo servera bez môjho hlasu + môj aktuálny výber.
  const counts = poll.options.map((o) => o.voters.filter((id) => id !== meId).length + (mine.includes(o.id) ? 1 : 0));
  const max = Math.max(1, ...counts);
  const voterCount = new Set([...poll.options.flatMap((o) => o.voters.filter((id) => id !== meId)), ...(mine.length ? [meId] : [])]).size;

  function toggle(optionId: string) {
    if (!poll.votingOpen) return;
    const next = mine.includes(optionId)
      ? mine.filter((id) => id !== optionId)
      : poll.allowMultiple
        ? [...mine, optionId]
        : [optionId];
    requested.current = next;
    setMine(next);
    vote.run({ pollId: poll.id, optionIds: next });
  }

  return (
    <article id={`anketa-${poll.id}`} className="scroll-mt-20 rounded-card border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {author ? <p className="text-xs font-semibold text-secondary">{author.nickname}</p> : null}
          <h3 className="mt-0.5 text-[1.0625rem] leading-snug font-semibold text-ink">{poll.title}</h3>
          {poll.note ? <p className="mt-1 text-sm whitespace-pre-line text-muted">{poll.note}</p> : null}
        </div>
        {poll.status === "converted" ? (
          <Badge tone="green">Termín je dohodnutý</Badge>
        ) : !poll.votingOpen ? (
          <Badge>Uzavretá</Badge>
        ) : null}
      </div>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted">
        <Check className="size-3.5" aria-hidden />
        {poll.votingOpen ? (poll.allowMultiple ? "Vyber jednu alebo viac možností" : "Vyber jednu možnosť") : "Hlasovanie skončilo"}
        <span aria-hidden>·</span>
        {voterCount === 1 ? "1 hlasujúci" : `${voterCount} hlasujúcich`}
      </p>

      <ul className="mt-3 flex flex-col gap-2.5" role="group" aria-label="Možnosti ankety">
        {poll.options.map((o, i) => {
          const selected = mine.includes(o.id);
          const voters = [...o.voters.filter((id) => id !== meId), ...(selected ? [meId] : [])]
            .map((id) => players[id])
            .filter((p): p is PlayerLite => !!p);
          return (
            <li key={o.id}>
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  onClick={() => toggle(o.id)}
                  disabled={!poll.votingOpen || vote.pending}
                  aria-pressed={selected}
                  className="flex min-w-0 flex-1 items-start gap-3 rounded-xl py-1 text-left disabled:cursor-default"
                >
                  <span
                    className={cn(
                      "mt-0.5 flex size-6 shrink-0 items-center justify-center border-2 transition-colors",
                      poll.allowMultiple ? "rounded-md" : "rounded-full",
                      selected ? "border-primary bg-primary text-bg" : "border-muted/60",
                    )}
                    aria-hidden
                  >
                    {selected ? <Check className="size-4" strokeWidth={3} /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-2">
                      <span className="text-[0.9375rem] leading-snug text-ink">
                        {o.label}
                        {o.startsAt ? (
                          <span className="ml-1.5 text-xs text-muted">
                            {formatWeekdayShort(o.startsAt)} {formatDayMonth(o.startsAt)} {formatTime(o.startsAt)}
                          </span>
                        ) : null}
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        <span className="flex -space-x-1.5">
                          {voters.slice(0, 3).map((p) => (
                            <PlayerAvatar key={p.id} nickname={p.nickname} avatarUrl={p.avatarUrl} color={p.avatarColor} size="xs" className="rounded-full ring-2 ring-surface" />
                          ))}
                        </span>
                        <span className="num w-5 text-right text-lg text-ink">{counts[i]}</span>
                      </span>
                    </span>
                    <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-elevated" aria-hidden>
                      <span
                        className={cn("block h-full rounded-full transition-[width] duration-300", counts[i] === max && counts[i] > 0 ? "bg-primary" : "bg-secondary/60")}
                        style={{ width: `${(counts[i] / max) * 100}%` }}
                      />
                    </span>
                    {showVoters && voters.length > 0 ? (
                      <span className="mt-1.5 block text-xs text-muted">{voters.map((p) => p.nickname).join(", ")}</span>
                    ) : null}
                  </span>
                </button>
                {isAdmin && poll.status !== "converted" ? (
                  <EventFormButton
                    initial={{ ...defaultEvent, startsAt: o.startsAt ? isoToLocalInput(o.startsAt) : defaultEvent.startsAt, note: o.label }}
                    poll={{ pollId: poll.id, optionId: o.id, optionLabel: o.label, voters: voters.length }}
                  />
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <button type="button" onClick={() => setShowVoters((s) => !s)} className="mr-auto text-sm font-semibold text-primary">
          {showVoters ? "Skryť hlasy" : "Zobraziť hlasy"}
        </button>
        {poll.status === "converted" && poll.matchId ? (
          <Link href={`/terminy/${poll.matchId}`} className="inline-flex items-center gap-1 text-sm font-semibold text-primary">
            Otvoriť termín
            <ChevronRight className="size-4" aria-hidden />
          </Link>
        ) : null}
        {canManage && poll.status !== "converted" ? (
          <button
            type="button"
            disabled={toggleOpen.pending}
            onClick={() => toggleOpen.run({ pollId: poll.id, open: poll.status !== "open" })}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm text-muted hover:bg-elevated hover:text-ink"
          >
            {poll.status === "open" ? <Lock className="size-4" aria-hidden /> : <LockOpen className="size-4" aria-hidden />}
            {poll.status === "open" ? "Uzavrieť" : "Otvoriť"}
          </button>
        ) : null}
        {canManage ? (
          <button
            type="button"
            disabled={remove.pending}
            onClick={() => window.confirm(`Zmazať anketu „${poll.title}“ aj s hlasmi?`) && remove.run(poll.id)}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm text-muted hover:bg-elevated hover:text-danger"
            aria-label={`Zmazať anketu ${poll.title}`}
          >
            <Trash2 className="size-4" aria-hidden />
            Zmazať
          </button>
        ) : null}
      </div>
    </article>
  );
}
