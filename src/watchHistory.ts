import { JellyfinAvailability } from "./JellyfinApiService";
import { EPISODES_WATCHED_PROPERTY, RUNTIME_PROPERTY, WATCHED_DATES_PROPERTY, WATCHED_PROPERTY, WATCHLIST_PROPERTY } from "./properties";
import { HasFieldSources, getFieldSource } from "./fields";

export function toDayString(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${date.getFullYear()}-${month}-${day}`;
}

export function parseDay(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);

  if (!match) return null;

  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  const isRealDate = date.getUTCFullYear() === Number(year)
    && date.getUTCMonth() === Number(month) - 1
    && date.getUTCDate() === Number(day);

  return isRealDate ? `${year}-${month}-${day}` : null;
}

export function readWatchDates(fm: Record<string, unknown>, property: string = WATCHED_DATES_PROPERTY): string[] {
  const value = fm[property];
  const items: unknown[] = Array.isArray(value) ? value : [value];
  const days = new Set<string>();

  for (const item of items) {
    const day = parseDay(item);

    if (day) days.add(day);
  }

  return [...days].sort();
}

export function isWatched(fm: Record<string, unknown>, datesProperty: string = WATCHED_DATES_PROPERTY): boolean {
  return fm[WATCHED_PROPERTY] === true
    || readWatchDates(fm, WATCHED_PROPERTY).length > 0
    || readWatchDates(fm, datesProperty).length > 0;
}

export function addWatchDates(fm: Record<string, unknown>, days: string[]): boolean {
  const existing = readWatchDates(fm);
  const merged = [...new Set([...existing, ...days])].sort();

  if (merged.length > 0 && (fm[WATCHED_PROPERTY] === undefined || typeof fm[WATCHED_PROPERTY] === "boolean")) {
    fm[WATCHED_PROPERTY] = true;
  }

  if (merged.length > 0) delete fm[WATCHLIST_PROPERTY];
  if (merged.length === existing.length) return false;

  fm[WATCHED_DATES_PROPERTY] = merged;

  return true;
}

export function applyJellyfinWatchHistory(fm: Record<string, unknown>, availability: JellyfinAvailability[], settings: HasFieldSources): void {
  const owns = (field: string) => getFieldSource(settings, field) === "jellyfin";
  const days: string[] = [];
  let played = false;
  let episodesWatched = 0;

  for (const item of availability) {
    if (item.episodes && item.episodes.length > 0) {
      episodesWatched = Math.max(episodesWatched, item.episodes.filter((episode) => episode.played).length);

      for (const episode of item.episodes) {
        const day = playedDay(episode.lastPlayed);

        if (day) days.push(day);
      }
    } else if (item.watched) {
      const day = playedDay(item.lastPlayed);

      if (day) days.push(day);
    }

    if (item.watched) played = true;
  }

  let watched = false;

  if (owns(WATCHED_DATES_PROPERTY) && days.length > 0) {
    fm[WATCHED_DATES_PROPERTY] = [...new Set([...readWatchDates(fm), ...days])].sort();
    watched = true;
  }

  if (owns(EPISODES_WATCHED_PROPERTY) && episodesWatched > 0) fm[EPISODES_WATCHED_PROPERTY] = episodesWatched;

  const current = fm[WATCHED_PROPERTY];

  if (owns(WATCHED_PROPERTY) && (played || readWatchDates(fm).length > 0) && (current === undefined || typeof current === "boolean")) {
    fm[WATCHED_PROPERTY] = true;
    watched = true;
  }

  if (watched) delete fm[WATCHLIST_PROPERTY];
}

export function applyJellyfinRuntime(fm: Record<string, unknown>, availability: JellyfinAvailability[], settings: HasFieldSources): void {
  if (getFieldSource(settings, RUNTIME_PROPERTY) !== "jellyfin") return;

  for (const item of availability) {
    const runtimes = item.episodes?.flatMap((episode) => episode.runtimeMinutes ?? []) ?? [];
    const minutes = runtimes.length > 0 ? Math.round(runtimes.reduce((sum, value) => sum + value, 0) / runtimes.length) : item.runtimeMinutes;

    if (minutes) {
      fm[RUNTIME_PROPERTY] = `${minutes} min`;

      return;
    }
  }
}

function playedDay(timestamp: string | undefined): string | undefined {
  if (!timestamp) return undefined;
  const date = new Date(timestamp);

  return Number.isNaN(date.getTime()) ? undefined : toDayString(date);
}
