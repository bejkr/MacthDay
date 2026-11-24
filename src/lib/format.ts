import type { Enum } from "./supabase/database.types";

export const POSITION_LABEL: Record<Enum<"player_position">, string> = {
  GK: "Brankár",
  DEF: "Obranca",
  MID: "Záložník",
  ATT: "Útočník",
};
export const POSITION_SHORT: Record<Enum<"player_position">, string> = { GK: "BR", DEF: "OB", MID: "ZÁ", ATT: "ÚT" };

export const TREASURY_LABEL: Record<Enum<"treasury_type">, string> = {
  fine: "Pokuta",
  payment: "Platba hráča",
  contribution: "Príspevok",
  expense: "Výdavok",
  income: "Iný príjem",
};

export const ATTENDANCE_LABEL: Record<Enum<"attendance_status">, string> = {
  yes: "Prídem",
  no: "Neprídem",
  maybe: "Možno",
};

const money = new Intl.NumberFormat("sk-SK", { style: "currency", currency: "EUR" });
export const formatMoney = (value: number | string) => money.format(Number(value)).replace(/ /g, " ");

export function plural(n: number, one: string, few: string, many: string) {
  if (n === 1) return `${n} ${one}`;
  if (n >= 2 && n <= 4) return `${n} ${few}`;
  return `${n} ${many}`;
}

/** Iba správny tvar slova podľa počtu (bez čísla). */
export function pluralWord(n: number, one: string, few: string, many: string) {
  return n === 1 ? one : n >= 2 && n <= 4 ? few : many;
}

export const cn = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(" ");

export const AVATAR_COLORS = [
  "#78C95A", "#B7F36B", "#5AC9A8", "#5AA9C9", "#8B8DF0",
  "#C98BE8", "#E8B65A", "#F0906A", "#F06464", "#8D9990",
];
