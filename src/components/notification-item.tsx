import Link from "next/link";
import { Award, Bell, CalendarPlus, Clock, Coins, HandCoins, ShieldAlert, UserPlus, Vote, type LucideIcon } from "lucide-react";
import { formatDayMonth, formatTime, relativeDay } from "@/lib/datetime";
import { cn } from "@/lib/format";
import type { Enum, Notification } from "@/lib/supabase/database.types";

const ICON: Record<Enum<"notification_type">, LucideIcon> = {
  new_event: CalendarPlus,
  rsvp_reminder: Clock,
  match_reminder: Bell,
  mvp_open: Vote,
  mvp_result: Award,
  fine: ShieldAlert,
  payment: HandCoins,
  contribution: Coins,
  access_request: UserPlus,
  system: Bell,
};

export function NotificationItem({ notification: n }: { notification: Notification }) {
  const Icon = ICON[n.type] ?? Bell;
  const unread = !n.read_at;
  const day = relativeDay(n.created_at);
  const when = day === "dnes" ? formatTime(n.created_at) : day === "včera" ? "včera" : formatDayMonth(n.created_at);

  const body = (
    <>
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-full",
          unread ? "bg-primary/15 text-primary" : "bg-elevated text-muted",
        )}
      >
        <Icon className="size-[1.125rem]" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-3">
          <span className={cn("truncate text-[0.9375rem]", unread ? "font-semibold text-ink" : "font-medium text-ink/80")}>{n.title}</span>
          <span className="shrink-0 text-xs text-muted">{when}</span>
        </span>
        {n.body ? <span className="mt-0.5 line-clamp-2 block text-sm text-muted">{n.body}</span> : null}
      </span>
      {unread ? <span className="mt-2 size-2 shrink-0 rounded-full bg-primary" aria-label="Neprečítané" /> : null}
    </>
  );

  const className = "flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-elevated/50";
  return n.link ? (
    <Link href={n.link} className={className}>{body}</Link>
  ) : (
    <div className={className}>{body}</div>
  );
}
