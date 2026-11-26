import { Notice, TFile } from "obsidian";
import { runBulkOperation } from "./bulk";
import { NOTE_NAME_FIELD, getFieldSource } from "./fields";
import type WhoIsStreamingPlugin from "./main";
import { downloadPoster, localPosterLink } from "./notes";
import { Outcome, failed, warned } from "./outcome";
import { POSTER_PROPERTY, TMDB_ID_PROPERTY, TYPE_PROPERTY } from "./properties";
import { renderFileName } from "./templates";
import { applyTmdbDetails, getTmdbTemplateVariables, needsTmdbDetails, tmdbOwns } from "./tmdb";
import { getFrontmatter, getNoteTitle, getNoteYear } from "./vaultTitles";
import { TitleId, TitleType, toTitleType } from "./titleId";
import { ImportEnricher, PreparedDetails } from "./letterboxdImport";
import { FrontmatterWriter } from "./frontmatterUtils";
import { previewPlan } from "./PreviewRefreshModal";
import { RefreshPlan, applyPlan } from "./refreshPlan";
import { RefreshReporter } from "./refreshReporter";

export class TmdbNotes implements ImportEnricher {
  constructor(private plugin: WhoIsStreamingPlugin) {}

  private get api() {
    return this.plugin.tmdbApi;
  }

  private get settings() {
    return this.plugin.settings;
  }

  isConfigured(): boolean {
    return this.api.isConfigured();
  }

  findMovieId(title: string, year: number | undefined): Promise<number | undefined> {
    return this.api.findMovieId(title, year);
  }

  needsDetails(frontmatter: Record<string, unknown>): boolean {
    return needsTmdbDetails(frontmatter, this.settings);
  }

  async prepare(type: TitleType, tmdbId: number, current: Record<string, unknown>): Promise<PreparedDetails | undefined> {
    const parts = await this.prepareParts(type, tmdbId, current);

    if (!parts) return undefined;
    await parts.download?.();

    return { write: parts.write, variables: getTmdbTemplateVariables(parts.details) };
  }

  private async prepareParts(type: TitleType, tmdbId: number, current: Record<string, unknown>) {
    const details = await this.api.getDetails(type, tmdbId);

    if (!details) return undefined;

    let poster: string | undefined;
    let download: (() => Promise<void>) | undefined;
    const wantsPoster = this.settings.posterMode !== "none" && tmdbOwns(this.settings, POSTER_PROPERTY);
    const posterUrl = details.posterUrl;

    if (posterUrl && wantsPoster) {
      if (this.settings.posterMode === "local") {
        download = () => downloadPoster(this.plugin.app, this.settings, tmdbId, posterUrl);
        poster = localPosterLink(this.settings, tmdbId);
      } else {
        poster = posterUrl;
      }
    }

    const write: FrontmatterWriter = (frontmatter) => applyTmdbDetails(frontmatter, details, this.settings, poster);

    return { details, write, download };
  }

  async plan(file: TFile, known?: TitleId): Promise<{ plan: RefreshPlan } | { failure: string }> {
    const frontmatter = getFrontmatter(this.plugin.app, file);
    const type: TitleType = known?.type ?? toTitleType(frontmatter[TYPE_PROPERTY]);
    const stored = frontmatter[TMDB_ID_PROPERTY];

    let tmdbId = known?.tmdbId ?? (typeof stored === "number" ? stored : undefined);

    if (tmdbId === undefined) {
      if (type !== "movie") return { failure: "No TMDB ID; use Search on this note" };
      tmdbId = await this.api.findMovieId(getNoteTitle(file, frontmatter), getNoteYear(file, frontmatter));
    }

    if (tmdbId === undefined) return { failure: "No exact match on TMDB" };

    const parts = await this.prepareParts(type, tmdbId, frontmatter);

    if (!parts) return { failure: "Title not found on TMDB" };
    const { details } = parts;
    const template = type === "movie" ? this.settings.noteNameFormat : this.settings.noteNameFormatSeries;
    const named = getFieldSource(this.settings, NOTE_NAME_FIELD) === "tmdb" && template.length > 0;

    return {
      plan: {
        heading: details.title,
        details: `${type === "movie" ? "Movie" : "Series"} • ${details.year ?? ""}`,
        posterUrl: details.posterUrl,
        newName: named ? await renderFileName(template, getTmdbTemplateVariables(details)) || undefined : undefined,
        writers: [parts.write],
        posterDownload: parts.download,
      },
    };
  }

  async refresh(file: TFile, known?: TitleId): Promise<Outcome> {
    const planned = await this.plan(file, known);

    if ("failure" in planned) return failed(planned.failure);

    return warned(await applyPlan(this.plugin.app, file, planned.plan));
  }

  async refreshActiveNote(): Promise<void> {
    const file = this.plugin.app.workspace.getActiveFile();

    if (!file) {
      new Notice("No active note");

      return;
    }

    const reporter = new RefreshReporter("TMDB");

    try {
      const planned = await this.plan(file);

      if ("failure" in planned) {
        reporter.done(failed(planned.failure));

        return;
      }

      let accepted: Set<string> | undefined;

      if (this.settings.showPreviewDialog) {
        reporter.pause();
        accepted = await previewPlan(this.plugin.app, getFrontmatter(this.plugin.app, file), file.basename, planned.plan);

        if (!accepted) {
          reporter.cancel();

          return;
        }
      }

      reporter.done(warned(await applyPlan(this.plugin.app, file, planned.plan, accepted)));
    } catch (error: unknown) {
      reporter.fail(error);
    }
  }

  async refreshAllNotes(): Promise<void> {
    const { files, scope } = this.plugin.getBulkTargets();

    if (files.length === 0) {
      new Notice(`No titles found in ${scope}`);

      return;
    }

    await runBulkOperation(this.plugin.app, files, "TMDB: bulk refresh", (file) => this.refresh(file));
  }
}
