import { EPISODES_WATCHED_PROPERTY, SERVICE_RATING_PROPERTY, TMDB_RATING_PROPERTY, WATCHED_DATES_PROPERTY, WATCHED_PROPERTY } from "./properties";

export const NOTE_NAME_FIELD = "File Name";
export const STREAMING_AVAILABILITY_FIELD = "Streaming availability";
export const STREAMING_LINKS_FIELD = "Streaming links";
export const JELLYFIN_AVAILABILITY_FIELD = "Jellyfin availability";
export const JELLYFIN_LINKS_FIELD = "Jellyfin links";

export const SHARED_FIELDS = [
  NOTE_NAME_FIELD,
  "Poster",
  "Year",
  "Directors",
  "Cast",
  "Overview",
  "Genres",
  "Runtime",
  "Seasons",
  "Episodes",
] as const;

export const STREAMING_ONLY_FIELDS = [SERVICE_RATING_PROPERTY, STREAMING_AVAILABILITY_FIELD, STREAMING_LINKS_FIELD] as const;
export const TMDB_ONLY_FIELDS = [TMDB_RATING_PROPERTY] as const;
export const JELLYFIN_ONLY_FIELDS = [WATCHED_PROPERTY, WATCHED_DATES_PROPERTY, EPISODES_WATCHED_PROPERTY, JELLYFIN_AVAILABILITY_FIELD, JELLYFIN_LINKS_FIELD] as const;

export type SharedField = typeof SHARED_FIELDS[number];
export type FieldId = SharedField | typeof STREAMING_ONLY_FIELDS[number] | typeof TMDB_ONLY_FIELDS[number] | typeof JELLYFIN_ONLY_FIELDS[number];

export type FieldSource = "streaming" | "tmdb" | "jellyfin" | "off";

export type FieldSources = Record<FieldId, FieldSource>;

export const DEFAULT_FIELD_SOURCES: FieldSources = {
  [NOTE_NAME_FIELD]: "streaming",
  "Poster": "streaming",
  "Year": "streaming",
  "Directors": "streaming",
  "Cast": "streaming",
  "Overview": "streaming",
  "Genres": "streaming",
  "Runtime": "streaming",
  "Seasons": "streaming",
  "Episodes": "streaming",
  [SERVICE_RATING_PROPERTY]: "streaming",
  [STREAMING_AVAILABILITY_FIELD]: "streaming",
  [STREAMING_LINKS_FIELD]: "streaming",
  [TMDB_RATING_PROPERTY]: "tmdb",
  [WATCHED_PROPERTY]: "jellyfin",
  [WATCHED_DATES_PROPERTY]: "jellyfin",
  [EPISODES_WATCHED_PROPERTY]: "jellyfin",
  [JELLYFIN_AVAILABILITY_FIELD]: "jellyfin",
  [JELLYFIN_LINKS_FIELD]: "jellyfin",
};

export function sourcesFor(field: SharedField): FieldSource[] {
  return field === "Runtime" ? ["streaming", "tmdb", "jellyfin", "off"] : ["streaming", "tmdb", "off"];
}

export function onlySourceOf(field: FieldId): FieldSource | undefined {
  if ((STREAMING_ONLY_FIELDS as readonly string[]).includes(field)) return "streaming";
  if ((TMDB_ONLY_FIELDS as readonly string[]).includes(field)) return "tmdb";
  if ((JELLYFIN_ONLY_FIELDS as readonly string[]).includes(field)) return "jellyfin";

  return undefined;
}

export interface HasFieldSources {
  fieldSources: FieldSources;
}

export function isFieldId(field: string): field is FieldId {
  return field in DEFAULT_FIELD_SOURCES;
}

export function getFieldSource(settings: HasFieldSources, field: string): FieldSource {
  return isFieldId(field) ? settings.fieldSources[field] : "off";
}

export function getFieldsFrom(settings: HasFieldSources, source: FieldSource): FieldId[] {
  return (Object.keys(settings.fieldSources) as FieldId[]).filter((field) => settings.fieldSources[field] === source);
}
