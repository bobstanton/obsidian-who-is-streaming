import { ItemView, Notice, Plugin, TFile } from "obsidian";
import { Show } from "streaming-availability";
import { WhoIsStreamingSettingsTab } from "./WhoIsStreamingSettingsTab";
import { TitleSelectModal } from "./TitleSelectModal";
import { previewPlan } from "./PreviewRefreshModal";
import StreamingAvailabilityApiService from "./StreamingAvailabilityApiService";
import JellyfinApiService, { JellyfinAvailability } from "./JellyfinApiService";
import { TitlesBasesView, TitlesViewType } from "./TitlesBasesView";
import { CastGraphBasesView, CastGraphViewType } from "./CastGraphBasesView";
import { StatsBasesView, StatsViewType } from "./StatsBasesView";
import { DiscoverBasesView, DiscoverViewType } from "./DiscoverBasesView";
import TmdbApiService from "./TmdbApiService";
import { TmdbNotes } from "./TmdbNotes";
import { JellyfinNotes } from "./JellyfinNotes";
import { registerCommands } from "./commands";
import { runBulkOperation } from "./bulk";
import { DEFAULT_FIELD_SOURCES, NOTE_NAME_FIELD, getFieldsFrom } from "./fields";
import { isRecord } from "./frontmatterUtils";
import { applyLeavingFromShow, updateLeavingSoon } from "./leavingSoon";
import { parseLastSynced } from "./lastSynced";
import { downloadPoster, readTitleId } from "./notes";
import { Outcome, failed, warned } from "./outcome";
import { LAST_SYNCED_PROPERTY, LETTERBOXD_PROPERTY, POSTER_PROPERTY, TMDB_ID_PROPERTY, WATCHED_PROPERTY } from "./properties";
import { WhoIsStreamingSettings, DEFAULT_SETTINGS, JellyfinInstance, isJellyfinInstanceComplete } from "./settings";
import { buildRefreshFields, getEnabledFields, isRefreshFieldEnabled } from "./refreshFields";
import { getShowTemplateVariables, renderFileName } from "./templates";
import { getFrontmatter, getNoteTitle, getNoteYear, getVaultTitles, guessImportFolder, normaliseTitle } from "./vaultTitles";
import { addWatchDates, applyJellyfinRuntime, applyJellyfinWatchHistory, toDayString } from "./watchHistory";
import { TitleType, showTitleId } from "./titleId";
import { RefreshPlan, applyPlan, combinePlans } from "./refreshPlan";
import { applyNoteTemplate, createTitleNote, propertyVariables } from "./titleNotes";
import { RefreshReporter, describeError } from "./refreshReporter";

type TitleListView = TitlesBasesView | StatsBasesView;

export default class WhoIsStreamingPlugin extends Plugin {
  settings!: WhoIsStreamingSettings;
  streamingAvailabilityApi!: StreamingAvailabilityApiService;
  jellyfinApiService!: JellyfinApiService;
  tmdbApi!: TmdbApiService;
  tmdbNotes!: TmdbNotes;
  jellyfinNotes!: JellyfinNotes;
  private titlesViews = new Set<TitlesBasesView>();
  private statsViews = new Set<StatsBasesView>();

  async onload() {
    await this.loadSettings();
    this.setupApiClient();
    this.tmdbApi = new TmdbApiService(this.settings);
    this.tmdbNotes = new TmdbNotes(this);
    this.jellyfinApiService = new JellyfinApiService();
    this.jellyfinApiService.tmdbIdResolver = async (ids) =>
      this.tmdbApi.isConfigured() ? this.tmdbApi.findByExternalId(ids.type, ids) : undefined;
    this.jellyfinNotes = new JellyfinNotes(this);

    this.addSettingTab(new WhoIsStreamingSettingsTab(this.app, this));
    this.registerViews();
    registerCommands(this);
    this.app.workspace.onLayoutReady(() => void this.getGenres());

    const ribbon = this.addRibbonIcon("popcorn", "Who is streaming", async () => {
      try {
        ribbon.addClass("who-is-streaming-ribbon-disabled");

        await this.searchActiveNote();
      } finally {
        ribbon.removeClass("who-is-streaming-ribbon-disabled");
      }
    });
  }

