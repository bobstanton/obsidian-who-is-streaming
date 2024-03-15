import * as streamingAvailability from "streaming-availability";
import { WhoIsStreamingSettings } from "./main"; // Import the WhoIsStreamingSettings type
import { Notice } from "obsidian";

//This data is returned in raw response, now sure why it isn't included in streamingAvailability.Show
export interface ShowWithExtraDetails extends streamingAvailability.Show {
  cast: Array<string>;
  overview: string;
}

export default class StreamingAvailabilityApiService {
  settings: WhoIsStreamingSettings;
  apiClient: streamingAvailability.DefaultApi;
  apiShowCache: Map<string, ShowWithExtraDetails | undefined>; //cache for single show
  apiSearchCache: Map<string, Array<ShowWithExtraDetails>>; //cache for searches

  constructor(settings: WhoIsStreamingSettings) {
    this.settings = settings;

    this.apiClient = new streamingAvailability.DefaultApi(
      new streamingAvailability.Configuration({ apiKey: this.settings.apiKey })
    ).withMiddleware(new ThrottleMiddleware());

    this.apiShowCache = new Map<string, ShowWithExtraDetails | undefined>();
    this.apiSearchCache = new Map<string, Array<ShowWithExtraDetails>>();
  }

  async getCountries(): Promise<{ [key: string]: streamingAvailability.Country }> {
    if (Object.keys(this.settings.countriesCache).length !== 0 && this.getDaysDifference(new Date(this.settings.countriesCacheAsOf), new Date(Date.now())) < 7) {
      return this.settings.countriesCache;
    }

    if (!this.validateApiKey()) {
      return {};
    }

    try {
      const response = await this.apiClient.countries();

      this.settings.countriesCache = response.result;
      this.settings.countriesCacheAsOf = new Date(Date.now());

      return response.result;
    } catch (error) {
      if (!this.handleApiError(error)) {
        console.error(error);
      }

      return {};
    }
  }

  async getShowByTmdbId(showType: string, tmdb_id: number): Promise<ShowWithExtraDetails | undefined> {
    const cacheKey = `getShowByTmdbId:${showType}/${tmdb_id}`;
    const cachedResponse = this.apiShowCache.get(cacheKey);
    if (cachedResponse) return cachedResponse;
    
    try {
      const response = await this.apiClient.getByIdRaw({
        tmdbId: `${showType === "movie" ? "movie" : "tv"}/${tmdb_id}`,
        seriesGranularity: "show",
      });

      const show = (await response.raw.json()).result as ShowWithExtraDetails;
      this.apiShowCache.set(cacheKey, show);
      return show;
    } catch (error) {
      if (!this.handleApiError(error)) {
        console.error(error);
      }

      return undefined;
    }
  }

  async searchForShowsByTitle(searchTerm: string): Promise<Array<ShowWithExtraDetails>> {
    if (!this.validateApiKey()) {
      return [];
    }

    const cacheKey = `searchForShowsByTitle:${searchTerm}`;
    const cachedResponse = this.apiSearchCache.get(cacheKey);
    if (cachedResponse) return cachedResponse;
    
    try {
      const response = await this.apiClient.searchByTitleRaw({
        country: this.settings.country,
        title: searchTerm,
      });
      var results = (await response.raw.json()).result as Array<ShowWithExtraDetails>;
      this.apiSearchCache.set(cacheKey, results);

      return results;
    } catch (error) {
      if (!this.handleApiError(error)) {
        console.error(error);
      }

      return [];
    }
  }

  /**
   * Handles API errors and displays appropriate error messages.
   * @param error - The error object.
   * @returns Returns `true` if the error was handled, `false` otherwise.
   */
  handleApiError(error: any): boolean {
    if ("response" in error) {
      //error instanceof streamingAvailability.ResponseError
      if (error.response.status === 429) {
        new Notice("Number of API requests exceeded. Upgrade your plan or wait for the limit to reset.");
        return true;
      } else if (error.response.status !== 200) {
        console.log(error);
        console.log(error.response);
        new Notice("There was an error fetching the show. Check the console for more details.");
        return true;
      }
    }

    return false;
  }

  validateApiKey(): boolean {
    if (this.settings.apiKey?.length !== 50) {
      new Notice("No API key or API key is in correct format.");
      return false;
    }

    return true;
  }

  getDaysDifference(date1: Date, date2: Date): number {
    const timeDifference = date2.getTime() - date1.getTime();
    const daysDifference = Math.floor(timeDifference / (1000 * 3600 * 24));
    return daysDifference;
  }

}

class ThrottleMiddleware implements streamingAvailability.Middleware {
  previousApiCallTime = Date.now();

  async pre(
    context: streamingAvailability.RequestContext
  ): Promise<streamingAvailability.FetchParams | void> {
    const delay = 1000 / 10; // 10 requests per second
    const timeSinceLastCall = Date.now() - this.previousApiCallTime;
    if (timeSinceLastCall < delay) {
      await new Promise((resolve) =>
        setTimeout(resolve, delay - timeSinceLastCall)
      );
    }
    this.previousApiCallTime = Date.now();
  }
}

/*
    let cache = new Map<string, any>();    
    const cacheMiddleware: streamingAvailability.Middleware = {
      async pre(context: streamingAvailability.RequestContext): Promise<streamingAvailability.FetchParams | void> {
        console.log("requestContext");

        console.log(context);
        const cacheKey = context.url;
        const cachedResponse = cache.get(cacheKey);
        if (cachedResponse) {
          console.log("cachedResponse");
          console.log(cachedResponse);
          return Promise.resolve(cachedResponse);
        }
      },
      async post(context: streamingAvailability.ResponseContext): Promise<Response | void> {
        console.log(context);
        if (context.response.status !== 200 || context.init.method !== 'GET')
          return;

        const cacheKey = context.url;
        cache.set(cacheKey, context);
      },
    };
        */
