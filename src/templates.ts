import { createEngine, standardFilters } from "knap";
import { Show } from "streaming-availability";
import { decode } from "he";
import { getTmdbId } from "./refreshFields";
import { toFileName } from "./vaultTitles";

const engine = createEngine({ filters: standardFilters });

export interface TemplateOutcome {
  output: string;
  error?: string;
}

export function convertLegacyPlaceholders(template: string): string {
  return template.replace(/\$\{(\w+)\}/g, "{{ $1 }}");
}

export async function renderTemplate(template: string, variables: Record<string, unknown>): Promise<TemplateOutcome> {
  try {
    const result = await engine.render(convertLegacyPlaceholders(template), { variables });

    if (result.errors.length > 0) {
      const first = result.errors[0];

      return { output: "", error: `${first.message} (line ${first.line}, column ${first.column})` };
    }

    return { output: result.output };
  } catch (error: unknown) {
    return { output: "", error: error instanceof Error ? error.message : "Template failed to render" };
  }
}

export function validateTemplate(template: string): string | undefined {
  const errors = engine.validate(convertLegacyPlaceholders(template));

  if (errors.length === 0) return undefined;

  return `${errors[0].message} (line ${errors[0].line}, column ${errors[0].column})`;
}

export function getShowTemplateVariables(show: Show): Record<string, unknown> {
  return {
    title: show.title,
    type: show.showType,
    year: show.releaseYear || show.firstAirYear,
    firstAirYear: show.firstAirYear,
    lastAirYear: show.lastAirYear,
    tmdb_id: show.tmdbId,
    tmdb: getTmdbId(show),
    rating: show.rating,
    runtime: show.runtime,
    overview: typeof show.overview === "string" ? decode(show.overview) : "",
    genres: show.genres?.map((genre) => genre.name) ?? [],
    directors: show.directors ?? [],
    cast: show.cast ?? [],
    seasons: show.seasonCount,
    episodes: show.episodeCount,
  };
}

export async function renderFileName(template: string, variables: Record<string, unknown>): Promise<string> {
  const outcome = await renderTemplate(template, variables);

  if (outcome.error) {
    console.warn("Who Is Streaming: note name format failed.", outcome.error);

    return "";
  }

  return toFileName(outcome.output);
}
