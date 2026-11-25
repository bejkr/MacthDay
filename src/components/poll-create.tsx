"use client";

import { ListChecks, Plus, X } from "lucide-react";
import { useRef, useState } from "react";
import { createPollAction } from "@/lib/actions/polls";
import { Button } from "./ui/button";
import { Field, Input, Textarea, Toggle } from "./ui/form";
import { Modal } from "./ui/modal";
import { useToast } from "./ui/toast";
import { useAction } from "./use-action";

type OptionDraft = { key: number; label: string; startsAt: string };

const blankOptions = (): OptionDraft[] => [
  { key: 1, label: "", startsAt: "" },
  { key: 2, label: "", startsAt: "" },
];

/** Nová anketa – môže ju vytvoriť ktorýkoľvek hráč. */
export function PollCreateButton() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("Kedy môžete hrať?");
  const [note, setNote] = useState("");
  const [allowMultiple, setAllowMultiple] = useState(true);
  const [options, setOptions] = useState<OptionDraft[]>(blankOptions);
  const nextKey = useRef(3);

  const { run, pending } = useAction(createPollAction, {
    success: "Anketa vytvorená, partia dostala upozornenie.",
    onSuccess: () => {
      setOpen(false);
      setTitle("Kedy môžete hrať?");
      setNote("");
      setAllowMultiple(true);
      setOptions(blankOptions());
    },
  });

  const update = (key: number, patch: Partial<OptionDraft>) =>
    setOptions((list) => list.map((o) => (o.key === key ? { ...o, ...patch } : o)));

  function submit() {
    const filled = options.filter((o) => o.label.trim());
    if (filled.length < 2) {
      toast.error("Vyplň aspoň 2 možnosti.");
      return;
    }
    run({
      title,
      note,
      allowMultiple,
      options: filled.map((o) => ({ label: o.label, startsAt: o.startsAt || null })),
    });
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} icon={<ListChecks className="size-4" />}>
        Nová anketa
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Nová anketa"
        description="Hráči označia, čo im vyhovuje. Admin potom z vybranej možnosti spraví termín."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>Zrušiť</Button>
            <Button type="submit" form="poll-form" loading={pending}>Vytvoriť</Button>
          </>
        }
      >
        <form
          id="poll-form"
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <Field label="Otázka">
            {(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} minLength={2} maxLength={100} required />}
          </Field>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-ink">Možnosti</span>
            {options.map((o, i) => (
              <div key={o.key} className="rounded-2xl border border-line bg-bg/50 p-2.5">
                <div className="flex items-center gap-2">
                  <Input
                    aria-label={`Možnosť ${i + 1}`}
                    value={o.label}
                    onChange={(e) => update(o.key, { label: e.target.value })}
                    placeholder={i === 0 ? "napr. Sobota ráno vonku" : i === 1 ? "napr. Nedeľa poobede hala" : "Ďalšia možnosť"}
                    maxLength={80}
                  />
                  {options.length > 2 ? (
                    <button
                      type="button"
                      onClick={() => setOptions((list) => list.filter((x) => x.key !== o.key))}
                      className="flex size-10 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-elevated hover:text-danger"
                      aria-label={`Odstrániť možnosť ${i + 1}`}
                    >
                      <X className="size-4" />
                    </button>
                  ) : null}
                </div>
                <label className="mt-2 flex items-center gap-2 text-xs text-muted">
                  <span className="shrink-0">Dátum a čas (nepovinné)</span>
                  <input
                    type="datetime-local"
                    value={o.startsAt}
                    onChange={(e) => update(o.key, { startsAt: e.target.value })}
                    className="h-9 min-w-0 flex-1 rounded-lg border border-line-strong bg-bg px-2 text-sm text-ink"
                  />
                </label>
              </div>
            ))}
            {options.length < 10 ? (
              <Button
                variant="ghost"
                size="sm"
                className="self-start"
                onClick={() => setOptions((list) => [...list, { key: nextKey.current++, label: "", startsAt: "" }])}
                icon={<Plus className="size-4" />}
              >
                Pridať možnosť
              </Button>
            ) : null}
          </div>

          <Toggle label="Dá sa vybrať viac možností" checked={allowMultiple} onChange={setAllowMultiple} />

          <Field label="Poznámka (nepovinné)">
            {(id) => <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="napr. ak bude pršať, ideme do haly" />}
          </Field>
        </form>
      </Modal>
    </>
  );
}
