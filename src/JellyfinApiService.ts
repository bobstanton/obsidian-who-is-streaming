import { requestUrl } from "obsidian";
import { isRecord } from "./frontmatterUtils";
import { JellyfinInstance } from "./settings";
import { TitleType } from "./titleId";

interface JellyfinItem {
  Name: string;
  Id: string;
  Type: string;
  ProductionYear?: number;
  RunTimeTicks?: number;
  ProviderIds?: {
    Tmdb?: string;
    Imdb?: string;
    Tvdb?: string;
  };
  UserData?: {
    Played?: boolean;
    LastPlayedDate?: string;
  };
}

export interface JellyfinEpisode {
  played: boolean;
  lastPlayed?: string;
  runtimeMinutes?: number;
}

export interface JellyfinAvailability {
  instanceName: string;
  available: boolean;
  itemId?: string;
  watched?: boolean;
  runtimeMinutes?: number;
  episodes?: JellyfinEpisode[];
  lastPlayed?: string;
}

export interface JellyfinLibraryItem {
  tmdbId: number;
  wrongTmdbId?: number;
  type: TitleType;
  name: string;
  year?: number;
  itemId: string;
  watched: boolean;
  runtimeMinutes?: number;
  episodes?: JellyfinEpisode[];
  lastPlayed?: string;
}

export type TmdbIdResolver = (ids: { type: TitleType; imdbId?: string; tvdbId?: string }) => Promise<number | undefined>;

const LIBRARY_CACHE_MS = 5 * 60 * 1000;

export default class JellyfinApiService {
  tmdbIdResolver?: TmdbIdResolver;

  private libraries = new Map<string, { items: JellyfinLibraryItem[]; readAt: number }>();

  private resolvedTmdbIds = new Map<string, number>();

  clearCache(): void {
    this.libraries.clear();
    this.resolvedTmdbIds.clear();
  }

  async listLibrary(instance: JellyfinInstance, fresh = false): Promise<JellyfinLibraryItem[]> {
    const baseUrl = instance.url.replace(/\/+$/, "");
    const cacheKey = `${baseUrl}|${instance.userId}`;
    const cached = this.libraries.get(cacheKey);

    if (cached && !fresh && Date.now() - cached.readAt < LIBRARY_CACHE_MS) return cached.items;

    const user = instance.userId ? `&userId=${encodeURIComponent(instance.userId)}` : "";
    const response = await requestUrl({
      url: `${baseUrl}/Items?Recursive=true&IncludeItemTypes=Movie,Series&Fields=ProviderIds${user}`,
      method: "GET",
      headers: { Authorization: `MediaBrowser Token="${instance.apiKey.trim()}"` },
    });

    const items: JellyfinLibraryItem[] = [];

    for (const item of parseItems(response.json)) {
      if (item.Type !== "Movie" && item.Type !== "Series") continue;

      const tmdbId = await this.getTmdbId(item);

      if (tmdbId === undefined) continue;

      const stored = Number.parseInt(item.ProviderIds?.Tmdb ?? "", 10);

      items.push({
        tmdbId,
        wrongTmdbId: stored !== tmdbId ? stored : undefined,
        type: item.Type === "Movie" ? "movie" : "series",
        name: item.Name,
        year: typeof item.ProductionYear === "number" ? item.ProductionYear : undefined,
        itemId: item.Id,
        watched: item.UserData?.Played === true,
        lastPlayed: typeof item.UserData?.LastPlayedDate === "string" ? item.UserData.LastPlayedDate : undefined,
        runtimeMinutes: toMinutes(item.RunTimeTicks),
      });
    }

    this.libraries.set(cacheKey, { items, readAt: Date.now() });

    return items;
  }

  async listEpisodes(instance: JellyfinInstance, seriesItemId: string): Promise<JellyfinEpisode[]> {
    if (!instance.userId) return [];
    const baseUrl = instance.url.replace(/\/+$/, "");
    const response = await requestUrl({
      url: `${baseUrl}/Items?ParentId=${encodeURIComponent(seriesItemId)}&Recursive=true&IncludeItemTypes=Episode&userId=${encodeURIComponent(instance.userId)}`,
      method: "GET",
      headers: { Authorization: `MediaBrowser Token="${instance.apiKey.trim()}"` },
    });

    return parseItems(response.json).map((episode) => ({
      played: episode.UserData?.Played === true,
      lastPlayed: typeof episode.UserData?.LastPlayedDate === "string" ? episode.UserData.LastPlayedDate : undefined,
      runtimeMinutes: toMinutes(episode.RunTimeTicks),
    }));
  }

  async withEpisodes(instance: JellyfinInstance, item: JellyfinLibraryItem): Promise<JellyfinLibraryItem> {
    if (item.type !== "series" || item.episodes) return item;

    return { ...item, episodes: await this.listEpisodes(instance, item.itemId) };
  }

  async checkAvailability(instances: JellyfinInstance[], tmdbId: number, type: TitleType): Promise<JellyfinAvailability[]> {
    return Promise.all(instances.map(async (instance) => {
      try {
        const library = await this.listLibrary(instance);
        const found = library.find((item) => item.type === type && item.tmdbId === tmdbId);

        return toAvailability(instance.name, found ? await this.withEpisodes(instance, found) : undefined);
      } catch (error: unknown) {
        console.error(`Jellyfin request to ${instance.name} failed:`, error);

        return toAvailability(instance.name, undefined);
      }
    }));
  }

  private async getTmdbId(item: JellyfinItem): Promise<number | undefined> {
    const stored = Number.parseInt(item.ProviderIds?.Tmdb ?? "", 10);

    if (!Number.isFinite(stored)) return undefined;

    const known = this.resolvedTmdbIds.get(item.Id);

    if (known !== undefined) return known;

    let tmdbId = stored;
    const doubtful = item.ProviderIds?.Tvdb !== undefined && item.ProviderIds.Tvdb === item.ProviderIds.Tmdb;

    if (doubtful && this.tmdbIdResolver) {
      try {
        tmdbId = await this.tmdbIdResolver({
          type: item.Type === "Movie" ? "movie" : "series",
          imdbId: item.ProviderIds?.Imdb,
          tvdbId: item.ProviderIds?.Tvdb,
        }) ?? stored;
      } catch (error: unknown) {
        console.debug(`Jellyfin: could not check the TMDB ID of ${item.Name}`, error);
      }
    }

    this.resolvedTmdbIds.set(item.Id, tmdbId);

    return tmdbId;
  }
}

export function toAvailability(instanceName: string, item: JellyfinLibraryItem | undefined): JellyfinAvailability {
  return {
    instanceName,
    available: item !== undefined,
    itemId: item?.itemId,
    watched: item?.watched,
    lastPlayed: item?.lastPlayed,
    runtimeMinutes: item?.runtimeMinutes,
    episodes: item?.episodes,
  };
}

function toMinutes(ticks: number | undefined): number | undefined {
  return typeof ticks === "number" && ticks > 0 ? Math.round(ticks / 600_000_000) : undefined;
}

function parseItems(response: unknown): JellyfinItem[] {
  const items: unknown = isRecord(response) ? response["Items"] : undefined;

  return Array.isArray(items) ? items.filter(isJellyfinItem) : [];
}

function isJellyfinItem(value: unknown): value is JellyfinItem {
  return isRecord(value)
    && typeof value["Name"] === "string"
    && typeof value["Id"] === "string"
    && typeof value["Type"] === "string";
}
