import type { Show } from "streaming-availability";
import { TMDB_ID_PROPERTY, TYPE_PROPERTY } from "./properties";

export type TitleType = "movie" | "series";

export interface TitleId {
  tmdbId: number;
  type: TitleType;
}

export function toTitleType(value: unknown): TitleType {
  return value === "series" ? "series" : "movie";
}

export function titleKey(id: TitleId): string {
  return `${id.type}:${id.tmdbId}`;
}

export function noteKey(frontmatter: Record<string, unknown>): string | undefined {
  const tmdbId = frontmatter[TMDB_ID_PROPERTY];

  if (typeof tmdbId !== "number") return undefined;

  return titleKey({ type: toTitleType(frontmatter[TYPE_PROPERTY]), tmdbId });
}

export function showTitleId(show: Pick<Show, "showType" | "tmdbId">): TitleId {
  return { type: toTitleType(show.showType), tmdbId: Number.parseInt(show.tmdbId.split("/").pop() ?? "", 10) };
}

export function showKey(show: Pick<Show, "showType" | "tmdbId">): string {
  return titleKey(showTitleId(show));
}
