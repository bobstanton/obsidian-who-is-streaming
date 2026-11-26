import { App, Modal, Notice, Setting } from "obsidian";
import { guessImportFolder } from "./vaultTitles";
import { LetterboxdLibrary, readLetterboxdFiles } from "./letterboxdFiles";
import { ImportEnricher, ImportOptions, ImportPlan, planImport, runImport } from "./letterboxdImport";
import { WhoIsStreamingSettings } from "./settings";

const LETTERBOXD_EXPORT_URL = "https://letterboxd.com/settings/data/";

export class LetterboxdImportModal extends Modal {
  private library: LetterboxdLibrary | null = null;
  private options: ImportOptions;
  private importing = false;
  private cancelled = false;

  private useEnricher = true;

  constructor(app: App, settings: WhoIsStreamingSettings, private enricher?: ImportEnricher) {
    super(app);
    this.options = { settings, folder: guessImportFolder(app), includeWatchlist: true, replaceRatings: false };
  }

  onOpen(): void {
    this.setTitle("Letterboxd import");
    this.modalEl.addClass("who-is-streaming-letterboxd-import");
    this.renderChooseFiles();
  }

  onClose(): void {
    this.cancelled = true;
    this.contentEl.empty();
  }

  private renderChooseFiles(problem?: string): void {
    const { contentEl } = this;

    contentEl.empty();

    const intro = contentEl.createEl("p");

    intro.appendText("Choose the ZIP file from ");
    intro.createEl("a", { text: "Letterboxd's export page", href: LETTERBOXD_EXPORT_URL });
    intro.appendText(", or any of the CSV files inside it. Watched dates, ratings and your watchlist are added to your notes.");

    if (problem) contentEl.createEl("p", { cls: "letterboxd-import-problem", text: problem });

    const input = contentEl.createEl("input", { type: "file", cls: "letterboxd-import-input" });

    input.accept = ".zip,.csv";
    input.multiple = true;
    input.addEventListener("change", () => {
      const files = Array.from(input.files ?? []);

      if (files.length > 0) void this.loadFiles(files);
    });

    new Setting(contentEl)
      .addButton((button) => button.setButtonText("Choose files").setCta().onClick(() => input.click()))
      .addButton((button) => button.setButtonText("Cancel").onClick(() => this.close()));
  }

  private async loadFiles(files: File[]): Promise<void> {
    try {
      const library = await readLetterboxdFiles(files);

      if (library.films.length === 0) {
        this.renderChooseFiles("No films were found in those files. Choose the Letterboxd export ZIP, or its diary, reviews, watched, ratings or watchlist CSV.");

        return;
      }

      this.library = library;
      this.renderReview();
    } catch (error: unknown) {
      console.error("Letterboxd import could not read the files:", error);
      this.renderChooseFiles("Those files could not be read. Check that the ZIP came from Letterboxd and try again.");
    }
  }

  private renderReview(): void {
    const library = this.library;

    if (!library) return;

    const { contentEl } = this;

    contentEl.empty();

    const filesLine = contentEl.createEl("p", { cls: "letterboxd-import-note" });

    filesLine.setText(`Read ${library.filesRead.join(", ")}.`);

    if (library.filesSkipped.length > 0) {
      filesLine.appendText(` Ignored ${library.filesSkipped.join(", ")}.`);
    }

    const summaryEl = contentEl.createDiv({ cls: "letterboxd-import-summary" });
    let plan = planImport(this.app, library, this.options);
    const refresh = () => {
      plan = planImport(this.app, library, this.options);
      this.renderSummary(summaryEl, plan);
      importButton?.setDisabled(plan.items.length === 0);
    };

    new Setting(contentEl)
      .setName("Folder for new notes")
      .setDesc("Created if it doesn't exist. Leave blank for the vault root.")
      .addText((text) => text
        .setPlaceholder("Movies")
        .setValue(this.options.folder)
        .onChange((value) => {
          this.options.folder = value.trim();
          refresh();
        }));

    new Setting(contentEl)
      .setName("Include watchlist")
      .setDesc("Create notes for films you haven't watched yet.")
      .addToggle((toggle) => toggle.setValue(this.options.includeWatchlist).onChange((value) => {
        this.options.includeWatchlist = value;
        refresh();
      }));

    new Setting(contentEl)
      .setName("Replace existing ratings")
      .setDesc("Off keeps a rating already in a note. On overwrites it with the imported rating.")
      .addToggle((toggle) => toggle.setValue(this.options.replaceRatings).onChange((value) => {
        this.options.replaceRatings = value;
      }));

    if (this.enricher) {
      new Setting(contentEl)
        .setName("Add details from TMDB")
        .setDesc("Looks each film up on TMDB to identify it and fill the fields whose source is TMDB. Doesn't use your Streaming Availability API quota.")
        .addToggle((toggle) => toggle.setValue(this.useEnricher).onChange((value) => {
          this.useEnricher = value;
        }));
    }

    let importButton: { setDisabled(disabled: boolean): unknown } | undefined;

    new Setting(contentEl)
      .addButton((button) => {
        importButton = button;
        button.setButtonText("Import").setCta().onClick(() => void this.runImport(plan));
      })
      .addButton((button) => button.setButtonText("Back").onClick(() => this.renderChooseFiles()));

    refresh();
  }

