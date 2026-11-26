import { Client, Configuration, Show, ShowType } from "streaming-availability";
import { StreamingCountrySetting, WhoIsStreamingSettings } from "./settings";
import { Notice } from "obsidian";
import { obsidianFetch } from "./obsidianFetch";

const DISCOVERY_CACHE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CHANGE_PAGES = 4;
const GENRES_CACHE_MS = 7 * 24 * 60 * 60 * 1000;

export type DiscoveryChangeType = "new" | "expiring" | "upcoming";

export interface ChangedShow {
  show: Show;
  serviceId: string;
  serviceName: string;
  timestamp?: number;
}

export interface ChangesLookup {
  items: ChangedShow[];
  complete: boolean;
}

export interface BrowseFilters {
  showType?: ShowType;
  genres?: string[];
  genresRelation?: "and" | "or";
  keyword?: string;
  showOriginalLanguage?: string;
  yearMin?: number;
  yearMax?: number;
  ratingMin?: number;
  services?: string[];
  orderBy: "original_title" | "release_date" | "rating" | "popularity_alltime" | "popularity_1year" | "popularity_1month" | "popularity_1week";
  cursor?: string;
}

export interface BrowsePage {
  shows: Show[];
  hasMore: boolean;
  nextCursor?: string;
}

export default class StreamingAvailabilityApiService {
  private discoveryCache = new Map<string, { at: number; value: unknown }>();

  settings: WhoIsStreamingSettings;
  apiClient: Client;
  apiShowCache: Map<string, Show | undefined>;
  apiSearchCache: Map<string, Array<Show>>;

  constructor(settings: WhoIsStreamingSettings) {
    this.settings = settings;

    this.apiClient = new Client(new Configuration({
        apiKey: () => this.settings.apiKey.trim(),
        fetchApi: obsidianFetch,
    }));

    this.apiShowCache = new Map<string, Show | undefined>();
    this.apiSearchCache = new Map<string, Array<Show>>();
  }

  async getCountries(): Promise<{ [key: string]: StreamingCountrySetting }> {
    if (!this.validateApiKey()) {
      return {};
    }

    if (Object.keys(this.settings.countriesCache).length !== 0 
      && this.getDaysDifference(new Date(this.settings.countriesCacheAsOf), new Date(Date.now())) < 7) 
    {
      return this.settings.countriesCache;
    }

    try {
      const apiResponse = await this.apiClient.countriesApi.getCountriesRaw({
        outputLanguage: "en",
      });

      this.checkRateLimitHeaders(apiResponse.raw);

      const countriesData = await apiResponse.value();

      if (!countriesData || typeof countriesData !== "object") {
        return {};
      }

      this.settings.countriesCache = countriesData;
      this.settings.countriesCacheAsOf = new Date(Date.now());

      return countriesData;
    } catch (error: unknown) {
      await this.handleApiError(error);
      return {};
    }
  }

  async getShowByTmdbId(showType: string, tmdb_id: number, showNotice: boolean = true, forceRefresh: boolean = false): Promise<Show | undefined> {
    const cacheKey = `getShowByTmdbId|${showType}/${tmdb_id}`;
    const cachedResponse = this.apiShowCache.get(cacheKey);
    if (cachedResponse && !forceRefresh) return cachedResponse;

    const tmdbIdType = showType === "movie" ? "movie" : "tv";

    try {
      const apiResponse = await this.apiClient.showsApi.getShowRaw({
        id: `${tmdbIdType}/${tmdb_id}`,
        country: this.settings.country,
        seriesGranularity: "show",
      });

      this.checkRateLimitHeaders(apiResponse.raw);

      const show = await apiResponse.value();
      this.apiShowCache.set(cacheKey, show);
      return show;
    } catch (error: unknown) {
      if (!showNotice) {
        throw error;
      }

      await this.handleApiError(error, showNotice);
      return undefined;
    }
  }

  async searchForShowsByTitle(searchTerm: string, showType?: ShowType): Promise<Array<Show>> {
    if (!this.validateApiKey()) {
      return [];
    }

    const cacheKey = `searchForShowsByTitle|${showType ?? "any"}|${searchTerm}`;
    const cachedResponse = this.apiSearchCache.get(cacheKey);
    if (cachedResponse) return cachedResponse;

    try {
      const apiResponse = await this.apiClient.showsApi.searchShowsByTitleRaw({
        country: this.settings.country,
        title: searchTerm,
        showType,
      });

      this.checkRateLimitHeaders(apiResponse.raw);

      const results = await apiResponse.value();
      this.apiSearchCache.set(cacheKey, results);

      return results;
    } catch (error: unknown) {
      await this.handleApiError(error);
      return [];
    }
  }

  getEnabledServiceIds(): string[] {
    return [...new Set(Object.values(this.settings.streamingServicesToSync).map((service) => service.id))];
  }

