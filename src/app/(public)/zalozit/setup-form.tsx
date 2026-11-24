"use client";

import { ArrowRight } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { InviteLinkBox } from "@/components/invite-link-box";
import { Button, ButtonLink } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/form";
import { useAction } from "@/components/use-action";
import { createGroupAction } from "@/lib/actions/identity";

export function SetupForm({ defaultSeason, alreadyMember }: { defaultSeason: string; alreadyMember: boolean }) {
  const router = useRouter();
  const [groupName, setGroupName] = useState("");
  const [nickname, setNickname] = useState("");
  const [season, setSeason] = useState(defaultSeason);
  const [token, setToken] = useState<string | null>(null);
  const { run, pending } = useAction(createGroupAction, { onSuccess: (data) => setToken(data.token) });

  // Člen, ktorý sem zablúdil bez čerstvo vytvoreného linku, tu nemá čo robiť.
  useEffect(() => {
    if (alreadyMember && !token && !pending) router.replace("/prehlad");
  }, [alreadyMember, token, pending, router]);

  if (token) {
    return (
      <div className="animate-rise">
        <h1 className="display text-4xl text-ink">Partia je založená</h1>
        <p className="mt-3 mb-5 text-muted">Pošli tento link do vašej skupiny. Každý si po otvorení zadá iba prezývku.</p>
        <InviteLinkBox token={token} groupName={groupName.trim()} />
        <ButtonLink href="/prehlad" size="lg" className="mt-5 w-full">
          Pokračovať do aplikácie
          <ArrowRight className="size-5" aria-hidden />
        </ButtonLink>
      </div>
    );
  }

  return (
    <form
      className="animate-rise"
      onSubmit={(e) => {
        e.preventDefault();
        run({ groupName, nickname, season });
      }}
    >
      <h1 className="display text-4xl text-ink">Založiť partiu</h1>
      <p className="mt-3 mb-6 text-muted">Budeš prvým adminom. Ďalších adminov môžeš pridať neskôr.</p>
      <div className="flex flex-col gap-4">
        <Field label="Názov partie">
          {(id) => <Input id={id} value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="napr. Štvrtkový futbal" maxLength={40} required autoFocus />}
        </Field>
        <Field label="Tvoja prezývka" hint="Takto ťa uvidia spoluhráči.">
          {(id) => <Input id={id} value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder="napr. Mišo" maxLength={24} required autoComplete="nickname" />}
        </Field>
        <Field label="Názov sezóny">
          {(id) => <Input id={id} value={season} onChange={(e) => setSeason(e.target.value)} maxLength={40} />}
        </Field>
      </div>
      <Button type="submit" size="lg" className="mt-6 w-full" loading={pending}>
        Založiť a získať pozývací link
      </Button>
    </form>
  );
}
