"use client";

import { Camera, KeyRound, Pencil, Smartphone, Trash2, UserPlus, X } from "lucide-react";
import { useRef, useState } from "react";
import {
  createPlayerAction, createRecoveryLinkAction, deletePlayerAction, removeAvatarAction, removeDeviceAction,
  updatePlayerAction, uploadAvatarAction,
} from "@/lib/actions/players";
import { AVATAR_COLORS, cn, POSITION_LABEL } from "@/lib/format";
import type { Enum } from "@/lib/supabase/database.types";
import { InviteLinkBox } from "./invite-link-box";
import { PlayerAvatar } from "./player-avatar";
import { Button } from "./ui/button";
import { Field, Input, Segmented, Select, Toggle } from "./ui/form";
import { Modal } from "./ui/modal";
import { useToast } from "./ui/toast";
import { useAction } from "./use-action";

type Position = Enum<"player_position">;
type Skill = "1" | "2" | "3" | "4" | "5";

type ProfileValues = { nickname: string; jerseyNumber: number | null; position: Position | null; skill: number };

function ProfileFields({ v, set }: { v: ProfileValues; set: (patch: Partial<ProfileValues>) => void }) {
  return (
    <>
      <Field label="Prezývka">
        {(id) => <Input id={id} value={v.nickname} onChange={(e) => set({ nickname: e.target.value })} minLength={2} maxLength={24} required />}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Číslo dresu">
          {(id) => (
            <Input
              id={id}
              type="number"
              inputMode="numeric"
              min={0}
              max={99}
              value={v.jerseyNumber ?? ""}
              onChange={(e) => set({ jerseyNumber: e.target.value === "" ? null : Number(e.target.value) })}
            />
          )}
        </Field>
        <Field label="Pozícia">
          {(id) => (
            <Select id={id} value={v.position ?? ""} onChange={(e) => set({ position: (e.target.value || null) as Position | null })}>
              <option value="">Univerzál</option>
              {(Object.keys(POSITION_LABEL) as Position[]).map((p) => (
                <option key={p} value={p}>{POSITION_LABEL[p]}</option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-ink">Hodnotenie schopností</span>
        <Segmented<Skill>
          label="Hodnotenie schopností"
          value={String(v.skill) as Skill}
          onChange={(s) => set({ skill: Number(s) })}
          options={(["1", "2", "3", "4", "5"] as Skill[]).map((s) => ({ value: s, label: s }))}
        />
        <p className="text-xs text-muted">Používa sa pri rozdeľovaní do vyrovnaných tímov. 1 = začiatočník, 5 = ťahúň.</p>
      </div>
    </>
  );
}

/** Admin: pripraviť hráča vopred (ešte bez zariadenia). */
export function PlayerCreateButton() {
  const blank: ProfileValues = { nickname: "", jerseyNumber: null, position: null, skill: 3 };
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(blank);
  const { run, pending } = useAction(createPlayerAction, {
    success: "Hráč pridaný.",
    onSuccess: () => {
      setOpen(false);
      setV(blank);
    },
  });
  return (
    <>
      <Button onClick={() => setOpen(true)} icon={<UserPlus className="size-4" />}>Pridať hráča</Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Nový hráč"
        description="Hráč sa neskôr prihlási cez pozývací link touto prezývkou a ty jeho zariadenie potvrdíš."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>Zrušiť</Button>
            <Button type="submit" form="player-create" loading={pending}>Pridať</Button>
          </>
        }
      >
        <form id="player-create" className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); run(v); }}>
          <ProfileFields v={v} set={(patch) => setV((prev) => ({ ...prev, ...patch }))} />
        </form>
      </Modal>
    </>
  );
}

export type PlayerEditValues = ProfileValues & {
  id: string;
  avatarColor: string;
  role: "admin" | "player";
  isActive: boolean;
  joinedOn: string;
};

export function PlayerEditButton({ initial }: { initial: PlayerEditValues }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(initial);
  const set = (patch: Partial<PlayerEditValues>) => setV((prev) => ({ ...prev, ...patch }));
  const { run, pending } = useAction(updatePlayerAction, { success: "Profil uložený.", onSuccess: () => setOpen(false) });

  return (
    <>
      <Button variant="secondary" onClick={() => { setV(initial); setOpen(true); }} icon={<Pencil className="size-4" />}>
        Upraviť profil
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Upraviť hráča"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>Zrušiť</Button>
            <Button type="submit" form="player-edit" loading={pending}>Uložiť</Button>
          </>
        }
      >
        <form id="player-edit" className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); run(v); }}>
          <ProfileFields v={v} set={set} />
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-ink">Farba avatara</span>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Farba avatara">
              {AVATAR_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={v.avatarColor.toLowerCase() === c.toLowerCase()}
                  aria-label={`Farba ${c}`}
                  onClick={() => set({ avatarColor: c })}
                  className={cn("size-9 rounded-full ring-offset-2 ring-offset-surface transition", v.avatarColor.toLowerCase() === c.toLowerCase() && "ring-2 ring-ink")}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          <Field label="V partii od" hint="Dochádzka sa počíta zo zápasov od tohto dátumu.">
            {(id) => <Input id={id} type="date" value={v.joinedOn} onChange={(e) => set({ joinedOn: e.target.value })} required />}
          </Field>
          <div className="flex flex-col gap-2 rounded-2xl border border-line bg-bg/50 p-3.5">
            <Toggle label="Admin" hint="Môže spravovať termíny, zápasy, hráčov a pokladnicu." checked={v.role === "admin"} onChange={(on) => set({ role: on ? "admin" : "player" })} />
            <Toggle label="Aktívny hráč" hint="Vypnutím stratia všetky jeho zariadenia prístup. História ostáva." checked={v.isActive} onChange={(on) => set({ isActive: on })} />
          </div>
        </form>
      </Modal>
    </>
  );
}

