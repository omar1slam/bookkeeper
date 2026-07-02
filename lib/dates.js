// Date / tab-name / number-format helpers shared by the webhook and the digest cron.

export const TZ = process.env.DEFAULT_TZ || "Africa/Cairo";

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Today's date parts in the configured timezone. */
export function nowInTz() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map((p) => [p.type, p.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

export function todayISO() {
  const { year, month, day } = nowInTz();
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** "Jun 2026" tab name for a YYYY-MM-DD date string. */
export function tabNameForDate(dateISO) {
  const [y, m] = String(dateISO).split("-").map(Number);
  if (!y || !m) {
    const t = nowInTz();
    return `${MONTHS[t.month - 1]} ${t.year}`;
  }
  return `${MONTHS[m - 1]} ${y}`;
}

/** "Jul 2026" → "Jun 2026" (or null if the tab name doesn't parse). */
export function prevTabName(tabName) {
  const [mon, yearStr] = String(tabName).split(" ");
  const m = MONTHS.indexOf(mon);
  const year = Number(yearStr);
  if (m === -1 || !year) return null;
  return m === 0 ? `${MONTHS[11]} ${year - 1}` : `${MONTHS[m - 1]} ${year}`;
}

/** Days in a month (1-based month). */
export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** YYYY-MM-DD for n days before today in the configured timezone. */
export function isoDaysAgo(n) {
  const { year, month, day } = nowInTz();
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export function fmtNumber(n) {
  const num = Number(n);
  if (!isFinite(num)) return String(n);
  return num.toLocaleString("en-US", { maximumFractionDigits: 2 });
}
