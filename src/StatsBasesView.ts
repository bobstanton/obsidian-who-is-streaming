import { BasesAllOptions, BasesView, BasesViewConfig, QueryController, TFile, setIcon, setTooltip } from "obsidian";
import WhoIsStreamingPlugin from "./main";
import { frontmatterEquals, frontmatterNotEquals } from "./frontmatterUtils";
import { MY_RATING_PROPERTY, WATCHED_DATES_PROPERTY } from "./properties";
import { getFrontmatter } from "./vaultTitles";
import { AvailabilitySource, BarRow, DEFAULT_LIST_LENGTH, MONTH_NAMES, StatsFilter, StatsModel, buildStatsModel, dayFromNumber, dayNumber, describeFilter, formatCount, formatHours, formatRating, formatShare, mondayOffset, pluralise, resolvePeriod, sameFilter } from "./statsModel";
import { getTileViewOptions, renderNoteTiles } from "./titleTiles";

export const StatsViewType = "movie-stats";

const PANELS = [
  { key: "showSummary", name: "Summary tiles" },
  { key: "showTimeline", name: "Watches over time" },
  { key: "showActivity", name: "Activity calendar" },
  { key: "showGenres", name: "Genres" },
  { key: "showCast", name: "Cast" },
  { key: "showDirectors", name: "Directors" },
  { key: "showDecades", name: "Release decade" },
  { key: "showRatings", name: "Your ratings" },
  { key: "showAvailability", name: "Where to watch" },
] as const;

type PanelKey = typeof PANELS[number]["key"];

export class StatsBasesView extends BasesView {
  type = StatsViewType;
  containerEl: HTMLElement;
  plugin: WhoIsStreamingPlugin;

  private columnCharts = new ResizeObserver((entries) => {
    for (const entry of entries) {
      if (entry.target.instanceOf(HTMLElement)) fitColumnLabels(entry.target);
    }
  });

  private filters: StatsFilter[] = [];

  constructor(controller: QueryController, private scrollEl: HTMLElement, plugin: WhoIsStreamingPlugin) {
    super(controller);
    this.plugin = plugin;
    this.containerEl = scrollEl.createDiv({ cls: "who-is-streaming-stats" });
    this.plugin.registerStatsView(this);
  }

  onunload(): void {
    this.columnCharts.disconnect();
    this.plugin.unregisterStatsView(this);
  }

  public getDisplayedFiles(): TFile[] {
    return (this.data?.data ?? []).map((entry) => entry.file).filter((file) => file.extension === "md");
  }

  public onDataUpdated(): void {
    this.render();
  }

  static getViewOptions(this: void, config: BasesViewConfig): BasesAllOptions[] {
    return [
      {
        displayName: "Period",
        type: "dropdown",
        key: "period",
        options: {
          "all": "All time",
          "this-year": "This year",
          "last-year": "Last year",
          "last-12-months": "Last 12 months",
          "custom": "Specific year",
        },
        default: "all",
      },
      {
        displayName: "Year",
        type: "text",
        key: "customYear",
        default: "",
        placeholder: String(new Date().getFullYear()),
        shouldHide: () => config.get("period") !== "custom",
      },
      {
        displayName: "Measure",
        type: "dropdown",
        key: "measure",
        options: {
          "titles": "Titles",
          "watches": "Watches",
          "hours": "Hours watched",
        },
        default: "titles",
      },
      {
        displayName: "Titles counted",
        type: "dropdown",
        key: "scope",
        options: {
          "watched": "Watched only",
          "all": "Everything in the base",
        },
        default: "watched",
      },
      {
        displayName: "List length",
        type: "slider",
        key: "listLength",
        min: 3,
        max: 25,
        step: 1,
        default: DEFAULT_LIST_LENGTH,
      },
      {
        displayName: "Panels",
        type: "group",
        items: PANELS.map((panel) => ({
          displayName: panel.name,
          type: "toggle",
          key: panel.key,
          default: true,
        })),
      },
      {
        displayName: "Matching titles",
        type: "group",
        items: getTileViewOptions(config, "poster"),
      },
      {
        displayName: "Properties",
        type: "group",
        items: [
          {
            displayName: "Watched dates",
            type: "property",
            key: "watchDatesProperty",
            placeholder: WATCHED_DATES_PROPERTY,
            filter: (prop) => prop.startsWith("note."),
          },
          {
            displayName: "Your rating",
            type: "property",
            key: "ratingProperty",
            placeholder: MY_RATING_PROPERTY,
            filter: (prop) => prop.startsWith("note."),
          },
        ],
      },
    ];
  }

