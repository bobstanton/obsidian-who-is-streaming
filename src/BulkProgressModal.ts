import { App, Modal } from "obsidian";
import { Outcome } from "./outcome";

const MAX_FILES_LISTED = 10;

export class BulkProgressModal extends Modal {
  currentIndex: number = 0;
  successCount: number = 0;
  failureCount: number = 0;
  progressBarEl!: HTMLProgressElement;
  statusEl!: HTMLElement;
  detailsEl!: HTMLElement;
  errorsEl!: HTMLElement;
  cancelled: boolean = false;
  errors: { file: string; error: string }[] = [];

  constructor(app: App, private totalFiles: number, private title: string) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("who-is-streaming-progress-modal");

    contentEl.createEl("h2", { text: this.title });

    const progressContainer = contentEl.createDiv({ cls: "progress-container" });
    this.progressBarEl = progressContainer.createEl("progress", {
      cls: "progress-bar",
      attr: {
        max: "100",
        value: "0",
      },
    });

    this.statusEl = contentEl.createDiv({ cls: "progress-status" });
    this.updateStatus();

    this.detailsEl = contentEl.createDiv({ cls: "progress-details" });

    this.errorsEl = contentEl.createDiv({ cls: "progress-errors hidden" });

    const buttonContainer = contentEl.createDiv({ cls: "progress-buttons" });
    const cancelBtn = buttonContainer.createEl("button", { text: "Cancel" });
    cancelBtn.onclick = () => {
      this.cancelled = true;
      cancelBtn.disabled = true;
      cancelBtn.textContent = "Cancelling…";
    };
  }

  updateProgress(currentFile: string) {
    this.currentIndex++;
    const percentage = Math.round((this.currentIndex / this.totalFiles) * 100);
    this.progressBarEl.value = percentage;
    this.updateStatus();
    this.detailsEl.setText(`Refreshing ${currentFile}`);
  }

  updateStatus() {
    const percentage = Math.round((this.currentIndex / this.totalFiles) * 100);
    this.statusEl.setText(
      `Progress ${this.currentIndex}/${this.totalFiles} (${percentage}%) | ` + `Success ${this.successCount} | Failed ${this.failureCount}`
    );
  }

  record(fileName: string, outcome: Outcome) {
    if (outcome.status === "ok") this.recordSuccess();
    else if (outcome.status === "warning") this.recordWarning(fileName, outcome.message);
    else this.recordFailure(fileName, outcome.message);
  }

  recordSuccess() {
    this.successCount++;
    this.updateStatus();
  }

  recordFailure(fileName?: string, errorMessage?: string) {
    this.failureCount++;
    this.updateStatus();

    if (fileName && errorMessage) {
      this.errors.push({ file: fileName, error: errorMessage });
      this.updateErrors();
    }
  }

  recordWarning(fileName: string, message: string) {
    this.successCount++;
    this.updateStatus();
    this.errors.push({ file: fileName, error: message });
    this.updateErrors();
  }

  updateErrors() {
    if (this.errors.length === 0) {
      this.errorsEl.addClass("hidden");
      return;
    }

    this.errorsEl.removeClass("hidden");
    this.errorsEl.empty();

    this.errorsEl.createEl("h4", { text: "Problems:", cls: "progress-error-header" });

    const errorList = this.errorsEl.createDiv({ cls: "progress-error-list" });

    const errorGroups = new Map<string, string[]>();

    for (const { file, error } of this.errors) {
      errorGroups.set(error, [...(errorGroups.get(error) ?? []), file]);
    }

    for (const [error, files] of errorGroups) {
      const errorItem = errorList.createDiv({ cls: "progress-error-item" });

      errorItem.createEl("strong", { text: error, cls: "progress-error-text" });

      const shown = files.slice(0, MAX_FILES_LISTED).join(", ");
      const more = files.length > MAX_FILES_LISTED ? `, and ${files.length - MAX_FILES_LISTED} more` : "";

      errorItem.createDiv({ text: `${shown}${more}`, cls: "progress-error-file-count" });
    }
  }

  complete() {
    this.detailsEl.setText(
      `Completed! ${this.successCount} succeeded, ${this.failureCount} failed.`
    );
    const buttonContainer = this.contentEl.querySelector(".progress-buttons");
    if (buttonContainer) {
      buttonContainer.empty();
      const closeBtn = buttonContainer.createEl("button", { text: "Close" });
      closeBtn.onclick = () => this.close();
    }
  }

  isCancelled(): boolean {
    return this.cancelled;
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}
