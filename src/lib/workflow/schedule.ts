import { Cron } from "croner";

// Cron handling for trigger.schedule. Five fields only (minute hour day month weekday); croner does the
// timezone/DST arithmetic. Safe to import in the browser for the "next run" preview.

const FIELD_COUNT = 5;

function parse(cron: string, timezone: string): Cron | null {
  if (cron.trim().split(/\s+/).length !== FIELD_COUNT) return null;
  try {
    return new Cron(cron.trim(), { timezone, catch: false });
  } catch {
    return null;
  }
}

export function isValidTimezone(timezone: string): boolean {
  if (!timezone || timezone.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

export function isValidCron(cron: string): boolean {
  return parse(cron, "UTC") !== null;
}

/** Next run strictly after `from`, or null when the expression is invalid or never fires. */
export function nextRunAt(cron: string, timezone: string, from: Date): Date | null {
  if (!isValidTimezone(timezone)) return null;
  return parse(cron, timezone)?.nextRun(from) ?? null;
}

/** A few upcoming runs, for the editor preview. */
export function nextRuns(cron: string, timezone: string, from: Date, count: number): Date[] {
  if (!isValidTimezone(timezone)) return [];
  return parse(cron, timezone)?.nextRuns(count, from) ?? [];
}
