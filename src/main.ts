import { Editor, MarkdownView, Notice, Plugin, TFile } from "obsidian";
import { getAPI, isPluginEnabled } from "obsidian-dataview";
import { match, P } from "ts-pattern";
import * as streamingAvailability from "streaming-availability";
import { WhoIsStreamingSettingsTab } from "./WhoIsStreamingSettingsTab";
import { ShowSelectModal } from "./ShowSelectModal";
import StreamingAvailabilityApiService, { ShowWithExtraDetails } from "./StreamingAvailabilityApiService";

/**
 * Represents the settings for the "WhoIsStreaming" plugin.
 */
export interface WhoIsStreamingSettings {
  /**
   * The API key used for accessing streaming service data.
   */
  apiKey: string;

  /**
   * The country to filter streaming availability.
   */
  country: string;

  /**
   * Cache all available countries and their streaming services as this doesn't change often. Will be refreshed weekly.
   */
  countriesCache: { [key: string]: streamingAvailability.Country };

  /**
   * The date the countries cache was last updated.
   */
  countriesCacheAsOf: Date;

  /**
   * Format to use when a note is being renamed.
   */
  noteNameFormat: string;

  /**
   * Dataview query to execute when bulk syncing shows
   */
  bulkSyncDataviewQuery: string;

  /**
   * The streaming services to sync with.
   * The key represents the service name, and the value represents the streaming availability service.
   */
  streamingServicesToSync: { [key: string]: streamingAvailability.Service };
}

const DEFAULT_SETTINGS: WhoIsStreamingSettings = {
  apiKey: "",
  country: "us",
  countriesCache: {},
  countriesCacheAsOf: new Date(0),
  noteNameFormat: "${title} (${year})",
  bulkSyncDataviewQuery: "",
  streamingServicesToSync: {},
};

export default class WhoIsStreamingPlugin extends Plugin {
  settings: WhoIsStreamingSettings;
  streamingAvailabilityApi: StreamingAvailabilityApiService;

  async onload() {
    await this.loadSettings();
    this.setupApiClient();

    this.addSettingTab(new WhoIsStreamingSettingsTab(this.app, this));

    const ribbonCommand = this.addRibbonIcon("popcorn", "Who is Streaming?", async (evt: MouseEvent) => {
        ribbonCommand.setCssStyles({ 'pointerEvents': 'none' });
        await this.syncActiveFile();
        ribbonCommand.setCssStyles({ 'pointerEvents': '' });
    });
    this.addCommand({ id: "who-is-streaming-command", name: "Who is Streaming?", editorCallback: async (editor: Editor, view: MarkdownView) => {
        await this.syncActiveFile();
    }});
    this.addCommand({ id: "who-is-streaming-sync-all-command", name: "Sync all shows", callback: async () => {
        await this.syncAllFiles();
    }});
  }

  onunload() {}

  async syncActiveFile() {
    //verify there is an active file to sycronize
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      new Notice("No active file.");
      return;
    }

    if (!this.streamingAvailabilityApi.validateApiKey()) {
      return;
    }

    //if show has been previously synced, lookup by tmdb_id instead of title
    const [tmdb_id, showType] = await this.getTmdbId(activeFile);
    if (tmdb_id && showType) {
      const show = await this.streamingAvailabilityApi.getShowByTmdbId(
        showType,
        tmdb_id
      );

      if (show) {
        this.syncFileWithShow(activeFile, show);

        new Notice("Synced using tmdb_id.");
        return;
      }
    }

    //otherwise search by title and prompt user to choose correct show
    var results = await this.streamingAvailabilityApi.searchForShowsByTitle(
      activeFile.basename
    );

    if (results.length === 1) {
      this.syncFileWithShow(activeFile, results[0]);
      return;
    }

