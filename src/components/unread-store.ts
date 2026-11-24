"use client";

import { useSyncExternalStore } from "react";

// Počet neprečítaných upozornení posiela server v layoute, ktorý sa pri prechode
// medzi stránkami neprekresľuje. Keď používateľ otvorí upozornenia, zapamätáme si,
// koľko ich videl, a odznak hneď skryjeme. Keď server pošle iný počet (napr. po
// obnovení stránky pribudlo nové upozornenie), platí znova jeho číslo.
let seenCount: number | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function markUnreadSeen(count: number) {
  seenCount = count;
  for (const listener of listeners) listener();
}

export function useUnreadCount(serverCount: number) {
  const seen = useSyncExternalStore(subscribe, () => seenCount, () => null);
  return seen !== null && serverCount === seen ? 0 : serverCount;
}
