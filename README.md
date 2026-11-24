# MATCHDAY

Súkromná webová aplikácia (PWA) pre amatérsku futbalovú partiu: termíny a dochádzka, zápasy, góly a asistencie,
MVP hlasovanie, rebríčky, rozdeľovanie tímov, pokuty a spoločná pokladnica, upozornenia.

Hráči sa **neregistrujú** – žiadne e-maily ani heslá. Admin pošle do skupiny jeden pozývací link, hráč zadá prezývku
a zariadenie si ho zapamätá.

- **Next.js 16** (App Router, Server Components, Server Actions) · **TypeScript** · **Tailwind CSS 4**
- **Supabase** – PostgreSQL, anonymná autentifikácia, RLS, Storage
- **Recharts** (grafy) · **Lucide** (ikony) · PWA (manifest + service worker)

---

## Čo treba doplniť (bez toho aplikácia nepobeží)

| Čo | Kde to získaš | Kam to patrí |
| --- | --- | --- |
| Supabase projekt | [supabase.com](https://supabase.com) → New project (región napr. EU Frankfurt) | – |
| `NEXT_PUBLIC_SUPABASE_URL` | Project Settings → API | `.env.local`, Vercel |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Project Settings → API keys (publishable / anon) | `.env.local`, Vercel |
| Zapnuté **Anonymous sign-ins** | Authentication → Sign In / Providers | Supabase dashboard |

Service role kľúč aplikácia **nepoužíva** – nikam ho nevkladaj.

---

## Spustenie

```bash
npm install
cp .env.example .env.local      # doplň URL a publishable key
```

### 1. Databáza

Prepoj projekt a nahraj migrácie (Supabase CLI):

```bash
supabase login
supabase link --project-ref <ref-tvojho-projektu>
supabase db push
```

Migrácie sú v `supabase/migrations/` a vytvoria celú schému, RLS politiky, RPC funkcie, úložisko avatarov
a plánovač (pg_cron). Bez CLI ich môžeš postupne vložiť do SQL editora v dashboarde – v poradí podľa názvu súboru.

### 2. Nastavenia Supabase

V dashboarde:

1. **Authentication → Sign In / Providers → Allow anonymous sign-ins: zapnúť.** Bez toho sa nikto nepripojí.
2. **Authentication → Rate Limits → Anonymous sign-ins:** nechaj predvolených 30/hod. Je to strop, koľko nových
   zariadení môže za hodinu vzniknúť.
3. Voliteľne **Authentication → Attack Protection → CAPTCHA** (Turnstile), ak by link unikol mimo partie.
4. **Database → Extensions → pg_cron:** ak nie je zapnuté, zapni a spusti znova poslednú migráciu
   (`…_storage_cron.sql`). Bez pg_cron aplikácia funguje, pripomienky sa len vytvárajú až pri otvorení appky.

### 3. Aplikácia

```bash
npm run dev          # http://localhost:3000
```

Otvor `/` → **Založiť partiu** → zadaj názov partie a svoju prezývku. Si prvý admin a dostaneš pozývací link.
Založenie je možné iba raz (`app_config.max_groups = 1`); potom sa tlačidlo skryje.

### Lokálny Supabase (voliteľné, vyžaduje Docker)

```bash
supabase start       # lokálny Postgres + Auth + Storage, migrácie sa aplikujú samy
supabase status      # vypíše URL a kľúče do .env.local
npm run db:types     # pregeneruje TypeScript typy zo schémy
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f scripts/dev-seed.sql   # demo dáta (iba lokálne!)
```

`scripts/dev-seed.sql` naplní partiu vymyslenými hráčmi a zápasmi. Je určený výhradne na vývoj – v produkcii
žiadne ukážkové dáta nie sú, všetky obrazovky čítajú z databázy.

---

## Nasadenie na Vercel

1. Nahraj repozitár na GitHub (`.env.local` sa necommituje, je v `.gitignore`).
2. Vercel → **Add New Project** → vyber repozitár. Framework sa rozpozná sám.
3. **Environment Variables:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   (pre Production aj Preview). Musia byť nastavené **pred buildom**.
4. Deploy. Potom v Supabase → Authentication → URL Configuration nastav **Site URL** na adresu aplikácie.
5. Otvor appku, založ partiu, pošli link do skupiny.

Po nasadení over na mobile: inštaláciu na plochu (iPhone: Safari → Zdieľať → Pridať na plochu; Android: Chrome →
menu → Inštalovať), že po zatvorení a otvorení ostávaš prihlásený, a nahratie fotky.

---

## Ako funguje prihlásenie bez registrácie

1. Admin vygeneruje **pozývací link** `https://…/pozvanka#<token>`. Token (244 bitov náhody) je v časti za `#`,
   ktorú prehliadač neposiela na server – nie je v logoch ani v náhľadoch odkazov. V databáze je iba jeho
   **SHA-256 hash**; link sa zobrazí raz a dá sa kedykoľvek vymeniť (rotácia) alebo zablokovať.
2. Hráč otvorí link a zadá prezývku. Server mu vytvorí **anonymnú Supabase identitu** (session v httpOnly cookie)
   a funkcia `join_group` ju prepojí s hráčom (`player_devices`).
3. Pri ďalšej návšteve stačí cookie – appka otvorí rovno prehľad.

**Prezývka nie je heslo.** Ak niekto zadá prezývku, ktorá už existuje, nedostane sa k nej – vznikne čakajúca
žiadosť (`access_requests`) a admin ju schváli alebo zamietne v Nastaveniach. Rovnako sa rieši nový mobil.
Rýchlejšia cesta: admin v profile hráča vytvorí **jednorazový link na obnovu** (platí 24 h).

Ochrany: limit pokusov na zariadenie (8/hod) a na link (30/hod) v databáze, limit hráčov partie, limit použití
a platnosť linku, limit anonymných prihlásení v Supabase Auth, pomocný limit na IP v serverových akciách.

Rolu (admin/hráč) aj partiu určuje vždy databáza z overenej session. Klient ju nikde neposiela a nevie si ju zmeniť.

---

## Bezpečnostný model

- **RLS na každej tabuľke.** Člen číta údaje svojej partie; cudzia partia je neviditeľná.
- **Zápisy** idú dvoma cestami: admin cez RLS politiky (termíny, hráči, pokladnica, nastavenia) a hráč cez úzke
  RPC funkcie, ktoré si samy overia volajúceho (`set_attendance`, `cast_mvp_vote`, `set_avatar`…).
  Priamy zápis do dochádzky, hlasov, zostáv či upozornení je zakázaný aj pre admina.
- **MVP hlasovanie je tajné** – každý vidí iba svoj hlas, počty až po uzavretí. Jeden hlas na zápas, nie za seba.
- **Pokladnica:** hráč vidí svoje položky, spoločné príjmy/výdavky a celkovú hotovosť. Zostatky ostatných vidí iba admin.
- **E-mail** (voliteľný) je v samostatnej tabuľke a vidí ho iba jeho majiteľ – ani admin nie.
- **Žiadny service role kľúč** v aplikácii. Session cookie je `httpOnly` + `secure` + `sameSite=lax`,
  JavaScript v prehliadači sa k tokenom nedostane; so Supabase komunikuje iba server.
- **Avatary** sa na serveri vždy nanovo zakódujú (sharp → JPEG 256 px), čím sa zahodia metadáta a skrytý obsah.
- HTTP hlavičky: CSP, HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `noindex`.

Štatistiky sa **nikde neukladajú ako súčty** – počítajú sa z histórie (`player_stats`, `player_history`,
`group_summary`). Oprava zápasu sa preto okamžite prejaví všade.

---

## Testy

```bash
npm run typecheck    # TypeScript
npm run lint         # ESLint
npm test             # algoritmus rozdeľovania tímov
npm run test:db      # migrácie + ~140 kontrol RLS a pravidiel na čistom PostgreSQL
```

`npm run test:db` potrebuje lokálny PostgreSQL (`psql`, `createdb` v PATH; nastav `PGPORT`/`PGUSER`/`PGPASSWORD`).
Skript vytvorí dočasnú databázu `matchday_test`, nasimuluje viac zariadení a overí napríklad, že hráč si nevie
nastaviť rolu admina, cudzia partia nič nevidí, existujúca prezývka nedá prístup, hlasovať sa nedá dvakrát ani za
seba, a že pokuta nezvyšuje hotovosť. Na konci databázu zmaže. Proti lokálnemu Supabase stačí:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/rls.test.sql
```

(test beží v transakcii a končí `ROLLBACK`, nič po sebe nenechá).

---

## E-mailové upozornenia (voliteľné)

Upozornenia sú vždy v aplikácii. E-mail je doplnok pre hráčov, ktorí si ho sami zapnú v Nastaveniach.

```bash
supabase secrets set RESEND_API_KEY=… EMAIL_FROM="Matchday <matchday@tvoja-domena.sk>" APP_URL=https://… CRON_SECRET=$(openssl rand -hex 32)
supabase functions deploy send-notification-emails --no-verify-jwt
```

Plánované spúšťanie každých 10 minút (SQL editor; secret ulož do Vault, nie do SQL):

```sql
select vault.create_secret('<CRON_SECRET>', 'matchday_cron_secret');
select cron.schedule('matchday-emails', '*/10 * * * *', $$
  select net.http_post(
    url := 'https://<ref>.supabase.co/functions/v1/send-notification-emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'matchday_cron_secret'))
  )$$);
```

Odosielateľ (`EMAIL_FROM`) musí byť z domény overenej v Resend, inak pošta skončí v spame.

---

## Štruktúra

```
supabase/migrations/        schéma, RLS, RPC, storage + cron
supabase/tests/             RLS testy
supabase/functions/         edge funkcia na e-maily
src/proxy.ts                obnova session pri každej požiadavke
src/lib/auth.ts             kto je prihlásený (whoami) a presmerovania
src/lib/data.ts             všetky čítania z databázy
src/lib/actions/            serverové akcie (validácia zod + volanie DB)
src/lib/teams.ts            rozdeľovanie tímov (+ testy)
src/components/ui/          Button, Card, Badge, Modal, formulárové prvky, Toast
src/components/             PlayerAvatar, MatchCard, Leaderboard, AttendanceStatus, navigácia…
src/app/(public)/           úvod, založenie partie, pozvánka, čakanie na schválenie
src/app/(app)/              prehľad, termíny, zápasy, štatistiky, hráči, pokladnica, upozornenia, nastavenia
public/sw.js                service worker (offline obrazovka, cache statických súborov)
```

## Dobré vedieť

- **Časové pásmo** je `Europe/Bratislava` (`src/lib/env.ts` a formátovanie v SQL upozorneniach).
- **Offline:** appka ukáže offline obrazovku a pruh „Si offline“. Zápisy sa offline neodosielajú ani neodkladajú
  do fronty – nevzniknú tak neaktuálne či duplicitné záznamy.
- **Dochádzka v %** = v koľkých odohraných zápasoch (od dátumu „V partii od“) hráč naozaj nastúpil.
  Odpoveď Prídem/Neprídem je plán; admin ju vie opraviť aj spätne.
- **Pokladnica:** pokuta a príspevok zvyšujú dlh hráča; platba dlh znižuje a zvyšuje hotovosť; výdavok a iný príjem
  menia iba hotovosť.
- **Viac partií** na jednej inštancii: `update public.app_config set max_groups = 2;`
- **Zálohy:** Supabase robí denné zálohy iba na platených plánoch. Na Free pláne si raz za čas sprav
  `supabase db dump -f zaloha.sql` a ulož mimo servera.
- **Typy databázy** v `src/lib/supabase/database.types.ts` sú písané podľa migrácií v tvare, aký generuje
  Supabase CLI. Po zmene schémy ich pregeneruj (`npm run db:types`) a porovnaj.
