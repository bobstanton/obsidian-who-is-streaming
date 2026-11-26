import { App, Notice, TFile } from "obsidian";
import { BulkProgressModal } from "./BulkProgressModal";
import { Outcome } from "./outcome";
import { describeError } from "./refreshReporter";

export async function runBulkOperation(
  app: App,
  files: TFile[],
  title: string,
  processFile: (file: TFile) => Promise<Outcome>,
  describeError: (error: unknown) => Promise<string> | string = defaultErrorMessage
): Promise<void> {
  const progress = new BulkProgressModal(app, files.length, title);

  progress.open();

  for (const file of files) {
    if (progress.isCancelled()) {
      new Notice(`⚠️ ${title} cancelled`);
      break;
    }

    const name = file.basename;

    progress.updateProgress(name);

    try {
      progress.record(name, await processFile(file));
    } catch (error: unknown) {
      progress.recordFailure(name, await describeError(error));
    }
  }

  progress.complete();
}

export function defaultErrorMessage(error: unknown): string {
  return describeError(error);
}
