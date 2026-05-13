import { Editor, MarkdownView, Notice, Plugin, TFile, normalizePath, requestUrl } from "obsidian";
import { ShowType, Show } from "streaming-availability";
import { WhoIsStreamingSettingsTab } from "./WhoIsStreamingSettingsTab";
import { ShowSelectModal } from "./ShowSelectModal";
import { PreviewSyncModal } from "./PreviewSyncModal";
import { BulkSyncProgressModal } from "./BulkSyncProgressModal";
import StreamingAvailabilityApiService from "./StreamingAvailabilityApiService";
import JellyfinApiService, { JellyfinAvailability } from "./JellyfinApiService";
import { MoviesBasesView, MoviesViewType } from "./MoviesBasesView";
import { WhoIsStreamingSettings, DEFAULT_SETTINGS } from "./settings";
import { getDataviewApi, isDataviewPluginEnabled } from "./dataviewApi";
import { applyShowTemplate, buildJellyfinSyncFields, buildSyncFields, getEnabledSyncFields, getTmdbId, isSyncFieldEnabled } from "./syncFields";

interface DataviewValue {
  path: string;
}

export default class WhoIsStreamingPlugin extends Plugin {
  settings: WhoIsStreamingSettings;
  streamingAvailabilityApi: StreamingAvailabilityApiService;
  jellyfinApiService: JellyfinApiService;

  async onload() {
    await this.loadSettings();
    this.setupApiClient();
    this.jellyfinApiService = new JellyfinApiService();

    this.addSettingTab(new WhoIsStreamingSettingsTab(this.app, this));

    this.registerBasesView(MoviesViewType, {
      name: "Movies",
      icon: "film",
      factory: (controller, scrollEl) =>
        new MoviesBasesView(controller, scrollEl, this),
        options: MoviesBasesView.getViewOptions,
    });

    const ribbonCommand = this.addRibbonIcon("popcorn", "Who is streaming", async (evt: MouseEvent) => {
      try {
        ribbonCommand.addClass("who-is-streaming-ribbon-disabled");
        await this.searchActiveFile();
      } finally {
        ribbonCommand.removeClass("who-is-streaming-ribbon-disabled");
      }
    });
    this.addCommand({ id: "search", name: "Search", editorCallback: async (editor: Editor, view: MarkdownView) => {
        await this.searchActiveFile();
    }});
    this.addCommand({ id: "refresh", name: "Refresh", editorCallback: async (editor: Editor, view: MarkdownView) => {
        await this.refreshActiveFile();
    }});
    this.addCommand({ id: "bulk-refresh", name: "Bulk refresh", callback: async () => {
        await this.refreshAllFiles();
    }});

    if (this.settings.jellyfinInstances && this.settings.jellyfinInstances.length > 0) {
      this.addCommand({ id: "bulk-refresh-jellyfin", name: "Bulk refresh Jellyfin", callback: async () => {
          await this.syncJellyfinForAllFiles();
      }});
      this.addCommand({ id: "sync-jellyfin", name: "Sync Jellyfin", editorCallback: async (editor: Editor, view: MarkdownView) => {
          await this.syncJellyfinActiveFile();
      }});
    }
  }

  onunload() {
    this.jellyfinApiService.clearCache();
  }

  async searchActiveFile() {

    if (!this.streamingAvailabilityApi.validateApiKey()) {
      return;
    }

    let loadingNotice: Notice | undefined;

    try {
      const activeFile = this.app.workspace.getActiveFile();
      if (!activeFile) {
        new Notice("No active file");
        return;
      }

      loadingNotice = new Notice(`🔍 Searching for "${activeFile.basename}"...`, 0);
      const results = await this.streamingAvailabilityApi.searchForShowsByTitle(
        activeFile.basename
      );
      loadingNotice?.hide();

      if (results.length === 0) {
        new Notice(`No shows found for "${activeFile.basename}"`, 5000);
        return;
      }

      if (results.length === 1) {
        await this.syncFileWithShow(activeFile, results[0]);
        return;
      }

      new ShowSelectModal(this.app, results, (selectedShow: Show) => {
        void this.syncFileWithShow(activeFile, selectedShow);
      }).open();
    } catch (error: unknown) {
      loadingNotice?.hide();
      new Notice("Sync failed. See developer console for details.", 5000);
      console.error('Sync failed:', error);
    }
  }

