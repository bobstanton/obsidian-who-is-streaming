import { App, SuggestModal, setIcon } from "obsidian";
import { Show } from "streaming-availability";
import { decode } from "he";

export class ShowSelectModal extends SuggestModal<Show> {
  showMatches: Show[];
  callback: (show: Show) => void;

  constructor(app: App, showMatches: Show[], callback: (show: Show) => void) {
    super(app);
    this.showMatches = showMatches;
    this.callback = callback;
  }

  getSuggestions(query: string): Show[] {
    return this.showMatches.filter(
      (show) =>
        show.title.toLowerCase().includes(query.toLowerCase()) ||
        show.directors?.some((director) => director.toLowerCase().includes(query.toLowerCase())) ||
        show.creators?.some((creator) => creator.toLowerCase().includes(query.toLowerCase())) ||
        show.cast.some((actor) => actor.toLowerCase().includes(query.toLowerCase())) ||
        show.overview.toLowerCase().includes(query.toLowerCase())
    );
  }

  renderSuggestion(show: Show, el: HTMLElement) {
    el.addClass("who-is-streaming-suggestion");

    const contentContainer = el.createDiv({ cls: "suggestion-content" });

    if (show.imageSet?.verticalPoster?.w240) {
      const posterDiv = contentContainer.createDiv({ cls: "suggestion-poster" });
      posterDiv.createEl("img", {
        attr: {
          src: show.imageSet.verticalPoster.w240,
          alt: show.title,
        },
      });
    } else {
      const iconDiv = contentContainer.createDiv({ cls: "suggestion-icon-fallback" });
      const icon = createSpan({ cls: "show-icon" });
      setIcon(icon, show.showType == "movie" ? "clapperboard" : "tv");
      iconDiv.append(icon);
    }

    const detailsDiv = contentContainer.createDiv({ cls: "suggestion-details" });

    const titleDiv = detailsDiv.createDiv({ cls: "show-title" });
    if (show.releaseYear) {
      titleDiv.appendText(`${show.title} (${show.releaseYear})`);
    } else {
      titleDiv.appendText(`${show.title} (${show.firstAirYear} - ${show.lastAirYear})`);
    }

    const metaDiv = detailsDiv.createDiv({ cls: "show-meta" });
    const typeText = show.showType === "movie" ? "Movie" : "TV Series";
    let metaText = typeText;
    if (show.rating) {
      metaText += ` • ⭐ ${show.rating}/10`;
    }
    if (show.runtime) {
      metaText += ` • ${show.runtime} min`;
    } else if (show.seasonCount) {
      metaText += ` • ${show.seasonCount} season${show.seasonCount !== 1 ? 's' : ''}`;
    }
    metaDiv.setText(metaText);

    if (show.genres && show.genres.length > 0) {
      const genresDiv = detailsDiv.createDiv({ cls: "show-genres" });
      const genreNames = show.genres
        .map((genre: { name?: unknown }) => genre.name)
        .filter((name): name is string => typeof name === "string");
      genresDiv.setText(genreNames.join(", "));
    }

    const people = [...(show.directors ?? []), ...(show.creators ?? []), ...(show.cast ?? [])]
      .filter((name): name is string => typeof name === "string")
      .slice(0, 3)
      .join(", ");
    if (people) {
      detailsDiv.createEl("small", { text: people, cls: "show-people" });
    }

    const decodedOverview = typeof show.overview === "string" ? decode(show.overview) : "";
    const overview = typeof decodedOverview === "string" ? decodedOverview : "";
    if (overview.length > 0) {
      const overviewDiv = detailsDiv.createDiv({ cls: "show-overview" });
      overviewDiv.setText(overview);
    }
  }

  onChooseSuggestion(show: Show, evt: MouseEvent | KeyboardEvent) {
    this.callback(show);
  }
}