  private async cachedDiscovery<T>(key: string, force: boolean, load: () => Promise<T>): Promise<T | undefined> {
    const cacheKey = `${this.settings.country}|${key}`;
    const cached = this.discoveryCache.get(cacheKey);

    if (!force && cached && Date.now() - cached.at < DISCOVERY_CACHE_MS) {
      return cached.value as T;
    }

    try {
      const value = await load();

      this.discoveryCache.set(cacheKey, { at: Date.now(), value });

      return value;
    } catch (error: unknown) {
      await this.handleApiError(error);

      return undefined;
    }
  }

  async getChanges(changeType: DiscoveryChangeType, options: { showType?: ShowType; maxPages?: number; force?: boolean; services?: string[] } = {}): Promise<ChangesLookup | undefined> {
    if (!this.validateApiKey()) return undefined;

    const catalogs = options.services ?? this.getEnabledServiceIds();

    if (catalogs.length === 0) {
      new Notice("Enable at least one streaming service in settings first");

      return undefined;
    }

    const maxPages = options.maxPages ?? DEFAULT_CHANGE_PAGES;
    const key = `changes|${changeType}|${options.showType ?? "any"}|${catalogs.join(",")}|${maxPages}`;

    return this.cachedDiscovery(key, options.force === true, async () => {
      const found = new Map<string, ChangedShow>();
      let cursor: string | undefined;
      let complete = false;

      for (let page = 0; page < maxPages; page++) {
        const apiResponse = await this.apiClient.changesApi.getChangesRaw({
          country: this.settings.country,
          changeType,
          itemType: "show",
          catalogs,
          showType: options.showType,
          orderDirection: changeType === "new" ? "desc" : "asc",
          cursor,
        });

        this.checkRateLimitHeaders(apiResponse.raw);
        const result = await apiResponse.value();

        for (const change of result.changes) {
          const show = result.shows[change.showId];

          if (!show) continue;
          const itemKey = `${change.showId}|${change.service.id}`;

          if (!found.has(itemKey)) {
            found.set(itemKey, {
              show,
              serviceId: change.service.id,
              serviceName: change.service.name,
              timestamp: change.timestamp,
            });
          }
        }

        if (!result.hasMore || !result.nextCursor) {
          complete = true;
          break;
        }

        cursor = result.nextCursor;
      }

      return { items: [...found.values()], complete };
    });
  }

  async getTopShows(serviceId: string, showType?: ShowType, force = false): Promise<Show[] | undefined> {
    if (!this.validateApiKey()) return undefined;

    return this.cachedDiscovery(`top|${serviceId}|${showType ?? "any"}`, force, async () => {
      const apiResponse = await this.apiClient.showsApi.getTopShowsRaw({
        country: this.settings.country,
        service: serviceId,
        showType,
      });

      this.checkRateLimitHeaders(apiResponse.raw);

      return apiResponse.value();
    });
  }

  async browseShows(filters: BrowseFilters, force = false): Promise<BrowsePage | undefined> {
    if (!this.validateApiKey()) return undefined;

    const catalogs = filters.services ?? this.getEnabledServiceIds();

    if (catalogs.length === 0) {
      new Notice("Enable at least one streaming service in settings first");

      return undefined;
    }

    return this.cachedDiscovery(`browse|${catalogs.join(",")}|${JSON.stringify(filters)}`, force, async () => {
      const apiResponse = await this.apiClient.showsApi.searchShowsByFiltersRaw({
        country: this.settings.country,
        catalogs,
        showType: filters.showType,
        genres: filters.genres && filters.genres.length > 0 ? filters.genres : undefined,
        genresRelation: filters.genres && filters.genres.length > 1 ? filters.genresRelation : undefined,
        keyword: filters.keyword || undefined,
        showOriginalLanguage: filters.showOriginalLanguage || undefined,
        yearMin: filters.yearMin,
        yearMax: filters.yearMax,
        ratingMin: filters.ratingMin,
        orderBy: filters.orderBy,
        orderDirection: filters.orderBy === "original_title" ? "asc" : "desc",
        seriesGranularity: "show",
        cursor: filters.cursor,
      });

      this.checkRateLimitHeaders(apiResponse.raw);
      const result = await apiResponse.value();

      return { shows: result.shows, hasMore: result.hasMore, nextCursor: result.nextCursor };
    });
  }

  async getGenres(): Promise<{ id: string; name: string }[]> {
    const cached = this.settings.genresCache ?? [];
    const ageMs = Date.now() - (this.settings.genresCacheAsOf ?? 0);

    if (cached.length > 0 && ageMs < GENRES_CACHE_MS) return cached;
    if (!this.hasApiKey()) return cached;

    try {
      const apiResponse = await this.apiClient.genresApi.getGenresRaw({ outputLanguage: "en" });

      this.checkRateLimitHeaders(apiResponse.raw);
      const genres = (await apiResponse.value()).map((genre) => ({ id: genre.id, name: genre.name }));

      if (genres.length === 0) return cached;

      this.settings.genresCache = genres;
      this.settings.genresCacheAsOf = Date.now();

      return genres;
    } catch (error: unknown) {
      console.debug("Who Is Streaming: genre list could not be refreshed", error);

      return cached;
    }
  }

