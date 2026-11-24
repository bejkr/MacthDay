import { TIME_ZONE } from "./env";

// Všetky časy sa zobrazujú v časovom pásme partie, nezávisle od servera (Vercel beží v UTC).
const fmt = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("sk-SK", { timeZone: TIME_ZONE, ...options });

const F = {
  date: fmt({ day: "numeric", month: "numeric", year: "numeric" }),
  dayMonth: fmt({ day: "numeric", month: "numeric" }),
  time: fmt({ hour: "2-digit", minute: "2-digit" }),
  weekday: fmt({ weekday: "long" }),
  weekdayShort: fmt({ weekday: "short" }),
  monthShort: fmt({ month: "short" }),
  day: fmt({ day: "numeric" }),
};

const d = (v: string | Date) => (typeof v === "string" ? new Date(v) : v);

export const formatDate = (v: string | Date) => F.date.format(d(v));
export const formatDayMonth = (v: string | Date) => F.dayMonth.format(d(v));
export const formatTime = (v: string | Date) => F.time.format(d(v));
export const formatWeekday = (v: string | Date) => F.weekday.format(d(v));
export const formatWeekdayShort = (v: string | Date) => F.weekdayShort.format(d(v)).replace(".", "");
export const formatMonthShort = (v: string | Date) => F.monthShort.format(d(v)).replace(".", "");
export const formatDay = (v: string | Date) => F.day.format(d(v)).replace(".", "");
export const formatDateTime = (v: string | Date) => `${formatDate(v)} ${formatTime(v)}`;

/** Dátum bez času (stĺpec typu date, "2026-11-17") → "17. 11. 2026" */
export function formatPlainDate(v: string) {
  const [y, m, day] = v.split("-").map(Number);
  return `${day}. ${m}. ${y}`;
}

const dayKey = (x: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(x);

/** "o 3 dni", "zajtra", "dnes", "pred 2 dňami" */
export function relativeDay(v: string | Date, now = new Date()) {
  const days = Math.round((Date.parse(dayKey(d(v))) - Date.parse(dayKey(now))) / 86_400_000);
  if (days === 0) return "dnes";
  if (days === 1) return "zajtra";
  if (days === -1) return "včera";
  if (days > 1) return days < 5 ? `o ${days} dni` : `o ${days} dní`;
  return `pred ${-days} dňami`;
}

export function timeLeft(v: string | Date, now = new Date()) {
  const ms = d(v).getTime() - now.getTime();
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3_600_000);
  if (h >= 48) return `${Math.floor(h / 24)} dní`;
  if (h >= 1) return `${h} h`;
  return `${Math.max(1, Math.floor(ms / 60_000))} min`;
}

function tzOffsetMs(utc: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(utc);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - utc.getTime();
}

/** Hodnota z <input type="datetime-local"> ("2026-11-20T18:30") chápaná v pásme partie → ISO UTC. */
export function localInputToIso(value: string, timeZone = TIME_ZONE): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return null;
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const first = guess - tzOffsetMs(new Date(guess), timeZone);
  const utc = guess - tzOffsetMs(new Date(first), timeZone); // korekcia okolo zmeny času
  return new Date(utc).toISOString();
}

/** ISO UTC → hodnota pre <input type="datetime-local"> v pásme partie. */
export function isoToLocalInput(iso: string | Date, timeZone = TIME_ZONE) {
  const date = d(iso);
  return new Date(date.getTime() + tzOffsetMs(date, timeZone)).toISOString().slice(0, 16);
}

export function todayInZone(timeZone = TIME_ZONE) {
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date());
}
