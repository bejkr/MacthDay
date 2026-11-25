import type { EventFormValues } from "@/components/event-form";
import { todayInZone } from "./datetime";

/** Predvolené hodnoty nového termínu: zajtra o 18:00, bez limitu, medzi sebou. */
export function defaultEventValues(): EventFormValues {
  const tomorrow = new Date(Date.parse(todayInZone()) + 86_400_000).toISOString().slice(0, 10);
  return { startsAt: `${tomorrow}T18:00`, location: "", note: "", maxPlayers: null, signupClosesAt: null, kind: "internal", opponent: "" };
}