    new ShowSelectModal(this.app, results, async (selectedShow: ShowWithExtraDetails) => {
      await this.syncFileWithShow(activeFile, selectedShow);
    }).open();
  }

  async syncAllFiles() {
    if (!this.streamingAvailabilityApi.validateApiKey()) {
      return;
    }

    const files = await this.getFilesToSync();
    if (files.length === 0) {
      return;
    }

    for (const file of files) {
      const [tmdb_id, showType] = await this.getTmdbId(file);

      if (!tmdb_id || !showType) continue;

      var show = await this.streamingAvailabilityApi.getShowByTmdbId(showType, tmdb_id);
      if (!show) continue;

      await this.syncFileWithShow(file, show);
    }

    new Notice(`Synced ${files.length} files.`);
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
      new Notice("Could not execute query. Check console for more details.");
      console.log(results);
      return [];
    } else if (results.value.values.length === 0) {
      new Notice("No files matched the dataview query in settings.");
      return [];
    }

    return results.value.values.map((value: any) =>
      this.app.vault.getFileByPath(value.path)
    );
  }

  async syncFileWithShow(file: TFile, selectedShow: ShowWithExtraDetails): Promise<void> {
    await this.syncFilename(file, selectedShow);

    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      this.syncFrontMatter(frontmatter, selectedShow);
    });
  }

  async syncFilename(file: TFile, show: ShowWithExtraDetails): Promise<void> {
    if (this.settings.noteNameFormat.length === 0) return;

    const newName = this.settings.noteNameFormat
      .replace("${title}", show.title)
      .replace("${year}", (show.year || show.firstAirYear!)?.toString())
      .replace("${tmdb_id}", show.tmdbId.toString())
      .replace(/[/\\?%*:|"<>]/g, "-");

    if (file.basename == newName) return;

    const newPath = `${file.parent?.path}/${newName}.md`;
    if (this.app.vault.getFileByPath(newPath) !== null) {
      new Notice(`File already exists: ${newName}.md`);
      return;
    }

    await this.app.fileManager.renameFile(file, newPath);
  }

  syncFrontMatter(frontmatter: any, selectedShow: ShowWithExtraDetails) {
    var he = require("he");

    const showsStreamingServices = (selectedShow.streamingInfo[this.settings.country] || []).filter((service: any) => {
      //filter out services that are not subscription or addon
      return (!service.addon?.startsWith("tvs.sbd") && (service.streamingType === "subscription" ||
          service.streamingType === "addon")
      );
    });

    frontmatter["Type"] = selectedShow.type;
    frontmatter["Year"] = selectedShow.year || selectedShow.firstAirYear;
    frontmatter["Directors"] = selectedShow.directors;
    frontmatter["Cast"] = selectedShow.cast;
    frontmatter["Overview"] = he.decode(selectedShow.overview);
    frontmatter["Genres"] = selectedShow.genres.map((genre: any) => genre.name);

    Object.entries(this.settings.streamingServicesToSync).forEach(
      ([key, streamingServiceToSync]) => {
        var matchedService = showsStreamingServices.find(
          (showsService) => showsService.service === streamingServiceToSync.id
        );

        if (matchedService === undefined) {
          frontmatter[streamingServiceToSync.name] = "Not available";
          return;
        }

        const description = match(matchedService)
          .with({ streamingType: "subscription", leaving: P._ }, () => `Available until ${new Date(matchedService!.leaving! * 1000).toLocaleDateString()}`)
          .with({ streamingType: "subscription" }, () => `Available`)
          .with({ streamingType: "addon" }, () => "Available with " + streamingServiceToSync.addons[matchedService!.addon!].displayName)
          .otherwise(() => "Not available?" + JSON.stringify(matchedService));

        frontmatter[streamingServiceToSync.name] = description;
      }
    );

    frontmatter["Last Synced"] = new Date().toLocaleString();
    frontmatter["tmdb_id"] = selectedShow.tmdbId;
  }

  async getTmdbId(activeFile: TFile): Promise<[tmdb_id: number | undefined, showType: string | undefined]> {
    let tmdb_id: number | undefined = undefined;
    let showType: string | undefined = undefined;

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

  setupApiClient() {
    this.streamingAvailabilityApi = new StreamingAvailabilityApiService(this.settings);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}
