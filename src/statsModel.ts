import { getFrontmatterNumber, getFrontmatterString, getFrontmatterStringArray, isTitleNote } from "./frontmatterUtils";
import { EPISODES_WATCHED_PROPERTY, RUNTIME_PROPERTY, TYPE_PROPERTY, YEAR_PROPERTY } from "./properties";
import { isWatched, readWatchDates, toDayString } from "./watchHistory";

export const DEFAULT_LIST_LENGTH = 10;
const MS_PER_DAY = 86_400_000;

export const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type Measure = "titles" | "watches" | "hours";
export type Scope = "watched" | "all";

export interface Period {
  start: string | null;
  end: string | null;
  label: string;
}

export type StatsFilter =
  | { kind: "genre" | "cast" | "director" | "availability"; value: string }
  | { kind: "decade"; value: number }
  | { kind: "rating"; value: number; step: number }
  | { kind: "period"; start: string; end: string; label: string };

export interface StatsMatch {
  name: string;
  path?: string;
  lastWatched?: string;
  watches: number;
}

export interface Title {
  label: string;
  path?: string;
  type: string | undefined;
  year: number | undefined;
  runtimeMinutes: number | undefined;
  episodesWatched: number | undefined;
  genres: string[];
  cast: string[];
  directors: string[];
  myRating: number | undefined;
  frontmatter: Record<string, unknown>;
  allWatchDays: string[];
  watchDays: string[];
  watches: number;
}

export interface BarRow {
  label: string;
  value: number;
  display: string;
  tooltip: string;
  fullLabel?: string;
  averageRating?: number;
  filter?: StatsFilter;
  watched?: number;
}

export interface Totals {
  titles: number;
  movies: number;
  series: number;
  watched: number;
  watches: number;
  rewatches: number;
  hours: number;
  seriesHours: number;
  seriesDays: number;
  longestStreakWeeks: number | null;
  busyDays: number | null;
  averageRating: number | null;
  rated: number;
}

export interface StatsModel {
  period: Period;
  measure: Measure;
  scope: Scope;
  scopeLabel: string;
  subtitle: string;
  listLength: number;
  fallbackNotice: string | null;
  hasWatchHistory: boolean;
  totals: Totals;
  timeline: { unit: "month" | "year"; rows: BarRow[] } | null;
  heatmap: { label: string; start: string; end: string; counts: Map<string, number> } | null;
  genres: BarRow[];
  cast: BarRow[];
  directors: BarRow[];
  decades: BarRow[];
  ratings: BarRow[];
  availability: { rows: BarRow[]; anywhereShare: string } | null;
  matches: StatsMatch[];
}

export function resolvePeriod(choice: unknown, customYear: unknown, today: Date = new Date()): Period {
  const year = today.getFullYear();
  const wholeYear = (value: number): Period => ({
    start: `${value}-01-01`,
    end: `${value}-12-31`,
    label: String(value),
  });

  switch (choice) {
    case "this-year":
      return wholeYear(year);
    case "last-year":
      return wholeYear(year - 1);
    case "last-12-months": {
      const start = new Date(year - 1, today.getMonth(), today.getDate() + 1);

      return { start: toDayString(start), end: toDayString(today), label: "Last 12 months" };
    }
    case "custom": {
      const custom = typeof customYear === "string" || typeof customYear === "number"
        ? Number.parseInt(String(customYear), 10)
        : Number.NaN;

      if (custom >= 1900 && custom <= 2200) return wholeYear(custom);
      break;
    }
  }

  return { start: null, end: null, label: "All time" };
}

function readTitles(notes: StatsNote[], period: Period, datesProperty: string, ratingProperty: string): Title[] {
  const titles: Title[] = [];

  for (const { name, path, frontmatter } of notes) {
    if (!isTitleNote(frontmatter)) continue;

    const allWatchDays = readWatchDates(frontmatter, datesProperty);
    const watchDays = allWatchDays.filter((day) =>
      (period.start === null || day >= period.start) && (period.end === null || day <= period.end)
    );
    const undatedWatch = period.start === null && allWatchDays.length === 0 && isWatched(frontmatter, datesProperty);

    titles.push({
      label: name,
      path,
      type: getFrontmatterString(frontmatter, TYPE_PROPERTY),
      year: getFrontmatterNumber(frontmatter, YEAR_PROPERTY),
      runtimeMinutes: getFrontmatterNumber(frontmatter, RUNTIME_PROPERTY),
      episodesWatched: getFrontmatterNumber(frontmatter, EPISODES_WATCHED_PROPERTY),
      genres: getFrontmatterStringArray(frontmatter, "Genres") ?? [],
      cast: getFrontmatterStringArray(frontmatter, "Cast") ?? [],
      directors: getFrontmatterStringArray(frontmatter, "Directors") ?? [],
      myRating: getFrontmatterNumber(frontmatter, ratingProperty),
      frontmatter,
      allWatchDays,
      watchDays,
      watches: watchDays.length + (undatedWatch ? 1 : 0),
    });
  }

  return titles;
}

