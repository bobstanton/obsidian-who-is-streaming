import { BasesAllOptions, BasesEntry, BasesView, BasesViewConfig, QueryController, TFile } from "obsidian";
import WhoIsStreamingPlugin from "./main";
import { getTileViewOptions, renderNoteTiles } from "./titleTiles";
import { isTitleNote } from "./frontmatterUtils";
import { TMDB_ID_PROPERTY } from "./properties";

export const TitlesViewType = "movies";

export class TitlesBasesView extends BasesView {
  type = TitlesViewType;
  scrollEl: HTMLElement;
  containerEl: HTMLElement;
  plugin: WhoIsStreamingPlugin;

  constructor(controller: QueryController, scrollEl: HTMLElement, plugin: WhoIsStreamingPlugin) {
    super(controller);
    this.scrollEl = scrollEl;
    this.plugin = plugin;
    this.containerEl = scrollEl.createDiv({ cls: "who-is-streaming-bases-view" });
    this.plugin.registerTitlesView(this);
  }

  onload(): void {
  }

  onunload(): void {
    this.plugin.unregisterTitlesView(this);
  }

  public getDisplayedFiles(): TFile[] {
    if (!this.data) return [];

    return this.data.data
      .filter(entry => this.hasTmdbId(entry))
      .map(entry => entry.file)
      .filter(file => file.extension === "md");
  }

  public focus(): void {
    this.containerEl.focus({ preventScroll: true });
  }

  public onDataUpdated(): void {
    this.render();
  }

  private getFrontmatter(entry: BasesEntry): Record<string, unknown> {
    const cache = this.app.metadataCache.getFileCache(entry.file);

    return cache?.frontmatter || {};
  }

  private hasTmdbId(entry: BasesEntry): boolean {
    return this.getFrontmatter(entry)[TMDB_ID_PROPERTY] != null;
  }

  private render(): void {
    this.containerEl.empty();

    if (!this.data || this.data.data.length === 0) {
      this.containerEl.createDiv({
        text: "No titles found.",
        cls: "who-is-streaming-empty",
      });

      return;
    }

    const filteredEntries = this.data.data.filter(entry => isTitleNote(this.getFrontmatter(entry)));

    if (filteredEntries.length === 0) {
      this.containerEl.createDiv({
        text: "No titles with a TMDB ID found.",
        cls: "who-is-streaming-empty",
      });

      return;
    }

    const notes = filteredEntries.map((entry) => ({ file: entry.file, frontmatter: this.getFrontmatter(entry) }));

    renderNoteTiles(this.containerEl, this.app, this.config, this.plugin.settings, notes, "cards");
  }

  static getViewOptions(this: void, config: BasesViewConfig): BasesAllOptions[] {
    return getTileViewOptions(config, "cards");
  }
}
