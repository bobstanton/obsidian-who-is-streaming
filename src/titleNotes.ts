import { App, Notice, TFile, getFrontMatterInfo, normalizePath } from "obsidian";
import { FrontmatterWriter } from "./frontmatterUtils";
import { ensureFolder, findFreePath } from "./notes";
import { TITLE_PROPERTY } from "./properties";
import { WhoIsStreamingSettings } from "./settings";
import { renderFileName, renderTemplate } from "./templates";
import { TitleType } from "./titleId";
import { toFileName } from "./vaultTitles";

export interface NewTitleNote {
  title: string;
  type: TitleType;
  year?: number;
  folder: string;
  variables?: Record<string, unknown>;
  write: FrontmatterWriter[];
}

export async function createTitleNote(app: App, settings: WhoIsStreamingSettings, note: NewTitleNote): Promise<TFile> {
  const properties: Record<string, unknown> = {};

  for (const write of note.write) write(properties);
  if (toFileName(note.title, true) !== note.title) properties[TITLE_PROPERTY] = note.title;

  const variables = { title: note.title, type: note.type, year: note.year ?? "", firstAirYear: note.year ?? "", lastAirYear: "", ...note.variables };
  const format = note.type === "movie" ? settings.noteNameFormat : settings.noteNameFormatSeries;
  const plainName = toFileName(note.title, true) || "Untitled";
  const fallback = note.year !== undefined ? `${plainName} (${note.year})` : plainName;
  const name = (format.length > 0 ? await renderFileName(format, variables) : "") || fallback;
  const body = await renderNoteTemplate(app, settings, { ...variables, ...propertyVariables(properties) });

  await ensureFolder(app, note.folder);
  const file = await app.vault.create(findFreePath(app, note.folder, name), body);

  await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
    Object.assign(frontmatter, properties);
  });

  return file;
}

export async function applyNoteTemplate(app: App, settings: WhoIsStreamingSettings, file: TFile, variables: Record<string, unknown>): Promise<void> {
  const current = await app.vault.cachedRead(file);

  if (current.slice(getFrontMatterInfo(current).contentStart).trim().length > 0) return;
  const body = await renderNoteTemplate(app, settings, variables);

  if (body.length === 0) return;

  await app.vault.process(file, (content) => {
    const contentStart = getFrontMatterInfo(content).contentStart;

    if (content.slice(contentStart).trim().length > 0) return content;

    return `${content.slice(0, contentStart)}${body}`;
  });
}

async function renderNoteTemplate(app: App, settings: WhoIsStreamingSettings, variables: Record<string, unknown>): Promise<string> {
  const path = settings.noteTemplateFile.trim();

  if (path.length === 0) return "";
  const template = app.vault.getFileByPath(normalizePath(path)) ?? app.vault.getFileByPath(normalizePath(`${path}.md`));

  if (!template) {
    new Notice(`Note template not found: ${path}`, 10000);

    return "";
  }

  const outcome = await renderTemplate(await app.vault.cachedRead(template), variables);

  if (outcome.error) {
    new Notice(`Note template failed: ${outcome.error}`, 10000);

    return "";
  }

  const output = outcome.output.trim();

  return output.length > 0 ? `${output}\n` : "";
}

export function propertyVariables(properties: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(properties).map(([key, value]) => [variableName(key), value]));
}

function variableName(property: string): string {
  const words = property.split(/[^\p{L}\p{N}]+/u).filter(Boolean);

  return words.map((word, index) => index === 0 ? word.toLowerCase() : word[0].toUpperCase() + word.slice(1).toLowerCase()).join("");
}