export interface StatsNote {
  name: string;
  path?: string;
  frontmatter: Record<string, unknown>;
}

export interface AvailabilitySource {
  name: string;
  isAvailable: (frontmatter: Record<string, unknown>) => boolean;
}

export interface StatsOptions {
  period: Period;
  measure: Measure;
  scope: Scope;
  listLength: number;
  datesProperty: string;
  ratingProperty: string;
  sources: AvailabilitySource[];
  filters?: StatsFilter[];
}

export function describeFilter(filter: StatsFilter): string {
  switch (filter.kind) {
    case "genre":
    case "cast":
      return filter.value;
    case "director":
      return `Directed by ${filter.value}`;
    case "availability":
      return `On ${filter.value}`;
    case "decade":
      return `${filter.value}s`;
    case "rating":
      return `Rated ${filter.value}`;
    case "period":
      return filter.label;
  }
}

export function sameFilter(a: StatsFilter, b: StatsFilter): boolean {
  if (a.kind === "period" || b.kind === "period") return a.kind === b.kind;

  return a.kind === b.kind && a.value === b.value;
}

function ratingBucket(rating: number, step: number): number {
  return Math.max(step, Math.round(rating / step) * step);
}

function hasName(names: string[], wanted: string): boolean {
  const key = wanted.toLowerCase();

  return names.some((name) => name.trim().toLowerCase() === key);
}

function matchesFilter(title: Title, filter: StatsFilter, sources: AvailabilitySource[]): boolean {
  switch (filter.kind) {
    case "genre":
      return hasName(title.genres, filter.value);
    case "cast":
      return hasName(title.cast, filter.value);
    case "director":
      return hasName(title.directors, filter.value);
    case "availability":
      return sources.find((source) => source.name === filter.value)?.isAvailable(title.frontmatter) ?? false;
    case "decade":
      return title.year !== undefined && Math.floor(title.year / 10) * 10 === filter.value;
    case "rating":
      return title.myRating !== undefined && ratingBucket(title.myRating, filter.step) === filter.value;
    case "period":
      return true;
  }
}

export function buildStatsModel(notes: StatsNote[], options: StatsOptions): StatsModel | null {
  const { measure, datesProperty, ratingProperty } = options;
  const filters = options.filters ?? [];
  const periodFilter = filters.find((filter) => filter.kind === "period");
  const period: Period = periodFilter ? { start: periodFilter.start, end: periodFilter.end, label: periodFilter.label } : options.period;
  const listLength = Math.max(1, Math.round(options.listLength));
  const everyTitle = readTitles(notes, period, datesProperty, ratingProperty);

  if (everyTitle.length === 0) return null;

  const hasWatchHistory = everyTitle.some((title) => isWatched(title.frontmatter, datesProperty));
  const titles = everyTitle.filter((title) => filters.every((filter) => matchesFilter(title, filter, options.sources)));
  let scope = options.scope;
  let fallbackNotice: string | null = null;

  if (scope === "watched" && !hasWatchHistory) {
    scope = "all";
    fallbackNotice = `No watch history found, so these numbers cover every title in the base. Add dates to "${datesProperty}" or run "Mark as watched today" to track what you watch.`;
  }

  const weight = (title: Title): number => {
    if (measure === "watches") return title.watches;
    if (measure === "hours") return hoursWatched(title);

    return scope === "all" || title.watches > 0 ? 1 : 0;
  };
  const counted = titles.filter((title) => scope === "all" || title.watches > 0);

  const scopeLabel = scope === "all" ? "all titles" : "watched titles";
  const measureLabel = measure === "titles" ? scopeLabel : measure === "watches" ? "watches" : "hours watched";

  const mixed = titles.some((title) => title.watches > 0) && titles.some((title) => title.watches === 0);
  const stacked = scope === "all" && measure === "titles" && mixed;
  const ranked = (kind: "genre" | "cast" | "director", names: (title: Title) => string[]) =>
    computeRanked(titles, kind, names, weight, measure, listLength, stacked);
  const matches = counted
    .filter((title) => !periodFilter || title.watches > 0)
    .map((title): StatsMatch => ({ name: title.label, path: title.path, lastWatched: title.watchDays[title.watchDays.length - 1] ?? title.allWatchDays[title.allWatchDays.length - 1], watches: title.watches }))
    .sort((a, b) => (b.lastWatched ?? "").localeCompare(a.lastWatched ?? "") || a.name.localeCompare(b.name));

  return {
    period,
    measure,
    scope,
    scopeLabel,
    subtitle: `${period.label} · ${measureLabel}`,
    listLength,
    fallbackNotice,
    hasWatchHistory,
    totals: computeTotals(titles, counted),
    timeline: hasWatchHistory ? computeTimeline(titles, period) : null,
    heatmap: hasWatchHistory ? computeHeatmap(titles, period) : null,
    genres: ranked("genre", (title) => title.genres),
    cast: ranked("cast", (title) => title.cast),
    directors: ranked("director", (title) => title.directors),
    decades: computeDecades(titles, weight, measure, stacked),
    ratings: computeRatings(counted, stacked),
    availability: computeAvailability(titles, options.sources, mixed),
    matches,
  };
}

