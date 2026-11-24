"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { useAction } from "@/components/use-action";
import { cancelRequestAction } from "@/lib/actions/identity";

/** Kým žiadosť čaká, stránka sa každých pár sekúnd sama obnoví – po schválení hráča pustí dnu. */
export function AutoRefresh({ seconds = 8 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && navigator.onLine) router.refresh();
    }, seconds * 1000);
    return () => window.clearInterval(timer);
  }, [router, seconds]);
  return null;
}

export function CancelRequestButton({ label }: { label: string }) {
  const router = useRouter();
  const { run, pending } = useAction(cancelRequestAction, { onSuccess: () => router.replace("/vitaj") });
  return (
    <Button variant="secondary" className="mt-6 w-full" loading={pending} onClick={() => run(undefined)}>
      {label}
    </Button>
  );
}
