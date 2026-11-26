import { Notice, requestUrl } from "obsidian";
import { WhoIsStreamingSettings } from "./settings";
import { TitleType } from "./titleId";
import { MAX_YEAR_DIFFERENCE, TmdbDetails, TmdbSearchResult, parseDetails, parseFoundId, parseSearchResults, pickMovie } from "./tmdb";

const API_URL = "https://api.themoviedb.org/3";
const MAX_RETRIES = 3;

export default class TmdbApiService {
  private cache = new Map<string, unknown>();
  private warnedAboutKey = false;

  constructor(private settings: WhoIsStreamingSettings) {}

  isConfigured(): boolean {
    return this.settings.tmdbApiKey.trim().length > 0;
  }

  async findByExternalId(type: TitleType, ids: { imdbId?: string; tvdbId?: string }): Promise<number | undefined> {
    const sources: [string | undefined, string][] = [[ids.imdbId, "imdb_id"], [ids.tvdbId, "tvdb_id"]];

    for (const [externalId, source] of sources) {
      if (!externalId) continue;
      const response = await this.get(`/find/${encodeURIComponent(externalId)}`, { external_source: source });
      const found = parseFoundId(type, response);

      if (found !== undefined) return found;
    }

    return undefined;
  }

  async searchMovies(title: string, year?: number): Promise<TmdbSearchResult[]> {
    const params: Record<string, string> = { query: title, include_adult: "false" };

    if (year !== undefined) params["year"] = String(year);

    return parseSearchResults(await this.get("/search/movie", params));
  }

  async findMovieId(title: string, year?: number): Promise<number | undefined> {
    if (year !== undefined) {
      const id = pickMovie(await this.searchMovies(title, year), title, year, 1);

      if (id !== undefined) return id;
    }

    return pickMovie(await this.searchMovies(title), title, year, MAX_YEAR_DIFFERENCE);
  }

  async getDetails(type: TitleType, id: number): Promise<TmdbDetails | undefined> {
    return parseDetails(type, id, await this.get(`/${type === "movie" ? "movie" : "tv"}/${id}`, { append_to_response: "credits" }));
  }

  private async get(path: string, params: Record<string, string>): Promise<unknown> {
    const key = this.settings.tmdbApiKey.trim();

    if (key.length === 0) return undefined;

    const query = new URLSearchParams(params);
    const cacheKey = `${path}?${query.toString()}`;

    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey);

    const isToken = key.includes(".");
    const headers: Record<string, string> = { Accept: "application/json" };

    if (isToken) headers["Authorization"] = `Bearer ${key}`;
    else query.set("api_key", key);

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      let status: number;
      let body: unknown;
      let retryAfter: string | undefined;

      try {
        const response = await requestUrl({ url: `${API_URL}${path}?${query.toString()}`, headers, throw: false });

        status = response.status;
        retryAfter = response.headers["retry-after"] ?? response.headers["Retry-After"];
        body = status === 200 ? response.json : undefined;
      } catch (error: unknown) {
        console.debug("Who Is Streaming: TMDB request failed", error);

        return undefined;
      }

      if (status === 200) {
        this.cache.set(cacheKey, body);

        return body;
      }

      if (status === 429) {
        const seconds = Number.parseInt(retryAfter ?? "", 10);

        await wait((Number.isFinite(seconds) ? seconds : 2) * 1000);
        continue;
      }

      if (status === 401 && !this.warnedAboutKey) {
        this.warnedAboutKey = true;
        new Notice("TMDB rejected the API key. Check it in settings.", 10000);
      }

      return undefined;
    }

    return undefined;
  }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
