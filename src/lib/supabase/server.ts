import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseEnv } from "@/lib/env";
import type { Database } from "./database.types";

export class MissingConfigError extends Error {
  constructor() {
    super("Chýba konfigurácia Supabase (NEXT_PUBLIC_SUPABASE_URL a kľúč).");
  }
}

// Session cookies sú httpOnly – JavaScript v prehliadači sa k tokenom nedostane.
// Celá komunikácia so Supabase preto prebieha na serveri (Server Components a Server Actions).
export function hardenCookie<T extends object>(options: T) {
  return {
    ...options,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
  };
}

export async function createClient() {
  const env = getSupabaseEnv();
  if (!env) throw new MissingConfigError();
  const cookieStore = await cookies();

  return createServerClient<Database>(env.url, env.key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) {
            cookieStore.set(name, value, hardenCookie(options));
          }
        } catch {
          // Volané zo Server Component – cookies tam meniť nemožno.
          // Obnovu tokenov rieši proxy.ts pri každej požiadavke.
        }
      },
    },
  });
}

export type Supabase = Awaited<ReturnType<typeof createClient>>;
