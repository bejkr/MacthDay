"use client";

import { CalendarPlus, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { saveEventAction } from "@/lib/actions/matches";
import { Button } from "./ui/button";
import { Field, Input, Segmented, Textarea } from "./ui/form";
import { Modal } from "./ui/modal";
import { useAction } from "./use-action";

export type EventFormValues = {
  id?: string;
  startsAt: string; // hodnota pre datetime-local v pásme partie
  location: string;
  note: string;
  maxPlayers: number | null;
  signupClosesAt: string | null;
  kind: "internal" | "external";
  opponent: string;
};

type Props = { initial: EventFormValues; defaultOpen?: boolean; variant?: "create" | "edit" };

export function EventFormButton({ initial, defaultOpen = false, variant = "create" }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [v, setV] = useState(initial);
  const set = <K extends keyof EventFormValues>(key: K, value: EventFormValues[K]) => setV((prev) => ({ ...prev, [key]: value }));

  const { run, pending } = useAction(saveEventAction, {
    success: variant === "create" ? "Termín vytvorený, partia dostala upozornenie." : "Termín upravený.",
    onSuccess: (data) => {
      setOpen(false);
      if (variant === "create") {
        setV(initial);
        router.push(`/terminy/${data.id}`);
      }
    },
  });

  return (
    <>
      {variant === "create" ? (
        <Button onClick={() => setOpen(true)} icon={<CalendarPlus className="size-4" />}>Nový termín</Button>
      ) : (
        <Button variant="secondary" onClick={() => setOpen(true)} icon={<Pencil className="size-4" />}>Upraviť</Button>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={variant === "create" ? "Nový termín" : "Upraviť termín"}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>Zrušiť</Button>
            <Button type="submit" form="event-form" loading={pending}>Uložiť</Button>
          </>
        }
      >
        <form
          id="event-form"
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            run({ ...v, signupClosesAt: v.signupClosesAt || null });
          }}
        >
          <Field label="Dátum a čas">
            {(id) => <Input id={id} type="datetime-local" value={v.startsAt} onChange={(e) => set("startsAt", e.target.value)} required />}
          </Field>
          <Field label="Miesto">
            {(id) => <Input id={id} value={v.location} onChange={(e) => set("location", e.target.value)} placeholder="napr. Umelka pri ZŠ" maxLength={120} />}
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink">Typ zápasu</span>
            <Segmented
              label="Typ zápasu"
              value={v.kind}
              onChange={(kind) => set("kind", kind)}
              options={[
                { value: "internal", label: "Medzi sebou" },
                { value: "external", label: "Proti súperovi" },
              ]}
            />
          </div>
          {v.kind === "external" ? (
            <Field label="Súper">
              {(id) => <Input id={id} value={v.opponent} onChange={(e) => set("opponent", e.target.value)} placeholder="Názov súpera" maxLength={30} required />}
            </Field>
          ) : null}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Max. hráčov" hint="Prázdne = bez limitu">
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  inputMode="numeric"
                  min={2}
                  max={60}
                  value={v.maxPlayers ?? ""}
                  onChange={(e) => set("maxPlayers", e.target.value === "" ? null : Number(e.target.value))}
                />
              )}
            </Field>
            <Field label="Uzávierka" hint="Prázdne = do začiatku">
              {(id) => (
                <Input
                  id={id}
                  type="datetime-local"
                  value={v.signupClosesAt ?? ""}
                  max={v.startsAt}
                  onChange={(e) => set("signupClosesAt", e.target.value || null)}
                />
              )}
            </Field>
          </div>
          <Field label="Poznámka">
            {(id) => <Textarea id={id} value={v.note} onChange={(e) => set("note", e.target.value)} maxLength={500} placeholder="Dresy, platba za halu…" />}
          </Field>
        </form>
      </Modal>
    </>
  );
}
