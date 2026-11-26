import { App, Modal, Setting } from "obsidian";

export function confirmAction(app: App, title: string, lines: string[], confirmText: string): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = new ConfirmModal(app, title, lines, confirmText, resolve);

    modal.open();
  });
}

class ConfirmModal extends Modal {
  private confirmed = false;

  constructor(app: App, private heading: string, private lines: string[], private confirmText: string, private done: (confirmed: boolean) => void) {
    super(app);
  }

  onOpen(): void {
    this.setTitle(this.heading);
    for (const line of this.lines) this.contentEl.createEl("p", { text: line });

    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText(this.confirmText).setCta().onClick(() => {
        this.confirmed = true;
        this.close();
      }))
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()));
  }

  onClose(): void {
    this.contentEl.empty();
    this.done(this.confirmed);
  }
}
