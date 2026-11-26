import { App, Notice, TFile } from "obsidian";
import { BulkProgressModal } from "./BulkProgressModal";
import { confirmAction } from "./confirmAction";
import { JellyfinAvailability, JellyfinLibraryItem, toAvailability } from "./JellyfinApiService";
import { defaultErrorMessage, runBulkOperation } from "./bulk";
import { isRecord } from "./frontmatterUtils";
import type WhoIsStreamingPlugin from "./main";
import { ensureFolder, readTitleId } from "./notes";
import { OK, failed } from "./outcome";
import { TMDB_ID_PROPERTY, TYPE_PROPERTY } from "./properties";
import { WhoIsStreamingSettings } from "./settings";
import { buildJellyfinFields } from "./refreshFields";
import { VaultTitle, getVaultTitles, guessImportFolder } from "./vaultTitles";
import { applyJellyfinRuntime, applyJellyfinWatchHistory } from "./watchHistory";
import { TitleId, noteKey, titleKey } from "./titleId";
import { createTitleNote } from "./titleNotes";
import { RefreshReporter } from "./refreshReporter";

export interface JellyfinLibrary {
  name: string;
  items: JellyfinLibraryItem[];
}

export interface NoteUpdate {
  file: TFile;
  availability: JellyfinAvailability[];
  correctedTmdbId?: number;
}

export interface NoteToCreate {
  item: JellyfinLibraryItem;
  availability: JellyfinAvailability[];
}

export interface LibrarySyncPlan {
  updates: NoteUpdate[];
  creates: NoteToCreate[];
}

export function applyJellyfin(frontmatter: Record<string, unknown>, settings: WhoIsStreamingSettings, availability: JellyfinAvailability[]): void {
  for (const field of buildJellyfinFields(settings, availability)) {
    frontmatter[field.name] = field.value;
  }

  applyJellyfinWatchHistory(frontmatter, availability, settings);
  applyJellyfinRuntime(frontmatter, availability, settings);
}

export function planLibrarySync(vaultTitles: VaultTitle[], libraries: JellyfinLibrary[], settings: WhoIsStreamingSettings): LibrarySyncPlan {
  const inJellyfin = new Map<string, { item: JellyfinLibraryItem; servers: Map<string, JellyfinLibraryItem> }>();

  for (const library of libraries) {
    for (const item of library.items) {
      const key = titleKey(item);
      const entry = inJellyfin.get(key) ?? { item, servers: new Map<string, JellyfinLibraryItem>() };

      entry.servers.set(library.name, item);
      inJellyfin.set(key, entry);
    }
  }

  const availabilityFor = (servers?: Map<string, JellyfinLibraryItem>) =>
    libraries.map((library) => toAvailability(library.name, servers?.get(library.name)));

  const vaultKeys = new Set(vaultTitles.flatMap((title) => noteKey(title.frontmatter) ?? []));
  const corrections = new Map<string, { key: string; tmdbId: number }>();

  for (const [key, entry] of inJellyfin) {
    const wrong = [...entry.servers.values()].find((item) => item.wrongTmdbId !== undefined)?.wrongTmdbId;

    if (wrong === undefined) continue;
    const wrongKey = titleKey({ type: entry.item.type, tmdbId: wrong });

    if (!vaultKeys.has(key) && !inJellyfin.has(wrongKey)) corrections.set(wrongKey, { key, tmdbId: entry.item.tmdbId });
  }

  const missing = new Map(inJellyfin);
  const updates: NoteUpdate[] = [];

  for (const title of vaultTitles) {
    const ownKey = noteKey(title.frontmatter);

    if (!ownKey) continue;
    const correction = corrections.get(ownKey);
    const key = correction?.key ?? ownKey;
    const availability = availabilityFor(inJellyfin.get(key)?.servers);

    missing.delete(key);

    const after = structuredClone(title.frontmatter);

    if (correction) after[TMDB_ID_PROPERTY] = correction.tmdbId;
    applyJellyfin(after, settings, availability);

    if (JSON.stringify(after) !== JSON.stringify(title.frontmatter)) {
      updates.push({ file: title.file, availability, correctedTmdbId: correction?.tmdbId });
    }
  }

  const creates = [...missing.values()].map(({ item, servers }) => ({ item, availability: availabilityFor(servers) }));

  return { updates, creates };
}

export class JellyfinNotes {
  constructor(private plugin: WhoIsStreamingPlugin) {}

  private get app(): App {
    return this.plugin.app;
  }

  hasServers(): boolean {
    return this.plugin.getJellyfinInstances().length > 0;
  }

