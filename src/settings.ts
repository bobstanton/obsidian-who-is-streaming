import { DEFAULT_FIELD_SOURCES, FieldSources } from "./fields";

export type PosterMode = "none" | "local" | "remote";

export interface StreamingServiceSetting {
  id: string;
  name: string;
}

export interface StreamingCountrySetting {
  countryCode: string;
  name: string;
  services: StreamingServiceSetting[];
}

export interface JellyfinInstance {
  /**
   * User-defined name for this Jellyfin instance
   */
  name: string;

  /**
   * Jellyfin server URL (e.g., http://localhost:8096)
   */
  url: string;

  /**
   * Jellyfin API key
   */
  apiKey: string;

  /**
   * Jellyfin user ID (required for watch status)
   */
  userId: string;
}

export function isJellyfinInstanceComplete(instance: JellyfinInstance): boolean {
  return instance.name.trim().length > 0
    && instance.url.trim().length > 0
    && instance.apiKey.trim().length > 0;
}

export interface WhoIsStreamingSettings {
  /**
   * API key used for accessing streaming service data.
   */
  apiKey: string;

  /**
   * The country to filter streaming availability.
   */
  country: string;

  /**
   * Cache all available countries and their streaming services as this doesn't change often. Will be refreshed weekly.
   */
  countriesCache: { [key: string]: StreamingCountrySetting };

  /**
   * The date the countries cache was last updated.
   */
  countriesCacheAsOf: Date;

  /**
   * Format to use when a note is being renamed (for movies).
   */
  genresCache: { id: string; name: string }[];

  genresCacheAsOf: number;

  tmdbApiKey: string;

  noteNameFormat: string;

  /**
   * Format to use when a note is being renamed (for TV series).
   */
  noteNameFormatSeries: string;

  noteTemplateFile: string;

  streamingServicesToSync: { [key: string]: StreamingServiceSetting };

  /**
   * How to handle poster images: "none", "local", or "remote"
   */
  posterMode: PosterMode;

  /**
   * Folder path for storing poster images
   */
  posterFolder: string;

  showPreviewDialog: boolean;

  /**
   * Poster size for grid view (width in pixels)
   */
  gridPosterSize: number;

  /**
   * List of Jellyfin instances to check for movie availability
   */
  jellyfinInstances: JellyfinInstance[];

  bulkRefreshLimit: number;

  /**
   * Rate limit warning threshold (percentage, 0-100).
   * Shows a warning when API quota usage reaches this percentage.
   * For example, 80 means warn when 80% of quota has been used.
   * Set to 0 to disable warnings.
   */
  rateLimitWarningThreshold: number;

  fieldSources: FieldSources;
}

export const DEFAULT_SETTINGS: WhoIsStreamingSettings = {
  apiKey: "",
  country: "us",
  countriesCache: {},
  countriesCacheAsOf: new Date(0),
  genresCache: [],
  genresCacheAsOf: 0,
  tmdbApiKey: "",
  noteNameFormat: "${title} (${year})",
  noteNameFormatSeries: "${title} (${firstAirYear}-${lastAirYear})",
  noteTemplateFile: "",
  streamingServicesToSync: {},
  posterMode: "remote",
  posterFolder: "posters",
  showPreviewDialog: true,
  gridPosterSize: 200,
  jellyfinInstances: [],
  bulkRefreshLimit: 40,
  rateLimitWarningThreshold: 80,
  fieldSources: { ...DEFAULT_FIELD_SOURCES },
};
