import { Client, Configuration, Show } from "streaming-availability";
import { StreamingCountrySetting, WhoIsStreamingSettings } from "./settings";
import { Notice, requestUrl } from "obsidian";

export default class StreamingAvailabilityApiService {
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

  async searchForShowsByTitle(searchTerm: string): Promise<Array<Show>> {
    if (!this.validateApiKey()) {
      return [];
    }

    const cacheKey = `searchForShowsByTitle|${searchTerm}`;
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
      return "Show not found in the streaming database.";
    }

    if (status >= 500) {
      return "Streaming API server error. Please try again later.";
    }

    return `Streaming API request failed with HTTP ${status}.`;
  }

  validateApiKey(): boolean {
    const apiKey = this.settings.apiKey?.trim();
    if (!apiKey || (!apiKey.startsWith("motn-key-") && apiKey.length !== 50)) {
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

async function obsidianFetch(url: string, init: RequestInit): Promise<Response> {
  const response = await requestUrl({
    url,
    method: init.method,
    headers: normalizeRequestHeaders(init.headers),
    body: await normalizeRequestBody(init.body),
    throw: false,
  });

  return new Response(response.arrayBuffer, {
    status: response.status,
    headers: response.headers,
  });
}

function normalizeRequestHeaders(headers: HeadersInit | undefined): Record<string, string> {
  const normalizedHeaders: Record<string, string> = {};
  if (!headers) {
    return normalizedHeaders;
  }

  if (headers instanceof Headers) {
    headers.forEach((value, key) => {
      normalizedHeaders[key] = value;
    });
    return normalizedHeaders;
  }

  if (Array.isArray(headers)) {
    headers.forEach(([key, value]) => {
      normalizedHeaders[key] = value;
    });
    return normalizedHeaders;
  }

  Object.entries(headers).forEach(([key, value]) => {
    if (value !== undefined) {
      normalizedHeaders[key] = String(value);
    }
  });

  return normalizedHeaders;
}

async function normalizeRequestBody(body: BodyInit | null | undefined): Promise<string | ArrayBuffer | undefined> {
  if (body === null || body === undefined) {
    return undefined;
  }

  if (typeof body === "string" || body instanceof ArrayBuffer) {
    return body;
  }

  if (ArrayBuffer.isView(body)) {
    return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
  }

  if (body instanceof URLSearchParams) {
    return body.toString();
  }

  if (body instanceof Blob) {
    return body.arrayBuffer();
  }

  throw new Error("Unsupported Streaming Availability request body type.");
}