  async refresh(file: TFile, id: TitleId): Promise<void> {
    const availability = await this.plugin.jellyfinApiService.checkAvailability(this.plugin.getJellyfinInstances(), id.tmdbId, id.type);

    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      if (isRecord(frontmatter)) applyJellyfin(frontmatter, this.plugin.settings, availability);
    });
  }

  async refreshActiveNote(): Promise<void> {
    if (!this.requireServers()) return;

    const file = this.app.workspace.getActiveFile();

    if (!file) {
      new Notice("No active note");

      return;
    }

    const reporter = new RefreshReporter("Jellyfin");
    const id = readTitleId(this.app, file);

    if (!id) {
      reporter.done(failed("This note has no TMDB ID or type"));

      return;
    }

    try {
      await this.refresh(file, id);
      reporter.done(OK);
    } catch (error: unknown) {
      reporter.fail(error);
    }
  }

  async refreshAllNotes(): Promise<void> {
    if (!this.requireServers()) return;

    const { files: candidates, scope } = this.plugin.getBulkTargets();
    const files = candidates.filter((file) => readTitleId(this.app, file) !== undefined);

    if (files.length === 0) {
      new Notice(`No titles with a TMDB ID found in ${scope}`);

      return;
    }

    await runBulkOperation(this.app, files, "Jellyfin: bulk refresh", async (file) => {
      const id = readTitleId(this.app, file);

      if (!id) return failed("No TMDB ID or type");
      await this.refresh(file, id);

      return OK;
    });
  }

  async syncLibrary(): Promise<void> {
    if (!this.requireServers()) return;

    new Notice("Reading the Jellyfin library…");
    const libraries = await this.readLibraries();

    if (libraries.length === 0) return;

    const plan = planLibrarySync(getVaultTitles(this.app), libraries, this.plugin.settings);

    if (plan.creates.length === 0 && plan.updates.length === 0) {
      new Notice("Your vault is already in sync with Jellyfin");

      return;
    }

    const folder = guessImportFolder(this.app);

    if (plan.creates.length > 0 && !await this.confirmCreates(plan, folder)) return;

    const progress = new BulkProgressModal(this.app, plan.creates.length + plan.updates.length, "Jellyfin: sync library");

    progress.open();

    for (const update of plan.updates) {
      if (progress.isCancelled()) break;
      progress.updateProgress(update.file.basename);

      try {
        await this.applyUpdate(update);
        progress.recordSuccess();
      } catch (error: unknown) {
        progress.recordFailure(update.file.basename, defaultErrorMessage(error));
      }
    }

    for (const create of plan.creates) {
      if (progress.isCancelled()) {
        new Notice("⚠️ Jellyfin: sync library cancelled");
        break;
      }

      progress.updateProgress(create.item.name);

      try {
        await this.createNote(create, folder);
        progress.recordSuccess();
      } catch (error: unknown) {
        progress.recordFailure(create.item.name, defaultErrorMessage(error));
      }
    }

    progress.complete();
  }

  private requireServers(): boolean {
    if (this.hasServers()) return true;
    new Notice("Jellyfin has no servers configured");

    return false;
  }

  private async readLibraries(): Promise<JellyfinLibrary[]> {
    const libraries: JellyfinLibrary[] = [];

    for (const instance of this.plugin.getJellyfinInstances()) {
      try {
        const service = this.plugin.jellyfinApiService;
        const items: JellyfinLibraryItem[] = [];

        for (const item of await service.listLibrary(instance, true)) items.push(await service.withEpisodes(instance, item));
        libraries.push({ name: instance.name, items });
      } catch (error: unknown) {
        const status = isRecord(error) ? error["status"] : undefined;
        const reason = status === 401 || status === 403
          ? "the server rejected the API key"
          : typeof status === "number" ? `the server answered ${status}` : "the server could not be reached";

        new Notice(`Could not read the library on ${instance.name}: ${reason}`, 10000);
        console.error(`Jellyfin library could not be read from ${instance.name}:`, error);
      }
    }

    return libraries;
  }

  private async confirmCreates(plan: LibrarySyncPlan, folder: string): Promise<boolean> {
    const total = plan.creates.length;
    const movies = plan.creates.filter((create) => create.item.type === "movie").length;
    const confirmed = await confirmAction(this.app, "Jellyfin library sync", [
      `${total.toLocaleString()} titles in Jellyfin have no note yet (${movies.toLocaleString()} movies, ${(total - movies).toLocaleString()} series). A note will be created for each in ${folder ? `"${folder}"` : "the vault root"}.`,
      this.plugin.tmdbNotes.isConfigured()
        ? "Fields whose source is TMDB are filled from TMDB. The Streaming Availability API is not used."
        : "New notes will hold the title, year and Jellyfin status only. Set a TMDB API key to add posters and details, or refresh the notes afterwards.",
      plan.updates.length > 0
        ? `${plan.updates.length.toLocaleString()} existing notes will also be updated with their Jellyfin availability and watch dates.`
        : "Existing notes are already up to date.",
    ], "Sync");

    if (confirmed) await ensureFolder(this.app, folder);

    return confirmed;
  }

  private async applyUpdate(update: NoteUpdate): Promise<void> {
    await this.app.fileManager.processFrontMatter(update.file, (frontmatter: Record<string, unknown>) => {
      if (update.correctedTmdbId !== undefined) frontmatter[TMDB_ID_PROPERTY] = update.correctedTmdbId;
      applyJellyfin(frontmatter, this.plugin.settings, update.availability);
    });
  }

  private async createNote({ item, availability }: NoteToCreate, folder: string): Promise<void> {
    const tmdb = this.plugin.tmdbNotes;
    const details = tmdb.isConfigured() ? await tmdb.prepare(item.type, item.tmdbId, {}) : undefined;

    await createTitleNote(this.app, this.plugin.settings, {
      title: item.name,
      type: item.type,
      year: item.year,
      folder,
      variables: details?.variables,
      write: [(frontmatter) => {
        frontmatter[TMDB_ID_PROPERTY] = item.tmdbId;
        frontmatter[TYPE_PROPERTY] = item.type;
        applyJellyfin(frontmatter, this.plugin.settings, availability);
        details?.write(frontmatter);
      }],
    });
  }
}
