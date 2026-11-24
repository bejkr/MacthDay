import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Skeleton } from "@/components/ui/card";
import { getSessionState, homeFor } from "@/lib/auth";
import { JoinFlow } from "./join-flow";

export const metadata: Metadata = { title: "Pozvánka" };

// Hráči otvárajú pozývací link z WhatsAppu aj opakovane. Zariadenie, ktoré už do
// partie patrí (alebo čaká na schválenie), preto rovno pošleme ďalej – inak by
// znova videlo formulár na prezývku a vyzeralo by to, že si ho appka nepamätá.
async function Gate() {
  const session = await getSessionState();
  if (session.state !== "guest" && session.state !== "anonymous") redirect(homeFor(session.state));
  // Token z adresy (#…) číta až prehliadač a posiela ho serveru v tele požiadavky, nie v URL.
  return <JoinFlow />;
}

export default function InvitePage() {
  return (
    <Suspense fallback={<Skeleton className="h-72 w-full rounded-card" />}>
      <Gate />
    </Suspense>
  );
}
