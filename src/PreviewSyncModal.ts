import { App, Modal, Setting } from "obsidian";
import { Show } from "streaming-availability";
import { WhoIsStreamingSettings } from "./settings";
import * as he from "he";

interface FieldChange {
  field: string;
  oldValue: string;
  newValue: string;
  enabled: boolean;
  isPoster?: boolean; 
}

export class PreviewSyncModal extends Modal {
  show: Show;
  settings: WhoIsStreamingSettings;
  currentFrontmatter: any;
  currentFileName: string;
  callback: (confirmed: boolean, enabledFields?: string[]) => void;
  changes: FieldChange[] = [];
  newFileName: string = "";

  constructor(app: App, show: Show, settings: WhoIsStreamingSettings, currentFrontmatter: any, currentFileName: string, callback: (confirmed: boolean, enabledFields?: string[]) => void) {
    super(app);
    this.show = show;
    this.settings = settings;
    this.currentFrontmatter = currentFrontmatter;
    this.currentFileName = currentFileName;
    this.callback = callback;
    this.calculateChanges();
  }

  isFieldEnabled(fieldName: string): boolean {
    if (fieldName === "Type" || fieldName === "tmdb_id") {
      return true;
    }

    if (!this.settings.defaultEnabledFields.includes(fieldName)) {
      const isStreamingService = Object.values(this.settings.streamingServicesToSync).some(
        (service) => service.name === fieldName
      );
      const isJellyfinInstance = this.settings.jellyfinInstances.some(
        (instance) => instance.name === fieldName
      );

      if (!isStreamingService && !isJellyfinInstance) {
        return false;
      }
    }
    return true;
  }

  calculateChanges() {
    const template = this.show.showType === "movie" ? this.settings.noteNameFormat : this.settings.noteNameFormatSeries;

    this.newFileName = this.applyTemplate(template, this.show);

    if (this.newFileName !== this.currentFileName) {
      this.changes.push({
        field: "File Name",
        oldValue: this.currentFileName,
        newValue: this.newFileName,
        enabled: this.isFieldEnabled("File Name"),
      });
    }

    this.checkFieldChange("Type", this.show.showType);
    this.checkFieldChange("Year", (this.show.releaseYear || this.show.firstAirYear)?.toString() || "");

    if (this.show.directors && this.show.directors.length > 0) {
      this.checkArrayFieldChange("Directors", this.show.directors);
    }

    if (this.show.cast && this.show.cast.length > 0) {
      this.checkArrayFieldChange("Cast", this.show.cast);
    }

    if (this.show.overview) {
      this.checkFieldChange("Overview", he.decode(this.show.overview));
    }

    if (this.show.genres && this.show.genres.length > 0) {
      this.checkArrayFieldChange("Genres", this.show.genres.map((g: any) => g.name));
    }

    if (this.show.imageSet?.verticalPoster?.w480) {
      if (this.settings.posterMode === "local") {
        const tmdbId = this.show.tmdbId.split('/').pop() || this.show.tmdbId;
        const posterFilename = `${tmdbId}.jpg`;
        this.checkPosterFieldChange("Poster", `![[${this.settings.posterFolder}/${posterFilename}]]`, this.show.imageSet.verticalPoster.w240);
      } else if (this.settings.posterMode === "remote") {
        this.checkPosterFieldChange("Poster", this.show.imageSet.verticalPoster.w480, this.show.imageSet.verticalPoster.w240);
      }
    }

    if (this.show.runtime) {
      this.checkFieldChange("Runtime", `${this.show.runtime} min`);
    }
    if (this.show.rating) {
      this.checkFieldChange("Rating", this.show.rating.toString());
    }
    if (this.show.seasonCount) {
      this.checkFieldChange("Seasons", this.show.seasonCount.toString());
    }
    if (this.show.episodeCount) {
      this.checkFieldChange("Episodes", this.show.episodeCount.toString());
    }

    const showsStreamingServices = (this.show.streamingOptions[this.settings.country] || []).filter((service: any) => {
      return (!service.addon?.id?.startsWith("tvs.sbd") && (service.type === "subscription" || service.type === "addon"));
    });

    Object.entries(this.settings.streamingServicesToSync).forEach(([key, streamingServiceToSync]) => {
      const matchedService = showsStreamingServices.find((showsService: any) => showsService.service.id === streamingServiceToSync.id);

      if (matchedService) {
        const description = matchedService.type === "subscription"
          ? (matchedService.expiresOn ? `Available until ${new Date(matchedService.expiresOn * 1000).toLocaleDateString()}` : "Available")
          : (matchedService.addon?.name ? `Available with ${matchedService.addon.name}` : "Available with addon");
        this.checkFieldChange(streamingServiceToSync.name, description);
      } else {
        this.checkFieldChange(streamingServiceToSync.name, "Not available");
      }
    });
  }

  checkFieldChange(field: string, newValue: any) {
    const oldValue = this.currentFrontmatter[field];
    const newValueStr = newValue?.toString() || "";
    const oldValueStr = oldValue?.toString() || "";

    if (newValueStr && oldValueStr !== newValueStr) {
      this.changes.push({
        field,
        oldValue: oldValueStr || "(empty)",
        newValue: newValueStr,
        enabled: this.isFieldEnabled(field),
      });
    } else if (newValueStr && !oldValueStr) {
      this.changes.push({
        field,
        oldValue: "(empty)",
        newValue: newValueStr,
        enabled: this.isFieldEnabled(field),
      });
    }
  }

