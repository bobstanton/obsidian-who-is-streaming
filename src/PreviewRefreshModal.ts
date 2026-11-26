import { App, Modal, Setting } from "obsidian";
import { NOTE_NAME_FIELD } from "./fields";
import { POSTER_PROPERTY } from "./properties";
import { PlannedChange, RefreshPlan, plannedChanges } from "./refreshPlan";

interface ChangeRow extends PlannedChange {
  enabled: boolean;
}

export function previewPlan(app: App, current: Record<string, unknown>, currentName: string, plan: RefreshPlan): Promise<Set<string> | undefined> {
  return new Promise((resolve) => {
    new PreviewRefreshModal(app, plan, plannedChanges(current, currentName, plan), resolve).open();
  });
}

export class PreviewRefreshModal extends Modal {
  private rows: ChangeRow[];
  private decided = false;

  constructor(app: App, private readonly plan: RefreshPlan, changes: PlannedChange[], private readonly onDecision: (accepted: Set<string> | undefined) => void) {
    super(app);
    this.rows = changes.map((change) => ({ ...change, enabled: true }));
  }

  private decide(accepted: Set<string> | undefined): void {
    if (this.decided) return;
    this.decided = true;
    this.onDecision(accepted);
  }

  onOpen() {
    const { contentEl } = this;

    contentEl.empty();
    contentEl.addClass("who-is-streaming-preview-modal");
    this.setTitle("Preview changes");

    if (this.plan.posterUrl) {
      contentEl.createDiv({ cls: "preview-poster" }).createEl("img", { attr: { src: this.plan.posterUrl, alt: this.plan.heading } });
    }

    contentEl.createEl("h3", { text: this.plan.heading });
    contentEl.createEl("p", { text: this.plan.details, cls: "preview-subtitle" });

    if (this.rows.length === 0) {
      contentEl.createEl("p", { text: "No changes will be made. All enabled fields are already up to date.", cls: "preview-no-changes" });
    } else {
      contentEl.createEl("h4", { text: "The following changes will be made:" });
      const changesContainer = contentEl.createDiv({ cls: "preview-changes" });

      for (const row of this.rows) this.renderRow(changesContainer, row);
    }

    new Setting(contentEl)
      .addButton((button) => button.setButtonText("Cancel").onClick(() => {
        this.decide(undefined);
        this.close();
      }))
      .addButton((button) => button.setButtonText("Refresh").setCta().onClick(() => {
        this.decide(new Set(this.rows.filter((row) => row.enabled).map((row) => row.property)));
        this.close();
      }));
  }

  private renderRow(container: HTMLElement, row: ChangeRow): void {
    const item = container.createDiv({ cls: "preview-change-item" });
    const checkbox = item.createDiv({ cls: "preview-checkbox-container" }).createEl("input", { type: "checkbox", cls: "preview-change-checkbox" });

    checkbox.checked = row.enabled;
    checkbox.addEventListener("change", () => {
      row.enabled = checkbox.checked;
    });

    const label = item.createDiv({ cls: "preview-label-container" });

    label.createEl("strong", { text: row.property === NOTE_NAME_FIELD ? "Note name" : row.property });
    const details = label.createDiv({ cls: "preview-change-details" });
    const after = describe(row.after);

    if (row.property === POSTER_PROPERTY) {
      const poster = details.createDiv({ cls: "preview-poster-change" });

      if (this.plan.posterUrl) poster.createEl("img", { cls: "preview-poster-thumbnail", attr: { src: this.plan.posterUrl, alt: "Poster preview" } });
      poster.createDiv({ text: after || "(removed)", cls: "preview-poster-url" });

      return;
    }

    details.createSpan({ text: describe(row.before) || "(empty)", cls: "preview-old-value" });
    details.createSpan({ text: " → ", cls: "preview-arrow" });
    details.createSpan({ text: after || "(removed)", cls: "preview-new-value" });
  }

  onClose() {
    this.decide(undefined);
    this.contentEl.empty();
  }
}

function describe(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(describe).filter((item) => item.length > 0).join(", ");
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toLocaleString();

  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}
