import { App, Notice, Platform, TFile, normalizePath } from "obsidian";
import type WhoIsStreamingPlugin from "./main";
import { getFrontmatter, getNoteTitle, getNoteYear, usesTenPointRatings } from "./vaultTitles";
import { isWatched, readWatchDates, toDayString } from "./watchHistory";
import { formatCsvRow } from "./csv";
import { getFrontmatterNumber, getFrontmatterStringArray, isTitleNote } from "./frontmatterUtils";
import { MY_RATING_PROPERTY, TMDB_ID_PROPERTY, TYPE_PROPERTY, WATCHLIST_PROPERTY } from "./properties";
import { describeError } from "./refreshReporter";

const LETTERBOXD_MAX_IMPORT_BYTES = 1_000_000;

type SaveFilePicker = (options: {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}) => Promise<{ name: string; createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }> }>;

export async function exportForLetterboxd(plugin: WhoIsStreamingPlugin, mode: "watched" | "watchlist"): Promise<void> {
  const { app } = plugin;
  const { files: notes, scope } = plugin.getBulkTargets();

  const result = buildLetterboxdExport(app, notes, mode);

  if (result.files.length === 0) {
    new Notice(mode === "watched" ? `No watched films found in ${scope}` : `No unwatched films found in ${scope}`);

    return;
  }

  const baseName = `letterboxd-${mode}-${toDayString(new Date())}`;
  const summary = `${result.films.toLocaleString()} films from ${scope}`;
  const where = mode === "watchlist"
    ? ` Upload it from your Letterboxd watchlist page; the general import page would mark these films as watched.${result.allUnwatched ? " No note has the Watchlist property, so every unwatched film was included." : ""}`
    : "";

  try {
    const picker = (window as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;

    if (Platform.isDesktopApp && result.files.length === 1 && typeof picker === "function") {
      const handle = await picker({
        suggestedName: `${baseName}.csv`,
        types: [{ description: "CSV", accept: { "text/csv": [".csv"] } }],
      });
      const writable = await handle.createWritable();

      try {
        await writable.write(result.files[0]);
      } finally {
        await writable.close();
      }

      new Notice(`Exported ${summary} to ${handle.name}.${where}`, where ? 20000 : 8000);

      return;
    }

    const paths: string[] = [];

    for (const [index, content] of result.files.entries()) {
      const suffix = result.files.length > 1 ? `-${index + 1}` : "";
      const path = normalizePath(`${baseName}${suffix}.csv`);

      const existing = app.vault.getAbstractFileByPath(path);

      if (existing instanceof TFile) await app.vault.modify(existing, content);
      else await app.vault.create(path, content);

      paths.push(path);
    }

    const split = paths.length > 1 ? " Letterboxd accepts 1 MB per file, so upload each one in turn." : "";

    new Notice(`Exported ${summary} to ${paths.join(", ")} in your vault.${split}${where}`, where ? 20000 : 12000);
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === "AbortError") return;
    new Notice(`❌ Export failed: ${describeError(error)}`, 10000);
    console.error("Letterboxd export failed:", error);
  }
}

export interface LetterboxdExport {
  files: string[];
  films: number;
  rows: number;
  skippedSeries: number;
  allUnwatched: boolean;
}

export function buildLetterboxdExport(app: App, notes: TFile[], mode: "watched" | "watchlist"): LetterboxdExport {
  const tenPoint = usesTenPointRatings(app);
  const header = mode === "watched"
    ? ["tmdbID", "Title", "Year", "Directors", "WatchedDate", tenPoint ? "Rating10" : "Rating", "Rewatch"]
    : ["tmdbID", "Title", "Year", "Directors"];

  const usesWatchlistProperty = mode === "watchlist"
    && notes.some((file) => getFrontmatter(app, file)[WATCHLIST_PROPERTY] === true);

  const rows: string[] = [];
  let films = 0;
  let skippedSeries = 0;

  for (const file of notes) {
    const frontmatter = getFrontmatter(app, file);

    if (!isTitleNote(frontmatter)) continue;

    if (frontmatter[TYPE_PROPERTY] === "series") {
      skippedSeries++;
      continue;
    }

    const watched = isWatched(frontmatter);

    if ((mode === "watched") !== watched) continue;
    if (usesWatchlistProperty && frontmatter[WATCHLIST_PROPERTY] !== true) continue;

    const tmdbId = frontmatter[TMDB_ID_PROPERTY];
    const base = [
      typeof tmdbId === "number" ? tmdbId : "",
      getNoteTitle(file, frontmatter),
      getNoteYear(file, frontmatter) ?? "",
      (getFrontmatterStringArray(frontmatter, "Directors") ?? []).join(", "),
    ];

    films++;

    if (mode === "watchlist") {
      rows.push(formatCsvRow(base));
      continue;
    }

    const ratingValue = getFrontmatterNumber(frontmatter, MY_RATING_PROPERTY);
    const rating = ratingValue !== undefined ? (tenPoint ? Math.round(ratingValue) : ratingValue) : "";
    const days = readWatchDates(frontmatter);

    if (days.length === 0) {
      rows.push(formatCsvRow([...base, "", rating, ""]));
    }

    for (const [index, day] of days.entries()) {
      rows.push(formatCsvRow([...base, day, rating, index > 0 ? "true" : "false"]));
    }
  }

  return { files: splitForLetterboxd(formatCsvRow(header), rows), films, rows: rows.length, skippedSeries, allUnwatched: mode === "watchlist" && !usesWatchlistProperty };
}

function splitForLetterboxd(header: string, rows: string[]): string[] {
  if (rows.length === 0) return [];

  const encoder = new TextEncoder();
  const files: string[] = [];
  let current = [header];
  let size = encoder.encode(header).length + 1;

  for (const row of rows) {
    const rowSize = encoder.encode(row).length + 1;

    if (size + rowSize > LETTERBOXD_MAX_IMPORT_BYTES && current.length > 1) {
      files.push(`${current.join("\n")}\n`);
      current = [header];
      size = encoder.encode(header).length + 1;
    }

    current.push(row);
    size += rowSize;
  }

  files.push(`${current.join("\n")}\n`);

  return files;
}
