// Verejné nastavenia Supabase. Kľúč je "publishable/anon" – je určený pre klienta
// a sám o sebe nedáva žiadne práva (všetko stráži RLS). Service role kľúč aplikácia nepoužíva.
export function getSupabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return { url, key };
}

export const TIME_ZONE = "Europe/Bratislava";