  private getNoteProperty(key: string, fallback: string): string {
    const propertyId = this.config.getAsPropertyId(key);

    return propertyId && propertyId.startsWith("note.") ? propertyId.slice("note.".length) : fallback;
  }

  private buildModel(): StatsModel | null {
    const settings = this.plugin.settings;
    const sources: AvailabilitySource[] = [
      ...Object.values(settings.streamingServicesToSync)
        .filter((service) => service?.name)
        .map((service) => ({ name: service.name, isAvailable: (fm: Record<string, unknown>) => frontmatterNotEquals(fm, service.name, "Not available") })),
      ...settings.jellyfinInstances
        .filter((instance) => instance.name)
        .map((instance) => ({ name: instance.name, isAvailable: (fm: Record<string, unknown>) => frontmatterEquals(fm, instance.name, "Available") })),
    ];

    const measure = this.config.get("measure");
    const listLength = this.config.get("listLength");
    const notes = (this.data?.data ?? []).map((entry) => ({ name: entry.file.basename, path: entry.file.path, frontmatter: getFrontmatter(this.app, entry.file) }));

    return buildStatsModel(notes, {
      period: resolvePeriod(this.config.get("period"), this.config.get("customYear")),
      measure: measure === "watches" || measure === "hours" ? measure : "titles",
      scope: this.config.get("scope") === "all" ? "all" : "watched",
      listLength: typeof listLength === "number" ? listLength : DEFAULT_LIST_LENGTH,
      datesProperty: this.getNoteProperty("watchDatesProperty", WATCHED_DATES_PROPERTY),
      ratingProperty: this.getNoteProperty("ratingProperty", MY_RATING_PROPERTY),
      sources,
      filters: this.filters,
    });
  }

  private render(): void {
    this.columnCharts.disconnect();
    this.containerEl.empty();

    const model = this.buildModel();

    if (!model) {
      this.containerEl.createDiv({ cls: "who-is-streaming-empty", text: "No titles with a TMDB ID found." });

      return;
    }

    const isOn = (key: PanelKey) => this.config.get(key) !== false;

    if (!PANELS.some((panel) => isOn(panel.key))) {
      this.containerEl.createDiv({ cls: "who-is-streaming-empty", text: "Every panel is turned off in the view options." });

      return;
    }

    const period = this.config.get("period");

    this.containerEl.setAttrs({
      "data-measure": model.measure,
      "data-scope": model.scope,
      "data-period": typeof period === "string" && model.period.start !== null ? period : "all",
    });

    if (model.fallbackNotice) {
      this.containerEl.createDiv({ cls: "stats-notice", text: model.fallbackNotice });
    }

    if (this.filters.length > 0) {
      this.renderFilterBar();
      this.renderMatches(model);
    }

    if (isOn("showSummary")) this.renderTiles(model);

    const grid = this.containerEl.createDiv({ cls: "stats-grid" });
    const listSubtitle = `${model.subtitle} · top ${model.listLength}`;

    if (model.hasWatchHistory && isOn("showTimeline")) {
      const unit = model.timeline?.unit ?? "month";
      const panel = this.createPanel(grid, "timeline", "Watches over time", `${model.period.label} · watches per ${unit}`, true);

      if (model.timeline) this.renderColumns(panel, model.timeline.rows);
      else panel.createDiv({ cls: "stats-panel-empty", text: "No dated watches in this period." });
    }

    if (model.heatmap && isOn("showActivity")) this.renderHeatmap(grid, model.heatmap);

    if (isOn("showGenres")) this.renderBars(this.createPanel(grid, "genres", "Genres", listSubtitle), model.genres);
    if (isOn("showCast")) this.renderBars(this.createPanel(grid, "cast", "Cast", listSubtitle), model.cast);
    if (isOn("showDirectors")) this.renderBars(this.createPanel(grid, "directors", "Directors", listSubtitle), model.directors);
    if (isOn("showDecades")) this.renderColumns(this.createPanel(grid, "decades", "Release decade", model.subtitle), model.decades);

    if (isOn("showRatings")) {
      const panel = this.createPanel(grid, "ratings", "Your ratings", `${model.period.label} · ${model.scopeLabel}`);

      if (model.ratings.length > 0) this.renderColumns(panel, model.ratings);
      else panel.createDiv({ cls: "stats-panel-empty", text: "No titles rated yet." });
    }

    if (model.availability && isOn("showAvailability")) {
      const panel = this.createPanel(
        grid,
        "availability",
        "Where to watch",
        `Every title in the base · ${model.availability.anywhereShare} available on at least one`
      );

      this.renderBars(panel, model.availability.rows);
    }
  }

