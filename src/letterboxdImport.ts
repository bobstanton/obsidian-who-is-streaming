import { App, TFile, getFrontMatterInfo, normalizePath } from "obsidian";
import { addWatchDates, isWatched } from "./watchHistory";
import { LETTERBOXD_PROPERTY, LIKED_PROPERTY, MY_RATING_PROPERTY, TMDB_ID_PROPERTY, TYPE_PROPERTY, WATCHED_PROPERTY, WATCHLIST_PROPERTY, YEAR_PROPERTY } from "./properties";
import { getFrontmatter, getVaultTitles, normaliseTitle, usesTenPointRatings } from "./vaultTitles";
import { TitleType, toTitleType } from "./titleId";
import { LetterboxdFilm, LetterboxdLibrary, filmKey } from "./letterboxdFiles";
import { FrontmatterWriter } from "./frontmatterUtils";
import { WhoIsStreamingSettings } from "./settings";
import { createTitleNote } from "./titleNotes";

export interface ImportEnricher {
  findMovieId(title: string, year: number | undefined): Promise<number | undefined>;
  needsDetails(frontmatter: Record<string, unknown>): boolean;
  prepare(type: TitleType, tmdbId: number, current: Record<string, unknown>): Promise<PreparedDetails | undefined>;
}

export interface PreparedDetails {
  write: FrontmatterWriter;
  variables: Record<string, unknown>;
}

export interface ImportOptions {
  settings: WhoIsStreamingSettings;
  folder: string;
  includeWatchlist: boolean;
  replaceRatings: boolean;
  enricher?: ImportEnricher;
}

export interface ImportPlanItem {
  film: LetterboxdFilm;
  existing?: TFile;
}

export interface ImportPlan {
  items: ImportPlanItem[];
  toCreate: number;
  toUpdate: number;
  watchDates: number;
  ratings: number;
  reviews: number;
  liked: number;
  yearMismatches: number;
  watchlistSkipped: number;
}

export interface ImportResult {
  created: number;
  updated: number;
  failed: { name: string; reason: string }[];
}

const MAX_YEAR_DIFFERENCE = 5;

export function planImport(app: App, library: LetterboxdLibrary, options: ImportOptions): ImportPlan {
  const byTmdb = new Map<number, TFile>();
  const byUri = new Map<string, TFile>();
  const byTitle = new Map<string, TFile>();
  const byName = new Map<string, { file: TFile; year: number | undefined }[]>();

  for (const title of getVaultTitles(app)) {
    const tmdbId = title.frontmatter[TMDB_ID_PROPERTY];

    if (typeof tmdbId === "number" && title.frontmatter[TYPE_PROPERTY] !== "series") byTmdb.set(tmdbId, title.file);
    const uri = title.frontmatter[LETTERBOXD_PROPERTY];

    if (typeof uri === "string") byUri.set(uri, title.file);

    if (title.frontmatter[TYPE_PROPERTY] !== "series") {
      byTitle.set(filmKey(title.title, title.year), title.file);
      const name = normaliseTitle(title.title);

      byName.set(name, [...(byName.get(name) ?? []), { file: title.file, year: title.year }]);
    }
  }

  const included = library.films.filter((film) => film.watched || !film.onWatchlist || options.includeWatchlist);
  const matches = new Map<LetterboxdFilm, TFile>();

  for (const film of included) {
    const exact = (film.tmdbId !== undefined ? byTmdb.get(film.tmdbId) : undefined)
      ?? (film.uri ? byUri.get(film.uri) : undefined)
      ?? byTitle.get(filmKey(film.name, film.year));

    if (exact) matches.set(film, exact);
  }

  const claimed = new Set([...matches.values()].map((file) => file.path));
  let yearMismatches = 0;

  for (const film of included) {
    if (matches.has(film)) continue;
    const candidates = (byName.get(normaliseTitle(film.name)) ?? []).filter((candidate) =>
      !claimed.has(candidate.file.path)
      && (film.year === undefined || candidate.year === undefined || Math.abs(film.year - candidate.year) <= MAX_YEAR_DIFFERENCE));

    if (candidates.length !== 1) continue;
    matches.set(film, candidates[0].file);
    claimed.add(candidates[0].file.path);
    yearMismatches++;
  }

  const plan: ImportPlan = { items: [], toCreate: 0, toUpdate: 0, watchDates: 0, ratings: 0, reviews: 0, liked: 0, yearMismatches, watchlistSkipped: 0 };

  for (const film of library.films) {
    if (!film.watched && film.onWatchlist && !options.includeWatchlist) {
      plan.watchlistSkipped++;
      continue;
    }

    const existing = matches.get(film);

    plan.watchDates += film.watchDates.size;
    if (film.rating !== undefined) plan.ratings++;
    plan.reviews += film.reviews.length;
    if (film.liked) plan.liked++;

    if (existing) {
      plan.items.push({ film, existing });
      plan.toUpdate++;
      continue;
    }

    plan.items.push({ film });
    plan.toCreate++;
  }

  return plan;
}

