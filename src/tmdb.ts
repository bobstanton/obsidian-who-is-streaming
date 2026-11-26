import { WhoIsStreamingSettings } from "./settings";
import { isRecord } from "./frontmatterUtils";
import { POSTER_PROPERTY, TMDB_ID_PROPERTY, TMDB_RATING_PROPERTY, TYPE_PROPERTY } from "./properties";
import { normaliseTitle } from "./vaultTitles";
import { NOTE_NAME_FIELD, getFieldSource, getFieldsFrom } from "./fields";
import { TitleType } from "./titleId";

const IMAGE_URL = "https://image.tmdb.org/t/p/w500";

export const MAX_YEAR_DIFFERENCE = 5;
const MAX_CAST = 10;

export interface TmdbSearchResult {
  id: number;
  title: string;
  originalTitle: string;
  year: number | undefined;
}

export interface TmdbDetails {
  id: number;
  type: TitleType;
  title: string;
  year: number | undefined;
  lastAirYear: number | undefined;
  runtime: number | undefined;
  genres: string[];
  directors: string[];
  cast: string[];
  overview: string | undefined;
  posterUrl: string | undefined;
  rating: number | undefined;
  seasons: number | undefined;
  episodes: number | undefined;
}

export function tmdbOwns(settings: WhoIsStreamingSettings, property: string): boolean {
  return getFieldSource(settings, property) === "tmdb";
}

export function getTmdbTemplateVariables(details: TmdbDetails): Record<string, unknown> {
  return {
    title: details.title,
    type: details.type,
    year: details.year,
    firstAirYear: details.year,
    lastAirYear: details.lastAirYear,
    tmdb_id: `${details.type === "movie" ? "movie" : "tv"}/${details.id}`,
    tmdb: String(details.id),
    rating: details.rating,
    runtime: details.runtime,
    overview: details.overview ?? "",
    genres: details.genres,
    directors: details.directors,
    cast: details.cast,
    seasons: details.seasons,
    episodes: details.episodes,
  };
}

export function needsTmdbDetails(frontmatter: Record<string, unknown>, settings: WhoIsStreamingSettings): boolean {
  return frontmatter[TMDB_ID_PROPERTY] == null
    || getFieldsFrom(settings, "tmdb").some((field) => field !== NOTE_NAME_FIELD && (field !== POSTER_PROPERTY || settings.posterMode !== "none") && isEmpty(frontmatter[field]));
}

export function applyTmdbDetails(frontmatter: Record<string, unknown>, details: TmdbDetails, settings: WhoIsStreamingSettings, poster?: string): void {
  const fill = (property: string, value: unknown) => {
    if (!isEmpty(value) && tmdbOwns(settings, property)) frontmatter[property] = value;
  };

  if (frontmatter[TMDB_ID_PROPERTY] == null) frontmatter[TMDB_ID_PROPERTY] = details.id;
  if (frontmatter[TYPE_PROPERTY] == null) frontmatter[TYPE_PROPERTY] = details.type;

  fill("Year", details.year);
  fill("Directors", details.directors);
  fill("Cast", details.cast);
  fill("Overview", details.overview);
  fill("Genres", details.genres);
  fill("Runtime", details.runtime !== undefined ? `${details.runtime} min` : undefined);
  fill("Seasons", details.seasons);
  fill("Episodes", details.episodes);
  fill("Poster", poster);

  if (details.rating !== undefined && tmdbOwns(settings, TMDB_RATING_PROPERTY)) {
    frontmatter[TMDB_RATING_PROPERTY] = Math.round(details.rating * 10) / 10;
  }
}

function isEmpty(value: unknown): boolean {
  return value == null || value === "" || (Array.isArray(value) && value.length === 0);
}

export function pickMovie(results: TmdbSearchResult[], title: string, year: number | undefined, tolerance: number): number | undefined {
  const wanted = normaliseTitle(title);
  const named = results.filter((result) =>
    normaliseTitle(result.title) === wanted || normaliseTitle(result.originalTitle) === wanted);

  if (year === undefined) return named.length === 1 ? named[0].id : undefined;

  const close = named.filter((result) => result.year !== undefined && Math.abs(result.year - year) <= tolerance);

  if (close.length <= 1) return close[0]?.id;

  return close.find((result) => result.year === year)?.id;
}

export function parseSearchResults(response: unknown): TmdbSearchResult[] {
  return records(asRecord(response)["results"]).flatMap((result) => {
    const id = asNumber(result["id"]);

    if (id === undefined) return [];

    return [{
      id,
      title: asString(result["title"]) ?? "",
      originalTitle: asString(result["original_title"]) ?? "",
      year: yearOf(result["release_date"]),
    }];
  });
}

export function parseFoundId(type: TitleType, response: unknown): number | undefined {
  const [first] = records(asRecord(response)[type === "movie" ? "movie_results" : "tv_results"]);

  return first ? asNumber(first["id"]) : undefined;
}

export function parseDetails(type: TitleType, id: number, response: unknown): TmdbDetails | undefined {
  if (!isRecord(response)) return undefined;

  const isMovie = type === "movie";
  const credits = asRecord(response["credits"]);
  const cast = records(credits["cast"]).sort((a, b) => (asNumber(a["order"]) ?? 0) - (asNumber(b["order"]) ?? 0));
  const directors = isMovie ? records(credits["crew"]).filter((person) => person["job"] === "Director") : records(response["created_by"]);
  const episodeRuntimes: unknown[] = Array.isArray(response["episode_run_time"]) ? response["episode_run_time"] : [];
  const posterPath = asString(response["poster_path"]);
  const votes = asNumber(response["vote_count"]) ?? 0;

  return {
    id,
    type,
    title: asString(isMovie ? response["title"] : response["name"]) ?? "",
    year: yearOf(isMovie ? response["release_date"] : response["first_air_date"]),
    lastAirYear: isMovie ? undefined : yearOf(response["last_air_date"]),
    runtime: asNumber(isMovie ? response["runtime"] : episodeRuntimes[0]) || undefined,
    genres: names(records(response["genres"])),
    directors: names(directors),
    cast: names(cast.slice(0, MAX_CAST)),
    overview: asString(response["overview"]) || undefined,
    posterUrl: posterPath ? `${IMAGE_URL}${posterPath}` : undefined,
    rating: votes > 0 ? asNumber(response["vote_average"]) : undefined,
    seasons: asNumber(response["number_of_seasons"]),
    episodes: asNumber(response["number_of_episodes"]),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function names(items: Record<string, unknown>[]): string[] {
  return [...new Set(items.flatMap((item) => (typeof item["name"] === "string" && item["name"] ? [item["name"]] : [])))];
}

function yearOf(date: unknown): number | undefined {
  const year = typeof date === "string" ? Number.parseInt(date.slice(0, 4), 10) : Number.NaN;

  return Number.isFinite(year) ? year : undefined;
}
