"use client";

import { Check, HelpCircle, X } from "lucide-react";
import { setAttendanceAction } from "@/lib/actions/matches";
import { ATTENDANCE_LABEL, cn } from "@/lib/format";
import type { Enum } from "@/lib/supabase/database.types";
import { Badge } from "./ui/card";
import { useAction } from "./use-action";

type Status = Enum<"attendance_status">;

const ICON = { yes: Check, maybe: HelpCircle, no: X } as const;
const TONE = { yes: "green", maybe: "warning", no: "danger" } as const;

export function AttendanceStatus({ status }: { status: Status | null }) {
  if (!status) return <Badge>Bez odpovede</Badge>;
  const Icon = ICON[status];
  return (
    <Badge tone={TONE[status]}>
      <Icon className="size-3" aria-hidden />
      {ATTENDANCE_LABEL[status]}
    </Badge>
  );
}

const ACTIVE: Record<Status, string> = {
  yes: "border-primary bg-primary text-bg",
  maybe: "border-warning bg-warning text-bg",
  no: "border-danger bg-danger text-bg",
};

type RsvpProps = { matchId: string; current: Status | null; disabled?: boolean; full?: boolean };

/** Tri veľké tlačidlá na potvrdenie účasti – jeden ťuk, žiadny formulár. */
export function RsvpButtons({ matchId, current, disabled, full }: RsvpProps) {
  const { run, pending } = useAction(setAttendanceAction);
  const order: Status[] = ["yes", "maybe", "no"];
  return (
    <div className="grid grid-cols-3 gap-2" role="group" aria-label="Moja účasť">
      {order.map((status) => {
        const Icon = ICON[status];
        const active = current === status;
        const blocked = disabled || (status === "yes" && full && !active);
        return (
          <button
            key={status}
            type="button"
            aria-pressed={active}
            disabled={pending || blocked}
            onClick={() => !active && run({ matchId, status })}
            className={cn(
              "flex h-12 items-center justify-center gap-1.5 rounded-xl border text-sm font-semibold transition active:scale-[0.97] disabled:opacity-40",
              active ? ACTIVE[status] : "border-line-strong bg-bg/50 text-ink hover:border-muted/60",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {status === "yes" && full && !active ? "Plno" : ATTENDANCE_LABEL[status]}
          </button>
        );
      })}
    </div>
  );
}