export async function runImport(app: App, plan: ImportPlan, options: ImportOptions, onProgress: (done: number, total: number) => boolean): Promise<ImportResult> {
  const result: ImportResult = { created: 0, updated: 0, failed: [] };

  const context: ImportContext = { app, options, ratingScale: usesTenPointRatings(app) ? 2 : 1, byTmdb: new Map() };

  if (options.enricher) {
    for (const title of getVaultTitles(app)) {
      const tmdbId = title.frontmatter[TMDB_ID_PROPERTY];

      if (typeof tmdbId === "number" && title.frontmatter[TYPE_PROPERTY] !== "series") context.byTmdb.set(tmdbId, title.file);
    }
  }

  for (const [index, item] of plan.items.entries()) {
    if (!onProgress(index, plan.items.length)) break;

    try {
      if (await importFilm(context, item)) result.created++;
      else result.updated++;
    } catch (error: unknown) {
      result.failed.push({ name: item.film.name, reason: error instanceof Error ? error.message : "Could not write the note" });
    }
  }

  onProgress(plan.items.length, plan.items.length);

  return result;
}

interface ImportContext {
  app: App;
  options: ImportOptions;
  ratingScale: number;
  byTmdb: Map<number, TFile>;
}

async function importFilm(context: ImportContext, item: ImportPlanItem): Promise<boolean> {
  const { app, options } = context;
  const { film } = item;
  const { enricher } = options;

  let existing = item.existing;

  if (enricher && !existing) {
    film.tmdbId ??= await quietly(() => enricher.findMovieId(film.name, film.year));
    if (film.tmdbId !== undefined) existing = context.byTmdb.get(film.tmdbId);
  }

  if (existing) {
    const details = enricher ? await prepareDetails(context, enricher, film, existing) : undefined;

    await app.fileManager.processFrontMatter(existing, (frontmatter: Record<string, unknown>) => {
      applyFilm(frontmatter, film, false, context.ratingScale, options.replaceRatings);
      details?.write(frontmatter);
    });
    await addReviews(app, existing, film);

    return false;
  }

  const details = enricher ? await prepareDetails(context, enricher, film, undefined) : undefined;
  const file = await createTitleNote(app, options.settings, {
    title: film.name,
    type: "movie",
    year: film.year,
    folder: normalizePath(options.folder),
    variables: details?.variables,
    write: [(frontmatter) => applyFilm(frontmatter, film, true, context.ratingScale, options.replaceRatings), ...(details ? [details.write] : [])],
  });

  if (film.tmdbId !== undefined) context.byTmdb.set(film.tmdbId, file);
  await addReviews(app, file, film);

  return true;
}