  private renderTiles(model: StatsModel): void {
    const totals = model.totals;
    const periodLabel = model.period.label;
    const filtered = this.filters.some((filter) => filter.kind !== "period");
    const tiles = this.containerEl.createDiv({ cls: "stats-tiles" });
    const addTile = (id: string, label: string, value: string, detail?: string) => {
      const tile = tiles.createDiv({ cls: "stats-tile", attr: { "data-tile": id } });

      tile.createDiv({ cls: "stats-tile-label", text: label });
      tile.createDiv({ cls: "stats-tile-value", text: value });
      if (detail) tile.createDiv({ cls: "stats-tile-detail", text: detail });
    };

    addTile("titles", filtered ? "Matching titles" : "Titles in base", formatCount(totals.titles), `${formatCount(totals.movies)} movies · ${formatCount(totals.series)} series`);

    if (totals.watches === 0) {
      addTile("watched", "Watched", "0", periodLabel);
    } else {
      addTile("watched", "Watched", formatCount(totals.watched), `${periodLabel} · ${formatShare(totals.watched, totals.titles)} of ${filtered ? "these" : "the base"}`);
      const seriesDays = totals.seriesDays > 0 ? ` · ${pluralise(totals.seriesDays, "day", "days")} of series` : "";

      addTile("watches", "Watches", formatCount(totals.watches), `${formatCount(totals.rewatches)} rewatches${seriesDays}`);
      addTile("hours", "Hours watched", formatHours(totals.hours), totals.seriesHours > 0 ? `${formatHours(totals.seriesHours)} of series` : undefined);

      if (totals.longestStreakWeeks !== null) {
        addTile("streak", "Longest streak", `${totals.longestStreakWeeks} wk`, "Consecutive weeks with a watch");
      }

      if (totals.busyDays !== null) {
        addTile("busy-days", "Days with 2+ titles", formatCount(totals.busyDays));
      }
    }

    if (totals.averageRating !== null) {
      addTile("average-rating", "Average rating", formatRating(totals.averageRating), `Your rating · ${formatCount(totals.rated)} rated`);
    }
  }

  private toggleFilter(filter: StatsFilter): void {
    const active = this.filters.find((existing) => sameFilter(existing, filter));

    if (active && (active.kind !== "period" || filter.kind !== "period" || active.start === filter.start && active.end === filter.end)) {
      this.filters = this.filters.filter((existing) => existing !== active);
    } else {
      this.filters = [...this.filters.filter((existing) => !(existing.kind === "period" && filter.kind === "period")), filter];
      this.scrollEl.scrollTop = 0;
    }

    this.render();
  }

  private isActive(filter: StatsFilter | undefined): boolean {
    return filter !== undefined && this.filters.some((existing) =>
      sameFilter(existing, filter) && (existing.kind !== "period" || filter.kind !== "period" || existing.start === filter.start && existing.end === filter.end));
  }

  private makeClickable(el: HTMLElement, filter: StatsFilter | undefined): void {
    if (!filter) return;

    el.addClass("is-clickable");
    if (this.isActive(filter)) el.addClass("is-active");
    el.setAttrs({ role: "button", tabindex: "0" });
    el.addEventListener("click", () => this.toggleFilter(filter));
    el.addEventListener("keydown", (evt) => {
      if (evt.key !== "Enter" && evt.key !== " ") return;
      evt.preventDefault();
      this.toggleFilter(filter);
    });
  }

