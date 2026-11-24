"use client";

import { Ban, Check, Link2, Smartphone, X } from "lucide-react";
import { useState } from "react";
import {
  createInviteAction, decideRequestAction, deleteEmailAction, revokeInviteAction,
  saveEmailAction, startSeasonAction, updateGroupAction,
} from "@/lib/actions/settings";
import { InviteLinkBox } from "./invite-link-box";
import { Button } from "./ui/button";
import { Field, Input, Select, Toggle } from "./ui/form";
import { Modal } from "./ui/modal";
import { useAction } from "./use-action";

// ───────────── Žiadosti o prístup ─────────────
export type AccessRequestItem = { id: string; nickname: string; deviceLabel: string | null; createdAt: string };

export function AccessRequests({ requests }: { requests: AccessRequestItem[] }) {
  const { run, pending } = useAction(decideRequestAction);
  if (requests.length === 0) return <p className="p-4 text-sm text-muted">Žiadne čakajúce žiadosti.</p>;
  return (
    <ul className="flex flex-col gap-2.5 p-4">
      {requests.map((r) => (
        <li key={r.id} className="rounded-2xl border border-warning/30 bg-warning/[0.06] p-3.5">
          <p className="text-sm text-ink">
            Nové zariadenie chce prístup k hráčovi <span className="font-semibold">{r.nickname}</span>.
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted">
            <Smartphone className="size-3.5" aria-hidden />
            {r.deviceLabel ?? "Neznáme zariadenie"} · {r.createdAt}
          </p>
          <p className="mt-2 text-xs text-muted">Schváľ iba vtedy, ak ti to {r.nickname} sám potvrdil (napr. správou alebo osobne).</p>
          <div className="mt-3 flex gap-2">
            <Button className="flex-1" size="sm" loading={pending} onClick={() => run({ id: r.id, approve: true })} icon={<Check className="size-4" />}>
              Schváliť
            </Button>
            <Button className="flex-1" size="sm" variant="danger" loading={pending} onClick={() => run({ id: r.id, approve: false })} icon={<X className="size-4" />}>
              Zamietnuť
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ───────────── Pozývací link ─────────────
export type ActiveInvite = { id: string; createdAt: string; useCount: number; maxUses: number | null; expiresAt: string | null };

export function InviteManager({ active, groupName }: { active: ActiveInvite | null; groupName: string }) {
  const [token, setToken] = useState<string | null>(null);
  const [maxUses, setMaxUses] = useState(30);
  const [expiresDays, setExpiresDays] = useState("");
  const create = useAction(createInviteAction, { success: "Nový link je pripravený.", onSuccess: (data) => setToken(data.token) });
  const revoke = useAction(revokeInviteAction, { success: "Link zablokovaný.", onSuccess: () => setToken(null) });

  return (
    <div className="flex flex-col gap-4 p-4">
      {active ? (
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-bg/50 p-3.5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Link2 className="size-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1 text-sm">
            <div className="font-medium text-ink">Aktívny link</div>
            <div className="text-xs text-muted">
              vytvorený {active.createdAt} · použitý {active.useCount}×{active.maxUses ? ` z ${active.maxUses}` : ""}
              {active.expiresAt ? ` · platí do ${active.expiresAt}` : ""}
            </div>
          </div>
          <Button
            variant="danger"
            size="sm"
            loading={revoke.pending}
            onClick={() => window.confirm("Zablokovať pozývací link? Nikto nový sa ním už nepripojí. Existujúci hráči ostávajú.") && revoke.run(active.id)}
            icon={<Ban className="size-3.5" />}
          >
            Zablokovať
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted">Momentálne nie je aktívny žiadny pozývací link – nikto nový sa nepripojí.</p>
      )}

      {token ? <InviteLinkBox token={token} groupName={groupName} /> : null}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Max. použití">
          {(id) => <Input id={id} type="number" inputMode="numeric" min={1} max={200} value={maxUses} onChange={(e) => setMaxUses(Number(e.target.value))} />}
        </Field>
        <Field label="Platnosť">
          {(id) => (
            <Select id={id} value={expiresDays} onChange={(e) => setExpiresDays(e.target.value)}>
              <option value="">Bez obmedzenia</option>
              <option value="1">1 deň</option>
              <option value="7">7 dní</option>
              <option value="30">30 dní</option>
            </Select>
          )}
        </Field>
      </div>
      <Button
        variant={active ? "secondary" : "primary"}
        loading={create.pending}
        onClick={() => {
          if (active && !window.confirm("Vygenerovať nový link? Doterajší okamžite prestane platiť.")) return;
          create.run({ maxUses, expiresDays: expiresDays ? Number(expiresDays) : null });
        }}
      >
        {active ? "Vymeniť link za nový" : "Vygenerovať pozývací link"}
      </Button>
      <p className="text-xs text-muted">
        Link je spoločný pre celú partiu. Kto zadá novú prezývku, vstúpi hneď; kto zadá už existujúcu, čaká na tvoje schválenie.
      </p>
    </div>
  );
}

// ───────────── Nastavenia partie ─────────────
export type GroupValues = {
  name: string;
  maxPlayers: number;
  allowAvatarEdit: boolean;
  mvpVoteHours: number;
  rsvpReminderHours: number;
  matchReminderHours: number;
};

export function GroupSettingsForm({ initial }: { initial: GroupValues }) {
  const [v, setV] = useState(initial);
  const set = <K extends keyof GroupValues>(key: K, value: GroupValues[K]) => setV((prev) => ({ ...prev, [key]: value }));
  const { run, pending } = useAction(updateGroupAction, { success: "Nastavenia partie uložené." });
  const number = (id: string, key: "maxPlayers" | "mvpVoteHours" | "rsvpReminderHours" | "matchReminderHours", min: number, max: number) => (
    <Input id={id} type="number" inputMode="numeric" min={min} max={max} value={v[key]} onChange={(e) => set(key, Number(e.target.value))} required />
  );

  return (
    <form className="flex flex-col gap-4 p-4" onSubmit={(e) => { e.preventDefault(); run(v); }}>
      <Field label="Názov partie">
        {(id) => <Input id={id} value={v.name} onChange={(e) => set("name", e.target.value)} minLength={2} maxLength={40} required />}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Limit hráčov" hint="Viac aktívnych hráčov sa nepripojí.">{(id) => number(id, "maxPlayers", 2, 100)}</Field>
        <Field label="MVP hlasovanie (h)" hint="Ako dlho je otvorené.">{(id) => number(id, "mvpVoteHours", 1, 168)}</Field>
        <Field label="Pripomienka dochádzky (h)" hint="Pred uzávierkou termínu.">{(id) => number(id, "rsvpReminderHours", 1, 168)}</Field>
        <Field label="Pripomienka zápasu (h)" hint="Pred začiatkom, prihláseným.">{(id) => number(id, "matchReminderHours", 1, 72)}</Field>
      </div>
      <Toggle label="Hráči si môžu meniť fotku" hint="Inak avatary spravuje iba admin." checked={v.allowAvatarEdit} onChange={(on) => set("allowAvatarEdit", on)} />
      <Button type="submit" loading={pending}>Uložiť nastavenia</Button>
    </form>
  );
}

// ───────────── Sezóny ─────────────
export function NewSeasonButton({ today, suggestedName }: { today: string; suggestedName: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(suggestedName);
  const [startsOn, setStartsOn] = useState(today);
  const { run, pending } = useAction(startSeasonAction, { success: "Nová sezóna je aktívna.", onSuccess: () => setOpen(false) });
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>Nová sezóna</Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Začať novú sezónu"
        description="Doterajšia sezóna sa uzavrie. Jej zápasy a štatistiky ostávajú v histórii a vo „Všetkých sezónach“."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>Zrušiť</Button>
            <Button type="submit" form="season-form" loading={pending}>Začať sezónu</Button>
          </>
        }
      >
        <form id="season-form" className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); run({ name, startsOn }); }}>
          <Field label="Názov sezóny">
            {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} required placeholder="napr. Jar 2027" />}
          </Field>
          <Field label="Začiatok">
            {(id) => <Input id={id} type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} required />}
          </Field>
        </form>
      </Modal>
    </>
  );
}

