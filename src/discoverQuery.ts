import { Show } from "streaming-availability";
import StreamingAvailabilityApiService from "./StreamingAvailabilityApiService";
import { toDayString } from "./watchHistory";
import { DiscoverParams, TOP_LIST_SERVICE_IDS } from "./discoverOptions";

export interface DiscoverItem {
  show: Show;
  detail: string;
}

export interface DiscoverResults {
  items: DiscoverItem[];
  nextCursor?: string;
  message: string;
  warning: string;
}

export interface DiscoverSource {
  api: StreamingAvailabilityApiService;
  getGenres: () => Promise<{ id: string }[]>;
  hasEnabledServices: boolean;
}

export async function fetchDiscoverResults(source: DiscoverSource, params: DiscoverParams, cursor?: string): Promise<DiscoverResults> {
  const { api, hasEnabledServices } = source;
  let items: DiscoverItem[] = [];
  let nextCursor: string | undefined;
  let message = "";
  let warning = "";

  if (params.list !== "top" && hasEnabledServices && params.services.length === 0) {
    message = "Every service is switched off in this view's options. Turn at least one on.";
  } else if (params.list === "top") {
    const service = params.service || TOP_LIST_SERVICE_IDS[0];
    const shows = await api.getTopShows(service, params.showType);

    items = (shows ?? []).map((show, index) => ({ show, detail: `#${index + 1}` }));

    if (items.length === 0) {
      message = "No top list came back. Only Netflix, Prime Video, Disney+, Apple TV and Max publish one.";
    }
  } else if (params.list === "browse") {
    const { ids, unknown } = resolveGenres(params.genres, await source.getGenres());

    if (unknown.length > 0) {
      warning = `Ignored ${unknown.length === 1 ? "a genre" : "genres"} the API no longer lists: ${unknown.join(", ")}.`;
    }

    const page = await api.browseShows({
      showType: params.showType,
      genres: ids.length > 0 ? ids : undefined,
      genresRelation: params.genresRelation,
      keyword: params.keyword || undefined,
      showOriginalLanguage: params.language || undefined,
      ratingMin: params.ratingMin > 0 ? params.ratingMin : undefined,
      yearMin: params.yearMin,
      yearMax: params.yearMax,
      services: hasEnabledServices ? params.services : undefined,
      orderBy: params.orderBy,
      cursor,
    });

    items = (page?.shows ?? []).map((show) => ({ show, detail: "" }));
    nextCursor = page?.hasMore ? page.nextCursor : undefined;
  } else {
    const list = params.list;
    const changeType = list === "new" ? "new" : list === "upcoming" ? "upcoming" : "expiring";
    const lookup = await api.getChanges(changeType, {
      showType: params.showType,
      services: hasEnabledServices ? params.services : undefined,
    });

    items = (lookup?.items ?? []).map((item) => {
      const day = item.timestamp !== undefined ? toDayString(new Date(item.timestamp * 1000)) : undefined;
      const detail = list === "new"
        ? `New on ${item.serviceName}${day ? ` · ${day}` : ""}`
        : list === "upcoming"
          ? `Coming to ${item.serviceName} · ${day ?? "soon"}`
          : `Leaving ${item.serviceName} · ${day ?? "soon"}`;

      return { show: item.show, detail };
    });

    if (items.length === 0 && list === "upcoming") {
      message = "Nothing announced. Only Apple TV, Disney+, Max, Netflix and Prime Video publish what's coming.";
    }
  }

  return { items, nextCursor, message, warning };
}

export function resolveGenres(selected: string[], live: { id: string }[]): { ids: string[]; unknown: string[] } {
  if (selected.length === 0 || live.length === 0) return { ids: selected, unknown: [] };

  const liveIds = new Set(live.map((genre) => genre.id));

  return {
    ids: selected.filter((id) => liveIds.has(id)),
    unknown: selected.filter((id) => !liveIds.has(id)),
  };
}
