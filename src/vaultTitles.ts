import { App, TFile } from "obsidian";
import { getFrontmatterNumber, isTitleNote } from "./frontmatterUtils";
import { MY_RATING_PROPERTY, TITLE_PROPERTY, YEAR_PROPERTY } from "./properties";

export interface VaultTitle {
  file: TFile;
  frontmatter: Record<string, unknown>;
  title: string;
  year: number | undefined;
}

export function getFrontmatter(app: App, file: TFile): Record<string, unknown> {
  return app.metadataCache.getFileCache(file)?.frontmatter ?? {};
}

export function getNoteTitle(file: TFile, frontmatter?: Record<string, unknown>): string {
  const explicit = frontmatter?.[TITLE_PROPERTY];

  if (typeof explicit === "string" && explicit.trim().length > 0) return explicit.trim();

  return file.basename.replace(/\s*\(\d{4}(?:\s*-\s*\d{0,4})?\)\s*$/, "").trim() || file.basename;
}

export function getNoteYear(file: TFile, frontmatter: Record<string, unknown>): number | undefined {
  const fromProperty = getFrontmatterNumber(frontmatter, YEAR_PROPERTY);

  if (fromProperty !== undefined) return fromProperty;
  const fromName = file.basename.match(/\((\d{4})(?:\s*-\s*\d{0,4})?\)\s*$/);

  return fromName ? Number.parseInt(fromName[1], 10) : undefined;
}

export function getVaultTitles(app: App): VaultTitle[] {
  return app.vault.getMarkdownFiles().flatMap((file) => {
    const frontmatter = getFrontmatter(app, file);

    if (!isTitleNote(frontmatter)) return [];

    return [{ file, frontmatter, title: getNoteTitle(file, frontmatter), year: getNoteYear(file, frontmatter) }];
  });
}

export function guessImportFolder(app: App): string {
  const counts = new Map<string, number>();

  for (const title of getVaultTitles(app)) {
    const folder = title.file.parent?.path ?? "";

    counts.set(folder, (counts.get(folder) ?? 0) + 1);
  }

  const busiest = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const folder = busiest?.[0] ?? "";

  return folder === "/" ? "" : folder;
}

export function normaliseTitle(title: string): string {
  return title.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function toFileName(text: string, linkSafe = false): string {
  const unsafe = linkSafe ? /[/\\?%*:|"<>#^[\]]/g : /[/\\?%*:|"<>]/g;

  return text.replace(/\s*[\r\n]+\s*/g, " ").replace(unsafe, "-").trim();
}

export function usesTenPointRatings(app: App): boolean {
  return getVaultTitles(app).some((title) => {
    return (getFrontmatterNumber(title.frontmatter, MY_RATING_PROPERTY) ?? 0) > 5;
  });
}
