import { App, TFile, normalizePath, requestUrl } from "obsidian";
import { TMDB_ID_PROPERTY, TYPE_PROPERTY } from "./properties";
import { WhoIsStreamingSettings } from "./settings";
import { getFrontmatter } from "./vaultTitles";
import { TitleId } from "./titleId";

export function readTitleId(app: App, file: TFile): TitleId | undefined {
  const frontmatter = getFrontmatter(app, file);
  const tmdbId = frontmatter[TMDB_ID_PROPERTY];
  const type = frontmatter[TYPE_PROPERTY];

  if (typeof tmdbId !== "number" || (type !== "movie" && type !== "series")) return undefined;

  return { tmdbId, type };
}

export async function renameNote(app: App, file: TFile, newName: string): Promise<string | undefined> {
  if (newName.length === 0 || file.basename === newName) return undefined;

  const newPath = normalizePath(`${file.parent?.path}/${newName}.md`);
  const taken = `Not renamed to "${newName}": another note already has that name`;
  const clash = file.parent?.children.find((sibling) => sibling !== file && sibling.path.toLowerCase() === newPath.toLowerCase());

  if (clash) return taken;

  try {
    await app.fileManager.renameFile(file, newPath);
  } catch (error: unknown) {
    console.error(`Could not rename ${file.path} to ${newPath}:`, error);

    return taken;
  }

  return undefined;
}

export function findFreePath(app: App, folder: string, baseName: string): string {
  let path = normalizePath(`${folder}/${baseName}.md`);

  for (let copy = 2; app.vault.getAbstractFileByPath(path) !== null; copy++) {
    path = normalizePath(`${folder}/${baseName} ${copy}.md`);
  }

  return path;
}

export async function ensureFolder(app: App, folder: string): Promise<void> {
  if (folder && folder !== "/" && !app.vault.getAbstractFileByPath(folder)) {
    await app.vault.createFolder(folder);
  }
}

export function localPosterLink(settings: WhoIsStreamingSettings, tmdbId: string | number): string {
  return `![[${settings.posterFolder}/${tmdbId}.jpg]]`;
}

export async function downloadPoster(app: App, settings: WhoIsStreamingSettings, tmdbId: string | number, url: string): Promise<void> {
  try {
    const folderPath = normalizePath(settings.posterFolder);

    await ensureFolder(app, folderPath);

    const posterPath = normalizePath(`${folderPath}/${tmdbId}.jpg`);

    if (app.vault.getAbstractFileByPath(posterPath) !== null) return;

    const response = await requestUrl({ url, method: "GET" });

    await app.vault.createBinary(posterPath, response.arrayBuffer);
  } catch (error: unknown) {
    console.debug("Poster download failed:", error);
  }
}
