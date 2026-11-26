import { App, BasesOptions, BasesViewConfig, ButtonComponent, Keymap, TFile, setIcon } from "obsidian";
import { WhoIsStreamingSettings } from "./settings";
import { frontmatterEquals, frontmatterNotEquals, getFrontmatterString, getFrontmatterStringArray, getFrontmatterStringOrNumber } from "./frontmatterUtils";
import { resolvePosterUrl } from "./posterUtils";
import { LEAVING_FROM_PROPERTY, LEAVING_PROPERTY, MY_RATING_PROPERTY, POSTER_PROPERTY, SERVICE_RATING_PROPERTY, TMDB_RATING_PROPERTY, TYPE_PROPERTY, YEAR_PROPERTY } from "./properties";
import { isWatched } from "./watchHistory";

export type TileMode = "cards" | "poster";

export interface TitleTile {
  title: string;
  year?: string;
  type?: string;
  runtime?: string;
  ratings: string[];
  detail?: string;
  posterUrl?: string | null;
  watched: boolean;
  genres: string[];
  directors: string[];
  cast: string[];
  services: string[];
  leaving?: { from: string[]; date?: string };
  overview?: string;
  action?: { label: string };
}

export interface RenderedTile {
  el: HTMLElement;
  button?: ButtonComponent;
}

export function renderTile(container: HTMLElement, tile: TitleTile, mode: TileMode): RenderedTile {
  return mode === "cards" ? renderCard(container, tile) : renderPosterTile(container, tile);
}

function renderCard(container: HTMLElement, tile: TitleTile): RenderedTile {
  const card = container.createDiv({ cls: "movie-card" });
  const cardInner = card.createDiv({ cls: "movie-card-inner" });

  const posterDiv = cardInner.createDiv({ cls: "movie-card-poster" });

  renderPosterImage(posterDiv, tile, false);
  renderWatchedMark(posterDiv, tile);

  const detailsDiv = cardInner.createDiv({ cls: "movie-card-details" });
  const headerDiv = detailsDiv.createDiv({ cls: "movie-card-header" });

  headerDiv.createEl("h4", { cls: "movie-card-title", text: tile.title });
  const yearEl = headerDiv.createSpan({ cls: "movie-card-year" });

  if (tile.year) yearEl.setText(tile.year);

  const metaParts: string[] = [];

  if (tile.type) {
    metaParts.push(tile.type === "movie" ? "🎬 Movie" : "📺 Series");
  }

  if (tile.runtime) metaParts.push(`⏱️ ${tile.runtime}`);
  metaParts.push(...tile.ratings);
  if (tile.detail) metaParts.push(tile.detail);

  if (metaParts.length > 0) {
    detailsDiv.createDiv({ cls: "movie-metadata", text: metaParts.join(" • ") });
  }

  if (tile.genres.length > 0) {
    detailsDiv.createDiv({ cls: "movie-genres", text: tile.genres.join(", ") });
  }

  const peopleSegments: { label: string; names: string }[] = [];

  if (tile.directors.length > 0) peopleSegments.push({ label: "Director:", names: tile.directors.join(", ") });
  if (tile.cast.length > 0) peopleSegments.push({ label: "Cast:", names: tile.cast.join(", ") });

  if (peopleSegments.length > 0) {
    const peopleDiv = detailsDiv.createDiv({ cls: "movie-people" });

    for (const [index, segment] of peopleSegments.entries()) {
      if (index > 0) peopleDiv.appendText(" • ");
      peopleDiv.createEl("strong", { text: segment.label });
      peopleDiv.appendText(" " + segment.names);
    }
  }

  renderBadges(detailsDiv, tile);

  if (tile.overview) {
    detailsDiv.createDiv({ cls: "movie-card-overview", text: tile.overview });
  }

  card.addClass("clickable");

  return { el: card, button: renderAction(detailsDiv, tile, "movie-card-action") };
}

function renderPosterTile(container: HTMLElement, tile: TitleTile): RenderedTile {
  const posterItem = container.createDiv({ cls: "movie-poster-item" });

  const posterContainer = posterItem.createDiv({ cls: "poster-container" });

  if (tile.posterUrl) {
    posterContainer.setCssProps({ "--poster-bg": `url("${tile.posterUrl}")` });
  }

  renderPosterImage(posterContainer, tile, true);
  renderWatchedMark(posterContainer, tile);

  const overlay = posterItem.createDiv({ cls: "poster-overlay" });
  const overlayContent = overlay.createDiv({ cls: "overlay-content" });

  overlayContent.createEl("h4", { cls: "poster-overlay-title", text: tile.title });

  const metaDiv = overlayContent.createDiv({ cls: "poster-overlay-meta" });
  const metaParts: string[] = [];

  if (tile.year) metaParts.push(tile.year);
  metaParts.push(...tile.ratings);
  if (tile.detail) metaParts.push(tile.detail);
  if (metaParts.length > 0) metaDiv.setText(metaParts.join(" • "));

  renderBadges(overlayContent.createDiv({ cls: "poster-overlay-badges" }), tile);

  if (tile.overview) {
    overlayContent.createDiv({ cls: "poster-overlay-overview", text: tile.overview });
  }

  posterItem.addClass("clickable");

  return { el: posterItem, button: renderAction(overlayContent, tile, "poster-overlay-action") };
}

function renderPosterImage(container: HTMLElement, tile: TitleTile, isPoster: boolean): void {
  if (tile.posterUrl) {
    const img = container.createEl("img");

    img.src = tile.posterUrl;
    img.alt = tile.title;
    img.addClass(isPoster ? "poster-img-poster" : "poster-img-card");
  } else {
    container.createDiv({
      cls: isPoster ? "poster-placeholder-poster" : "poster-placeholder-card",
      text: tile.title,
    });
  }
}

