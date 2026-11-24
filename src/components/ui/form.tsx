"use client";

import { Minus, Plus } from "lucide-react";
import { useId, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/format";

const control =
  "w-full rounded-xl border border-line-strong bg-bg px-3.5 text-ink placeholder:text-muted/60 " +
  "transition-colors focus:border-primary/70 focus:outline-none disabled:opacity-50";

export function Field({
  label, hint, children, className,
}: { label: string; hint?: ReactNode; children: (id: string) => ReactNode; className?: string }) {
  const id = useId();
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium text-ink">{label}</label>
      {children(id)}
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function Input({ className, ...rest }: ComponentProps<"input">) {
  return <input className={cn(control, "h-12", className)} {...rest} />;
}

export function Textarea({ className, ...rest }: ComponentProps<"textarea">) {
  return <textarea className={cn(control, "min-h-24 py-3", className)} {...rest} />;
}

export function Select({ className, children, ...rest }: ComponentProps<"select">) {
  return (
    <select
      className={cn(control, "select-chevron h-12 appearance-none pr-10", className)}
      {...rest}
    >
      {children}
    </select>
  );
}

type SegmentedProps<T extends string> = {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: ReactNode }[];
  label: string;
  className?: string;
};

export function Segmented<T extends string>({ value, onChange, options, label, className }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("flex rounded-xl border border-line bg-bg p-1", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            "flex h-9 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-sm font-medium transition-colors",
            o.value === value ? "bg-elevated text-ink shadow-sm shadow-black/40" : "text-muted hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({
  checked, onChange, label, hint,
}: { checked: boolean; onChange: (checked: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-1">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{label}</span>
        {hint ? <span className="block text-xs text-muted">{hint}</span> : null}
      </span>
      <input type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span
        aria-hidden
        className="relative h-7 w-12 shrink-0 rounded-full bg-elevated ring-1 ring-line-strong transition-colors peer-checked:bg-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary after:absolute after:top-1 after:left-1 after:size-5 after:rounded-full after:bg-muted after:transition-transform peer-checked:after:translate-x-5 peer-checked:after:bg-bg"
      />
    </label>
  );
}

/** Veľké +/− pre skóre a počty: ovládateľné palcom, bez klávesnice. */
export function Stepper({
  value, onChange, min = 0, max = 99, label, size = "md",
}: { value: number; onChange: (value: number) => void; min?: number; max?: number; label: string; size?: "md" | "lg" }) {
  const btn = cn(
    "flex shrink-0 items-center justify-center rounded-full border border-line-strong bg-elevated text-ink transition active:scale-95 disabled:opacity-30",
    size === "lg" ? "size-11" : "size-9",
  );
  return (
    <div className="flex items-center gap-3" role="group" aria-label={label}>
      <button type="button" className={btn} onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label={`${label}: ubrať`}>
        <Minus className="size-4" />
      </button>
      <span className={cn("num min-w-[1.6ch] text-center text-ink", size === "lg" ? "text-6xl" : "text-3xl")} aria-live="polite">
        {value}
      </span>
      <button type="button" className={btn} onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label={`${label}: pridať`}>
        <Plus className="size-4" />
      </button>
    </div>
  );
}
