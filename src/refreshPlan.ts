import { App, TFile } from "obsidian";
import { NOTE_NAME_FIELD } from "./fields";
import { FrontmatterWriter, isRecord } from "./frontmatterUtils";
import { renameNote } from "./notes";
import { LAST_SYNCED_PROPERTY, POSTER_PROPERTY, TMDB_ID_PROPERTY, TYPE_PROPERTY } from "./properties";

export interface RefreshPlan {
  heading: string;
  details: string;
  posterUrl?: string;
  newName?: string;
  writers: FrontmatterWriter[];
  posterDownload?: () => Promise<void>;
  afterWrite?: () => Promise<void>;
  warning?: string;
}

export interface PlannedChange {
  property: string;
  before: unknown;
  after: unknown;
}

const ALWAYS_WRITTEN = new Set([TMDB_ID_PROPERTY, TYPE_PROPERTY, LAST_SYNCED_PROPERTY]);

function propose(current: Record<string, unknown>, writers: FrontmatterWriter[]): Record<string, unknown> {
  const next = structuredClone(current);

  for (const write of writers) write(next);

  return next;
}

function changedKeys(current: Record<string, unknown>, next: Record<string, unknown>): string[] {
  return [...new Set([...Object.keys(current), ...Object.keys(next)])]
    .filter((key) => JSON.stringify(current[key]) !== JSON.stringify(next[key]));
}

export function plannedChanges(current: Record<string, unknown>, currentName: string, plan: RefreshPlan): PlannedChange[] {
  const changes: PlannedChange[] = [];

  if (plan.newName && plan.newName !== currentName) changes.push({ property: NOTE_NAME_FIELD, before: currentName, after: plan.newName });
  const next = propose(current, plan.writers);

  for (const key of changedKeys(current, next)) {
    if (!ALWAYS_WRITTEN.has(key)) changes.push({ property: key, before: current[key], after: next[key] });
  }

  return changes;
}

export function combinePlans(primary: RefreshPlan, extra: RefreshPlan): RefreshPlan {
  return {
    ...primary,
    posterUrl: primary.posterUrl ?? extra.posterUrl,
    newName: extra.newName ?? primary.newName,
    writers: [...primary.writers, ...extra.writers],
    posterDownload: primary.posterDownload && extra.posterDownload
      ? async () => {
        await primary.posterDownload?.();

        await extra.posterDownload?.();
      }
      : primary.posterDownload ?? extra.posterDownload,
    warning: primary.warning ?? extra.warning,
  };
}

export async function applyPlan(app: App, file: TFile, plan: RefreshPlan, accepted?: Set<string>): Promise<string | undefined> {
  const accepts = (property: string) => !accepted || accepted.has(property);

  if (plan.posterDownload && accepts(POSTER_PROPERTY)) await plan.posterDownload();
  const renameWarning = plan.newName && accepts(NOTE_NAME_FIELD) ? await renameNote(app, file, plan.newName) : undefined;

  await app.fileManager.processFrontMatter(file, (frontmatter: unknown) => {
    if (!isRecord(frontmatter)) return;
    const next = propose(frontmatter, plan.writers);

    for (const key of changedKeys(frontmatter, next)) {
      if (!ALWAYS_WRITTEN.has(key) && !accepts(key)) continue;
      if (key in next && next[key] !== undefined) frontmatter[key] = next[key];
      else delete frontmatter[key];
    }
  });

  await plan.afterWrite?.();

  return plan.warning ?? renameWarning;
}
