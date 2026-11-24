import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Skeleton } from "@/components/ui/card";
import { getSessionState, homeFor } from "@/lib/auth";
import { todayInZone } from "@/lib/datetime";
import { createClient } from "@/lib/supabase/server";
import { SetupForm } from "./setup-form";

export const metadata: Metadata = { title: "Založiť partiu" };

async function Setup() {
  const session = await getSessionState();
  // Po úspešnom založení sa táto stránka prekreslí už so stavom "member". Formulár
  // musí ostať na mieste, lebo práve ukazuje pozývací link, ktorý sa zobrazí iba raz.
  const member = session.state === "member";
  if (!member) {
    if (session.state !== "guest" && session.state !== "anonymous") redirect(homeFor(session.state));
    const supabase = await createClient();
    const { data: open } = await supabase.rpc("setup_open");
    if (!open) redirect("/vitaj");
  }
  return <SetupForm defaultSeason={todayInZone().slice(0, 4)} alreadyMember={member} />;
}

export default function SetupPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full rounded-card" />}>
      <Setup />
    </Suspense>
  );
}
