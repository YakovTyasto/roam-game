/**
 * Weekly leaderboard time helpers — pure and UTC-based, mirroring the SQL
 * `roam_week_start` / `roam_week_end`.
 *
 * A leaderboard week runs Monday 00:00:00 UTC → the following Monday 00:00:00
 * UTC. The server clock is authoritative for eligibility; these helpers are for
 * DISPLAY (date range, countdown) and are unit-tested against known dates.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

/** Monday 00:00:00 UTC of the week containing `date`. */
export function weekStart(date: Date): Date {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const day = d.getUTCDay(); // 0 = Sunday … 6 = Saturday
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - daysSinceMonday);
  return d;
}

/** The following Monday 00:00:00 UTC (exclusive end of the week). */
export function weekEnd(date: Date): Date {
  return new Date(weekStart(date).getTime() + MS_PER_WEEK);
}

/** Milliseconds remaining until the current week ends (never negative). */
export function msUntilWeekEnd(now: Date): number {
  return Math.max(0, weekEnd(now).getTime() - now.getTime());
}

/** Human-readable "6 Jan – 12 Jan" range for the week containing `date`. */
export function formatWeekRange(date: Date): string {
  const start = weekStart(date);
  const endInclusive = new Date(weekEnd(date).getTime() - MS_PER_DAY);
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
  return `${fmt(start)} – ${fmt(endInclusive)}`;
}

/** Compact countdown like "2d 4h" or "3h 12m" or "8m" until the week ends. */
export function formatCountdown(ms: number): string {
  const totalMinutes = Math.floor(ms / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
