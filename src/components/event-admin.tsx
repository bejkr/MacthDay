"use client";

import { Ban, RotateCcw, Trash2, UserCog } from "lucide-react";
import { useState } from "react";
import { adminSetAttendanceAction, deleteMatchAction, setEventStatusAction } from "@/lib/actions/matches";
import type { PlayerLite } from "@/lib/data";
import type { Enum } from "@/lib/supabase/database.types";
import { PlayerAvatar } from "./player-avatar";
import { Button } from "./ui/button";
import { Segmented } from "./ui/form";
import { Modal } from "./ui/modal";
import { useAction } from "./use-action";

type Status = Enum<"attendance_status">;

/** Zrušenie / obnovenie termínu. */
export function CancelEventButton({ matchId, cancelled }: { matchId: string; cancelled: boolean }) {
  const { run, pending } = useAction(setEventStatusAction, { success: cancelled ? "Termín obnovený." : "Termín zrušený." });
  return cancelled ? (
    <Button variant="secondary" loading={pending} onClick={() => run({ id: matchId, status: "scheduled" })} icon={<RotateCcw className="size-4" />}>
      Obnoviť
    </Button>
  ) : (
    <Button
      variant="secondary"
      loading={pending}
      onClick={() => window.confirm("Naozaj zrušiť tento termín? Hráči ho uvidia ako zrušený.") && run({ id: matchId, status: "cancelled" })}
      icon={<Ban className="size-4" />}
    >
      Zrušiť termín
    </Button>
  );
}

/** Trvalé zmazanie termínu alebo zápasu vrátane dochádzky, gólov a hlasov. */
export function DeleteMatchButton({ matchId, redirectTo, played }: { matchId: string; redirectTo: "/terminy" | "/zapasy"; played?: boolean }) {
  const { run, pending } = useAction(deleteMatchAction);
  const question = played
    ? "Zmazať zápas natrvalo? Zmiznú aj góly, zostavy a MVP hlasy a prepočítajú sa štatistiky. Nedá sa to vrátiť."
    : "Zmazať termín natrvalo aj s dochádzkou? Nedá sa to vrátiť.";
  return (
    <Button variant="danger" loading={pending} onClick={() => window.confirm(question) && run({ id: matchId, redirectTo })} icon={<Trash2 className="size-4" />}>
      Zmazať
    </Button>
  );
}

type EditorProps = {
  matchId: string;
  players: PlayerLite[];
  statuses: Record<string, Status | undefined>;
};

/** Admin môže dochádzku opraviť komukoľvek a kedykoľvek, aj po uzávierke. */
export function AttendanceEditor({ matchId, players, statuses }: EditorProps) {
  const [open, setOpen] = useState(false);
  const { run, pending } = useAction(adminSetAttendanceAction);

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} icon={<UserCog className="size-4" />}>
        Upraviť
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Upraviť dochádzku" description="Zmeny sa ukladajú hneď.">
        <ul className="flex flex-col gap-3">
          {players.map((p) => (
            <li key={p.id} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <PlayerAvatar nickname={p.nickname} avatarUrl={p.avatarUrl} color={p.avatarColor} size="xs" />
                <span className="truncate text-sm font-medium text-ink">{p.nickname}</span>
              </div>
              <Segmented<Status | "none">
                label={`Dochádzka hráča ${p.nickname}`}
                value={statuses[p.id] ?? "none"}
                onChange={(value) => !pending && run({ matchId, playerId: p.id, status: value === "none" ? null : value })}
                options={[
                  { value: "yes", label: "Príde" },
                  { value: "maybe", label: "Možno" },
                  { value: "no", label: "Nepríde" },
                  { value: "none", label: "–" },
                ]}
              />
            </li>
          ))}
        </ul>
      </Modal>
    </>
  );
}
