import { requestUrl } from "obsidian";
import { JellyfinInstance } from "./settings";

export interface JellyfinItem {
  Name: string;
  Id: string;
  Type: string;
  ProviderIds?: {
    Tmdb?: string;
  };
  UserData?: {
    Played?: boolean;
    PlayCount?: number;
    IsFavorite?: boolean;
  };
}

export interface JellyfinAvailability {
  instanceName: string;
  available: boolean;
  itemId?: string;
  watched?: boolean;
}

interface CacheEntry {
  items: JellyfinItem[];
  timestamp: number;
}

export default class JellyfinApiService {
  private cache: Map<string, CacheEntry> = new Map();
  private cacheExpiryMs: number = 5 * 60 * 1000; 

  private getCacheKey(instanceUrl: string, itemType: string): string {
    return `${instanceUrl}:${itemType}`;
  }

  private getCachedItems(instanceUrl: string, itemType: string): JellyfinItem[] | null {
    const key = this.getCacheKey(instanceUrl, itemType);
    const cached = this.cache.get(key);

    if (!cached) {
      return null;
    }

    const now = Date.now();
    if (now - cached.timestamp > this.cacheExpiryMs) {
      this.cache.delete(key);
      return null;
    }

    return cached.items;
  }

  private setCachedItems(instanceUrl: string, itemType: string, items: JellyfinItem[]): void {
    const key = this.getCacheKey(instanceUrl, itemType);
    this.cache.set(key, {
      items,
      timestamp: Date.now()
    });
  }

  public clearCache(): void {
    this.cache.clear();
  }

  async isAvailableInJellyfin(instance: JellyfinInstance, tmdbId: number, showType: "movie" | "series"): Promise<{ available: boolean; itemId?: string; watched?: boolean }> {
    try {
      const baseUrl = instance.url.replace(/\/+$/, '');
      const itemType = showType === "movie" ? "Movie" : "Series";

      let allItems = this.getCachedItems(baseUrl, itemType);

      if (!allItems) {
        const searchUrl = `${baseUrl}/Items?Recursive=true&IncludeItemTypes=${itemType}&Fields=ProviderIds`;

        const searchResponse = await requestUrl({
          url: searchUrl,
          method: "GET",
          headers: {
            "X-Emby-Token": instance.apiKey,
          },
        });

        if (searchResponse.status !== 200 || !searchResponse.json) {
          return { available: false };
        }

        const searchData = searchResponse.json;
        allItems = searchData.Items || [];

        this.setCachedItems(baseUrl, itemType, allItems);
      }

      const matchingItems = allItems.filter((item: JellyfinItem) => {
        const itemTmdbId = item.ProviderIds?.Tmdb;
        return itemTmdbId && itemTmdbId === tmdbId.toString();
      });

      if (matchingItems.length === 0) {
        return { available: false };
      }

      const jellyfinItemId = matchingItems[0].Id;

      if (instance.userId) {
        const userItemUrl = `${baseUrl}/Users/${instance.userId}/Items/${jellyfinItemId}`;

        const userItemResponse = await requestUrl({
          url: userItemUrl,
          method: "GET",
          headers: {
            "X-Emby-Token": instance.apiKey,
          },
        });

        if (userItemResponse.status === 200 && userItemResponse.json) {
          const userItem = userItemResponse.json;
          const watched = userItem.UserData?.Played || false;

          return { available: true, itemId: jellyfinItemId, watched };
        }
      }

      return { available: true, itemId: jellyfinItemId, watched: false };

    } catch (error) {
      return { available: false };
    }
  }

  async checkAvailability(instances: JellyfinInstance[], tmdbId: number, showType: "movie" | "series"): Promise<JellyfinAvailability[]> {
    const results = await Promise.all(
      instances.map(async (instance) => {
        const result = await this.isAvailableInJellyfin(instance, tmdbId, showType);
        return {
          instanceName: instance.name,
          available: result.available,
          itemId: result.itemId,
          watched: result.watched
        };
      })
    );

    return results;
  }

}