  private renderFilterBar(): void {
    const bar = this.containerEl.createDiv({ cls: "stats-filters" });

    bar.createSpan({ cls: "stats-filters-label", text: "Showing" });

    for (const filter of this.filters) {
      const chip = bar.createDiv({ cls: "stats-filter-chip" });

      chip.createSpan({ text: describeFilter(filter) });
      const remove = chip.createEl("button", { cls: "clickable-icon stats-filter-remove", attr: { "aria-label": `Remove ${describeFilter(filter)}` } });

      setIcon(remove, "x");
      remove.addEventListener("click", () => this.toggleFilter(filter));
    }

    if (this.filters.length > 1) {
      const clear = bar.createEl("button", { cls: "stats-filters-clear", text: "Clear all" });

      clear.addEventListener("click", () => {
        this.filters = [];
        this.render();
      });
    }
  }

  private renderMatches(model: StatsModel): void {
    const section = this.containerEl.createDiv({ cls: "stats-matches", attr: { "data-panel": "matches" } });

    section.createDiv({ cls: "stats-matches-count", text: pluralise(model.matches.length, "title", "titles") });

    if (model.matches.length === 0) {
      section.createDiv({ cls: "stats-panel-empty", text: "No titles match." });

      return;
    }

    const notes = model.matches.flatMap((match) => {
      const file = match.path ? this.app.vault.getFileByPath(match.path) : null;

      return file ? [{ file, frontmatter: getFrontmatter(this.app, file) }] : [];
    });

    renderNoteTiles(section, this.app, this.config, this.plugin.settings, notes, "poster");
  }

  private createPanel(parent: HTMLElement, id: string, title: string, subtitle: string, wide = false): HTMLElement {
    const panel = parent.createDiv({ cls: wide ? "stats-panel is-wide" : "stats-panel", attr: { "data-panel": id } });

    panel.createDiv({ cls: "stats-panel-title", text: title });
    panel.createDiv({ cls: "stats-panel-subtitle", text: subtitle });

    return panel;
  }

  private renderHeatmap(parent: HTMLElement, heatmap: NonNullable<StatsModel["heatmap"]>): void {
    const { start, end, counts } = heatmap;
    const panel = this.createPanel(parent, "activity", "Activity", `${heatmap.label} · watches per day`, true);

    if (counts.size === 0) {
      panel.createDiv({ cls: "stats-panel-empty", text: "No dated watches in this period." });

      return;
    }

    const max = Math.max(...counts.values());
    const startNumber = dayNumber(start);
    const endNumber = dayNumber(end);
    const gridStart = startNumber - mondayOffset(startNumber);

    const scroller = panel.createDiv({ cls: "stats-heatmap-scroller" });
    const months = scroller.createDiv({ cls: "stats-heatmap-months" });
    const grid = scroller.createDiv({ cls: "stats-heatmap" });

    let lastMonth = -1;
    const monthLabels: { el: HTMLElement; column: number }[] = [];

    for (let week = gridStart, column = 0; week <= endNumber; week += 7, column++) {
      const firstVisible = Math.max(week, startNumber);
      const month = Number(dayFromNumber(firstVisible).slice(5, 7)) - 1;
      const label = months.createDiv({ cls: "stats-heatmap-month" });

      if (month !== lastMonth) {
        label.setText(MONTH_NAMES[month]);
        monthLabels.push({ el: label, column });
        lastMonth = month;
      }

      for (let offset = 0; offset < 7; offset++) {
        const number = week + offset;
        const cell = grid.createDiv({ cls: "stats-heatmap-cell" });

        if (number < startNumber || number > endNumber) {
          cell.addClass("is-outside");
          continue;
        }

        const day = dayFromNumber(number);
        const count = counts.get(day) ?? 0;
        const level = count === 0 ? 0 : max <= 4 ? count : Math.ceil(count / max * 4);

        cell.addClass(`level-${level}`);
        setTooltip(cell, `${day}: ${pluralise(count, "watch", "watches")}`);
        if (count > 0) this.makeClickable(cell, { kind: "period", start: day, end: day, label: day });
      }
    }

    if (monthLabels.length > 1 && monthLabels[1].column - monthLabels[0].column < 3) {
      monthLabels[0].el.setText("");
    }

    scroller.scrollLeft = scroller.scrollWidth;

    const legend = panel.createDiv({ cls: "stats-heatmap-legend" });

    legend.createSpan({ text: "Less" });

    for (let level = 0; level <= 4; level++) {
      legend.createDiv({ cls: `stats-heatmap-cell level-${level}` });
    }

    legend.createSpan({ text: "More" });
  }