  async handleApiError(error: unknown, showNotice: boolean = true): Promise<string | undefined> {
    if (!isApiError(error)) {
      return undefined;
    }

    const status = error.response.status;
    const message = await this.getApiErrorMessage(error, status);
    if (showNotice) {
      new Notice(message, status === 429 ? 10000 : 5000);
    }
    return message;
  }

  async getApiErrorMessage(error: ApiError, status: number): Promise<string> {
    const responseMessage = await readResponseMessage(error.response);
    if (responseMessage) {
      return responseMessage;
    }

    if (status === 429) {
      return "API rate limit exceeded.";
    }

    if (status === 404) {
      return "Title not found.";
    }

    if (status >= 500) {
      return "Streaming Availability API server error. Please try again later.";
    }

    return `Streaming Availability API request failed with HTTP ${status}.`;
  }

  hasApiKey(): boolean {
    const apiKey = this.settings.apiKey?.trim();

    return apiKey !== undefined && (apiKey.startsWith("motn-key-") || apiKey.length === 50);
  }

  validateApiKey(): boolean {
    if (!this.hasApiKey()) {
      new Notice("Add a valid Streaming Availability API key in settings.");
      return false;
    }

    return true;
  }

  getDaysDifference(date1: Date, date2: Date): number {
    const timeDifference = date2.getTime() - date1.getTime();
    const daysDifference = Math.floor(timeDifference / (1000 * 3600 * 24));
    return daysDifference;
  }

  checkRateLimitHeaders(response: Response): void {
    if (this.settings.rateLimitWarningThreshold === 0) {
      return; 
    }

    const headers = response.headers;
    if (!headers) {
      return;
    }

    const limit = getRateLimitHeader(headers, RATE_LIMIT_HEADER_NAMES.limit);
    const remaining = getRateLimitHeader(headers, RATE_LIMIT_HEADER_NAMES.remaining);
    const reset = getRateLimitHeader(headers, RATE_LIMIT_HEADER_NAMES.reset);

    if (!limit || remaining === null) {
      return;
    }

    const limitNum = parseRateLimitHeader(limit);
    const remainingNum = parseRateLimitHeader(remaining);
    if (limitNum === undefined || remainingNum === undefined || limitNum <= 0) {
      return;
    }

    const percentageUsed = ((limitNum - remainingNum) / limitNum) * 100;

    if (percentageUsed >= this.settings.rateLimitWarningThreshold) {
      let message = `⚠️ API Rate Limit Warning: ${formatRateLimitValue(remainingNum)}/${formatRateLimitValue(limitNum)} requests remaining (${percentageUsed.toFixed(0)}% used)`;

      const resetMessage = getRateLimitResetMessage(reset);
      if (resetMessage) {
        message += `. ${resetMessage}`;
      }

      message += ".";
      new Notice(message, 8000);
    }
  }
}

interface ApiError {
  response: {
    status: number;
    body?: unknown;
    clone?: () => {
      json: () => Promise<{ message?: string }>;
    };
  };
}

function isApiError(error: unknown): error is ApiError {
  const response = typeof error === "object"
    && error !== null
    && "response" in error
    ? (error as { response?: unknown }).response
    : undefined;

  return typeof response === "object"
    && response !== null
    && "status" in response
    && typeof (response as { status?: unknown }).status === "number";
}

async function readResponseMessage(response: ApiError["response"]): Promise<string | undefined> {
  if (!response.body || typeof response.clone !== "function") {
    return undefined;
  }

  try {
    const data = await response.clone().json();
    return data.message;
  } catch {
    return undefined;
  }
}

const RATE_LIMIT_HEADER_NAMES = {
  limit: [
    "x-ratelimit-requests-limit",
    "x-ratelimit-limit",
    "ratelimit-limit",
    "x-ratelimit-api-request-limit",
    "x-ratelimit-request-limit",
  ],
  remaining: [
    "x-ratelimit-requests-remaining",
    "x-ratelimit-remaining",
    "ratelimit-remaining",
    "x-ratelimit-api-request-remaining",
    "x-ratelimit-request-remaining",
  ],
  reset: [
    "x-ratelimit-reset",
    "ratelimit-reset",
    "x-ratelimit-requests-reset",
    "x-ratelimit-api-request-reset",
    "x-ratelimit-request-reset",
  ],
};

function getRateLimitHeader(headers: Headers, names: string[]): string | null {
  for (const name of names) {
    const value = headers.get(name);
    if (value !== null) {
      return value;
    }
  }

  return null;
}

function parseRateLimitHeader(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getRateLimitResetMessage(reset: string | null): string | undefined {
  if (reset === null) {
    return undefined;
  }

  const resetValue = parseRateLimitHeader(reset);
  if (resetValue === undefined || resetValue <= 0) {
    return undefined;
  }

  const currentUnixTime = Math.floor(Date.now() / 1000);
  const seconds = resetValue > currentUnixTime
    ? Math.max(0, Math.ceil(resetValue - currentUnixTime))
    : resetValue;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) {
    return `Resets in ${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `Resets in ${minutes}m`;
  }

  return `Resets in ${Math.ceil(seconds)}s`;
}

function formatRateLimitValue(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toFixed(1);
}