function computeTotals(titles: Title[], counted: Title[]): Totals {
  const movies = titles.filter((title) => title.type === "movie").length;
  const watchedTitles = titles.filter((title) => title.watches > 0);

  const rewatches = watchedTitles.filter((title) => title.type !== "series").reduce((sum, title) => {
    const first = title.allWatchDays[0];

    return sum + title.watchDays.filter((day) => day !== first).length;
  }, 0);
  const series = watchedTitles.filter((title) => title.type === "series");
  const hours = watchedTitles.reduce((sum, title) => sum + hoursWatched(title), 0);
  const seriesHours = series.reduce((sum, title) => sum + hoursWatched(title), 0);
  const seriesDays = series.reduce((sum, title) => sum + title.watches, 0);

  const days = new Map<string, number>();

  for (const title of watchedTitles) {
    for (const day of title.watchDays) days.set(day, (days.get(day) ?? 0) + 1);
  }

  const rated = counted.filter((title) => title.myRating !== undefined);
  const ratingSum = rated.reduce((sum, title) => sum + (title.myRating ?? 0), 0);

  return {
    titles: titles.length,
    movies,
    series: titles.length - movies,
    watched: watchedTitles.length,
    watches: watchedTitles.reduce((sum, title) => sum + title.watches, 0),
    rewatches,
    hours,
    seriesHours,
    seriesDays,
    longestStreakWeeks: days.size > 0 ? longestWeekStreak([...days.keys()]) : null,
    busyDays: days.size > 0 ? [...days.values()].filter((count) => count >= 2).length : null,
    averageRating: rated.length > 0 ? ratingSum / rated.length : null,
    rated: rated.length,
  };
}

function computeTimeline(titles: Title[], period: Period): { unit: "month" | "year"; rows: BarRow[] } | null {
  const days = titles.flatMap((title) => title.watchDays).sort();
  const start = period.start ?? days[0];
  const end = period.end ?? days[days.length - 1];

  if (!start || !end || days.length === 0) return null;

  const startYear = Number(start.slice(0, 4));
  const endYear = Number(end.slice(0, 4));
  const startMonth = Number(start.slice(5, 7));
  const endMonth = Number(end.slice(5, 7));
  const monthSpan = (endYear - startYear) * 12 + (endMonth - startMonth) + 1;
  const byYear = monthSpan > 36;

  const buckets = new Map<string, BarRow>();

  if (byYear) {
    for (let year = startYear; year <= endYear; year++) {
      buckets.set(String(year), {
        label: String(year),
        fullLabel: String(year),
        value: 0,
        display: "0",
        tooltip: "",
        filter: { kind: "period", start: `${year}-01-01`, end: `${year}-12-31`, label: String(year) },
      });
    }
  } else {
    for (let index = 0; index < monthSpan; index++) {
      const month = (startMonth - 1 + index) % 12;
      const year = startYear + Math.floor((startMonth - 1 + index) / 12);
      const key = `${year}-${String(month + 1).padStart(2, "0")}`;
      const label = month === 0 ? `${MONTH_NAMES[month]} ’${String(year).slice(2)}` : MONTH_NAMES[month];

      const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
      const fullLabel = `${MONTH_NAMES[month]} ${year}`;

      buckets.set(key, {
        label,
        fullLabel,
        value: 0,
        display: "0",
        tooltip: "",
        filter: { kind: "period", start: `${key}-01`, end: `${key}-${String(lastDay).padStart(2, "0")}`, label: fullLabel },
      });
    }
  }

  for (const day of days) {
    const bucket = buckets.get(byYear ? day.slice(0, 4) : day.slice(0, 7));

    if (bucket) bucket.value++;
  }

  const rows = [...buckets.values()];

  for (const row of rows) {
    row.display = formatCount(row.value);
    row.tooltip = `${row.fullLabel ?? row.label}: ${pluralise(row.value, "watch", "watches")}`;
  }

  return { unit: byYear ? "year" : "month", rows };
}

