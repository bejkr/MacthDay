"use client";

import { LinkIcon, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { useAction } from "@/components/use-action";
import { joinAction, peekInviteAction, type InvitePreview } from "@/lib/actions/identity";

type State = { step: "loading" } | { step: "invalid"; message?: string } | { step: "ready"; token: string; invite: InvitePreview };

export function JoinFlow() {
  const router = useRouter();
  const [state, setState] = useState<State>({ step: "loading" });
  const [nickname, setNickname] = useState("");
  const tokenRef = useRef("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // Token je za mriežkou, takže ho vidí iba prehliadač. Hneď ho z adresy odstránime,
      // aby neostal v histórii ani na snímkach obrazovky.
      // Token si pamätáme v ref: React v dev režime spúšťa efekty dvakrát a pri druhom
      // behu je už adresa vyčistená.
      const fromHash = window.location.hash.replace(/^#/, "").trim();
      if (fromHash) {
        tokenRef.current = fromHash;
        window.history.replaceState(null, "", window.location.pathname);
      }
      const token = tokenRef.current;
      if (!/^[a-f0-9]{64}$/.test(token)) {
        if (!cancelled) setState({ step: "invalid" });
        return;
      }
      setState({ step: "loading" });
      try {
        const result = await peekInviteAction(token);
        if (cancelled) return;
        if (!result.ok) setState({ step: "invalid", message: result.error });
        else if (!result.data.valid) setState({ step: "invalid" });
        else setState({ step: "ready", token, invite: result.data });
      } catch {
        if (!cancelled) setState({ step: "invalid", message: "Nepodarilo sa spojiť so serverom. Skontroluj pripojenie a otvor link znova." });
      }
    }

    load();
    // Ak je stránka už otvorená a používateľ ťukne na iný pozývací link, zmení sa iba časť za mriežkou.
    const onHashChange = () => {
      if (window.location.hash.length > 1) load();
    };
    window.addEventListener("hashchange", onHashChange);
    return () => {
      cancelled = true;
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);

  const { run, pending } = useAction(joinAction, {
    onSuccess: (data) => router.replace(data.status === "joined" ? "/prehlad" : "/cakanie"),
  });

  if (state.step === "loading") return <Skeleton className="h-72 w-full rounded-card" />;

  if (state.step === "invalid") {
    return (
      <div className="animate-rise text-center">
        <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-danger/10 text-danger">
          <LinkIcon className="size-6" aria-hidden />
        </span>
        <h1 className="display mt-5 text-3xl text-ink">Link neplatí</h1>
        <p className="mt-3 text-muted">
          {state.message ?? "Pozývací link je neplatný, vypršal alebo ho admin vymenil. Vypýtaj si v skupine aktuálny."}
        </p>
        <ButtonLink href="/" variant="secondary" className="mt-6">Späť na úvod</ButtonLink>
      </div>
    );
  }

  const { token, invite } = state;

  if (invite.kind === "recovery") {
    return (
      <div className="animate-rise">
        <p className="eyebrow">{invite.groupName}</p>
        <h1 className="display mt-2 text-4xl text-ink">
          Vitaj späť,
          <br />
          <span className="text-primary">{invite.nickname}</span>
        </h1>
        <p className="mt-4 text-muted">Tento jednorazový link pripojí toto zariadenie k tvojmu hráčovi. Štatistiky aj história ostávajú.</p>
        <Button size="lg" className="mt-6 w-full" loading={pending} onClick={() => run({ token })} icon={<ShieldCheck className="size-5" />}>
          Pripojiť toto zariadenie
        </Button>
      </div>
    );
  }

  return (
    <form
      className="animate-rise"
      onSubmit={(e) => {
        e.preventDefault();
        run({ token, nickname });
      }}
    >
      <p className="eyebrow">Pozvánka do partie</p>
      <h1 className="display mt-2 text-5xl leading-[0.95] text-primary">{invite.groupName}</h1>
      <p className="mt-4 mb-6 text-muted">Zadaj prezývku, pod ktorou ťa chalani poznajú. Nič viac netreba.</p>
      <Field label="Tvoja prezývka" hint="Ak si už v partii a meníš mobil, zadaj svoju pôvodnú prezývku – admin ti prístup potvrdí.">
        {(id) => (
          <Input
            id={id}
            value={nickname}
            onChange={(e) => setNickname(e.target.value)}
            placeholder="napr. Mišo"
            minLength={2}
            maxLength={24}
            required
            autoFocus
            autoComplete="nickname"
            autoCapitalize="words"
            enterKeyHint="go"
          />
        )}
      </Field>
      <Button type="submit" size="lg" className="mt-6 w-full" loading={pending}>
        Vstúpiť
      </Button>
    </form>
  );
}
