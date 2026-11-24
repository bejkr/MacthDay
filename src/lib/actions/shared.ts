import "server-only";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { describeError, fail, ok, type ActionResult } from "@/lib/errors";
import { createClient, MissingConfigError, type Supabase } from "@/lib/supabase/server";

/** Server-side validácia vstupu. Vráti prvú chybu ako hlášku pre používateľa. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): { data: z.infer<S> } | { error: string } {
  const result = schema.safeParse(input);
  if (result.success) return { data: result.data };
  return { error: result.error.issues[0]?.message || "Neplatné údaje." };
}

type DbResult = { error: unknown };

/**
 * Spoločný obal serverových akcií: vytvorí klienta so session používateľa,
 * zachytí chyby, preloží ich a po úspechu zneplatní vyrenderované stránky.
 * Autorizáciu nerobí – tú vynucuje databáza (RLS + kontroly v RPC).
 */
export async function act<T = undefined>(
  fn: (supabase: Supabase) => Promise<ActionResult<T> | DbResult | void>,
): Promise<ActionResult<T>> {
  try {
    const supabase = await createClient();
    const result = await fn(supabase);
    if (result && "ok" in result) {
      if (result.ok) revalidatePath("/", "layout");
      return result;
    }
    if (result && "error" in result && result.error) return fail(describeError(result.error));
    revalidatePath("/", "layout");
    return ok() as ActionResult<T>;
  } catch (error) {
    if (error instanceof MissingConfigError) return fail(error.message);
    return fail(describeError(error));
  }
}

/** Krátky popis zariadenia do zoznamu zariadení hráča (nie je to bezpečnostný údaj). */
export async function deviceLabel() {
  const ua = (await headers()).get("user-agent") ?? "";
  const os = /iPhone/.test(ua) ? "iPhone"
    : /iPad/.test(ua) ? "iPad"
    : /Android/.test(ua) ? "Android"
    : /Windows/.test(ua) ? "Windows"
    : /Mac OS X/.test(ua) ? "Mac"
    : /Linux/.test(ua) ? "Linux" : "Zariadenie";
  const browser = /Edg\//.test(ua) ? "Edge"
    : /OPR\//.test(ua) ? "Opera"
    : /Firefox\//.test(ua) ? "Firefox"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari" : "";
  return browser ? `${os} · ${browser}` : os;
}

// Pomocný limit na IP adresu pre vytváranie identít. Je len v pamäti jednej
// serverovej inštancie, preto je to doplnok – hlavné limity sú v databáze
// (join_group) a v Supabase Auth (limit anonymných prihlásení).
const hits = new Map<string, number[]>();

export async function ipThrottle(bucket: string, max: number, windowMs: number) {
  const h = await headers();
  const ip = (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "unknown";
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.clear();
  return true;
}

/**
 * Zavolá RPC, ktoré viaže zariadenie na hráča. Ak session patrí identite, ktorá
 * medzičasom na serveri zanikla (cudzí kľúč 23503), vytvorí novú a skúsi to raz znova.
 */
export async function withIdentity<R extends { error: { code?: string } | null }>(
  supabase: Supabase,
  call: () => PromiseLike<R>,
): Promise<R | null> {
  if (!(await ensureIdentity(supabase))) return null;
  const first = await call();
  if (first.error?.code !== "23503") return first;
  await supabase.auth.signOut({ scope: "local" });
  if (!(await ensureIdentity(supabase))) return null;
  return call();
}

/** Zabezpečí, že zariadenie má (anonymnú) Supabase identitu. Cookies nastavuje server ako httpOnly. */
export async function ensureIdentity(supabase: Supabase) {
  const { data } = await supabase.auth.getClaims();
  if (data?.claims?.sub) return true;
  const { error } = await supabase.auth.signInAnonymously();
  if (error) {
    console.error("[matchday] anonymné prihlásenie zlyhalo:", error.message);
    return false;
  }
  return true;
}