function renderWatchedMark(container: HTMLElement, tile: TitleTile): void {
  if (!tile.watched) return;
  setIcon(container.createDiv({ cls: "watched-checkbox-overlay" }), "check");
}

function renderBadges(container: HTMLElement, tile: TitleTile): void {
  const leaving = tile.leaving;
  const isLeaving = leaving !== undefined && (leaving.date !== undefined || leaving.from.length > 0);

  if (tile.services.length === 0 && !isLeaving) return;

  const badgesWrapper = container.createDiv({ cls: "streaming-badges" });

  for (const service of tile.services) {
    badgesWrapper.createSpan({ cls: "streaming-badge", text: service });
  }

  if (leaving && isLeaving) {
    const badge = badgesWrapper.createSpan({ cls: "streaming-badge leaving-badge" });

    setIcon(badge.createSpan({ cls: "leaving-badge-icon" }), "clock-alert");
    const from = leaving.from.length > 0 ? ` ${leaving.from.join(", ")}` : "";

    badge.appendText(`Leaving${from} ${leaving.date ?? "soon"}`);
  }
}

function renderAction(container: HTMLElement, tile: TitleTile, cls: string): ButtonComponent | undefined {
  if (!tile.action) return undefined;

  return new ButtonComponent(container.createDiv({ cls })).setButtonText(tile.action.label).setCta();
}

const POSTER_SIZE = { min: 120, max: 300, step: 10 };

export function getTileViewOptions(config: BasesViewConfig, defaultMode: TileMode): BasesOptions[] {
  return [
    {
      displayName: "View mode",
      type: "dropdown",
      key: "viewMode",
      options: { poster: "Poster", cards: "Cards" },
      default: defaultMode,
    },
    {
      displayName: "Poster size",
      type: "slider",
      key: "posterSize",
      ...POSTER_SIZE,
      shouldHide: () => readTileMode(config, defaultMode) === "cards",
    },
  ];
}

export function readTileMode(config: BasesViewConfig, defaultMode: TileMode): TileMode {
  const mode = config.get("viewMode");

  return mode === "cards" || mode === "poster" ? mode : defaultMode;
}

export function readPosterSize(config: BasesViewConfig, fallback: number): number {
  const size = config.get("posterSize");

  return typeof size === "number" ? size : fallback;
}

export function buildNoteTile(app: App, settings: WhoIsStreamingSettings, file: TFile, fm: Record<string, unknown>): TitleTile {
  const posterValue = getFrontmatterString(fm, POSTER_PROPERTY);

  const services: string[] = [];

  for (const service of Object.values(settings.streamingServicesToSync)) {
    if (frontmatterNotEquals(fm, service.name, "Not available")) services.push(service.name);
  }

  for (const instance of settings.jellyfinInstances) {
    if (frontmatterEquals(fm, instance.name, "Available")) services.push(instance.name);
  }

  return {
    title: file.basename,
    year: getFrontmatterStringOrNumber(fm, YEAR_PROPERTY),
    type: getFrontmatterString(fm, TYPE_PROPERTY),
    runtime: getFrontmatterStringOrNumber(fm, "Runtime"),
    ratings: [
      { label: "⭐", property: MY_RATING_PROPERTY },
      { label: "TMDB", property: TMDB_RATING_PROPERTY },
      { label: "Streaming Availability", property: SERVICE_RATING_PROPERTY },
    ].flatMap(({ label, property }) => {
      const value = getFrontmatterStringOrNumber(fm, property);

      return value ? [`${label} ${value}`] : [];
    }),
    posterUrl: posterValue ? resolvePosterUrl(app, posterValue) : null,
    watched: isWatched(fm),
    genres: getFrontmatterStringArray(fm, "Genres") ?? [],
    directors: getFrontmatterStringArray(fm, "Directors") ?? [],
    cast: getFrontmatterStringArray(fm, "Cast") ?? [],
    services,
    leaving: {
      from: getFrontmatterStringArray(fm, LEAVING_FROM_PROPERTY) ?? [],
      date: getFrontmatterString(fm, LEAVING_PROPERTY),
    },
    overview: getFrontmatterString(fm, "Overview"),
  };
}

export interface TitleNote {
  file: TFile;
  frontmatter: Record<string, unknown>;
}

export function renderNoteTiles(parent: HTMLElement, app: App, config: BasesViewConfig, settings: WhoIsStreamingSettings, notes: TitleNote[], defaultMode: TileMode): void {
  const mode = readTileMode(config, defaultMode);
  const container = parent.createDiv({ cls: `who-is-streaming-results ${mode}-view` });

  if (mode === "poster") {
    container.setCssProps({ "--poster-size": `${readPosterSize(config, settings.gridPosterSize)}px` });
  }

  for (const { file, frontmatter } of notes) {
    const { el } = renderTile(container, buildNoteTile(app, settings, file, frontmatter), mode);

    el.addEventListener("click", (evt) => {
      if (evt.defaultPrevented) return;
      const target = evt.target as Element;

      if (target?.closest && target.closest("a")) return;
      void app.workspace.openLinkText(file.path, "", Keymap.isModEvent(evt));
    });

    el.addEventListener("mouseover", (evt) => {
      app.workspace.trigger("hover-link", {
        event: evt,
        source: "bases",
        hoverParent: app.renderContext,
        targetEl: el,
        linktext: file.path,
      });
    });
  }
}