  async refreshActiveFile() {
    if (!this.streamingAvailabilityApi.validateApiKey()) {
      return;
    }

    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      new Notice("No active file");
      return;
    }

    let loadingNotice: Notice | undefined;

    try {
      const [tmdb_id, showType] = await this.getTmdbId(activeFile);
      if (!tmdb_id || !showType) {
        new Notice("No TMDB ID or type found in frontmatter");
        return;
      }

      loadingNotice = new Notice("🔄 Refreshing show by ID...", 0);
      const show = await this.streamingAvailabilityApi.getShowByTmdbId(
        showType,
        tmdb_id,
        false,
        true
      );

      loadingNotice.hide();

      if (!show) {
        new Notice("Show not found", 5000);
        return;
      }

      await this.syncFileWithShow(activeFile, show);
    } catch (error: unknown) {
      loadingNotice?.hide();
      const errorMessage = await this.streamingAvailabilityApi.handleApiError(error, false);
      new Notice(`${errorMessage || "Failed to refresh show"}`, 10000);
      console.error('Refresh failed:', error);
    }
  }

  async refreshAllFiles() {
    if (!this.streamingAvailabilityApi.validateApiKey()) {
      return;
    }

    const files = await this.getFilesToSync();
    if (files.length === 0) {
      new Notice("No files to sync");
      return;
    }

    await this.runBulkOperation(files, "⚠️ Bulk refresh cancelled by user", async (file) => {
      const [tmdb_id, showType] = await this.getTmdbId(file);
      if (!tmdb_id || !showType) {
        return "No TMDB id found";
      }

      const show = await this.streamingAvailabilityApi.getShowByTmdbId(showType, tmdb_id, false);
      if (!show) {
        return "Show not found";
      }

      await this.performSync(file, show, getEnabledSyncFields(this.settings));
      return undefined;
    });
  }

  async syncJellyfinForAllFiles() {
    if (this.settings.jellyfinInstances.length === 0) {
      new Notice("No Jellyfin instances configured");
      return;
    }

    const findingNotice = new Notice("🔄 Finding files with TMDB ID...", 0);

    const allFiles = this.app.vault.getMarkdownFiles();
    const filesWithTmdbId: TFile[] = [];

    for (const file of allFiles) {
      const [tmdb_id] = await this.getTmdbId(file);
      if (tmdb_id) {
        filesWithTmdbId.push(file);
      }
    }

    findingNotice.hide();

    if (filesWithTmdbId.length === 0) {
      new Notice("No files with TMDB ID found");
      return;
    }

    const files = filesWithTmdbId;

    await this.runBulkOperation(files, "⚠️ Bulk Jellyfin refresh cancelled by user", async (file) => {
      const [tmdb_id, showType] = await this.getTmdbId(file);
      if (!tmdb_id || !showType) {
        return "No TMDB id found";
      }

      await this.syncJellyfinFrontmatter(file, tmdb_id, showType);
      return undefined;
    });
  }

  async runBulkOperation(
    files: TFile[],
    cancellationNotice: string,
    processFile: (file: TFile) => Promise<string | undefined>
  ): Promise<void> {
    const progressModal = new BulkSyncProgressModal(this.app, files.length);
    progressModal.open();

    for (const file of files) {
      if (progressModal.isCancelled()) {
        new Notice(cancellationNotice);
        break;
      }

      progressModal.updateProgress(file.basename);

      try {
        const failure = await processFile(file);
        if (failure) {
          progressModal.recordFailure(file.basename, failure);
        } else {
          progressModal.recordSuccess();
        }
      } catch (error: unknown) {
        progressModal.recordFailure(file.basename, await this.describeSyncError(error));
      }
    }

    progressModal.complete();
  }

  async describeSyncError(error: unknown): Promise<string> {
    const apiMessage = await this.streamingAvailabilityApi.handleApiError(error, false);
    if (apiMessage) {
      return apiMessage;
    }

    return error instanceof Error ? error.message : "Sync failed";
  }

  async syncJellyfinActiveFile() {
    if (this.settings.jellyfinInstances.length === 0) {
      new Notice("No Jellyfin instances configured");
      return;
    }

    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      new Notice("No active file");
      return;
    }

    try {
      const [tmdb_id, showType] = await this.getTmdbId(activeFile);

      if (!tmdb_id || !showType) {
        new Notice("No TMDB ID found in frontmatter");
        return;
      }

      new Notice("🔄 Syncing with Jellyfin...");

      await this.syncJellyfinFrontmatter(activeFile, tmdb_id, showType);

      new Notice("✅ Jellyfin sync complete");
    } catch (error: unknown) {
      new Notice("Failed to sync with Jellyfin");
      console.error('Jellyfin sync failed:', error);
    }
  }

  async syncJellyfinFrontmatter(file: TFile, tmdbId: number, showType: ShowType): Promise<void> {
    const jellyfinAvailability = await this.jellyfinApiService.checkAvailability(
      this.settings.jellyfinInstances,
      tmdbId,
      showType === "movie" ? "movie" : "series"
    );

    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      if (!isRecord(frontmatter)) {
        return;
      }
      buildJellyfinSyncFields(this.settings, jellyfinAvailability).forEach((field) => {
        frontmatter[field.name] = field.value;
      });
    });
  }

  async getFilesToSync(): Promise<TFile[]> {
    if (!isDataviewPluginEnabled(this.app) || this.settings.bulkSyncDataviewQuery.length === 0) {
      return this.app.vault.getMarkdownFiles();
    }

    const dataview = getDataviewApi<DataviewValue>(this.app);
    if (!dataview) {
      return this.app.vault.getMarkdownFiles();
    }

    let dataviewQuery = this.settings.bulkSyncDataviewQuery;
    if (!dataviewQuery.startsWith("LIST")) {
      dataviewQuery = "LIST \n" + dataviewQuery;
    }

    const results = await dataview.query(dataviewQuery);

    if (!results.successful) {
      new Notice("Dataview query failed. Check the bulk refresh query in settings.");
      return [];
    } else if (results.value.values.length === 0) {
      new Notice("No files matched the Dataview query in settings");
      return [];
    }

    return results.value.values.map((value: DataviewValue) =>
      this.app.vault.getFileByPath(normalizePath(value.path))
    ).filter((file): file is TFile => file !== null);
  }

  async syncFileWithShow(file: TFile, selectedShow: Show, isBulkSync: boolean = false): Promise<void> {
    const defaultEnabledFields = getEnabledSyncFields(this.settings);

    if (!this.settings.showPreviewDialog) {
      await this.performSync(file, selectedShow, defaultEnabledFields);
      if (!isBulkSync) {
        new Notice("✅ Successfully synced");
      }
      return;
    }

    const currentFrontmatter = await this.getCurrentFrontmatter(file);
    const result = await new Promise<{ confirmed: boolean; enabledFields?: string[] }>((resolve) => {
      new PreviewSyncModal(
        this.app,
        selectedShow,
        this.settings,
        currentFrontmatter,
        file.basename,
        (confirmed, enabledFields) => resolve({ confirmed, enabledFields })
      ).open();
    });

    if (result.confirmed) {
      await this.performSync(file, selectedShow, result.enabledFields);
      if (!isBulkSync) {
        new Notice("✅ Successfully synced");
      }
    }
  }

  async performSync(file: TFile, selectedShow: Show, enabledFields?: string[]): Promise<void> {
    if (await this.shouldDownloadPoster(selectedShow, enabledFields)) {
      await this.downloadPoster(selectedShow);
    }

    if (!enabledFields || enabledFields.includes("File Name")) {
      await this.syncFilename(file, selectedShow);
    }

    const tmdbId = getTmdbId(selectedShow);
    const jellyfinAvailability = await this.jellyfinApiService.checkAvailability(
      this.settings.jellyfinInstances,
      parseInt(tmdbId),
      selectedShow.showType === "movie" ? "movie" : "series"
    );

    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      if (isRecord(frontmatter)) {
        this.syncFrontMatter(frontmatter, selectedShow, jellyfinAvailability, enabledFields);
      }
    });
  }

  async shouldDownloadPoster(show: Show, enabledFields?: string[]): Promise<boolean> {
    if (this.settings.posterMode !== "local" || !show.imageSet?.verticalPoster?.w480) {
      return false;
    }

    return !enabledFields || enabledFields.includes("Poster");
  }

  async getCurrentFrontmatter(file: TFile): Promise<Record<string, unknown>> {
    let frontmatter: Record<string, unknown> = {};
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      if (isRecord(fm)) {
        frontmatter = { ...fm };
      }
    });
    return frontmatter;
  }

  async syncFilename(file: TFile, show: Show): Promise<void> {
    const template = show.showType === "movie"
      ? this.settings.noteNameFormat
      : this.settings.noteNameFormatSeries;

    if (template.length === 0) return;

    const newName = applyShowTemplate(template, show);

    if (file.basename == newName) return;

    const newPath = normalizePath(`${file.parent?.path}/${newName}.md`);
    if (this.app.vault.getFileByPath(newPath) !== null) {
      new Notice(`⚠️ File already exists: ${newName}.md`);
      return;
    }

    await this.app.fileManager.renameFile(file, newPath);
  }

  syncFrontMatter(frontmatter: Record<string, unknown>, selectedShow: Show, jellyfinAvailability: JellyfinAvailability[] = [], enabledFields?: string[]) {
    buildSyncFields(this.settings, selectedShow, jellyfinAvailability).forEach((field) => {
      if (field.alwaysSync || isSyncFieldEnabled(this.settings, field.enabledBy || field.name, enabledFields)) {
        frontmatter[field.name] = field.value;
      }
    });
  }

  async getTmdbId(activeFile: TFile): Promise<[number | undefined, ShowType | undefined]> {
    let tmdb_id: number | undefined = undefined;
    let showType: ShowType | undefined = undefined;

    await this.app.fileManager.processFrontMatter(activeFile, (frontmatter) => {
      if (!isRecord(frontmatter)) {
        return;
      }

      const tmdbIdValue = frontmatter["tmdb_id"];
      if (typeof tmdbIdValue === "number") {
        tmdb_id = tmdbIdValue;
      }
      const typeValue = frontmatter["Type"];
      if (typeValue === "movie" || typeValue === "series") {
        showType = typeValue;
      }
    });

    return [tmdb_id, showType];
  }

  async downloadPoster(show: Show): Promise<void> {
    if (!show.imageSet?.verticalPoster?.w480) {
      return;
    }

    try {
      const folderPath = normalizePath(this.settings.posterFolder);
      if (!await this.app.vault.adapter.exists(folderPath)) {
        await this.app.vault.createFolder(folderPath);
      }

      const tmdbId = show.tmdbId.split('/').pop() || show.tmdbId;
      const posterFilename = `${tmdbId}.jpg`;
      const posterPath = normalizePath(`${folderPath}/${posterFilename}`);

      if (await this.app.vault.adapter.exists(posterPath)) {
        return;
      }

      const response = await requestUrl({
        url: show.imageSet.verticalPoster.w480,
        method: "GET",
      });

      await this.app.vault.adapter.writeBinary(posterPath, response.arrayBuffer);
    } catch (error: unknown) {
      // Poster downloads are optional; keep the sync result.
      console.debug('Poster download failed:', error);
    }
  }

  setupApiClient() {
    this.streamingAvailabilityApi = new StreamingAvailabilityApiService(this.settings);
  }

  async loadSettings() {
    const loadedData: unknown = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, isRecord(loadedData) ? loadedData : {});
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
