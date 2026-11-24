import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Ban, Hourglass, UserX } from "lucide-react";
import { Skeleton } from "@/components/ui/card";
import { getSessionState, homeFor } from "@/lib/auth";
import { AutoRefresh, CancelRequestButton } from "./waiting";

export const metadata: Metadata = { title: "Čaká sa na schválenie" };

async function Waiting() {
  const session = await getSessionState();
  if (session.state !== "pending" && session.state !== "rejected" && session.state !== "blocked") {
    redirect(homeFor(session.state));
  }

  if (session.state === "blocked") {
    return (
      <div className="animate-rise text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-danger/10 text-danger">
          <Ban className="size-6" aria-hidden />
        </span>
        <h1 className="display mt-5 text-3xl text-ink">Prístup pozastavený</h1>
        <p className="mt-3 text-muted">Admin tvoj účet deaktivoval. Ak ide o omyl, ozvi sa mu.</p>
        <AutoRefresh seconds={30} />
      </div>
    );
  }

  if (session.state === "rejected") {
    return (
      <div className="animate-rise text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-danger/10 text-danger">
          <UserX className="size-6" aria-hidden />
        </span>
        <h1 className="display mt-5 text-3xl text-ink">Žiadosť zamietnutá</h1>
        <p className="mt-3 text-muted">
          Admin nepotvrdil prístup k hráčovi „{session.nickname}“. Ak si v partii nový, otvor pozývací link znova a zvoľ si inú prezývku.
        </p>
        <CancelRequestButton label="Rozumiem" />
      </div>
    );
  }

  if (session.state !== "pending") redirect(homeFor(session.state));

  return (
    <div className="animate-rise text-center">
      <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-warning/10 text-warning">
        <Hourglass className="size-6" aria-hidden />
      </span>
      <p className="eyebrow mt-5">{session.groupName}</p>
      <h1 className="display mt-2 text-3xl text-ink">Čaká sa na admina</h1>
      <p className="mt-3 text-muted">
        Prezývka „{session.nickname}“ už v partii existuje. Aby sa za teba nemohol vydávať nikto cudzí, musí toto zariadenie potvrdiť admin.
        Napíš mu – stránka sa po schválení otvorí sama.
      </p>
      <CancelRequestButton label="Zrušiť žiadosť" />
      <AutoRefresh />
    </div>
  );
}

export default function WaitingPage() {
  return (
    <Suspense fallback={<Skeleton className="h-72 w-full rounded-card" />}>
      <Waiting />
    </Suspense>
  );
}