  checkArrayFieldChange(field: string, newValue: any[]) {
    const oldValue = this.currentFrontmatter[field];
    const newValueStr = newValue.join(", ");
    const oldValueStr = Array.isArray(oldValue) ? oldValue.join(", ") : (oldValue?.toString() || "");

    if (newValueStr && oldValueStr !== newValueStr) {
      this.changes.push({
        field,
        oldValue: oldValueStr || "(empty)",
        newValue: newValueStr,
        enabled: this.isFieldEnabled(field),
      });
    } else if (newValueStr && !oldValueStr) {
      this.changes.push({
        field,
        oldValue: "(empty)",
        newValue: newValueStr,
        enabled: this.isFieldEnabled(field),
      });
    }
  }

  checkPosterFieldChange(field: string, newValue: string, posterUrl?: string) {
    const oldValue = this.currentFrontmatter[field];
    const newValueStr = newValue?.toString() || "";
    const oldValueStr = oldValue?.toString() || "";

    if (newValueStr && oldValueStr !== newValueStr) {
      this.changes.push({
        field,
        oldValue: oldValueStr || "(empty)",
        newValue: newValueStr,
        enabled: this.isFieldEnabled(field),
        isPoster: true,
      });
    } else if (newValueStr && !oldValueStr) {
      this.changes.push({
        field,
        oldValue: "(empty)",
        newValue: newValueStr,
        enabled: this.isFieldEnabled(field),
        isPoster: true,
      });
    }
  }

  applyTemplate(template: string, show: Show): string {
    return template
      .replace("${title}", show.title)
      .replace("${year}", (show.releaseYear || show.firstAirYear || "")?.toString())
      .replace("${firstAirYear}", (show.firstAirYear || "")?.toString())
      .replace("${lastAirYear}", (show.lastAirYear || "")?.toString())
      .replace("${tmdb_id}", show.tmdbId.toString())
      .replace(/[/\\?%*:|"<>]/g, "-");
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("who-is-streaming-preview-modal");

    contentEl.createEl("h2", { text: "Preview changes" });

    if (this.show.imageSet?.verticalPoster?.w240) {
      const posterDiv = contentEl.createDiv({ cls: "preview-poster" });
      posterDiv.createEl("img", {
        attr: {
          src: this.show.imageSet.verticalPoster.w240,
          alt: this.show.title,
        },
      });
    }

    contentEl.createEl("h3", { text: this.show.title });
    contentEl.createEl("p", {
      text: `${this.show.showType === "movie" ? "Movie" : "TV Series"} • ${
        this.show.releaseYear || this.show.firstAirYear
      }`,
      cls: "preview-subtitle",
    });

    if (this.changes.length === 0) {
      contentEl.createEl("p", {
        text: "No changes will be made. All fields are already up to date.",
        cls: "preview-no-changes",
      });
    } else {
      contentEl.createEl("h4", { text: "The following changes will be made:" });

      const changesContainer = contentEl.createDiv({ cls: "preview-changes" });

      this.changes.forEach((change) => {
        const changeItem = changesContainer.createDiv({ cls: "preview-change-item" });

        const checkboxContainer = changeItem.createDiv({ cls: "preview-checkbox-container" });
        const checkbox = checkboxContainer.createEl("input", {
          type: "checkbox",
          cls: "preview-change-checkbox",
        });
        checkbox.checked = change.enabled;
        checkbox.addEventListener("change", () => {
          change.enabled = checkbox.checked;
        });

        const labelContainer = changeItem.createDiv({ cls: "preview-label-container" });
        labelContainer.createEl("strong", { text: change.field });

        const changeDetails = labelContainer.createDiv({ cls: "preview-change-details" });

        if (change.isPoster) {
          const posterPreview = changeDetails.createDiv({ cls: "preview-poster-change" });

          let posterUrl = change.newValue;
          if (posterUrl.startsWith("![[") && posterUrl.endsWith("]]")) {
            posterPreview.createDiv({ text: change.newValue, cls: "preview-new-value" });
          } else {
            const posterImg = posterPreview.createEl("img", {
              cls: "preview-poster-thumbnail",
              attr: {
                src: posterUrl,
                alt: "Poster preview",
              },
            });
            posterPreview.createDiv({ text: posterUrl, cls: "preview-poster-url" });
          }
        } else {
          changeDetails.createEl("span", {
            text: change.oldValue,
            cls: "preview-old-value",
          });
          changeDetails.createEl("span", { text: " → ", cls: "preview-arrow" });
          changeDetails.createEl("span", {
            text: change.newValue,
            cls: "preview-new-value",
          });
        }
      });
    }

    const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });

    const cancelBtn = buttonContainer.createEl("button");
    cancelBtn.setText("Cancel");
    cancelBtn.addEventListener("click", () => {
      this.callback(false);
      this.close();
    });

    const syncBtn = buttonContainer.createEl("button", { cls: "mod-cta" });
    syncBtn.setText("Sync");
    syncBtn.addEventListener("click", () => {
      const enabledFields = this.changes.filter(c => c.enabled).map(c => c.field);
      this.callback(true, enabledFields);
      this.close();
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
