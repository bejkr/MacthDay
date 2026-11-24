"use client";

import { X } from "lucide-react";
import { useEffect, useId, useRef, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/format";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  /** Tlačidlá prilepené k spodnému okraju (Uložiť / Zrušiť). */
  footer?: ReactNode;
  wide?: boolean;
};

const subscribeNever = () => () => {};

// Na mobile vyskakuje zospodu (dosiahnuteľné palcom), na väčších obrazovkách je v strede.
export function Modal({ open, onClose, title, description, children, footer, wide }: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  // Portál existuje iba v prehliadači. Pri prvom vykreslení (hydratácii) preto modál
  // nevykreslíme ani na klientovi – inak by sa HTML zo servera nezhodovalo.
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);

  // onClose býva pri každom vykreslení nová funkcia. Držíme ju v ref, aby sa efekt
  // nižšie nespúšťal znova pri každom stlačení klávesu (inak by modál kradol fokus z polí).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open || !mounted) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open, mounted]);

  if (!open || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <div className="absolute inset-0 animate-fade bg-black/70 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          "relative flex max-h-[92dvh] w-full animate-sheet flex-col rounded-t-3xl border border-line-strong bg-surface shadow-2xl shadow-black outline-none sm:rounded-3xl",
          wide ? "sm:max-w-2xl" : "sm:max-w-md",
        )}
      >
        <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-line-strong sm:hidden" aria-hidden />
        <div className="flex shrink-0 items-start justify-between gap-3 px-5 pt-4 pb-3">
          <div className="min-w-0">
            <h2 id={titleId} className="display text-2xl text-ink">{title}</h2>
            {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-mr-1.5 flex size-9 shrink-0 items-center justify-center rounded-full text-muted hover:bg-elevated hover:text-ink"
            aria-label="Zavrieť"
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">{children}</div>
        {footer ? (
          <div className="flex shrink-0 gap-2.5 border-t border-line bg-surface px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:rounded-b-3xl sm:pb-4 [&>*]:flex-1">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