async function prepareDetails(context: ImportContext, enricher: ImportEnricher, film: LetterboxdFilm, file: TFile | undefined): Promise<PreparedDetails | undefined> {
  const current = file ? getFrontmatter(context.app, file) : {};
  const type = toTitleType(current[TYPE_PROPERTY]);
  const stored = current[TMDB_ID_PROPERTY];

  let tmdbId = typeof stored === "number" ? stored : film.tmdbId;

  if (tmdbId === undefined && type === "movie") {
    tmdbId = film.tmdbId = await quietly(() => enricher.findMovieId(film.name, film.year));
  }

  if (tmdbId === undefined) return undefined;

  if (file && type === "movie") context.byTmdb.set(tmdbId, file);
  if (file && !enricher.needsDetails(current)) return undefined;

  const id = tmdbId;

  return quietly(() => enricher.prepare(type, id, current));
}

async function quietly<T>(lookup: () => Promise<T | undefined>): Promise<T | undefined> {
  try {
    return await lookup();
  } catch (error: unknown) {
    console.debug("Letterboxd import: lookup failed", error);

    return undefined;
  }
}

function applyFilm(frontmatter: Record<string, unknown>, film: LetterboxdFilm, isNew: boolean, ratingScale: number, replaceRatings: boolean): void {
  if (isNew || frontmatter[TYPE_PROPERTY] === undefined) frontmatter[TYPE_PROPERTY] = "movie";
  if (film.year !== undefined && frontmatter[YEAR_PROPERTY] === undefined) frontmatter[YEAR_PROPERTY] = film.year;
  if (film.uri && frontmatter[LETTERBOXD_PROPERTY] === undefined) frontmatter[LETTERBOXD_PROPERTY] = film.uri;
  if (isNew && frontmatter[LETTERBOXD_PROPERTY] === undefined) frontmatter[LETTERBOXD_PROPERTY] = "imported";
  if (film.tmdbId !== undefined && frontmatter[TMDB_ID_PROPERTY] == null) frontmatter[TMDB_ID_PROPERTY] = film.tmdbId;
  if (film.liked) frontmatter[LIKED_PROPERTY] = true;
  if (film.tags.size > 0) frontmatter["tags"] = mergeTags(frontmatter["tags"], film.tags);

  if (film.watched) {
    addWatchDates(frontmatter, [...film.watchDates]);
    const current = frontmatter[WATCHED_PROPERTY];

    if (current === undefined || typeof current === "boolean") frontmatter[WATCHED_PROPERTY] = true;
    delete frontmatter[WATCHLIST_PROPERTY];
  } else if (film.onWatchlist && !isWatched(frontmatter)) {
    frontmatter[WATCHLIST_PROPERTY] = true;
  }

  if (film.rating !== undefined && (replaceRatings || frontmatter[MY_RATING_PROPERTY] == null)) {
    frontmatter[MY_RATING_PROPERTY] = film.rating * ratingScale;
  }
}

function mergeTags(current: unknown, added: Set<string>): string[] {
  const existing = Array.isArray(current)
    ? current.filter((tag): tag is string => typeof tag === "string")
    : typeof current === "string" ? current.split(/[,\s]+/).filter((tag) => tag.length > 0) : [];
  const known = new Set(existing.map((tag) => tag.replace(/^#/, "").toLowerCase()));

  return [...existing, ...[...added].filter((tag) => !known.has(tag.toLowerCase()))];
}

async function addReviews(app: App, file: TFile, film: LetterboxdFilm): Promise<void> {
  if (film.reviews.length === 0) return;
  const reviews = [...film.reviews].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));

  await app.vault.process(file, (content) => {
    const comparable = content.replace(/\r\n?/g, "\n");
    const missing = reviews.filter((review) => !comparable.includes(review.text));

    if (missing.length === 0) return content;

    const text = missing
      .map((review) => (reviews.length > 1 && review.date ? `**${review.date}**\n\n${review.text}` : review.text))
      .join("\n\n");

    const contentStart = getFrontMatterInfo(content).contentStart;
    const head = content.slice(0, contentStart);
    const body = content.slice(contentStart).trimEnd();
    const gap = head.length > 0 && !head.endsWith("\n") ? "\n" : "";

    return `${head}${gap}${body}${body.length > 0 ? "\n\n" : ""}${text}\n`;
  });
}
