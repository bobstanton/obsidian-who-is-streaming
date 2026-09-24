import { moment as obsidianMoment } from "obsidian";

const moment = obsidianMoment as unknown as typeof import("moment");

const LAST_SYNCED_FORMAT = "YYYY-MM-DDTHH:mm:ss";

export function formatLastSynced(date: Date): string {
  return moment(date).format(LAST_SYNCED_FORMAT);
}

export function parseLastSynced(value: unknown): number | undefined {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.getTime();
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const parsed = moment(value.trim(), moment.ISO_8601, true);
  return parsed.isValid() ? parsed.valueOf() : undefined;
}
