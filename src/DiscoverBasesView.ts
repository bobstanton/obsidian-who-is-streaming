import { BasesAllOptions, BasesView, BasesViewConfig, ButtonComponent, Keymap, QueryController, TFile } from "obsidian";
import { Show } from "streaming-availability";
import { decode } from "he";
import WhoIsStreamingPlugin from "./main";
import { WhoIsStreamingSettings } from "./settings";
import { TileMode, TitleTile, readPosterSize, readTileMode, renderTile } from "./titleTiles";
import { isWatched } from "./watchHistory";
import { getVaultTitles } from "./vaultTitles";
import { noteKey, showKey } from "./titleId";
import { DiscoverParams, getDiscoverViewOptions, readDiscoverParams } from "./discoverOptions";
import { DiscoverItem, fetchDiscoverResults } from "./discoverQuery";

export const DiscoverViewType = "discover";

const OPTION_SETTLE_MS = 800;

export class DiscoverBasesView extends BasesView {
  type = DiscoverViewType;
  containerEl: HTMLElement;
  plugin: WhoIsStreamingPlugin;

  private items: DiscoverItem[] = [];
  private nextCursor: string | undefined;
  private message = "";
  private warning = "";
  private loading = false;
  private loadedKey: string | null = null;
  private requestId = 0;
  private settleTimer: number | null = null;

  constructor(controller: QueryController, scrollEl: HTMLElement, plugin: WhoIsStreamingPlugin) {
    super(controller);
    this.plugin = plugin;
    this.containerEl = scrollEl.createDiv({ cls: "who-is-streaming-discover" });
    void this.plugin.getGenres();
  }

  onunload(): void {
    this.clearSettleTimer();
    this.requestId++;
  }

  public onDataUpdated(): void {
    const params = readDiscoverParams(this.config, this.plugin.settings);
    const key = JSON.stringify(params);

    if (key === this.loadedKey) {
      this.renderResults();

      return;
    }

    const isFirstLoad = this.loadedKey === null;

    this.loadedKey = key;
    this.clearSettleTimer();

    if (isFirstLoad) {
      void this.loadResults(params);

      return;
    }

    this.loading = true;
    this.renderResults();
    this.settleTimer = this.containerEl.win.setTimeout(() => {
      this.settleTimer = null;
      void this.loadResults(params);
    }, OPTION_SETTLE_MS);
  }

  private clearSettleTimer(): void {
    if (this.settleTimer !== null) {
      this.containerEl.win.clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }
  }

  static getViewOptions(this: void, config: BasesViewConfig, settings: WhoIsStreamingSettings): BasesAllOptions[] {
    return getDiscoverViewOptions(config, settings);
  }

  private async loadResults(params: DiscoverParams, append = false): Promise<void> {
    const requestId = ++this.requestId;

    this.loading = true;

    if (!append) {
      this.items = [];
      this.nextCursor = undefined;
      this.message = "";
      this.warning = "";
    }

    this.renderResults();

    const results = await fetchDiscoverResults({
      api: this.plugin.streamingAvailabilityApi,
      getGenres: () => this.plugin.getGenres(),
      hasEnabledServices: Object.keys(this.plugin.settings.streamingServicesToSync).length > 0,
    }, params, append ? this.nextCursor : undefined);

    if (requestId !== this.requestId) return;

    this.items = append ? [...this.items, ...results.items] : results.items;
    this.nextCursor = results.nextCursor;
    this.message = results.message;
    this.warning = results.warning;
    this.loading = false;
    this.renderResults();
  }

  private getServiceNames(show: Show): string[] {
    const enabled = Object.values(this.plugin.settings.streamingServicesToSync);
    const names = new Set<string>();

    for (const option of show.streamingOptions?.[this.plugin.settings.country] ?? []) {
      const service = enabled.find((candidate) => candidate.id === option.service.id);

      if (service && (option.type === "subscription" || option.type === "addon")) names.add(service.name);
    }

    return [...names];
  }

  private renderResults(): void {
    const el = this.containerEl;

    el.empty();

    if (this.warning) el.createDiv({ cls: "discover-warning", text: this.warning });

    if (this.message && !this.loading) {
      el.createDiv({ cls: "who-is-streaming-empty", text: this.message });

      return;
    }

    const inVault = new Map<string, { file: TFile; watched: boolean }>();

    for (const title of getVaultTitles(this.app)) {
      const key = noteKey(title.frontmatter);

      if (key) inVault.set(key, { file: title.file, watched: isWatched(title.frontmatter) });
    }

    const hideInVault = this.config.get("hideInVault") === true;
    const visible = this.items.filter((item) => !hideInVault || !inVault.has(showKey(item.show)));

    if (visible.length === 0 && !this.loading) {
      const text = this.items.length > 0
        ? "Everything in this list is already in your vault."
        : "Nothing found. Check that streaming services are enabled in settings, or try different options.";

      el.createDiv({ cls: "who-is-streaming-empty", text });
    }

    const mode = readTileMode(this.config, "poster");
    const grid = el.createDiv({ cls: `who-is-streaming-results ${mode}-view` });

    if (mode === "poster") {
      grid.setCssProps({ "--poster-size": `${readPosterSize(this.config, this.plugin.settings.gridPosterSize)}px` });
    }

    for (const item of visible) {
      this.renderItem(grid, item, mode, inVault.get(showKey(item.show)));
    }

    if (this.loading) {
      el.createDiv({ cls: "discover-status", text: "Loading…" });
    } else if (this.nextCursor) {
      const more = el.createDiv({ cls: "discover-status" });

      new ButtonComponent(more).setButtonText("Load more").onClick(() => void this.loadResults(readDiscoverParams(this.config, this.plugin.settings), true));
    }
  }

  private buildTile(item: DiscoverItem, inVault: boolean, watched: boolean): TitleTile {
    const { show } = item;
    const year = show.releaseYear ?? show.firstAirYear;
    const names = (values: unknown[] | undefined) => (values ?? []).filter((value): value is string => typeof value === "string");

    return {
      title: show.title,
      year: year ? String(year) : undefined,
      type: show.showType,
      runtime: show.runtime ? `${show.runtime} min` : undefined,
      ratings: show.rating ? [`Streaming Availability ${show.rating}`] : [],
      detail: item.detail || undefined,
      posterUrl: show.imageSet?.verticalPoster?.w480 ?? show.imageSet?.verticalPoster?.w240,
      watched,
      genres: (show.genres ?? []).map((genre) => genre.name),
      directors: names(show.directors),
      cast: names(show.cast),
      services: this.getServiceNames(show),
      overview: typeof show.overview === "string" ? decode(show.overview) : undefined,
      action: inVault ? undefined : { label: "Add note" },
    };
  }

  private renderItem(grid: HTMLElement, item: DiscoverItem, mode: TileMode, note: { file: TFile; watched: boolean } | undefined): void {
    const { el, button } = renderTile(grid, this.buildTile(item, note !== undefined, note?.watched === true), mode);

    if (note) {
      el.addEventListener("click", (evt) => {
        void this.app.workspace.openLinkText(note.file.path, "", Keymap.isModEvent(evt));
      });

      return;
    }

    el.removeClass("clickable");
    el.addClass("is-not-in-vault");

    let adding = false;

    button?.onClick(() => {
      if (adding) return;
      adding = true;
      button.setDisabled(true).setButtonText("Adding…");
      void this.plugin.createNoteForTitle(item.show).then((created) => {
        if (!created) {
          adding = false;
          button.setDisabled(false).setButtonText("Add note");
        }
      });
    });
  }
}
