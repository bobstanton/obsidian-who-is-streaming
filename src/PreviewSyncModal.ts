import { App, Modal } from "obsidian";
import { Show } from "streaming-availability";
import { WhoIsStreamingSettings } from "./settings";
import { applyShowTemplate, buildSyncFields, getEnabledSyncFields, isSyncFieldEnabled, SyncField } from "./syncFields";

interface FieldChange {
  field: string;
  oldValue: string;
  newValue: string;
  enabled: boolean;
  isPoster?: boolean;
  posterUrl?: string;
}

export class PreviewSyncModal extends Modal {
  show: Show;
  settings: WhoIsStreamingSettings;
  currentFrontmatter: Record<string, unknown>;
  currentFileName: string;
  callback: (confirmed: boolean, enabledFields?: string[]) => void;
  changes: FieldChange[] = [];
  newFileName: string = "";

  constructor(app: App, show: Show, settings: WhoIsStreamingSettings, currentFrontmatter: Record<string, unknown>, currentFileName: string, callback: (confirmed: boolean, enabledFields?: string[]) => void) {
    super(app);
    this.show = show;
    this.settings = settings;
    this.currentFrontmatter = currentFrontmatter;
    this.currentFileName = currentFileName;
    this.callback = callback;
    this.calculateChanges();
  }

  isFieldEnabled(fieldName: string): boolean {
    return isSyncFieldEnabled(this.settings, fieldName);
  }

  calculateChanges() {
    const template = this.show.showType === "movie" ? this.settings.noteNameFormat : this.settings.noteNameFormatSeries;

    this.newFileName = applyShowTemplate(template, this.show);

    if (this.newFileName !== this.currentFileName) {
      this.addFieldChange({
        field: "File Name",
        oldValue: this.currentFileName,
        newValue: this.newFileName,
      });
    }

    buildSyncFields(this.settings, this.show)
      .filter((field) => field.showInPreview !== false)
      .forEach((field) => this.addSyncFieldChange(field));
  }

  addSyncFieldChange(field: SyncField) {
    const oldValue = this.currentFrontmatter[field.name];
    const newValueStr = this.stringifyFieldValue(field.value);
    const oldValueStr = this.stringifyFieldValue(oldValue);

    if (newValueStr && oldValueStr !== newValueStr) {
      this.addFieldChange({
        field: field.name,
        oldValue: oldValueStr || "(empty)",
        newValue: field.previewValue || newValueStr,
        isPoster: field.isPoster,
        posterUrl: field.posterUrl,
      });
    }
  }

  stringifyFieldValue(value: unknown): string {
    if (value === null || value === undefined) {
      return "";
    }

    if (Array.isArray(value)) {
      return value
        .map((item) => this.stringifyFieldValue(item))
        .filter((item) => item.length > 0)
        .join(", ");
    }

    if (typeof value === "string") {
      return value;
    }

    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }

    if (value instanceof Date) {
      return value.toLocaleString();
    }

    if (typeof value === "object") {
      try {
        return JSON.stringify(value);
      } catch {
        return "";
      }
    }

    return "";
  }

  addFieldChange(change: Omit<FieldChange, "enabled">) {
    if (!this.isFieldEnabled(change.field)) {
      return;
    }

    this.changes.push({
      ...change,
      enabled: true,
    });
  }

  getEnabledFields(): string[] {
    const overrides = new Map<string, boolean>();
    this.changes.forEach((change) => {
      overrides.set(change.field, change.enabled);
    });

    return getEnabledSyncFields(this.settings, overrides);
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
        text: "No changes will be made. All enabled fields are already up to date.",
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

          const posterUrl = change.posterUrl || change.newValue;
          if (posterUrl && !posterUrl.startsWith("![[") && !posterUrl.endsWith("]]")) {
            posterPreview.createEl("img", {
              cls: "preview-poster-thumbnail",
              attr: {
                src: posterUrl,
                alt: "Poster preview",
              },
            });
          }
          posterPreview.createDiv({ text: change.newValue, cls: "preview-poster-url" });
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

    const buttonContainer = contentEl.createDiv({ cls: "who-is-streaming-modal-button-container" });

    const cancelBtn = buttonContainer.createEl("button");
    cancelBtn.setText("Cancel");
    cancelBtn.addEventListener("click", () => {
      this.callback(false);
      this.close();
    });

    const syncBtn = buttonContainer.createEl("button", { cls: "mod-cta" });
    syncBtn.setText("Sync");
    syncBtn.addEventListener("click", () => {
      this.callback(true, this.getEnabledFields());
      this.close();
    });
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
