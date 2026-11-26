import { BasesAllOptions, BasesViewConfig, getLanguage } from "obsidian";
import { ShowType } from "streaming-availability";
import { BrowseFilters } from "./StreamingAvailabilityApiService";
import { WhoIsStreamingSettings } from "./settings";
import { getTileViewOptions } from "./titleTiles";

export type ListKind = "top" | "new" | "upcoming" | "leaving" | "browse";

const LISTS: Record<ListKind, string> = {
  top: "Top on a service",
  new: "New",
  upcoming: "Coming soon",
  leaving: "Leaving soon",
  browse: "Browse",
};

export const TOP_LIST_SERVICE_IDS = ["netflix", "prime", "disney", "apple", "hbo"];

const ORDER_OPTIONS: Record<BrowseFilters["orderBy"], string> = {
  popularity_1week: "Popular this week",
  popularity_1month: "Popular this month",
  popularity_1year: "Popular this year",
  popularity_alltime: "Popular of all time",
  rating: "Highest Streaming Availability rating",
  release_date: "Newest releases",
  original_title: "Title",
};

const LANGUAGE_CODES = ["eng", "spa", "fra", "deu", "ita", "por", "jpn", "kor", "zho", "hin", "tur", "rus", "swe", "dan", "nor"];

function getLanguageOptions(): Record<string, string> {
  let names: Intl.DisplayNames | undefined;

  try {
    names = new Intl.DisplayNames([getLanguage(), "en"], { type: "language" });
  } catch {
    names = undefined;
  }

  const languages = LANGUAGE_CODES
    .map((code) => [code, names?.of(code) ?? code] as const)
    .sort((a, b) => a[1].localeCompare(b[1]));

  return { any: "Any", ...Object.fromEntries(languages) };
}

function getTopListServices(settings: WhoIsStreamingSettings): Record<string, string> {
  const enabled = Object.values(settings.streamingServicesToSync).filter((service) => TOP_LIST_SERVICE_IDS.includes(service.id));

  if (enabled.length > 0) return Object.fromEntries(enabled.map((service) => [service.id, service.name]));
  const known = settings.countriesCache[settings.country]?.services ?? [];

  return Object.fromEntries(TOP_LIST_SERVICE_IDS.map((id) => [id, known.find((service) => service.id === id)?.name ?? id]));
}

function getKnownGenres(settings: WhoIsStreamingSettings): { id: string; name: string }[] {
  return settings.genresCache ?? [];
}

function serviceOptionKey(id: string): string {
  return `service_${id}`;
}

function genreOptionKey(id: string): string {
  return `genre_${id}`;
}

export interface DiscoverParams {
  list: ListKind;
  service: string;
  services: string[];
  showType: ShowType | undefined;
  keyword: string;
  genres: string[];
  genresRelation: "and" | "or";
  language: string;
  ratingMin: number;
  yearMin: number | undefined;
  yearMax: number | undefined;
  orderBy: BrowseFilters["orderBy"];
}

export function getDiscoverViewOptions(config: BasesViewConfig, settings: WhoIsStreamingSettings): BasesAllOptions[] {
  const list = () => readList(config.get("list"));
  const notBrowse = () => list() !== "browse";

  const topServices = getTopListServices(settings);
  const genres = getKnownGenres(settings);
  const noGenres = () => notBrowse() || genres.length === 0;

  return [
    {
      displayName: "List",
      type: "dropdown",
      key: "list",
      options: LISTS,
      default: "top",
    },
    {
      displayName: "Service",
      type: "dropdown",
      key: "service",
      options: topServices,
      default: Object.keys(topServices)[0],
      shouldHide: () => list() !== "top",
    },
    {
      displayName: "Services",
      type: "group",
      items: Object.values(settings.streamingServicesToSync).map((service) => ({
        displayName: service.name,
        type: "toggle",
        key: serviceOptionKey(service.id),
        default: true,
      })),
      shouldHide: () => list() === "top",
    },
    {
      displayName: "Type",
      type: "dropdown",
      key: "showType",
      options: { any: "Movies and series", movie: "Movies", series: "Series" },
      default: "any",
    },
    {
      displayName: "Keyword",
      type: "text",
      key: "keyword",
      default: "",
      placeholder: "Any",
      shouldHide: notBrowse,
    },
    {
      displayName: "Genres",
      type: "group",
      items: genres.map((genre) => ({
        displayName: genre.name,
        type: "toggle",
        key: genreOptionKey(genre.id),
        default: false,
      })),
      shouldHide: noGenres,
    },
    {
      displayName: "Genre matching",
      type: "dropdown",
      key: "genresRelation",
      options: { and: "All of the genres", or: "Any of the genres" },
      default: "and",
      shouldHide: noGenres,
    },
    {
      displayName: "Original language",
      type: "dropdown",
      key: "language",
      options: getLanguageOptions(),
      default: "any",
      shouldHide: notBrowse,
    },
    {
      displayName: "Minimum Streaming Availability rating",
      type: "slider",
      key: "ratingMin",
      min: 0,
      max: 95,
      step: 5,
      default: 0,
      shouldHide: notBrowse,
    },
    {
      displayName: "From year",
      type: "text",
      key: "yearMin",
      default: "",
      placeholder: "Any",
      shouldHide: notBrowse,
    },
    {
      displayName: "To year",
      type: "text",
      key: "yearMax",
      default: "",
      placeholder: "Any",
      shouldHide: notBrowse,
    },
    {
      displayName: "Sort by",
      type: "dropdown",
      key: "orderBy",
      options: ORDER_OPTIONS,
      default: "popularity_1year",
      shouldHide: notBrowse,
    },
    {
      displayName: "Hide titles in vault",
      type: "toggle",
      key: "hideInVault",
      default: false,
    },
    ...getTileViewOptions(config, "poster"),
  ];
}

export function readDiscoverParams(config: BasesViewConfig, settings: WhoIsStreamingSettings): DiscoverParams {
  const text = (key: string): string => {
    const value = config.get(key);

    return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  };
  const year = (key: string): number | undefined => {
    const value = Number.parseInt(text(key), 10);

    return value >= 1880 && value <= 2200 ? value : undefined;
  };

  const showType = text("showType");
  const orderBy = text("orderBy");
  const rating = config.get("ratingMin");
  const language = text("language");

  return {
    list: readList(config.get("list")),
    service: text("service"),
    services: Object.values(settings.streamingServicesToSync)
      .filter((service) => config.get(serviceOptionKey(service.id)) !== false)
      .map((service) => service.id),
    showType: showType === "movie" || showType === "series" ? showType : undefined,
    keyword: text("keyword"),
    genres: getKnownGenres(settings)
      .filter((genre) => config.get(genreOptionKey(genre.id)) === true)
      .map((genre) => genre.id),
    genresRelation: text("genresRelation") === "or" ? "or" : "and",
    language: language === "any" ? "" : language,
    ratingMin: typeof rating === "number" ? rating : 0,
    yearMin: year("yearMin"),
    yearMax: year("yearMax"),
    orderBy: orderBy in ORDER_OPTIONS ? orderBy as BrowseFilters["orderBy"] : "popularity_1year",
  };
}

function readList(value: unknown): ListKind {
  return typeof value === "string" && value in LISTS ? value as ListKind : "top";
}
