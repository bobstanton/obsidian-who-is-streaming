import { Notice } from "obsidian";
import { Outcome, failed } from "./outcome";

export class RefreshReporter {
  private progress: Notice | null;

  constructor(private readonly source: string) {
    this.progress = new Notice(`🔄 Refreshing from ${source}…`, 0);
  }

  pause(): void {
    this.progress?.hide();
    this.progress = null;
  }

  cancel(): void {
    this.pause();
  }

  done(outcome: Outcome): void {
    this.pause();
    if (outcome.status === "ok") new Notice(`✅ Refreshed from ${this.source}`);
    else if (outcome.status === "warning") new Notice(`⚠️ Refreshed from ${this.source}. ${outcome.message}`, 10000);
    else new Notice(`❌ ${this.source} refresh failed: ${outcome.message}`, 10000);
  }

  fail(error: unknown, message?: string): void {
    console.error(`${this.source} refresh failed:`, error);
    this.done(failed(message ?? describeError(error)));
  }
}

export function describeError(error: unknown): string {
  return error instanceof Error && error.message.length > 0 ? error.message : "unexpected error; see the developer console";
}