  private renderBars(panel: HTMLElement, rows: BarRow[]): void {
    const max = Math.max(0, ...rows.map((row) => row.value));

    if (max <= 0) {
      panel.createDiv({ cls: "stats-panel-empty", text: "Nothing to show yet." });

      return;
    }

    renderLegend(panel, rows);
    const list = panel.createDiv({ cls: "stats-bars" });

    for (const row of rows) {
      const rowEl = list.createDiv({ cls: "stats-bar-row" });

      rowEl.createDiv({ cls: "stats-bar-label", text: row.label });
      const track = rowEl.createDiv({ cls: "stats-bar-track" });
      const bar = track.createDiv({ cls: "stats-bar" });

      bar.setCssProps({ "--stats-size": `${row.value / max * 100}%` });
      renderSegments(bar, row);
      rowEl.createDiv({ cls: "stats-bar-value", text: row.display });
      setTooltip(rowEl, row.tooltip);
      this.makeClickable(rowEl, row.value > 0 ? row.filter : undefined);
    }
  }

  private renderColumns(panel: HTMLElement, rows: BarRow[]): void {
    const max = Math.max(0, ...rows.map((row) => row.value));

    if (max <= 0) {
      panel.createDiv({ cls: "stats-panel-empty", text: "Nothing to show yet." });

      return;
    }

    const peak = rows.findIndex((row) => row.value === max);

    renderLegend(panel, rows);
    const scroller = panel.createDiv({ cls: "stats-columns-scroller" });
    const chart = scroller.createDiv({ cls: "stats-columns" });

    for (const [index, row] of rows.entries()) {
      const column = chart.createDiv({ cls: "stats-column" });
      const plot = column.createDiv({ cls: "stats-column-plot" });

      plot.setCssProps({ "--stats-size": `${row.value / max * 100}%` });
      if (index === peak) plot.createDiv({ cls: "stats-column-value", text: row.display });
      const bar = plot.createDiv({ cls: "stats-column-bar" });

      if (row.value === 0) bar.addClass("is-empty");
      renderSegments(bar, row);

      column.createDiv({ cls: "stats-column-label", text: row.label });
      column.setAttribute("aria-label", row.tooltip);
      setTooltip(column, row.tooltip);
      this.makeClickable(column, row.value > 0 ? row.filter : undefined);
    }

    this.columnCharts.observe(chart);
  }
}

const LABEL_GAP_PX = 6;

function fitColumnLabels(chart: HTMLElement): void {
  const labels = Array.from(chart.querySelectorAll<HTMLElement>(".stats-column-label"));

  if (labels.length === 0 || chart.clientWidth === 0) return;

  for (const label of labels) label.removeClasses(["is-hidden", "is-start", "is-end"]);
  const columnWidth = chart.scrollWidth / labels.length;
  const widest = Math.max(...labels.map((label) => label.offsetWidth));
  const step = Math.max(1, Math.ceil((widest + LABEL_GAP_PX) / columnWidth));

  const bounds = chart.getBoundingClientRect();

  for (const [index, label] of labels.entries()) {
    if (index % step !== 0) {
      label.addClass("is-hidden");
      continue;
    }

    const box = label.getBoundingClientRect();

    if (box.left < bounds.left) label.addClass("is-start");
    else if (box.right > bounds.right) label.addClass("is-end");
  }
}

function renderLegend(panel: HTMLElement, rows: BarRow[]): void {
  if (!rows.some((row) => row.watched !== undefined)) return;
  const legend = panel.createDiv({ cls: "stats-legend" });

  for (const [cls, text] of [["is-watched", "Watched"], ["is-unwatched", "Not watched"]]) {
    const item = legend.createSpan({ cls: "stats-legend-item" });

    item.createSpan({ cls: `stats-legend-swatch ${cls}` });
    item.appendText(text);
  }
}

function renderSegments(bar: HTMLElement, row: BarRow): void {
  if (row.watched === undefined || row.value <= 0) return;
  const unwatched = row.value - row.watched;

  bar.addClass("is-stacked");
  if (row.watched > 0) bar.createDiv({ cls: "stats-segment is-watched" }).setCssProps({ "--stats-share": String(row.watched) });
  if (unwatched > 0) bar.createDiv({ cls: "stats-segment is-unwatched" }).setCssProps({ "--stats-share": String(unwatched) });
}