// ───────────── E-mailové upozornenia (voliteľné) ─────────────
export function EmailSettings({ initialEmail, initialEnabled }: { initialEmail: string; initialEnabled: boolean }) {
  const [email, setEmail] = useState(initialEmail);
  const [enabled, setEnabled] = useState(initialEnabled);
  const save = useAction(saveEmailAction, { success: "E-mailové upozornenia uložené." });
  const remove = useAction(deleteEmailAction, { success: "E-mail zmazaný.", onSuccess: () => setEmail("") });

  return (
    <form className="flex flex-col gap-3 p-4" onSubmit={(e) => { e.preventDefault(); save.run({ email, enabled }); }}>
      <p className="text-sm text-muted">
        Nepovinné. Ak chceš dostávať upozornenia aj e-mailom, nechaj tu adresu. Vidíš ju iba ty – spoluhráči ani admin nie.
      </p>
      <Field label="E-mail">
        {(id) => <Input id={id} type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ty@example.com" maxLength={254} required />}
      </Field>
      <Toggle label="Posielať upozornenia e-mailom" checked={enabled} onChange={setEnabled} />
      <div className="flex gap-2">
        <Button type="submit" className="flex-1" loading={save.pending}>Uložiť</Button>
        {initialEmail ? (
          <Button variant="danger" loading={remove.pending} onClick={() => window.confirm("Zmazať e-mail a vypnúť e-mailové upozornenia?") && remove.run(undefined)}>
            Zmazať e-mail
          </Button>
        ) : null}
      </div>
    </form>
  );
}
