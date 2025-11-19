import { BasesEntry, BasesView, Keymap, ViewOption, setIcon } from "obsidian";
import WhoIsStreamingPlugin from "./main";

export const MoviesViewType = "movies";

export class MoviesBasesView extends BasesView {
    type = MoviesViewType;
    scrollEl: HTMLElement;
    containerEl: HTMLElement;
    plugin: WhoIsStreamingPlugin;

    private viewMode: "cards" | "poster" = "cards";
    private posterSize: number;

    constructor(controller: unknown, scrollEl: HTMLElement, plugin: WhoIsStreamingPlugin) {
        super(controller);
        this.scrollEl = scrollEl;
        this.plugin = plugin;
        this.containerEl = scrollEl.createDiv({ cls: "who-is-streaming-bases-view" });
    }

    onload(): void {
    }

    onunload(): void {
    }

    public focus(): void {
        this.containerEl.focus({ preventScroll: true });
    }

    public onDataUpdated(): void {
        this.loadConfig();
        this.render();
    }

    private loadConfig(): void {
        const configViewMode = this.config.get("viewMode");
        this.viewMode = (configViewMode === "poster" || configViewMode === "cards") ? configViewMode : "cards";

        const configPosterSize = this.config.get("posterSize");
        this.posterSize = configPosterSize || this.plugin.settings.gridPosterSize;
    }

    private getFrontmatter(entry: BasesEntry): Record<string, unknown> {
        const cache = this.app.metadataCache.getFileCache(entry.file);
        return cache?.frontmatter || {};
    }

    private render(): void {
        this.containerEl.empty();

        if (!this.data || this.data.data.length === 0) {
            this.containerEl.createDiv({
                text: "No movies found.",
                cls: "who-is-streaming-empty",
            });
            return;
        }

        const filteredEntries = this.data.data.filter(entry => {
            const fm = this.getFrontmatter(entry);
            return fm["tmdb_id"] != null;
        });

        if (filteredEntries.length === 0) {
            this.containerEl.createDiv({
                text: "No movies with TMDB id found.",
                cls: "who-is-streaming-empty",
            });
            return;
        }

        const resultsContainer = this.containerEl.createDiv({
            cls: `who-is-streaming-results ${this.viewMode}-view`,
        });

        if (this.viewMode === "cards") {
            this.renderCardsView(resultsContainer, filteredEntries);
        } else {
            this.renderPosterView(resultsContainer, filteredEntries);
        }
    }

    private renderCardsView(container: HTMLElement, entries: BasesEntry[]): void {
        for (const entry of entries) {
            const fm = this.getFrontmatter(entry);
            const card = container.createDiv({ cls: "movie-card" });

            const cardInner = card.createDiv({ cls: "movie-card-inner" });

            const posterDiv = cardInner.createDiv({ cls: "movie-card-poster" });
            this.renderPoster(posterDiv, entry, false);

            if (fm["Watched"] === true) {
                const checkboxOverlay = posterDiv.createDiv({ cls: "watched-checkbox-overlay" });
                setIcon(checkboxOverlay, "check");
            }

            const detailsDiv = cardInner.createDiv({ cls: "movie-card-details" });

            const headerDiv = detailsDiv.createDiv({ cls: "movie-card-header" });

            const titleEl = headerDiv.createEl("h4", { cls: "movie-card-title" });
            titleEl.setText(entry.file.basename);

            const yearEl = headerDiv.createSpan({ cls: "movie-card-year" });
            if (fm["Year"]) {
                const year = typeof fm["Year"] === "number" || typeof fm["Year"] === "string" ? String(fm["Year"]) : "";
                if (year) yearEl.setText(year);
            }

            this.renderMetadata(detailsDiv, entry);

            this.renderGenres(detailsDiv, entry);

            this.renderPeople(detailsDiv, entry);

            this.renderStreamingBadges(detailsDiv, entry);

            if (fm["Overview"] && typeof fm["Overview"] === "string") {
                const overviewDiv = detailsDiv.createDiv({ cls: "movie-card-overview" });
                overviewDiv.setText(fm["Overview"]);
            }

            card.addClass("clickable");
            card.addEventListener("click", (evt) => {
                if (evt.defaultPrevented) return;
                const target = evt.target as Element;
                if (target?.closest && target.closest("a")) return;
                void this.app.workspace.openLinkText(
                    entry.file.path,
                    "",
                    Keymap.isModEvent(evt)
                );
            });

            card.addEventListener("mouseover", (evt) => {
                this.app.workspace.trigger("hover-link", {
                    event: evt,
                    source: "bases",
                    hoverParent: this.app.renderContext,
                    targetEl: card,
                    linktext: entry.file.path,
                });
            });
        }
    }

