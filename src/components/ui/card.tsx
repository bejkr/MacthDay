import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/format";

export function Card({ className, ...rest }: ComponentProps<"div">) {
  return <div className={cn("rounded-card border border-line bg-surface", className)} {...rest} />;
}

export function CardHeader({ title, action, className }: { title: string; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center justify-between gap-3 px-4 pt-4", className)}>
      <h2 className="eyebrow">{title}</h2>
      {action}
    </div>
  );
}

type Tone = "neutral" | "green" | "warning" | "danger" | "solid";
const TONE: Record<Tone, string> = {
  neutral: "bg-elevated text-muted border-line-strong",
  green: "bg-primary/10 text-primary border-primary/25",
  warning: "bg-warning/10 text-warning border-warning/25",
  danger: "bg-danger/10 text-danger border-danger/25",
  solid: "bg-primary text-bg border-transparent",
};

export function Badge({ tone = "neutral", className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full border px-2.5 text-xs font-semibold whitespace-nowrap",
        TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <header className="mb-5 flex items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="display text-[2rem] text-ink sm:text-4xl">{title}</h1>
        {subtitle ? <p className="mt-1.5 text-sm text-muted">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mt-7 mb-3 flex items-center justify-between gap-3">
      <h2 className="eyebrow">{children}</h2>
      {action}
    </div>
  );
}

/** Štatistická dlaždica: malý popis, veľké číslo. */
export function PlayerStat({
  label, value, hint, accent, className,
}: { label: string; value: ReactNode; hint?: ReactNode; accent?: boolean; className?: string }) {
  return (
    <div className={cn("rounded-2xl border border-line bg-surface p-3.5", className)}>
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className={cn("num mt-2 text-[2rem]", accent ? "text-primary" : "text-ink")}>{value}</div>
      {hint ? <div className="mt-1.5 truncate text-xs text-muted">{hint}</div> : null}
    </div>
  );
}

export function EmptyState({
  icon, title, text, action,
}: { icon: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-card border border-dashed border-line-strong px-6 py-10 text-center">
      <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-elevated text-muted [&_svg]:size-5">{icon}</div>
      <p className="font-semibold text-ink">{title}</p>
      {text ? <p className="mt-1 max-w-xs text-sm text-muted">{text}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} aria-hidden />;
}

export function PageSkeleton() {
  return (
    <div role="status" aria-label="Načítavam">
      <Skeleton className="h-9 w-44" />
      <Skeleton className="mt-6 h-44 w-full rounded-card" />
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
      <Skeleton className="mt-4 h-32 w-full rounded-card" />
    </div>
  );
}