function computeHeatmap(titles: Title[], period: Period): StatsModel["heatmap"] {
  const today = new Date();
  const useRecent = period.start === null || period.end === null;
  const start = useRecent
    ? toDayString(new Date(today.getFullYear() - 1, today.getMonth(), today.getDate() + 1))
    : period.start;
  const end = useRecent ? toDayString(today) : period.end;

  if (!start || !end) return null;

  const counts = new Map<string, number>();

  for (const title of titles) {
    for (const day of title.allWatchDays) {
      if (day >= start && day <= end) counts.set(day, (counts.get(day) ?? 0) + 1);
    }
  }

  return { label: useRecent ? "Last 12 months" : period.label, start, end, counts };
}

function computeRanked(titles: Title[], kind: "genre" | "cast" | "director", names: (title: Title) => string[], weight: (title: Title) => number, measure: Measure, listLength: number, stacked: boolean): BarRow[] {
  const totals = new Map<string, { label: string; value: number; watched: number; ratingSum: number; rated: number }>();

  for (const title of titles) {
    const value = weight(title);

    if (value <= 0) continue;

    for (const rawName of new Set(names(title))) {
      const label = rawName.trim();

      if (!label) continue;
      const key = label.toLowerCase();
      const total = totals.get(key) ?? { label, value: 0, watched: 0, ratingSum: 0, rated: 0 };

      total.value += value;
      if (title.watches > 0) total.watched += value;

      if (title.myRating !== undefined) {
        total.ratingSum += title.myRating;
        total.rated++;
      }

      totals.set(key, total);
    }
  }

  return [...totals.values()]
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
    .slice(0, listLength)
    .map((total): BarRow => {
      const display = formatMeasure(total.value, measure);
      const averageRating = total.rated > 0 ? total.ratingSum / total.rated : undefined;
      const rating = averageRating !== undefined ? ` · your average rating ${formatRating(averageRating)}` : "";

      const tooltip = stacked ? stackedTooltip(total.label, total.value, total.watched) : `${total.label}: ${display}`;

      return {
        label: total.label,
        value: total.value,
        display,
        tooltip: `${tooltip}${rating}`,
        averageRating,
        filter: { kind, value: total.label },
        watched: stacked ? total.watched : undefined,
      };
    });
}

function computeDecades(titles: Title[], weight: (title: Title) => number, measure: Measure, stacked: boolean): BarRow[] {
  const totals = new Map<number, number>();
  const watched = new Map<number, number>();

  for (const title of titles) {
    const value = weight(title);

    if (value <= 0 || title.year === undefined) continue;
    const decade = Math.floor(title.year / 10) * 10;

    totals.set(decade, (totals.get(decade) ?? 0) + value);
    if (title.watches > 0) watched.set(decade, (watched.get(decade) ?? 0) + value);
  }

  if (totals.size === 0) return [];

  const decades = [...totals.keys()];
  const rows: BarRow[] = [];

  for (let decade = Math.min(...decades); decade <= Math.max(...decades); decade += 10) {
    const value = totals.get(decade) ?? 0;
    const display = formatMeasure(value, measure);

    const watchedValue = watched.get(decade) ?? 0;

    rows.push({
      label: `${decade}s`,
      value,
      display,
      tooltip: stacked ? stackedTooltip(`${decade}s`, value, watchedValue) : `${decade}s: ${display}`,
      filter: { kind: "decade", value: decade },
      watched: stacked ? watchedValue : undefined,
    });
  }

  return rows;
}

