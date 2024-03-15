import { App, SuggestModal, setIcon } from "obsidian";
import * as streamingAvailability from "streaming-availability";
import { ShowWithExtraDetails } from "./StreamingAvailabilityApiService";

export class ShowSelectModal extends SuggestModal<ShowWithExtraDetails> {
  showMatches: ShowWithExtraDetails[];
  callback: (show: streamingAvailability.Show) => void;

  constructor(app: App, showMatches: ShowWithExtraDetails[], callback: (show: ShowWithExtraDetails) => void) {
    super(app);
    this.showMatches = showMatches;
    this.callback = callback;
  }

  getSuggestions(query: string): ShowWithExtraDetails[] {
    return this.showMatches.filter(
      (show) =>
        show.title.toLowerCase().includes(query.toLowerCase()) ||
        show.directors?.some((director) => director.toLowerCase().includes(query.toLowerCase())) ||
        show.creators?.some((creator) => creator.toLowerCase().includes(query.toLowerCase())) ||
        show.cast.some((actor) => actor.toLowerCase().includes(query.toLowerCase())) ||
        show.overview.toLowerCase().includes(query.toLowerCase())
    );
  }

  renderSuggestion(show: ShowWithExtraDetails, el: HTMLElement) {
    var icon = createSpan({ cls: "show-icon" });
    setIcon(icon, show.type == "movie" ? "clapperboard" : "tv");

    var titleDiv = el.createDiv({ cls: "show-title" });
    titleDiv.append(icon);

    if (show.year) 
	  titleDiv.appendText(`${show.title} (${show.year})`);
    else
      titleDiv.appendText(`${show.title} (${show.firstAirYear} - ${show.lastAirYear})`);

    const people = [...(show.directors ?? []), ...(show.creators ?? []), ...(show.cast ?? [])].join(", ");

    el.createEl("small", { text: people });
    var he = require("he");
    el.createDiv({ cls: "show-overview", text: he.decode(show.overview) });
  }

  onChooseSuggestion(show: ShowWithExtraDetails, evt: MouseEvent | KeyboardEvent) {
    this.callback(show);
  }
}