  onunload() {
    this.jellyfinApiService.clearCache();
  }

  private registerViews(): void {
    this.registerBasesView(TitlesViewType, {
      name: "Titles",
      icon: "film",
      factory: (controller, scrollEl) => new TitlesBasesView(controller, scrollEl, this),
      options: (config) => TitlesBasesView.getViewOptions(config),
    });

    this.registerBasesView(CastGraphViewType, {
      name: "Cast graph",
      icon: "waypoints",
      factory: (controller, scrollEl) => new CastGraphBasesView(controller, scrollEl),
      options: CastGraphBasesView.getViewOptions,
    });

    this.registerBasesView(StatsViewType, {
      name: "Title stats",
      icon: "chart-column",
      factory: (controller, scrollEl) => new StatsBasesView(controller, scrollEl, this),
      options: StatsBasesView.getViewOptions,
    });

    this.registerBasesView(DiscoverViewType, {
      name: "Streaming discover",
      icon: "telescope",
      factory: (controller, scrollEl) => new DiscoverBasesView(controller, scrollEl, this),
      options: (config) => DiscoverBasesView.getViewOptions(config, this.settings),
    });
  }

  setupApiClient() {
    this.streamingAvailabilityApi = new StreamingAvailabilityApiService(this.settings);
  }

  async loadSettings() {
    const loadedData: unknown = await this.loadData();
    const loaded = isRecord(loadedData) ? loadedData : {};

    this.settings = Object.assign({}, DEFAULT_SETTINGS, loaded);

    this.settings.fieldSources = { ...DEFAULT_FIELD_SOURCES, ...(isRecord(loaded["fieldSources"]) ? loaded["fieldSources"] : {}) };

    const services = Object.values(this.settings.streamingServicesToSync ?? {})
      .filter((service) => isRecord(service) && typeof service.id === "string");

    this.settings.streamingServicesToSync = Object.fromEntries(services.map((service) => [service.id, service]));
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  getJellyfinInstances(): JellyfinInstance[] {
    return this.settings.jellyfinInstances.filter(isJellyfinInstanceComplete);
  }

  registerTitlesView(view: TitlesBasesView): void {
    this.titlesViews.add(view);
  }

  unregisterTitlesView(view: TitlesBasesView): void {
    this.titlesViews.delete(view);
  }

  registerStatsView(view: StatsBasesView): void {
    this.statsViews.add(view);
  }

  unregisterStatsView(view: StatsBasesView): void {
    this.statsViews.delete(view);
  }

  private getActiveTitlesView(): TitlesBasesView | null {
    return this.findActiveView(this.titlesViews);
  }

  getActiveTitleListView(): TitleListView | null {
    return this.getActiveTitlesView() ?? this.findActiveView(this.statsViews);
  }

  private findActiveView<T extends { containerEl: HTMLElement }>(views: Set<T>): T | null {
    const activeView = this.app.workspace.getActiveViewOfType(ItemView);

    if (!activeView) return null;

    for (const view of views) {
      if (activeView.containerEl.contains(view.containerEl) && view.containerEl.isShown()) return view;
    }

    return null;
  }

  async getGenres(): Promise<{ id: string; name: string }[]> {
    const fetchedBefore = this.settings.genresCacheAsOf;
    const genres = await this.streamingAvailabilityApi.getGenres();

    if (this.settings.genresCacheAsOf !== fetchedBefore) {
      await this.saveSettings();
    }

    return genres;
  }

  async checkLeavingSoon(): Promise<void> {
    const loadingNotice = new Notice("Checking what's leaving soon…", 0);

    try {
      const summary = await updateLeavingSoon(this.app, this.streamingAvailabilityApi);

      loadingNotice.hide();
      if (!summary) return;

      if (summary.leaving.length === 0) {
        const cleared = summary.cleared > 0 ? ` Cleared ${summary.cleared} that are no longer leaving.` : "";

        new Notice(`Nothing in your vault is leaving your services soon.${cleared}`, 8000);

        return;
      }

      const lines = summary.leaving.slice(0, 5).map((title) =>
        `${title.file.basename}: ${title.services.join(", ")}, ${title.date ?? "soon"}`
      );

      if (summary.leaving.length > 5) lines.push(`…and ${summary.leaving.length - 5} more`);
      const partial = summary.complete ? "" : "\nOnly the soonest departures were checked.";

      new Notice(`${summary.leaving.length} in your vault leaving soon:\n${lines.join("\n")}${partial}`, 15000);
    } catch (error: unknown) {
      loadingNotice.hide();
      new Notice(`❌ Could not check what's leaving: ${await this.describeApiError(error)}`, 10000);
      console.error("Leaving soon check failed:", error);
    }
  }

  async createNoteForTitle(show: Show): Promise<TFile | undefined> {
    try {
      const { type } = showTitleId(show);
      const file = await createTitleNote(this.app, this.settings, {
        title: show.title,
        type,
        year: show.releaseYear ?? show.firstAirYear,
        folder: guessImportFolder(this.app),
        variables: getShowTemplateVariables(show),
        write: [],
      });
      const warning = await this.refreshNote(file, show);

      new Notice(warning ? `Added ${file.basename}. ${warning}` : `Added ${file.basename}`, warning ? 10000 : undefined);

      return file;
    } catch (error: unknown) {
      new Notice(`❌ Could not add "${show.title}": ${describeError(error)}`, 10000);
      console.error("Adding a note from Streaming discover failed:", error);

      return undefined;
    }
  }

  async searchActiveNote(): Promise<void> {
    if (!this.streamingAvailabilityApi.validateApiKey()) return;

    const file = this.app.workspace.getActiveFile();

    if (!file) {
      new Notice("No active note");

      return;
    }

    const loadingNotice = new Notice(`🔍 Searching for "${file.basename}"…`, 0);

    try {
      const results = await this.streamingAvailabilityApi.searchForShowsByTitle(file.basename);

      loadingNotice.hide();

      if (results.length === 0) {
        new Notice(`No titles found for "${file.basename}"`, 5000);
      } else if (results.length === 1) {
        await this.identifyNote(file, results[0]);
      } else {
        new TitleSelectModal(this.app, results, (selected: Show) => void this.identifyNote(file, selected)).open();
      }
    } catch (error: unknown) {
      loadingNotice.hide();
      new Notice(`❌ Search failed: ${await this.describeApiError(error)}`, 10000);
      console.error("Search failed:", error);
    }
  }

  async refreshActiveNote(): Promise<void> {
    if (!this.streamingAvailabilityApi.validateApiKey()) return;

    const file = this.app.workspace.getActiveFile();

    if (!file) {
      new Notice("No active note");

      return;
    }

    const reporter = new RefreshReporter("Streaming Availability");
    const id = readTitleId(this.app, file);

    if (!id) {
      reporter.done(failed("This note has no TMDB ID or type"));

      return;
    }

    try {
      const show = await this.streamingAvailabilityApi.getShowByTmdbId(id.type, id.tmdbId, false, true);

      if (!show) reporter.done(failed("Title not found"));
      else await this.refreshWithPreview(file, show, reporter);
    } catch (error: unknown) {
      reporter.fail(error, await this.describeApiError(error));
    }
  }

  getBulkTargets(): { files: TFile[]; scope: string } {
    const view = this.getActiveTitleListView();

    return { files: view ? view.getDisplayedFiles() : getVaultTitles(this.app).map((title) => title.file), scope: view ? "this base" : "your vault" };
  }

  async bulkRefresh(): Promise<void> {
    if (!this.streamingAvailabilityApi.validateApiKey()) return;

    const { files: candidates, scope } = this.getBulkTargets();
    const files = candidates.filter((file) => readTitleId(this.app, file) !== undefined);

    if (files.length === 0) {
      new Notice(`No titles with a TMDB ID found in ${scope}`);

      return;
    }

    const lastSynced = (file: TFile) => parseLastSynced(getFrontmatter(this.app, file)[LAST_SYNCED_PROPERTY]) ?? Number.MIN_SAFE_INTEGER;
    const ordered = [...files].sort((a, b) => lastSynced(a) - lastSynced(b));
    const toRefresh = this.settings.bulkRefreshLimit > 0 ? ordered.slice(0, this.settings.bulkRefreshLimit) : ordered;

    if (toRefresh.length < files.length) {
      new Notice(`Refreshing the ${toRefresh.length} least recently refreshed of ${files.length} notes`);
    }

    await this.runStreamingBulk(toRefresh, "Bulk refresh", async (file) => {
      const id = readTitleId(this.app, file);

      if (!id) return failed("No TMDB ID or type");

      return this.refreshById(file, id.type, id.tmdbId);
    });
  }

  getImportedNotesToRefresh(): TFile[] {
    return getVaultTitles(this.app)
      .filter((title) => title.frontmatter[TMDB_ID_PROPERTY] == null
        || (typeof title.frontmatter[LETTERBOXD_PROPERTY] === "string" && title.frontmatter[LAST_SYNCED_PROPERTY] == null))
      .map((title) => title.file);
  }

  async refreshImportedNotes(): Promise<void> {
    if (!this.streamingAvailabilityApi.validateApiKey()) return;

    const imported = this.getImportedNotesToRefresh();
    const limit = this.settings.bulkRefreshLimit;
    const files = limit > 0 ? imported.slice(0, limit) : imported;

    if (files.length < imported.length) {
      new Notice(`Refreshing ${files.length} of ${imported.length} imported notes. Run again for the rest.`);
    }

    await this.runStreamingBulk(files, "Refresh imported notes", async (file) => {
      const frontmatter = getFrontmatter(this.app, file);
      const title = getNoteTitle(file, frontmatter);
      const year = getNoteYear(file, frontmatter);

      const stored = frontmatter[TMDB_ID_PROPERTY];
      const tmdbId = typeof stored === "number" ? stored
        : this.tmdbApi.isConfigured() ? await this.tmdbApi.findMovieId(title, year) : undefined;

      if (tmdbId !== undefined) {
        const outcome = await this.refreshById(file, "movie", tmdbId);

        if (outcome.status !== "failed" || typeof stored === "number") return outcome;
      }

      const wanted = normaliseTitle(title);
      const matches = (await this.streamingAvailabilityApi.searchForShowsByTitle(title)).filter((show) =>
        show.showType === "movie"
        && normaliseTitle(show.title) === wanted
        && (year === undefined || show.releaseYear === year)
      );

      if (matches.length === 0) return failed("No exact match found");
      if (matches.length > 1) return failed(`${matches.length} possible matches; use Search on this note`);

      return warned(await this.refreshNote(file, matches[0]));
    });
  }

  private async refreshById(file: TFile, type: TitleType, tmdbId: number): Promise<Outcome> {
    const show = await this.streamingAvailabilityApi.getShowByTmdbId(type, tmdbId, false);

    if (!show) return failed("Title not found");

    return warned(await this.refreshNote(file, show));
  }

  private runStreamingBulk(files: TFile[], title: string, processFile: (file: TFile) => Promise<Outcome>): Promise<void> {
    return runBulkOperation(this.app, files, title, processFile, (error) => this.describeApiError(error));
  }

  private async describeApiError(error: unknown): Promise<string> {
    const apiMessage = await this.streamingAvailabilityApi.handleApiError(error, false);

    return apiMessage || describeError(error);
  }

  private async identifyNote(file: TFile, show: Show): Promise<void> {
    const reporter = new RefreshReporter("Streaming Availability");

    try {
      if (!await this.refreshWithPreview(file, show, reporter)) return;
      const current = this.app.vault.getFileByPath(file.path) ?? file;

      await applyNoteTemplate(this.app, this.settings, current, { ...getShowTemplateVariables(show), ...propertyVariables(getFrontmatter(this.app, current)) });
    } catch (error: unknown) {
      reporter.fail(error, await this.describeApiError(error));
    }
  }

  private async refreshWithPreview(file: TFile, show: Show, reporter: RefreshReporter): Promise<boolean> {
    const plan = await this.planRefresh(file, show);
    let accepted: Set<string> | undefined;

    if (this.settings.showPreviewDialog) {
      reporter.pause();
      accepted = await previewPlan(this.app, getFrontmatter(this.app, file), file.basename, plan);

      if (!accepted) {
        reporter.cancel();

        return false;
      }
    }

    reporter.done(warned(await applyPlan(this.app, file, plan, accepted)));

    return true;
  }

  async refreshNote(file: TFile, show: Show): Promise<string | undefined> {
    return applyPlan(this.app, file, await this.planRefresh(file, show));
  }

  private async planRefresh(file: TFile, show: Show): Promise<RefreshPlan> {
    const { tmdbId, type } = showTitleId(show);
    const enabledFields = getEnabledFields(this.settings);
    const jellyfinAvailability = await this.jellyfinApiService.checkAvailability(this.getJellyfinInstances(), tmdbId, type);
    const template = this.getNameTemplate(show);
    const posterUrl = show.imageSet?.verticalPoster?.w480;
    const plan: RefreshPlan = {
      heading: show.title,
      details: `${type === "movie" ? "Movie" : "Series"} • ${show.releaseYear ?? show.firstAirYear ?? ""}`,
      posterUrl: show.imageSet?.verticalPoster?.w240,
      newName: enabledFields.includes(NOTE_NAME_FIELD) && template.length > 0 ? await renderFileName(template, getShowTemplateVariables(show)) : undefined,
      writers: [(frontmatter) => {
        this.writeFields(frontmatter, show, jellyfinAvailability, enabledFields);
        applyLeavingFromShow(frontmatter, this.settings, show);
        applyJellyfinWatchHistory(frontmatter, jellyfinAvailability, this.settings);
        applyJellyfinRuntime(frontmatter, jellyfinAvailability, this.settings);
      }],
      posterDownload: this.settings.posterMode === "local" && posterUrl && enabledFields.includes(POSTER_PROPERTY)
        ? () => downloadPoster(this.app, this.settings, tmdbId, posterUrl)
        : undefined,
    };

    if (!this.tmdbNotes.isConfigured() || getFieldsFrom(this.settings, "tmdb").length === 0) return plan;

    try {
      const tmdb = await this.tmdbNotes.plan(file, { type, tmdbId });

      return "plan" in tmdb ? combinePlans(plan, tmdb.plan) : { ...plan, warning: `TMDB fields not refreshed: ${tmdb.failure}` };
    } catch (error: unknown) {
      console.error(`TMDB refresh failed for ${file.path}:`, error);

      return { ...plan, warning: "TMDB fields not refreshed" };
    }
  }

  private writeFields(frontmatter: Record<string, unknown>, show: Show, jellyfinAvailability: JellyfinAvailability[], enabledFields: string[]): void {
    for (const field of buildRefreshFields(this.settings, show, jellyfinAvailability)) {
      const existing = frontmatter[field.name];

      if (field.name === WATCHED_PROPERTY && existing !== undefined && typeof existing !== "boolean") continue;

      if (field.always || isRefreshFieldEnabled(this.settings, field.enabledBy || field.name, enabledFields)) {
        frontmatter[field.name] = field.value;
      }
    }
  }

  private getNameTemplate(show: Show): string {
    return show.showType === "movie" ? this.settings.noteNameFormat : this.settings.noteNameFormatSeries;
  }

  async markWatchedToday(file: TFile): Promise<void> {
    const today = toDayString(new Date());
    let added = false;

    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      if (isRecord(frontmatter)) added = addWatchDates(frontmatter, [today]);
    });

    new Notice(added ? `Marked as watched on ${today}` : `Already marked as watched on ${today}`);
  }
}
