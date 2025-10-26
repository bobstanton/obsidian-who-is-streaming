import { App, Modal } from "obsidian";

export class BulkSyncProgressModal extends Modal {
  totalFiles: number;
  currentIndex: number = 0;
  successCount: number = 0;
  failureCount: number = 0;
  progressBarEl: HTMLElement;
  statusEl: HTMLElement;
  detailsEl: HTMLElement;
  errorsEl: HTMLElement;
  cancelled: boolean = false;
  errors: { file: string; error: string }[] = [];

  constructor(app: App, totalFiles: number) {
    super(app);
    this.totalFiles = totalFiles;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("who-is-streaming-progress-modal");

    contentEl.createEl("h2", { text: "Syncing shows" });

    const progressContainer = contentEl.createDiv({ cls: "progress-container" });
    this.progressBarEl = progressContainer.createDiv({ cls: "progress-bar" });
    this.progressBarEl.style.width = "0%";

    this.statusEl = contentEl.createDiv({ cls: "progress-status" });
    this.updateStatus();

    this.detailsEl = contentEl.createDiv({ cls: "progress-details" });

    this.errorsEl = contentEl.createDiv({ cls: "progress-errors" });
    this.errorsEl.style.display = "none";

    const buttonContainer = contentEl.createDiv({ cls: "progress-buttons" });
    const cancelBtn = buttonContainer.createEl("button", { text: "Cancel" });
    cancelBtn.onclick = () => {
      this.cancelled = true;
      cancelBtn.disabled = true;
      cancelBtn.textContent = "Cancelling...";
    };
  }

  updateProgress(currentFile: string) {
    this.currentIndex++;
    const percentage = Math.round((this.currentIndex / this.totalFiles) * 100);
    this.progressBarEl.style.width = `${percentage}%`;
    this.updateStatus();
    this.detailsEl.setText(`Syncing: ${currentFile}`);
  }

  updateStatus() {
    const percentage = Math.round((this.currentIndex / this.totalFiles) * 100);
    this.statusEl.setText(
      `Progress: ${this.currentIndex}/${this.totalFiles} (${percentage}%) | ` + `Success: ${this.successCount} | Failed: ${this.failureCount}`
    );
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

  updateErrors() {
    if (this.errors.length === 0) {
      this.errorsEl.style.display = "none";
      return;
    }

    this.errorsEl.style.display = "block";
    this.errorsEl.empty();

    const errorHeader = this.errorsEl.createEl("h4", { text: "Errors:" });
    errorHeader.style.marginTop = "16px";
    errorHeader.style.marginBottom = "8px";

    const errorList = this.errorsEl.createEl("div", { cls: "progress-error-list" });
    errorList.style.maxHeight = "200px";
    errorList.style.overflowY = "auto";
    errorList.style.fontSize = "0.9em";

    const errorGroups = new Map<string, string[]>();
    this.errors.forEach(({ file, error }) => {
      if (!errorGroups.has(error)) {
        errorGroups.set(error, []);
      }
      errorGroups.get(error)!.push(file);
    });

    errorGroups.forEach((files, error) => {
      const errorItem = errorList.createDiv({ cls: "progress-error-item" });
      errorItem.style.marginBottom = "8px";
      errorItem.style.padding = "8px";
      errorItem.style.background = "var(--background-secondary)";
      errorItem.style.borderRadius = "4px";

      const errorText = errorItem.createEl("strong", { text: error });
      errorText.style.color = "var(--text-error)";

      const fileCount = errorItem.createDiv({ text: `${files.length} file(s) affected` });
      fileCount.style.fontSize = "0.85em";
      fileCount.style.color = "var(--text-muted)";
      fileCount.style.marginTop = "4px";
    });
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
