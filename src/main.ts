import { Editor, MarkdownView, Notice, Plugin, TFile, requestUrl } from "obsidian";
import { getAPI, isPluginEnabled } from "obsidian-dataview";
import { match, P } from "ts-pattern";
import { Country, Service, ShowType, Show } from "streaming-availability";
import * as he from "he";
import { WhoIsStreamingSettingsTab } from "./WhoIsStreamingSettingsTab";
import { ShowSelectModal } from "./ShowSelectModal";
import { PreviewSyncModal } from "./PreviewSyncModal";
import { BulkSyncProgressModal } from "./BulkSyncProgressModal";
import StreamingAvailabilityApiService from "./StreamingAvailabilityApiService";
import JellyfinApiService, { JellyfinAvailability } from "./JellyfinApiService";
import { MoviesBasesView, MoviesViewType } from "./MoviesBasesView";
import { WhoIsStreamingSettings, JellyfinInstance, PosterMode, DEFAULT_SETTINGS } from "./settings";

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

    const ribbonCommand = this.addRibbonIcon("popcorn", "Who is Streaming?", async (evt: MouseEvent) => {
        ribbonCommand.setCssStyles({ 'pointerEvents': 'none' });
        await this.syncActiveFile();
        ribbonCommand.setCssStyles({ 'pointerEvents': '' });
    });
    this.addCommand({ id: "who-is-streaming-command", name: "Who is Streaming?", editorCallback: async (editor: Editor, view: MarkdownView) => {
        await this.syncActiveFile();
    }});
    this.addCommand({ id: "who-is-streaming-sync-all-command", name: "Bulk sync", callback: async () => {
        await this.syncAllFiles();
    }});

    if (this.settings.jellyfinInstances && this.settings.jellyfinInstances.length > 0) {
      this.addCommand({ id: "sync-jellyfin-all-command", name: "Bulk sync Jellyfin", callback: async () => {
          await this.syncJellyfinForAllFiles();
      }});
      this.addCommand({ id: "sync-jellyfin-active-command", name: "Sync Jellyfin", editorCallback: async (editor: Editor, view: MarkdownView) => {
          await this.syncJellyfinActiveFile();
      }});
    }
  }

  onunload() {
    this.jellyfinApiService.clearCache();
  }

  async syncActiveFile() {

    if (!this.streamingAvailabilityApi.validateApiKey()) {
      return;
    }

    let loadingNotice: Notice | undefined;

    try {
      const activeFile = this.app.workspace.getActiveFile()!;
      const [tmdb_id, showType] = await this.getTmdbId(activeFile);
      if (tmdb_id && showType) {
        try {
          loadingNotice = new Notice("🔄 Looking up show by ID...", 0);
          const show = await this.streamingAvailabilityApi.getShowByTmdbId(
            showType,
            tmdb_id,
            false
          );

          loadingNotice?.hide();

          if (show) {
            await this.syncFileWithShow(activeFile, show);
            return;
          }
        } catch (error: any) {
          loadingNotice?.hide();
          const errorMessage = await this.streamingAvailabilityApi.handleApiError(error, false);
          new Notice(`❌ ${errorMessage || "Error fetching show"}`, 10000);
          return;
        }
      }

      loadingNotice = new Notice(`🔍 Searching for "${activeFile.basename}"...`, 0);
      const results = await this.streamingAvailabilityApi.searchForShowsByTitle(
        activeFile.basename
      );
      loadingNotice?.hide();

      if (results.length === 0) {
        new Notice(`❌ No shows found for "${activeFile.basename}".`, 5000);
        return;
      }

      if (results.length === 1) {
        await this.syncFileWithShow(activeFile, results[0]);
        return;
      }

      new ShowSelectModal(this.app, results, async (selectedShow: Show) => {
        await this.syncFileWithShow(activeFile, selectedShow);
      }).open();
    } catch (error) {
      loadingNotice?.hide();
      new Notice("❌ Failed to sync show. Check console for details.", 5000);
    }
  }

  async syncAllFiles() {
    if (!this.streamingAvailabilityApi.validateApiKey()) {
      return;
    }

    const files = await this.getFilesToSync();
    if (files.length === 0) {
      new Notice("❌ No files to sync.");
      return;
    }

    const progressModal = new BulkSyncProgressModal(this.app, files.length);
    progressModal.open();

    for (const file of files) {
      if (progressModal.isCancelled()) {
        new Notice("⚠️ Bulk sync cancelled by user.");
        break;
      }

      progressModal.updateProgress(file.basename);

      try {
        const [tmdb_id, showType] = await this.getTmdbId(file);

        if (!tmdb_id || !showType) {
          progressModal.recordFailure(file.basename, "No TMDB Id found");
          continue;
        }

        const show = await this.streamingAvailabilityApi.getShowByTmdbId(showType, tmdb_id, false);

        const originalSetting = this.settings.showPreviewDialog;
        this.settings.showPreviewDialog = false;
        await this.syncFileWithShow(file, show, true);
        this.settings.showPreviewDialog = originalSetting;

        progressModal.recordSuccess();
      } catch (error) {
        const errorMessage = await this.streamingAvailabilityApi.handleApiError(error, false);
        progressModal.recordFailure(file.basename, errorMessage || "Unknown error");
      }
    }

    progressModal.complete();
  }

  async syncJellyfinForAllFiles() {
    if (this.settings.jellyfinInstances.length === 0) {
      new Notice("❌ No Jellyfin instances configured.");
      return;
    }

    const findingNotice = new Notice("🔄 Finding files with TMDB Id...", 0);

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
      new Notice("❌ No files with TMDB Id found.");
      return;
    }

    const files = filesWithTmdbId;

    const progressModal = new BulkSyncProgressModal(this.app, files.length);
    progressModal.open();

    for (const file of files) {
      if (progressModal.isCancelled()) {
        new Notice("⚠️ Bulk Jellyfin sync cancelled by user.");
        break;
      }

      progressModal.updateProgress(file.basename);

      try {
        const [tmdb_id, showType] = await this.getTmdbId(file);

        if (!tmdb_id || !showType) {
          progressModal.recordFailure(file.basename, "No TMDB Id found");
          continue;
        }

        const jellyfinAvailability = await this.jellyfinApiService.checkAvailability(
          this.settings.jellyfinInstances,
          tmdb_id,
          showType === "movie" ? "movie" : "series"
        );

        await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
          for (const availability of jellyfinAvailability) {
            if (availability.available) {
              frontmatter[availability.instanceName] = "Available";

              if (availability.itemId) {
                const instance = this.settings.jellyfinInstances.find(i => i.name === availability.instanceName);
                if (instance) {
                  const baseUrl = instance.url.replace(/\/+$/, '');
                  const link = `${baseUrl}/web/index.html#!/details?id=${availability.itemId}`;
                  frontmatter[`${availability.instanceName} Link`] = link;
                }
              }
            } else {
              frontmatter[availability.instanceName] = "Not available";
            }
          }

          const isWatched = jellyfinAvailability.some(availability => availability.watched === true);
          if (isWatched) {
            frontmatter["Watched"] = true;
          }
        });

        progressModal.recordSuccess();
      } catch (error) {
        progressModal.recordFailure(file.basename, error?.message || "Jellyfin sync error");
      }
    }

    progressModal.complete();
  }

  async syncJellyfinActiveFile() {
    if (this.settings.jellyfinInstances.length === 0) {
      new Notice("❌ No Jellyfin instances configured.");
      return;
    }

    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      new Notice("❌ No active file.");
      return;
    }

    try {
      const [tmdb_id, showType] = await this.getTmdbId(activeFile);

      if (!tmdb_id || !showType) {
        new Notice("❌ No TMDB Id found in frontmatter.");
        return;
      }

      new Notice("🔄 Syncing with Jellyfin...");

      const jellyfinAvailability = await this.jellyfinApiService.checkAvailability(
        this.settings.jellyfinInstances,
        tmdb_id,
        showType === "movie" ? "movie" : "series"
      );

      await this.app.fileManager.processFrontMatter(activeFile, (frontmatter) => {
        for (const availability of jellyfinAvailability) {
          if (availability.available) {
            frontmatter[availability.instanceName] = "Available";

            if (availability.itemId) {
              const instance = this.settings.jellyfinInstances.find(i => i.name === availability.instanceName);
              if (instance) {
                const baseUrl = instance.url.replace(/\/+$/, '');
                const link = `${baseUrl}/web/index.html#!/details?id=${availability.itemId}`;
                frontmatter[`${availability.instanceName} Link`] = link;
              }
            }
          } else {
            frontmatter[availability.instanceName] = "Not available";
          }
        }

        const isWatched = jellyfinAvailability.some(availability => availability.watched === true);
        if (isWatched) {
          frontmatter["Watched"] = true;
        }
      });

      new Notice("✅ Jellyfin sync complete!");
    } catch (error) {
      new Notice("❌ Failed to sync with Jellyfin.");
    }
  }

  async getFilesToSync(): Promise<TFile[]> {
    if (!isPluginEnabled(this.app) || this.settings.bulkSyncDataviewQuery.length === 0) {
      return this.app.vault.getMarkdownFiles();
    }

    const dataview = getAPI(this.app);
    let dataviewQuery = this.settings.bulkSyncDataviewQuery;
    if (!dataviewQuery.startsWith("LIST")) {
      dataviewQuery = "LIST \n" + dataviewQuery;
    }

    const results = await dataview.query(dataviewQuery);

    if (!results.successful) {
      new Notice("Could not execute query. Please check your Dataview query syntax.");
      return [];
    } else if (results.value.values.length === 0) {
      new Notice("No files matched the dataview query in settings.");
      return [];
    }

    return results.value.values.map((value: any) =>
      this.app.vault.getFileByPath(value.path)
    );
  }

  async syncFileWithShow(file: TFile, selectedShow: Show, isBulkSync: boolean = false): Promise<void> {
    if (!this.settings.showPreviewDialog) {
      await this.performSync(file, selectedShow);
      if (!isBulkSync) {
        new Notice("✅ Successfully synced!");
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
        new Notice("✅ Successfully synced!");
      }
    }
  }

  async performSync(file: TFile, selectedShow: Show, enabledFields?: string[]): Promise<void> {
    if (this.settings.posterMode === "local" && (!enabledFields || enabledFields.includes("Poster"))) {
      await this.downloadPoster(selectedShow);
    }

    if (!enabledFields || enabledFields.includes("File Name")) {
      await this.syncFilename(file, selectedShow);
    }

    const tmdbId = selectedShow.tmdbId.split('/').pop() || selectedShow.tmdbId;
    const jellyfinAvailability = await this.jellyfinApiService.checkAvailability(
      this.settings.jellyfinInstances,
      parseInt(tmdbId),
      selectedShow.showType === "movie" ? "movie" : "series"
    );

    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      this.syncFrontMatter(frontmatter, selectedShow, jellyfinAvailability, enabledFields);
    });
  }

  async getCurrentFrontmatter(file: TFile): Promise<any> {
    let frontmatter: any = {};
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      frontmatter = { ...fm };
    });
    return frontmatter;
  }

  async syncFilename(file: TFile, show: Show): Promise<void> {
    const template = show.showType === "movie"
      ? this.settings.noteNameFormat
      : this.settings.noteNameFormatSeries;

    if (template.length === 0) return;

    const newName = this.applyTemplate(template, show);

    if (file.basename == newName) return;

    const newPath = `${file.parent?.path}/${newName}.md`;
    if (this.app.vault.getFileByPath(newPath) !== null) {
      new Notice(`⚠️ File already exists: ${newName}.md`);
      return;
    }

    await this.app.fileManager.renameFile(file, newPath);
  }

  applyTemplate(template: string, show: Show): string {
    return template
      .replace("${title}", show.title)
      .replace("${year}", (show.releaseYear || show.firstAirYear || "")?.toString())
      .replace("${firstAirYear}", (show.firstAirYear || "")?.toString())
      .replace("${lastAirYear}", (show.lastAirYear || "")?.toString())
      .replace("${tmdb_id}", show.tmdbId.toString())
      .replace("${rating}", show.rating?.toString() || "")
      .replace("${runtime}", show.runtime?.toString() || "")
      .replace(/[/\\?%*:|"<>]/g, "-");
  }

  syncFrontMatter(frontmatter: any, selectedShow: Show, jellyfinAvailability: JellyfinAvailability[] = [], enabledFields?: string[]) {
    const isFieldEnabled = (fieldName: string) => !enabledFields || enabledFields.includes(fieldName);

    const showsStreamingServices = (selectedShow.streamingOptions[this.settings.country] || []).filter((service: any) => {
      return (!service.addon?.id?.startsWith("tvs.sbd") && (service.type === "subscription" ||
          service.type === "addon")
      );
    });

    const tmdbId = selectedShow.tmdbId.split('/').pop() || selectedShow.tmdbId;

    // Build field values object
    const fieldValues: Record<string, any> = {
      "tmdb_id": parseInt(tmdbId),
      "Type": isFieldEnabled("Type") ? selectedShow.showType : undefined,
      "Year": isFieldEnabled("Year") ? (selectedShow.releaseYear || selectedShow.firstAirYear) : undefined,
      "Directors": isFieldEnabled("Directors") ? selectedShow.directors : undefined,
      "Cast": isFieldEnabled("Cast") ? selectedShow.cast : undefined,
      "Overview": isFieldEnabled("Overview") ? he.decode(selectedShow.overview) : undefined,
      "Genres": isFieldEnabled("Genres") ? selectedShow.genres.map((genre: any) => genre.name) : undefined,
    };

    if (this.settings.includeAdditionalMetadata) {
      if (selectedShow.runtime) {
        fieldValues["Runtime"] = isFieldEnabled("Runtime") ? `${selectedShow.runtime} min` : undefined;
      }
      if (selectedShow.rating) {
        fieldValues["Rating"] = isFieldEnabled("Rating") ? selectedShow.rating : undefined;
      }
      if (selectedShow.seasonCount) {
        fieldValues["Seasons"] = isFieldEnabled("Seasons") ? selectedShow.seasonCount : undefined;
      }
      if (selectedShow.episodeCount) {
        fieldValues["Episodes"] = isFieldEnabled("Episodes") ? selectedShow.episodeCount : undefined;
      }
    }

    if (selectedShow.imageSet?.verticalPoster?.w480) {
      if (isFieldEnabled("Poster")) {
        if (this.settings.posterMode === "local") {
          const posterFilename = `${tmdbId}.jpg`;
          fieldValues["Poster"] = `![[${this.settings.posterFolder}/${posterFilename}]]`;
        } else if (this.settings.posterMode === "remote") {
          fieldValues["Poster"] = selectedShow.imageSet.verticalPoster.w480;
        }
      }
    }

    if (this.settings.autoAddGenreTags) {
      const genreTags = selectedShow.genres.map((genre: any) =>
        genre.name.toLowerCase().replace(/\s+/g, "-")
      );
      const typeTags = [selectedShow.showType === "movie" ? "movie" : "tv-series"];
      fieldValues["tags"] = [...typeTags, ...genreTags];
    }

    // Handle streaming services
    Object.entries(this.settings.streamingServicesToSync).forEach(([key, streamingServiceToSync]) => {
        const matchedService = showsStreamingServices.find(
          (showsService) => showsService.service.id === streamingServiceToSync.id
        );

        const description = matchedService === undefined
          ? "Not available"
          : match(matchedService)
              .with({ type: "subscription", expiresOn: P._ }, () => `Available until ${new Date(matchedService!.expiresOn! * 1000).toLocaleDateString()}`)
              .with({ type: "subscription" }, () => `Available`)
              .with({ type: "addon" }, () => {
                return matchedService!.addon?.name ? `Available with ${matchedService!.addon.name}` : "Available with addon";
              })
              .otherwise(() => "Not available?" + JSON.stringify(matchedService));

        fieldValues[streamingServiceToSync.name] = isFieldEnabled(streamingServiceToSync.name) ? description : undefined;

        if (this.settings.addStreamingLinks && matchedService?.link) {
          fieldValues[`${streamingServiceToSync.name} Link`] = isFieldEnabled(streamingServiceToSync.name) ? matchedService.link : undefined;
        }
    });

    // Handle Jellyfin availability
    for (const availability of jellyfinAvailability) {
      const status = availability.available ? "Available" : "Not available";
      fieldValues[availability.instanceName] = isFieldEnabled(availability.instanceName) ? status : undefined;

      if (availability.available && availability.itemId) {
        const instance = this.settings.jellyfinInstances.find(i => i.name === availability.instanceName);
        if (instance && isFieldEnabled(availability.instanceName)) {
          const baseUrl = instance.url.replace(/\/+$/, '');
          const link = `${baseUrl}/web/index.html#!/details?id=${availability.itemId}`;
          fieldValues[`${availability.instanceName} Link`] = link;
        }
      }
    }

    const isWatched = jellyfinAvailability.some(availability => availability.watched === true);
    if (isWatched) {
      fieldValues["Watched"] = true;
    }

    fieldValues["Last Synced"] = new Date().toLocaleString();

    // Apply field values to frontmatter, skipping null/undefined values
    Object.entries(fieldValues).forEach(([key, value]) => {
      if (value !== null && value !== undefined) {
        frontmatter[key] = value;
      }
    });
  }

  async getTmdbId(activeFile: TFile): Promise<[number | undefined, ShowType | undefined]> {
    let tmdb_id: number | undefined = undefined;
    let showType: ShowType | undefined = undefined;

    await this.app.fileManager.processFrontMatter(activeFile, (frontmatter) => {
      if (frontmatter["tmdb_id"]) {
        tmdb_id = frontmatter["tmdb_id"];
      }
      if (frontmatter["Type"]) {
        showType = frontmatter["Type"];
      }
    });

    return [tmdb_id, showType];
  }

  async downloadPoster(show: Show): Promise<void> {
    if (!show.imageSet?.verticalPoster?.w480) {
      return;
    }

    try {
      const folderPath = this.settings.posterFolder;
      if (!await this.app.vault.adapter.exists(folderPath)) {
        await this.app.vault.createFolder(folderPath);
      }

      const tmdbId = show.tmdbId.split('/').pop() || show.tmdbId;
      const posterFilename = `${tmdbId}.jpg`;
      const posterPath = `${folderPath}/${posterFilename}`;

      if (await this.app.vault.adapter.exists(posterPath)) {
        return;
      }

      const response = await requestUrl({
        url: show.imageSet.verticalPoster.w480,
        method: "GET",
      });

      await this.app.vault.adapter.writeBinary(posterPath, response.arrayBuffer);
    } catch (error) {
      
    }
  }

  setupApiClient() {
    this.streamingAvailabilityApi = new StreamingAvailabilityApiService(this.settings);
  }

  async loadSettings() {
    const loadedData = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
