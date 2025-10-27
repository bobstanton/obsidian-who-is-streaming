import { Client, Configuration, Show, Country } from "streaming-availability";
import { WhoIsStreamingSettings } from "./settings";
import { Notice } from "obsidian";

export default class StreamingAvailabilityApiService {
  settings: WhoIsStreamingSettings;
  apiClient: Client;
  apiShowCache: Map<string, Show | undefined>;
  apiSearchCache: Map<string, Array<Show>>;

  constructor(settings: WhoIsStreamingSettings) {
    this.settings = settings;

    this.apiClient = new Client(new Configuration({
        apiKey: this.settings.apiKey,
    }));

    this.apiShowCache = new Map<string, Show | undefined>();
    this.apiSearchCache = new Map<string, Array<Show>>();
  }

  async getCountries(): Promise<{ [key: string]: Country }> {
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

  async getShowByTmdbId(showType: string, tmdb_id: number, showNotice: boolean = true): Promise<Show | undefined> {
    const cacheKey = `getShowByTmdbId:${showType}/${tmdb_id}`;
    const cachedResponse = this.apiShowCache.get(cacheKey);
    if (cachedResponse) return cachedResponse;

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

  async searchForShowsByTitle(searchTerm: string): Promise<Array<Show>> {
    if (!this.validateApiKey()) {
      return [];
    }

    const cacheKey = `searchForShowsByTitle:${searchTerm}`;
    const cachedResponse = this.apiSearchCache.get(cacheKey);
    if (cachedResponse) return cachedResponse;

    try {
      const apiResponse = await this.apiClient.showsApi.searchShowsByTitleRaw({
        country: this.settings.country,
        title: searchTerm,
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

  async handleApiError(error: unknown, showNotice: boolean = true): Promise<string | undefined> {
    if ("response" in error) {
      if (error.response.status === 429) {
        let message = "API rate limit exceeded.";

        try {
          if (error.response.body && typeof error.response.clone === 'function') {
            const clonedResponse = error.response.clone();
            const data = await clonedResponse.json();
            if (data?.message) {
              message = data.message;
            }
          }
        } catch (e: unknown) {
          // Failed to parse error response - use default message
        }

        if (showNotice) {
          new Notice(message, 10000);
        }
        return message;
      } else {
        let message = "Unable to fetch show information from the streaming API.";

        try {
          if (error.response.body && typeof error.response.clone === 'function') {
            const clonedResponse = error.response.clone();
            const data = await clonedResponse.json();
            if (data?.message) {
              message = data.message;
            }
          }
        } catch (e: unknown) {
          if (error.response.status === 404) {
            message = "Show not found in the streaming database.";
          } else if (error.response.status >= 500) {
            message = "Streaming API server error. Please try again later.";
          }
        }

        if (showNotice) {
          new Notice(message);
        }
        return message;
      }
    }

    return undefined;
  }

  validateApiKey(): boolean {
    if (this.settings.apiKey?.length !== 50) {
      new Notice("No API key or API key is in incorrect format");
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

    const limit = headers.get("x-ratelimit-api-request-limit");
    const remaining = headers.get("x-ratelimit-api-request-remaining");
    const resetSeconds = headers.get("x-ratelimit-api-request-reset");

    if (!limit || remaining === null) {
      return;
    }

    const limitNum = parseInt(limit);
    const remainingNum = parseInt(remaining);
    const percentageUsed = ((limitNum - remainingNum) / limitNum) * 100;
    const percentageRemaining = (remainingNum / limitNum) * 100;

    if (percentageUsed >= this.settings.rateLimitWarningThreshold && remainingNum > 0) {
      let message = `⚠️ API Rate Limit Warning: ${remainingNum}/${limitNum} requests remaining (${percentageUsed.toFixed(0)}% used)`;

      if (resetSeconds) {
        const seconds = parseInt(resetSeconds);
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);

        if (hours > 0) {
          message += `. Resets in ${hours}h ${minutes}m`;
        } else if (minutes > 0) {
          message += `. Resets in ${minutes}m`;
        } else {
          message += `. Resets in ${seconds}s`;
        }
      }

      message += ".";
      new Notice(message, 8000);
    }
  }
}
