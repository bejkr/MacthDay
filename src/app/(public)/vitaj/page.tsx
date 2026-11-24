import { Suspense } from "react";
import { redirect } from "next/navigation";
import { Link2, PlusCircle } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/card";
import { getSessionState, homeFor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

async function Welcome() {
  const session = await getSessionState();
  if (session.state !== "guest" && session.state !== "anonymous") redirect(homeFor(session.state));

  // Založenie partie je možné iba dovtedy, kým žiadna neexistuje (app_config.max_groups).
  const supabase = await createClient();
  const { data: setupOpen } = await supabase.rpc("setup_open");

  return (
    <div className="animate-rise">
      <h1 className="display text-5xl leading-[0.95] text-ink">
        Futbal
        <br />
        <span className="text-primary">našej partie</span>
      </h1>
      <p className="mt-4 text-muted">Termíny, dochádzka, góly, MVP aj pokladnica na jednom mieste. Bez registrácie a hesiel.</p>

      <div className="mt-8 rounded-card border border-line bg-surface p-4">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Link2 className="size-5" aria-hidden />
          </span>
          <div>
            <p className="font-semibold text-ink">Máš pozývací link?</p>
            <p className="mt-1 text-sm text-muted">
              Otvor link, ktorý admin poslal do skupiny. Zadáš iba prezývku a si dnu – toto zariadenie si ťa zapamätá.
            </p>
          </div>
        </div>
      </div>

      {setupOpen ? (
        <ButtonLink href="/zalozit" size="lg" className="mt-4 w-full" icon={<PlusCircle className="size-5" aria-hidden />}>
          Založiť partiu
        </ButtonLink>
      ) : (
        <p className="mt-4 text-center text-sm text-muted">Link nemáš? Vypýtaj si ho od admina partie.</p>
      )}
    </div>
  );
}

export default function WelcomePage() {
  return (
    <Suspense fallback={<Skeleton className="h-72 w-full rounded-card" />}>
      <Welcome />
    </Suspense>
  );
}