function computeRatings(counted: Title[], stacked: boolean): BarRow[] {
  const rated = counted.filter((title) => title.myRating !== undefined);

  if (rated.length === 0) return [];

  const highest = Math.max(...rated.map((title) => title.myRating ?? 0));
  const step = highest <= 5 ? 0.5 : 1;
  const top = highest <= 5 ? 5 : Math.max(10, Math.ceil(highest));

  const counts = new Map<number, number>();
  const watched = new Map<number, number>();

  for (const title of rated) {
    const bucket = Math.min(top, ratingBucket(title.myRating ?? 0, step));

    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    if (title.watches > 0) watched.set(bucket, (watched.get(bucket) ?? 0) + 1);
  }

  const rows: BarRow[] = [];

  for (let bucket = step; bucket <= top; bucket += step) {
    const value = counts.get(bucket) ?? 0;

    rows.push({
      label: String(bucket),
      value,
      display: formatCount(value),
      tooltip: stacked ? stackedTooltip(`Rated ${bucket}`, value, watched.get(bucket) ?? 0) : `Rated ${bucket}: ${pluralise(value, "title", "titles")}`,
      filter: { kind: "rating", value: bucket, step },
      watched: stacked ? watched.get(bucket) ?? 0 : undefined,
    });
  }

  return rows;
}

function computeAvailability(titles: Title[], sources: AvailabilitySource[], stacked: boolean): StatsModel["availability"] {
  if (sources.length === 0) return null;

  const rows = sources
    .map((source): BarRow => {
      const available = titles.filter((title) => source.isAvailable(title.frontmatter));
      const value = available.length;
      const watched = available.filter((title) => title.watches > 0).length;
      const display = `${formatCount(value)} · ${formatShare(value, titles.length)}`;

      return {
        label: source.name,
        value,
        display,
        tooltip: stacked
          ? stackedTooltip(source.name, value, watched)
          : `${source.name}: ${formatCount(value)} of ${formatCount(titles.length)} titles`,
        filter: { kind: "availability", value: source.name },
        watched: stacked ? watched : undefined,
      };
    })
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));

  const anywhere = titles.filter((title) => sources.some((source) => source.isAvailable(title.frontmatter))).length;

  return { rows, anywhereShare: formatShare(anywhere, titles.length) };
}

export function hoursWatched(title: Title): number {
  const runtime = title.runtimeMinutes ?? 0;

  if (title.type !== "series") return title.watches * runtime / 60;
  if (title.watches === 0) return 0;
  const share = title.allWatchDays.length > 0 ? title.watchDays.length / title.allWatchDays.length : 1;

  return (title.episodesWatched ?? 0) * runtime * share / 60;
}

function stackedTooltip(label: string, value: number, watched: number): string {
  return `${label}: ${formatCount(watched)} watched, ${formatCount(value - watched)} not watched`;
}

export function formatCount(value: number): string {
  return Math.round(value).toLocaleString();
}

export function formatHours(hours: number): string {
  return hours >= 100 ? `${formatCount(hours)} h` : `${(Math.round(hours * 10) / 10).toLocaleString()} h`;
}

export function formatRating(value: number): string {
  return (Math.round(value * 10) / 10).toLocaleString(undefined, { minimumFractionDigits: 1 });
}

export function formatShare(part: number, whole: number): string {
  return whole > 0 ? `${Math.round(part / whole * 100)}%` : "0%";
}

export function formatMeasure(value: number, measure: Measure): string {
  return measure === "hours" ? formatHours(value) : formatCount(value);
}

export function pluralise(count: number, singular: string, plural: string): string {
  return `${formatCount(count)} ${count === 1 ? singular : plural}`;
}

export function dayNumber(day: string): number {
  return Math.round(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) / MS_PER_DAY);
}

export function dayFromNumber(number: number): string {
  return new Date(number * MS_PER_DAY).toISOString().slice(0, 10);
}

export function mondayOffset(number: number): number {
  return (((number + 3) % 7) + 7) % 7;
}

export function longestWeekStreak(days: string[]): number {
  const weeks = [...new Set(days.map((day) => Math.floor((dayNumber(day) + 3) / 7)))].sort((a, b) => a - b);
  let longest = 0;
  let current = 0;
  let previous: number | null = null;

  for (const week of weeks) {
    current = previous !== null && week === previous + 1 ? current + 1 : 1;
    longest = Math.max(longest, current);
    previous = week;
  }

  return longest;
}