/** Zmenší obrázok v prehliadači, aby sa neposielali megabajty z fotoaparátu. Server ho aj tak zakóduje nanovo. */
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, 640 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("toBlob"))), "image/jpeg", 0.85),
  );
}

type AvatarProps = { playerId: string; nickname: string; avatarUrl: string | null; color: string; jerseyNumber: number | null; canEdit: boolean };

/** Avatar s tlačidlom na nahratie fotky (s náhľadom). */
export function AvatarUploader({ playerId, nickname, avatarUrl, color, jerseyNumber, canEdit }: AvatarProps) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const upload = useAction(uploadAvatarAction, { success: "Fotka nahratá.", onSuccess: () => setPreview(null) });
  const remove = useAction(removeAvatarAction, { success: "Fotka odstránená." });

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Vyber obrázok.");
      return;
    }
    setPreparing(true);
    try {
      const blob = await shrink(file);
      setPreview(URL.createObjectURL(blob));
      const form = new FormData();
      form.set("playerId", playerId);
      form.set("file", new File([blob], "avatar.jpg", { type: "image/jpeg" }));
      upload.run(form);
    } catch {
      toast.error("Tento obrázok sa nepodarilo spracovať. Skús inú fotku.");
    } finally {
      setPreparing(false);
      if (input.current) input.current.value = "";
    }
  }

  const busy = preparing || upload.pending || remove.pending;

  return (
    <div className="relative shrink-0">
      <PlayerAvatar nickname={nickname} avatarUrl={preview ?? avatarUrl} color={color} size="xl" jerseyNumber={jerseyNumber} className={busy ? "opacity-60" : undefined} />
      {canEdit ? (
        <>
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} onChange={(e) => onFile(e.target.files?.[0])} />
          <button
            type="button"
            disabled={busy}
            onClick={() => input.current?.click()}
            className="absolute -top-1 -left-1 flex size-9 items-center justify-center rounded-full border-2 border-bg bg-primary text-bg active:scale-95 disabled:opacity-60"
            aria-label="Nahrať fotku"
          >
            <Camera className="size-4" />
          </button>
          {avatarUrl && !preview ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => window.confirm("Odstrániť fotku?") && remove.run(playerId)}
              className="absolute -top-1 -right-1 flex size-7 items-center justify-center rounded-full border-2 border-bg bg-elevated text-muted hover:text-danger"
              aria-label="Odstrániť fotku"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

type Device = { id: string; label: string | null; createdAt: string; lastSeen: string; isCurrent: boolean };

/** Admin: zariadenia hráča, ich odpojenie a jednorazový link na obnovu prístupu. */
export function DeviceManager({ playerId, nickname, groupName, devices }: { playerId: string; nickname: string; groupName: string; devices: Device[] }) {
  const [token, setToken] = useState<string | null>(null);
  const remove = useAction(removeDeviceAction, { success: "Zariadenie odpojené." });
  const recovery = useAction(createRecoveryLinkAction, { onSuccess: (data) => setToken(data.token) });

  return (
    <div className="flex flex-col gap-3 p-4">
      {devices.length === 0 ? (
        <p className="text-sm text-muted">Hráč zatiaľ nemá pripojené žiadne zariadenie.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {devices.map((d) => (
            <li key={d.id} className="flex items-center gap-3 rounded-xl border border-line bg-bg/50 px-3 py-2.5">
              <Smartphone className="size-4 shrink-0 text-muted" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-ink">
                  {d.label ?? "Zariadenie"}
                  {d.isCurrent ? <span className="ml-1.5 text-xs font-normal text-primary">toto zariadenie</span> : null}
                </div>
                <div className="text-xs text-muted">pridané {d.createdAt} · naposledy {d.lastSeen}</div>
              </div>
              {!d.isCurrent ? (
                <Button
                  variant="danger"
                  size="sm"
                  loading={remove.pending}
                  onClick={() => window.confirm(`Odpojiť zariadenie „${d.label ?? "Zariadenie"}“? Stratí prístup k hráčovi ${nickname}.`) && remove.run(d.id)}
                  icon={<Trash2 className="size-3.5" />}
                >
                  Odpojiť
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {token ? (
        <InviteLinkBox token={token} groupName={groupName} note={`Jednorazový link pre hráča ${nickname}, platí 24 hodín. Pošli mu ho súkromne.`} />
      ) : (
        <Button variant="secondary" loading={recovery.pending} onClick={() => recovery.run(playerId)} icon={<KeyRound className="size-4" />}>
          Link na obnovu prístupu
        </Button>
      )}
    </div>
  );
}

/** Zmazanie hráča – tlačidlo patrí do profilu hráča, ktorého sa týka. */
export function DeletePlayerButton({ playerId, nickname, debt }: { playerId: string; nickname: string; debt: number }) {
  const { run, pending } = useAction(deletePlayerAction);
  function confirmAndDelete() {
    const lines = [
      `Zmazať hráča ${nickname}?`,
      "",
      "• Stratí prístup do appky na všetkých zariadeniach.",
      "• Zmaže sa jeho fotka, e-mail a prihlásenia na budúce termíny.",
      "• Ak už hral zápasy alebo má záznamy v pokladnici, ostane v histórii ako „Bývalý hráč“, aby sedeli výsledky a súčty.",
    ];
    if (debt > 0) lines.push("", `Pozor: má nezaplatený dlh ${debt.toFixed(2).replace(".", ",")} €. V pokladnici ostane pod „Bývalý hráč“.`);
    lines.push("", "Nedá sa to vrátiť.");
    if (window.confirm(lines.join("\n"))) run(playerId);
  }
  return (
    <Button variant="danger" loading={pending} onClick={confirmAndDelete} icon={<Trash2 className="size-4" />}>
      Zmazať hráča
    </Button>
  );
}
