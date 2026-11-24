"use client";

import { useCallback, useTransition } from "react";
import type { ActionResult } from "@/lib/errors";
import { useToast } from "./ui/toast";

type Options<T> = {
  /** Hláška po úspechu (plávajúce oznámenie). */
  success?: string;
  onSuccess?: (data: T) => void;
};

/**
 * Jednotné volanie serverových akcií z klienta: stav "ukladám", hlášky,
 * ošetrenie výpadku spojenia. Keď je zariadenie offline, akcia sa vôbec
 * neodošle – nič sa neukladá do fronty, takže nevzniknú neaktuálne zápisy.
 */
export function useAction<I, T>(action: (input: I) => Promise<ActionResult<T>>, options: Options<T> = {}) {
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const { success, onSuccess } = options;

  const run = useCallback(
    (input: I) => {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        toast.error("Si offline. Zmeny sa dajú ukladať až po obnovení pripojenia.");
        return;
      }
      startTransition(async () => {
        try {
          const result = await action(input);
          if (result.ok) {
            if (success) toast.success(success);
            onSuccess?.(result.data);
          } else {
            toast.error(result.error);
          }
        } catch {
          toast.error("Spojenie so serverom zlyhalo. Zmena sa neuložila – skús to znova.");
        }
      });
    },
    [action, onSuccess, success, toast],
  );

  return { run, pending };
}
