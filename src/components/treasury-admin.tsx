"use client";

import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { addTreasuryEntryAction, deleteTreasuryEntryAction } from "@/lib/actions/treasury";
import { TREASURY_LABEL } from "@/lib/format";
import type { Enum } from "@/lib/supabase/database.types";
import { Button } from "./ui/button";
import { Field, Input, Select, Textarea } from "./ui/form";
import { Modal } from "./ui/modal";
import { useToast } from "./ui/toast";
import { useAction } from "./use-action";

type Type = Enum<"treasury_type">;

const EFFECT: Record<Type, string> = {
  fine: "Zvýši dlh hráča. Hotovosť v pokladnici sa zmení až vtedy, keď pokutu zaplatí.",
  contribution: "Predpis príspevku (napr. hala, sezónny poplatok). Zvýši dlh hráča, hotovosť zatiaľ nie.",
  payment: "Hráč zaplatil: zníži sa jeho dlh a zvýši hotovosť v pokladnici.",
  expense: "Zníži hotovosť v pokladnici (lopty, prenájom, občerstvenie…).",
  income: "Zvýši hotovosť v pokladnici bez vplyvu na dlhy (sponzor, dar…).",
};

const NEEDS_PLAYER: Type[] = ["fine", "contribution", "payment"];

type Props = { players: { id: string; nickname: string; debt: number }[]; today: string };

export function TreasuryAddButton({ players, today }: Props) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<Type>("payment");
  const [playerId, setPlayerId] = useState("");
  const [amount, setAmount] = useState("");
  const [entryDate, setEntryDate] = useState(today);
  const [note, setNote] = useState("");

  const { run, pending } = useAction(addTreasuryEntryAction, {
    success: "Transakcia zapísaná.",
    onSuccess: () => {
      setOpen(false);
      setAmount("");
      setNote("");
    },
  });

  const needsPlayer = NEEDS_PLAYER.includes(type);
  const showPlayer = type !== "expense";
  const selected = players.find((p) => p.id === playerId);

  function submit() {
    const value = Number(amount.replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) {
      toast.error("Zadaj sumu väčšiu ako 0.");
      return;
    }
    run({ type, playerId: showPlayer && playerId ? playerId : null, amount: Math.round(value * 100) / 100, entryDate, note });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} icon={<Plus className="size-4" />}>Transakcia</Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Nová transakcia"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>Zrušiť</Button>
            <Button type="submit" form="treasury-form" loading={pending}>Zapísať</Button>
          </>
        }
      >
        <form id="treasury-form" className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <Field label="Typ" hint={EFFECT[type]}>
            {(id) => (
              <Select id={id} value={type} onChange={(e) => setType(e.target.value as Type)}>
                {(Object.keys(TREASURY_LABEL) as Type[]).map((t) => (
                  <option key={t} value={t}>{TREASURY_LABEL[t]}</option>
                ))}
              </Select>
            )}
          </Field>
          {showPlayer ? (
            <Field
              label={needsPlayer ? "Hráč" : "Hráč (nepovinné)"}
              hint={type === "payment" && selected && selected.debt > 0 ? `Aktuálny dlh: ${selected.debt.toFixed(2).replace(".", ",")} €` : undefined}
            >
              {(id) => (
                <Select id={id} value={playerId} onChange={(e) => setPlayerId(e.target.value)} required={needsPlayer}>
                  <option value="">{needsPlayer ? "Vyber hráča…" : "Bez hráča"}</option>
                  {players.map((p) => (
                    <option key={p.id} value={p.id}>{p.nickname}</option>
                  ))}
                </Select>
              )}
            </Field>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Suma (€)">
              {(id) => (
                <Input id={id} inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} pattern="[0-9]+([.,][0-9]{1,2})?" required />
              )}
            </Field>
            <Field label="Dátum">
              {(id) => <Input id={id} type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} required />}
            </Field>
          </div>
          {type === "payment" && selected && selected.debt > 0 ? (
            <Button variant="secondary" size="sm" className="self-start" onClick={() => setAmount(selected.debt.toFixed(2).replace(".", ","))}>
              Vyplniť celý dlh
            </Button>
          ) : null}
          <Field label="Poznámka">
            {(id) => <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Za čo to je" />}
          </Field>
        </form>
      </Modal>
    </>
  );
}

/** Zmazanie patrí priamo k transakcii, ktorej sa týka. */
export function TreasuryDeleteButton({ id, label }: { id: string; label: string }) {
  const { run, pending } = useAction(deleteTreasuryEntryAction, { success: "Transakcia zmazaná." });
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => window.confirm(`Zmazať transakciu „${label}“? Zostatky sa prepočítajú.`) && run(id)}
      className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-elevated hover:text-danger disabled:opacity-40"
      aria-label={`Zmazať transakciu ${label}`}
    >
      <Trash2 className="size-4" />
    </button>
  );
}