  private renderSummary(container: HTMLElement, plan: ImportPlan): void {
    container.empty();
    const list = container.createEl("ul");
    const add = (count: number, singular: string, plural: string) => {
      if (count > 0) list.createEl("li", { text: `${count.toLocaleString()} ${count === 1 ? singular : plural}` });
    };

    add(plan.toCreate, "new note will be created", "new notes will be created");
    add(plan.toUpdate, "existing note will be updated", "existing notes will be updated");
    add(plan.watchDates, "watch date", "watch dates");
    add(plan.ratings, "rating", "ratings");
    add(plan.reviews, "review", "reviews");
    add(plan.liked, "liked film", "liked films");
    add(plan.yearMismatches, "film matched by title, with a different release year", "films matched by title, with a different release year");
    add(plan.watchlistSkipped, "watchlist film left out", "watchlist films left out");

    if (plan.items.length === 0) {
      container.createEl("p", { cls: "letterboxd-import-problem", text: "Nothing to import with these options." });
    }
  }

  private async runImport(plan: ImportPlan): Promise<void> {
    if (this.importing || plan.items.length === 0) return;
    this.importing = true;
    this.cancelled = false;

    const { contentEl } = this;

    contentEl.empty();
    const status = contentEl.createEl("p", { text: "Importing…" });
    const progress = contentEl.createEl("progress", { cls: "letterboxd-import-progress" });

    progress.max = plan.items.length;
    new Setting(contentEl).addButton((button) => button.setButtonText("Stop").onClick(() => this.close()));

    const enricher = this.useEnricher ? this.enricher : undefined;
    const result = await runImport(this.app, plan, { ...this.options, enricher }, (done, total) => {
      progress.value = done;
      status.setText(`Importing ${Math.min(done + 1, total).toLocaleString()} of ${total.toLocaleString()}…`);

      return !this.cancelled;
    });

    this.importing = false;

    const parts = [
      `${result.created.toLocaleString()} created`,
      `${result.updated.toLocaleString()} updated`,
    ];

    if (result.failed.length > 0) parts.push(`${result.failed.length.toLocaleString()} failed`);
    const stopped = this.cancelled ? " Stopped early." : "";

    new Notice(`Letterboxd import: ${parts.join(", ")}.${stopped}`, 10000);

    if (result.failed.length > 0) console.warn("Letterboxd import failures:", result.failed);
    if (this.cancelled) return;

    contentEl.empty();
    contentEl.createEl("p", { text: `Done: ${parts.join(", ")}.` });

    if (result.created > 0) {
      contentEl.createEl("p", {
        cls: "letterboxd-import-note",
        text: enricher
          ? "New notes have the fields whose source is TMDB filled in, but no streaming availability yet. Run the command for refreshing imported notes to add it; it uses one Streaming Availability API request per note and stops at your bulk refresh limit."
          : "New notes have no poster, cast or streaming details yet. Run the command for refreshing imported notes to add them; it uses one Streaming Availability API request per note and stops at your bulk refresh limit.",
      });
    }

    if (result.failed.length > 0) {
      const failures = contentEl.createEl("ul", { cls: "letterboxd-import-problem" });

      for (const failure of result.failed.slice(0, 10)) {
        failures.createEl("li", { text: `${failure.name}: ${failure.reason}` });
      }

      if (result.failed.length > 10) failures.createEl("li", { text: `…and ${result.failed.length - 10} more (see the developer console).` });
    }

    new Setting(contentEl).addButton((button) => button.setButtonText("Close").setCta().onClick(() => this.close()));
  }
}
