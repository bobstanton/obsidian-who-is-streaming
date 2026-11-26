import { unzipSync } from "fflate";
import { parseCsvRecords } from "./csv";
import { parseDay } from "./watchHistory";
import { normaliseTitle } from "./vaultTitles";

type FileKind = "diary" | "watched" | "ratings" | "watchlist" | "likes";

export interface LetterboxdReview {
  text: string;
  date?: string;
}

export interface LetterboxdFilm {
  name: string;
  year: number | undefined;
  uri?: string;
  tmdbId?: number;
  watchDates: Set<string>;
  watched: boolean;
  rating?: number;
  onWatchlist: boolean;
  liked: boolean;
  tags: Set<string>;
  reviews: LetterboxdReview[];
}

export interface LetterboxdLibrary {
  films: LetterboxdFilm[];
  filesRead: string[];
  filesSkipped: string[];
}

export async function readLetterboxdFiles(files: File[]): Promise<LetterboxdLibrary> {
  const films = new Map<string, LetterboxdFilm>();
  const filesRead: string[] = [];
  const filesSkipped: string[] = [];
  const decoder = new TextDecoder("utf-8");

  const readCsv = (name: string, text: string) => {
    if (addCsv(films, name, text)) filesRead.push(name);
    else filesSkipped.push(name);
  };

  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());

    if (file.name.toLowerCase().endsWith(".zip")) {
      const entries = unzipSync(bytes, { filter: (entry) => /^([^/]+|likes\/films)\.csv$/i.test(entry.name) });

      for (const [name, content] of Object.entries(entries)) {
        readCsv(name, decoder.decode(content));
      }
    } else {
      readCsv(file.name, decoder.decode(bytes));
    }
  }

  return { films: [...films.values()], filesRead, filesSkipped };
}

function addCsv(films: Map<string, LetterboxdFilm>, fileName: string, text: string): boolean {
  const { headers, records } = parseCsvRecords(text);
  const kind = identifyFile(fileName, headers);

  if (!kind) return false;

  for (const record of records) {
    const name = record["name"] || record["title"];

    if (!name) continue;

    const yearValue = Number.parseInt(record["year"] ?? "", 10);
    const year = Number.isFinite(yearValue) ? yearValue : undefined;
    const key = filmKey(name, year);
    let film = films.get(key);

    if (!film) {
      film = { name, year, watchDates: new Set(), watched: false, onWatchlist: false, liked: false, tags: new Set(), reviews: [] };
      films.set(key, film);
    }

    const tmdbId = Number.parseInt(record["tmdbid"] ?? "", 10);

    if (Number.isFinite(tmdbId)) film.tmdbId = tmdbId;

    const uri = record["letterboxduri"];

    if (uri && kind !== "diary") film.uri = uri;

    for (const value of (record["tags"] ?? "").split(",")) {
      const tag = toObsidianTag(value);

      if (tag) film.tags.add(tag);
    }

    const review = (record["review"] ?? "").replace(/\r\n?/g, "\n").trim();

    if (review && !film.reviews.some((existing) => existing.text === review)) {
      film.reviews.push({ text: review, date: parseDay(record["watcheddate"]) ?? parseDay(record["date"]) ?? undefined });
    }

    if (kind === "likes") {
      film.liked = true;
      continue;
    }

    if (kind === "watchlist") {
      film.onWatchlist = true;
      continue;
    }

    film.watched = true;

    if (kind === "diary") {
      const day = parseDay(record["watcheddate"]) ?? parseDay(record["date"]);

      if (day) film.watchDates.add(day);
    }

    const rating = readRating(record);

    if (rating !== undefined && (kind === "ratings" || film.rating === undefined)) {
      film.rating = rating;
    }
  }

  return true;
}

function identifyFile(fileName: string, headers: string[]): FileKind | null {
  if (!headers.includes("name") && !headers.includes("title")) return null;

  const base = fileName.toLowerCase().replace(/^.*[\\/]/, "");

  if (base.startsWith("films") || base.startsWith("likes")) return "likes";
  if (base.startsWith("watchlist")) return "watchlist";
  if (base.startsWith("diary") || base.startsWith("reviews")) return "diary";
  if (base.startsWith("ratings")) return "ratings";
  if (base.startsWith("watched")) return "watched";
  if (/^(profile|comments)/.test(base)) return null;

  if (headers.includes("watcheddate")) return "diary";
  if (headers.includes("rating") || headers.includes("rating10")) return "ratings";

  return "watched";
}

function readRating(record: Record<string, string>): number | undefined {
  const rating = Number.parseFloat(record["rating"] ?? "");

  if (Number.isFinite(rating) && rating > 0) return rating;
  const rating10 = Number.parseFloat(record["rating10"] ?? "");

  if (Number.isFinite(rating10) && rating10 > 0) return rating10 / 2;

  return undefined;
}

export function toObsidianTag(value: string): string | undefined {
  const tag = value.trim().replace(/^#+/, "").replace(/\s+/g, "-").replace(/[^\p{L}\p{N}_\-/]/gu, "").replace(/^\/+|\/+$/g, "");

  if (!tag) return undefined;

  return /^\d+$/.test(tag) ? `letterboxd-${tag}` : tag;
}

export function filmKey(name: string, year: number | undefined): string {
  return `${normaliseTitle(name)}|${year ?? ""}`;
}
