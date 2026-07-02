// Weekly digest — invoked by the Vercel cron (see vercel.json). Sends a Telegram
// summary built purely from Sheets reads: no LLM tokens involved.

import { sendMessage } from "../lib/telegram.js";
import { readMonthSummary, capitalize } from "../lib/summary.js";
import { sumBetween } from "../lib/ledger.js";
import {
  nowInTz,
  todayISO,
  tabNameForDate,
  prevTabName,
  daysInMonth,
  isoDaysAgo,
  fmtNumber,
  MONTHS,
} from "../lib/dates.js";

const DEFAULT_CURRENCY = process.env.DEFAULT_CURRENCY || "EGP";

export default async function handler(req, res) {
  // Vercel sends `Authorization: Bearer <CRON_SECRET>` on cron invocations.
  const auth = req.headers.authorization || "";
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).send("unauthorized");
    return;
  }

  const chatId = (process.env.ALLOWED_CHAT_ID || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)[0];
  if (!chatId) {
    res.status(200).send("no chat id configured");
    return;
  }

  try {
    const text = await buildDigest();
    await sendMessage(chatId, text);
    res.status(200).send("sent");
  } catch (err) {
    console.error("digest error:", err);
    res.status(500).send("error"); // non-200 surfaces failures in the Vercel cron dashboard
  }
}

async function buildDigest() {
  const today = todayISO();
  const { year, month, day } = nowInTz();
  const tab = tabNameForDate(today);

  // Last 7 days from the ledger; missing Transactions tab (fresh setup) → zeros.
  let week = { total: 0, count: 0, bySection: {} };
  try {
    week = await sumBetween(isoDaysAgo(6), today);
  } catch (err) {
    console.error("digest ledger:", err);
  }

  // Month-to-date vs budget from the monthly tab.
  let summary = null;
  try {
    summary = await readMonthSummary(tab);
  } catch (err) {
    console.error("digest summary:", err);
  }

  // Pace vs previous month: previous tab's TOTAL actual, prorated by day-of-month.
  let paceLine = null;
  try {
    const prevTab = prevTabName(tab);
    if (prevTab && summary?.total) {
      const prev = await readMonthSummary(prevTab);
      if (prev.total && prev.total.actual > 0) {
        const prevMonth = month === 1 ? 12 : month - 1;
        const prevYear = month === 1 ? year - 1 : year;
        const dim = daysInMonth(prevYear, prevMonth);
        const pace = prev.total.actual * (Math.min(day, dim) / dim);
        if (pace > 0) {
          const diff = summary.total.actual - pace;
          const pct = Math.round((Math.abs(diff) / pace) * 100);
          paceLine = `Pace: ~${fmtNumber(Math.round(pace))} spent by day ${day} of ${prevTab} — you're ${pct}% ${diff >= 0 ? "ahead of" : "behind"} last month's pace`;
        }
      }
    }
  } catch (err) {
    console.error("digest pace:", err); // previous tab may simply not exist
  }

  const lines = [`📒 Weekly digest — ${day} ${MONTHS[month - 1]} ${year}`];
  lines.push(
    `Last 7 days: ${fmtNumber(week.total)} ${DEFAULT_CURRENCY} across ${week.count} entr${week.count === 1 ? "y" : "ies"}`
  );
  for (const [sec, amt] of Object.entries(week.bySection)) {
    lines.push(`• ${sec}: ${fmtNumber(amt)}`);
  }

  if (summary) {
    const dim = daysInMonth(year, month);
    let mtd = `\n${tab} so far (day ${day}/${dim}): ${fmtNumber(summary.total?.actual ?? 0)}`;
    if (summary.total?.budget != null) mtd += ` / ${fmtNumber(summary.total.budget)}`;
    mtd += ` ${DEFAULT_CURRENCY}`;
    lines.push(mtd);
    const over = summary.sections.filter((s) => s.over);
    if (over.length) {
      lines.push(`⚠ Over budget: ${over.map((s) => `${s.name} (+${fmtNumber(s.actual - s.budget)})`).join(", ")}`);
    }
    if (summary.vacation && summary.vacation.total > 0) {
      const name = summary.vacation.alias ? ` (${capitalize(summary.vacation.alias)})` : "";
      lines.push(`\nVacation${name}: ${fmtNumber(summary.vacation.total)} ${DEFAULT_CURRENCY}`);
    }
  }

  if (paceLine) lines.push(`\n${paceLine}`);
  return lines.join("\n");
}