    private renderPosterView(container: HTMLElement, entries: BasesEntry[]): void {
        container.setCssProps({ '--poster-size': `${this.posterSize}px` });

        for (const entry of entries) {
            const fm = this.getFrontmatter(entry);
            const posterItem = container.createDiv({ cls: "movie-poster-item" });

            const posterContainer = posterItem.createDiv({ cls: "poster-container" });

            if (fm["Poster"] && typeof fm["Poster"] === "string") {
                const posterUrl = this.getPosterUrl(fm["Poster"]);
                if (posterUrl) {
                    posterContainer.setCssProps({ '--poster-bg': `url("${posterUrl}")` });
                }
            }

            this.renderPoster(posterContainer, entry, true);

            if (fm["Watched"] === true) {
                const checkboxOverlay = posterContainer.createDiv({ cls: "watched-checkbox-overlay" });
                setIcon(checkboxOverlay, "check");
            }

            const overlay = posterItem.createDiv({ cls: "poster-overlay" });
            const overlayContent = overlay.createDiv({ cls: "overlay-content" });

            const titleEl = overlayContent.createEl("h4", { cls: "poster-overlay-title" });
            titleEl.setText(entry.file.basename);

            const metaDiv = overlayContent.createDiv({ cls: "poster-overlay-meta" });
            const metaParts: string[] = [];
            if (fm["Year"] && (typeof fm["Year"] === "number" || typeof fm["Year"] === "string")) {
                metaParts.push(String(fm["Year"]));
            }
            if (fm["Rating"] && (typeof fm["Rating"] === "number" || typeof fm["Rating"] === "string")) {
                metaParts.push(`⭐ ${String(fm["Rating"])}/10`);
            }
            if (metaParts.length > 0) metaDiv.setText(metaParts.join(" • "));

            const badgesDiv = overlayContent.createDiv({ cls: "poster-overlay-badges" });
            this.renderStreamingBadges(badgesDiv, entry);

            if (fm["Overview"] && typeof fm["Overview"] === "string") {
                const overviewDiv = overlayContent.createDiv({ cls: "poster-overlay-overview" });
                overviewDiv.setText(fm["Overview"]);
            }

            posterItem.addClass("clickable");
            posterItem.addEventListener("click", (evt) => {
                if (evt.defaultPrevented) return;
                const target = evt.target as Element;
                if (target?.closest && target.closest("a")) return;
                void this.app.workspace.openLinkText(
                    entry.file.path,
                    "",
                    Keymap.isModEvent(evt)
                );
            });

            posterItem.addEventListener("mouseover", (evt) => {
                this.app.workspace.trigger("hover-link", {
                    event: evt,
                    source: "bases",
                    hoverParent: this.app.renderContext,
                    targetEl: posterItem,
                    linktext: entry.file.path,
                });
            });
        }
    }

    private renderPoster(container: HTMLElement, entry: BasesEntry, isPoster: boolean): void {
        const fm = this.getFrontmatter(entry);
        const posterValue = fm["Poster"];

        if (!posterValue || typeof posterValue !== "string") {
            this.renderPlaceholderPoster(container, entry, isPoster);
            return;
        }

        const posterUrl = this.getPosterUrl(posterValue);

        if (posterUrl) {
            const img = container.createEl("img");
            img.src = posterUrl;
            img.alt = entry.file.basename;
            img.addClass(isPoster ? "poster-img-poster" : "poster-img-card");
        } else {
            this.renderPlaceholderPoster(container, entry, isPoster);
        }
    }

    private renderPlaceholderPoster(container: HTMLElement, entry: BasesEntry, isPoster: boolean): void {
        const placeholder = container.createDiv({
            cls: isPoster ? "poster-placeholder-poster" : "poster-placeholder-card",
            text: entry.file.basename
        });
    }

