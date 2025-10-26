import { Country, Service } from "streaming-availability";

export type PosterMode = "none" | "local" | "remote";

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
  countriesCache: { [key: string]: Country };

  /**
   * The date the countries cache was last updated.
   */
  countriesCacheAsOf: Date;

  /**
   * Format to use when a note is being renamed (for movies).
   */
  noteNameFormat: string;

  /**
   * Format to use when a note is being renamed (for TV series).
   */
  noteNameFormatSeries: string;

  /**
   * Dataview query to execute when bulk syncing shows
   */
  bulkSyncDataviewQuery: string;

  /**
   * The streaming services to sync with.
   * The key represents the service name, and the value represents the streaming availability service.
   */
  streamingServicesToSync: { [key: string]: Service };

  /**
   * How to handle poster images: "none", "local", or "remote"
   */
  posterMode: PosterMode;

  /**
   * Folder path for storing poster images
   */
  posterFolder: string;

  /**
   * Whether to add streaming service direct links
   */
  addStreamingLinks: boolean;

  /**
   * Whether to show preview dialog before syncing
   */
  showPreviewDialog: boolean;

  /**
   * Whether to automatically add genre-based tags
   */
  autoAddGenreTags: boolean;

  /**
   * Whether to include additional metadata fields
   */
  includeAdditionalMetadata: boolean;

  /**
   * Poster size for grid view (width in pixels)
   */
  gridPosterSize: number;

  /**
   * List of Jellyfin instances to check for movie availability
   */
  jellyfinInstances: JellyfinInstance[];

  /**
   * Rate limit warning threshold (percentage, 0-100).
   * Shows a warning when API quota usage reaches this percentage.
   * For example, 80 means warn when 80% of quota has been used.
   * Set to 0 to disable warnings.
   */
  rateLimitWarningThreshold: number;
}

export const DEFAULT_SETTINGS: WhoIsStreamingSettings = {
  apiKey: "",
  country: "us",
  countriesCache: {},
  countriesCacheAsOf: new Date(0),
  noteNameFormat: "${title} (${year})",
  noteNameFormatSeries: "${title} (${firstAirYear}-${lastAirYear})",
  bulkSyncDataviewQuery: "WHERE tmdb_id AND date(now) - date(last-synced, \"D, tt\") > dur(30 days)\nSORT date(last-synced, \"D, tt\") ASC\nLIMIT 10",
  streamingServicesToSync: {},
  posterMode: "remote",
  posterFolder: "posters",
  addStreamingLinks: true,
  showPreviewDialog: true,
  autoAddGenreTags: true,
  includeAdditionalMetadata: true,
  gridPosterSize: 200,
  jellyfinInstances: [],
  rateLimitWarningThreshold: 80,
};
