// @ts-nocheck

export const DAILY_REFRESH_MS = 24 * 60 * 60 * 1000;
export const DAILY_REFRESH_HOUR = 6;
export const DAILY_REFRESH_TIME_ZONE = "Europe/Rome";

function romeParts(value: number | Date = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: DAILY_REFRESH_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value instanceof Date ? value : new Date(value));
  const out: any = {};
  parts.forEach((part) => {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  });
  return out;
}

/**
 * Stable refresh bucket that flips at 06:00 Europe/Rome, including DST days.
 * Before 06:00 the current page still belongs to yesterday's catalogue window.
 */
export function romeDailyBucket(value: number | Date = Date.now()) {
  const p = romeParts(value);
  const date = new Date(Date.UTC(p.year, p.month - 1, p.day));
  if (Number(p.hour || 0) < DAILY_REFRESH_HOUR) {
    date.setUTCDate(date.getUTCDate() - 1);
  }
  return date.toISOString().slice(0, 10);
}

export function cacheBelongsToCurrentRomeWindow(savedAt: any) {
  const timestamp = Number(savedAt || 0);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return false;
  return romeDailyBucket(timestamp) === romeDailyBucket();
}

export function msUntilNextRomeRefresh() {
  const now = Date.now();
  const current = romeParts(now);

  // Step in real milliseconds until the bucket changes instead of assuming a
  // fixed 24h local day. This remains correct across CET/CEST switches.
  let low = now;
  let high = now + 27 * 60 * 60 * 1000;
  const currentBucket = romeDailyBucket(now);
  while (high - low > 1000) {
    const mid = Math.floor((low + high) / 2);
    if (romeDailyBucket(mid) === currentBucket) low = mid;
    else high = mid;
  }
  return Math.max(1000, high - now);
}