    private getPosterUrl(posterString: string): string | null {
        if (posterString.includes("http")) {
            return posterString;
        } else if (posterString.startsWith("![[")) {
            const match = posterString.match(/!\[\[(.+?)\]\]/);
            if (match) {
                const posterPath = match[1].split("|")[0];
                const posterFile = this.app.metadataCache.getFirstLinkpathDest(posterPath, "");
                if (posterFile) {
                    return this.app.vault.getResourcePath(posterFile);
                }
            }
        }
        return null;
    }

    private renderMetadata(container: HTMLElement, entry: BasesEntry): void {
        const fm = this.getFrontmatter(entry);
        const parts: string[] = [];

        if (fm["Type"] && typeof fm["Type"] === "string") {
            const typeStr = fm["Type"];
            const icon = typeStr === "movie" ? "🎬" : "📺";
            const text = typeStr === "movie" ? "Movie" : "TV Series";
            parts.push(`${icon} ${text}`);
        }

        if (fm["Runtime"] && (typeof fm["Runtime"] === "number" || typeof fm["Runtime"] === "string")) {
            parts.push(`⏱️ ${String(fm["Runtime"])}`);
        }

        if (fm["Rating"] && (typeof fm["Rating"] === "number" || typeof fm["Rating"] === "string")) {
            parts.push(`⭐ ${String(fm["Rating"])}/10`);
        }

        if (parts.length > 0) {
            const metaDiv = container.createDiv({ cls: "movie-metadata" });
            metaDiv.setText(parts.join(" • "));
        }
    }

    private renderGenres(container: HTMLElement, entry: BasesEntry): void {
        const fm = this.getFrontmatter(entry);
        if (!fm["Genres"] || !Array.isArray(fm["Genres"])) return;

        const genresDiv = container.createDiv({ cls: "movie-genres" });
        genresDiv.setText(fm["Genres"].join(", "));
    }

    private renderPeople(container: HTMLElement, entry: BasesEntry): void {
        const fm = this.getFrontmatter(entry);
        const peopleSegments: { label: string; names: string }[] = [];

        if (fm["Directors"] && Array.isArray(fm["Directors"])) {
            peopleSegments.push({ label: "Director:", names: fm["Directors"].join(", ") });
        }

        if (fm["Cast"] && Array.isArray(fm["Cast"])) {
            peopleSegments.push({ label: "Cast:", names: fm["Cast"].join(", ") });
        }

        if (peopleSegments.length > 0) {
            const peopleDiv = container.createDiv({ cls: "movie-people" });
            peopleSegments.forEach((segment, index) => {
                if (index > 0) {
                    peopleDiv.appendText(" • ");
                }
                peopleDiv.createEl("strong", { text: segment.label });
                peopleDiv.appendText(" " + segment.names);
            });
        }
    }

    private renderStreamingBadges(container: HTMLElement, entry: BasesEntry): void {
        const fm = this.getFrontmatter(entry);
        const streamingServices = Object.keys(this.plugin.settings.streamingServicesToSync);

        const badges: string[] = [];

        for (const service of streamingServices) {
            const value = fm[service];
            if (!value || value.toString() === "Not available") continue;
            badges.push(service);
        }

        for (const instance of this.plugin.settings.jellyfinInstances) {
            const value = fm[instance.name];
            if (value && value.toString() === "Available") {
                badges.push(instance.name);
            }
        }

        if (badges.length === 0) return;

        const badgesWrapper = container.createDiv({ cls: "streaming-badges" });

        for (const service of badges) {
            const badge = badgesWrapper.createSpan({ cls: "streaming-badge" });
            badge.setText(service);
        }
    }

    static getViewOptions(this: void): ViewOption[] {
        return [
            {
                displayName: "View mode",
                type: "dropdown",
                key: "viewMode",
                options: {
                    "cards": "Cards",
                    "poster": "Poster",
                },
                default: "cards",
            },
            {
                displayName: "Poster size",
                type: "slider",
                key: "posterSize",
                min: 120,
                max: 300,
                step: 10,
            },
        ];
    }
}
