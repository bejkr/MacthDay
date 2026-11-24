// MATCHDAY · voliteľné e-mailové upozornenia (Supabase Edge Function, Deno)
//
// Odošle e-mailom upozornenia, ktoré ešte neboli odoslané, hráčom so zapnutým
// e-mailom (tabuľka player_contacts). Bez nastavenia tejto funkcie aplikácia
// funguje ďalej – upozornenia sú vždy v aplikácii.
//
// Nasadenie a plánovanie: pozri README, časť „E-mailové upozornenia“.
// Tajomstvá (supabase secrets set …):
//   RESEND_API_KEY   – API kľúč služby Resend
//   EMAIL_FROM       – odosielateľ, napr. "Matchday <matchday@tvoja-domena.sk>"
//   APP_URL          – adresa aplikácie, napr. https://matchday.vercel.app
//   CRON_SECRET      – náhodný reťazec; funkciu smie volať iba ten, kto ho pozná
// SUPABASE_URL a SUPABASE_SERVICE_ROLE_KEY poskytuje Supabase funkcii automaticky.
// Service role kľúč existuje iba tu na serveri Supabase, nikdy nie v Next.js aplikácii.

import { createClient } from "jsr:@supabase/supabase-js@2";

const BATCH = 50;
const MAX_AGE_HOURS = 24; // staršie upozornenia už e-mailom neposielame

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function timingSafeEqual(a: string, b: string) {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

Deno.serve(async (req) => {
  const secret = Deno.env.get("CRON_SECRET");
  const auth = req.headers.get("authorization") ?? "";
  // Secret ide v hlavičke Authorization, nie v URL (tá by ostala v logoch).
  if (!secret || !timingSafeEqual(auth, `Bearer ${secret}`)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const resendKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("EMAIL_FROM");
  const appUrl = (Deno.env.get("APP_URL") ?? "").replace(/\/$/, "");
  if (!resendKey || !from || !appUrl) {
    return Response.json({ error: "missing_configuration" }, { status: 500 });
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  const since = new Date(Date.now() - MAX_AGE_HOURS * 3_600_000).toISOString();
  const { data: queue, error } = await supabase
    .from("notifications")
    .select("id, player_id, title, body, link, created_at")
    .is("emailed_at", null)
    .is("read_at", null)
    .gte("created_at", since)
    .order("created_at")
    .limit(BATCH);
  if (error) return Response.json({ error: "query_failed" }, { status: 500 });
  if (!queue?.length) return Response.json({ sent: 0 });

  const { data: contacts } = await supabase
    .from("player_contacts")
    .select("player_id, email")
    .eq("email_enabled", true)
    .in("player_id", [...new Set(queue.map((n) => n.player_id))]);
  const emailOf = new Map((contacts ?? []).map((c) => [c.player_id, c.email]));

  let sent = 0;
  const done: string[] = [];

  for (const n of queue) {
    const to = emailOf.get(n.player_id);
    if (!to) {
      done.push(n.id); // hráč e-maily nechce – označíme, aby sa položka nevracala do fronty
      continue;
    }
    const url = `${appUrl}${n.link ?? "/"}`;
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to,
        subject: `Matchday: ${n.title}`,
        text: `${n.title}\n\n${n.body ?? ""}\n\nOtvoriť v aplikácii: ${url}\n\nE-maily vypneš v aplikácii: Nastavenia → Upozornenia e-mailom.`,
        html: `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px;background:#0B0E0D;color:#F5F7F3;border-radius:16px">
<p style="margin:0 0 4px;color:#B7F36B;font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:13px">Matchday</p>
<h1 style="margin:0 0 12px;font-size:22px">${escapeHtml(n.title)}</h1>
<p style="margin:0 0 20px;color:#8D9990;line-height:1.5">${escapeHtml(n.body ?? "")}</p>
<a href="${escapeHtml(url)}" style="display:inline-block;background:#B7F36B;color:#0B0E0D;font-weight:600;text-decoration:none;padding:12px 18px;border-radius:12px">Otvoriť v aplikácii</a>
<p style="margin:24px 0 0;color:#8D9990;font-size:12px">E-maily vypneš v aplikácii: Nastavenia → Upozornenia e-mailom.</p>
</div>`,
      }),
    });
    if (response.ok) {
      sent++;
      done.push(n.id);
    }
    // Pri chybe položku neoznačíme – skúsi sa pri ďalšom behu (najviac 24 h).
  }

  if (done.length) {
    await supabase.from("notifications").update({ emailed_at: new Date().toISOString() }).in("id", done);
  }
  return Response.json({ sent, processed: done.length });
});
