"use client";

import { useEffect, useRef } from "react";
import { markNotificationsSeenAction } from "@/lib/actions/settings";

export function MarkSeen({ ids }: { ids: string[] }) {
  const sent = useRef(false);
  useEffect(() => {
    if (sent.current || ids.length === 0 || !navigator.onLine) return;
    sent.current = true;
    markNotificationsSeenAction(ids).catch(() => {});
  }, [ids]);
  return null;
}
