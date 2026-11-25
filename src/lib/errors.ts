// Preklad chybových kódov z databázy (RPC) na hlášky pre používateľa.
const MESSAGES: Record<string, string> = {
  forbidden: "Na túto akciu nemáš oprávnenie.",
  not_member: "Nie si členom partie.",
  not_found: "Záznam sa nenašiel.",
  no_session: "Nepodarilo sa vytvoriť identitu zariadenia. Skús to znova.",
  already_member: "Toto zariadenie už patrí hráčovi.",
  setup_closed: "Partia je už založená. Požiadaj admina o pozývací link.",
  invalid_link: "Pozývací link je neplatný alebo už neplatí. Vypýtaj si od admina nový.",
  invalid_nickname: "Prezývka musí mať 2 až 24 znakov.",
  rate_limited: "Priveľa pokusov. Skús to znova o hodinu.",
  group_full: "Partia je plná. Ozvi sa adminovi.",
  device_already_linked: "Toto zariadenie je už prepojené s iným hráčom.",
  signup_closed: "Prihlasovanie na tento termín je uzavreté.",
  match_full: "Termín je už plný.",
  match_cancelled: "Termín je zrušený.",
  invalid_lineup: "Zostava obsahuje neplatného alebo duplicitného hráča.",
  empty_lineup: "Pridaj do zostavy aspoň jedného hráča.",
  invalid_score: "Zadaj výsledok zápasu.",
  scorer_not_in_team: "Strelec gólu musí byť v zostave tímu, ktorému gól patrí.",
  assist_not_in_team: "Asistent musí byť v zostave rovnakého tímu ako strelec.",
  goals_exceed_score: "Zapísaných gólov je viac, ako je výsledok.",
  mvp_not_in_lineup: "MVP musí byť hráč zo zostavy.",
  voting_closed: "Hlasovanie je už uzavreté.",
  self_vote: "Nemôžeš hlasovať sám za seba.",
  not_eligible: "Hlasovať môžu iba hráči, ktorí v zápase nastúpili.",
  invalid_candidate: "Tento hráč v zápase nenastúpil.",
  already_voted: "V tomto zápase si už hlasoval.",
  last_admin: "Partia musí mať aspoň jedného aktívneho admina.",
  invalid_options: "Anketa potrebuje 2 až 10 možností, každú s textom do 80 znakov.",
  invalid_deadline: "Koniec hlasovania musí byť v budúcnosti.",
  too_many_polls: "Otvorených ankiet je priveľa. Uzavri staré, potom vytvor novú.",
  poll_closed: "Hlasovanie v tejto ankete je uzavreté.",
  poll_converted: "Z tejto ankety už vznikol termín.",
  single_choice: "V tejto ankete sa dá vybrať len jedna možnosť.",
  no_season: "Najprv vytvor sezónu v Nastaveniach.",
  cannot_delete_self: "Sám seba zmazať nemôžeš. Požiadaj iného admina.",
  avatar_edit_disabled: "Úpravu avatara admin vypol.",
  season_mismatch: "Sezóna nepatrí tejto partii.",
};

export function describeError(error: unknown): string {
  const e = (error ?? {}) as { message?: string; code?: string };
  const message = e.message ?? "";
  if (MESSAGES[message]) return MESSAGES[message];
  if (e.code === "23505") {
    if (message.includes("nickname")) return "Hráč s touto prezývkou už existuje.";
    if (message.includes("seasons")) return "Sezóna s týmto názvom už existuje.";
    return "Taký záznam už existuje.";
  }
  if (e.code === "23514") return "Niektorá hodnota je mimo povoleného rozsahu.";
  if (e.code === "23503") return "Operáciu sa nepodarilo dokončiť, lebo na záznam odkazujú iné údaje.";
  if (e.code === "42501") return MESSAGES.forbidden;
  if (/fetch failed|network|ECONN|ENOTFOUND|timeout/i.test(message)) {
    return "Server je nedostupný. Skontroluj pripojenie a skús to znova.";
  }
  // Interné detaily (SQL, stack) používateľovi neukazujeme.
  console.error("[matchday] neočakávaná chyba:", e.code, message);
  return "Niečo sa pokazilo. Skús to znova.";
}

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

export const ok = <T = undefined>(data?: T): ActionResult<T> => ({ ok: true, data: data as T });
export const fail = (error: string): ActionResult<never> => ({ ok: false, error });
