"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3, Bell, CalendarDays, LayoutDashboard, Menu, Settings, Trophy, Users, Wallet, WifiOff, type LucideIcon,
} from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/format";
import { Modal } from "./ui/modal";

type Item = { href: string; label: string; icon: LucideIcon };

const ITEMS: Item[] = [
  { href: "/prehlad", label: "Prehľad", icon: LayoutDashboard },
  { href: "/terminy", label: "Termíny", icon: CalendarDays },
  { href: "/zapasy", label: "Zápasy", icon: Trophy },
  { href: "/statistiky", label: "Štatistiky", icon: BarChart3 },
  { href: "/hraci", label: "Hráči", icon: Users },
  { href: "/pokladnica", label: "Pokladnica", icon: Wallet },
  { href: "/nastavenia", label: "Nastavenia", icon: Settings },
];
const PRIMARY = ITEMS.slice(0, 4);
const MORE = ITEMS.slice(4);

const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(href + "/");

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("display inline-flex items-center gap-2 text-xl tracking-[0.08em] text-ink", className)}>
      <span className="inline-block size-2.5 rounded-full bg-primary shadow-[0_0_12px_2px_rgb(183_243_107/0.6)]" aria-hidden />
      Matchday
    </span>
  );
}

function UnreadDot({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="num absolute -top-1 -right-1.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-primary px-1 text-[0.6875rem] text-bg">
      {count > 9 ? "9+" : count}
      <span className="sr-only"> neprečítaných upozornení</span>
    </span>
  );
}

type ChromeProps = { groupName: string; seasonName: string | null; unread: number; adminBadge: number };

/** Bočný panel pre desktop. */
export function Sidebar({ groupName, seasonName, unread, adminBadge }: ChromeProps) {
  const pathname = usePathname();
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-surface/60 px-4 py-6 lg:flex">
      <Link href="/prehlad" className="px-2">
        <Wordmark />
      </Link>
      <div className="mt-5 rounded-2xl border border-line bg-bg/60 px-3 py-2.5">
        <div className="truncate text-sm font-semibold text-ink">{groupName}</div>
        <div className="text-xs text-muted">{seasonName ? `Sezóna ${seasonName}` : "Bez sezóny"}</div>
      </div>
      <nav className="mt-5 flex flex-1 flex-col gap-1" aria-label="Hlavná navigácia">
        {[...ITEMS.slice(0, 6), { href: "/upozornenia", label: "Upozornenia", icon: Bell }, ITEMS[6]].map((item) => {
          const active = isActive(pathname, item.href);
          const badge = item.href === "/upozornenia" ? unread : item.href === "/nastavenia" ? adminBadge : 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-11 items-center gap-3 rounded-xl px-3 text-[0.9375rem] font-medium transition-colors",
                active ? "bg-primary/10 text-primary" : "text-muted hover:bg-elevated hover:text-ink",
              )}
            >
              <item.icon className="size-[1.125rem]" aria-hidden />
              <span className="flex-1">{item.label}</span>
              {badge > 0 ? (
                <span className="num flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-xs text-bg">{badge}</span>
              ) : null}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

/** Horná lišta na mobile: značka, partia a zvonček. */
export function TopBar({ groupName, unread }: ChromeProps) {
  const pathname = usePathname();
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-line bg-bg/85 px-4 pt-[env(safe-area-inset-top)] backdrop-blur-md lg:hidden">
      <Link href="/prehlad" className="flex min-w-0 items-baseline gap-2.5">
        <Wordmark className="text-lg" />
        <span className="truncate text-xs text-muted">{groupName}</span>
      </Link>
      <Link
        href="/upozornenia"
        aria-label="Upozornenia"
        aria-current={isActive(pathname, "/upozornenia") ? "page" : undefined}
        className={cn(
          "relative flex size-10 shrink-0 items-center justify-center rounded-full",
          isActive(pathname, "/upozornenia") ? "bg-primary/10 text-primary" : "text-muted hover:text-ink",
        )}
      >
        <span className="relative">
          <Bell className="size-5" aria-hidden />
          <UnreadDot count={unread} />
        </span>
      </Link>
    </header>
  );
}

/** Spodná navigácia: štyri hlavné sekcie + "Viac" s ostatnými. */
export function BottomNavigation({ adminBadge }: ChromeProps) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const moreActive = MORE.some((i) => isActive(pathname, i.href));

  const tab = (active: boolean) =>
    cn(
      "relative flex h-full flex-1 flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium transition-colors",
      active ? "text-primary" : "text-muted",
    );

  return (
    <>
      <nav
        aria-label="Hlavná navigácia"
        className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur-md lg:hidden"
      >
        <div className="mx-auto flex h-16 max-w-lg items-stretch px-1">
          {PRIMARY.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link key={item.href} href={item.href} className={tab(active)} aria-current={active ? "page" : undefined}>
                {active ? <span className="absolute top-0 h-0.5 w-8 rounded-full bg-primary" aria-hidden /> : null}
                <item.icon className="size-[1.375rem]" strokeWidth={active ? 2.4 : 2} aria-hidden />
                {item.label}
              </Link>
            );
          })}
          <button type="button" className={tab(moreActive)} onClick={() => setOpen(true)} aria-haspopup="dialog">
            {moreActive ? <span className="absolute top-0 h-0.5 w-8 rounded-full bg-primary" aria-hidden /> : null}
            <span className="relative">
              <Menu className="size-[1.375rem]" aria-hidden />
              {adminBadge > 0 ? <span className="absolute -top-0.5 -right-1 size-2 rounded-full bg-primary" aria-hidden /> : null}
            </span>
            Viac
          </button>
        </div>
      </nav>

      <Modal open={open} onClose={() => setOpen(false)} title="Viac">
        <div className="grid grid-cols-3 gap-2.5">
          {MORE.map((item) => {
            const active = isActive(pathname, item.href);
            const badge = item.href === "/nastavenia" ? adminBadge : 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={cn(
                  "relative flex h-24 flex-col items-center justify-center gap-2 rounded-2xl border text-sm font-medium",
                  active ? "border-primary/40 bg-primary/10 text-primary" : "border-line bg-elevated text-ink",
                )}
              >
                <item.icon className="size-6" aria-hidden />
                {item.label}
                {badge > 0 ? (
                  <span className="num absolute top-2 right-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-xs text-bg">{badge}</span>
                ) : null}
              </Link>
            );
          })}
        </div>
      </Modal>
    </>
  );
}

function subscribeOnline(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

export function useOnline() {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}

/** Pruh pri výpadku spojenia. Zápisy sú vtedy zablokované (pozri use-action.ts). */
export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <div role="status" className="sticky top-14 z-20 flex items-center justify-center gap-2 border-b border-warning/30 bg-[#2a2210] px-4 py-2 text-xs font-medium text-warning lg:top-0">
      <WifiOff className="size-3.5" aria-hidden />
      Si offline – vidíš posledné načítané údaje, zmeny sa neukladajú.
    </div>
  );
}
