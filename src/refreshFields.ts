import { Show } from "streaming-availability";
import { decode } from "he";
import { WhoIsStreamingSettings } from "./settings";
import { JellyfinAvailability } from "./JellyfinApiService";
import { formatLastSynced } from "./lastSynced";
import { JELLYFIN_AVAILABILITY_FIELD, JELLYFIN_LINKS_FIELD, STREAMING_AVAILABILITY_FIELD, STREAMING_LINKS_FIELD, getFieldSource, getFieldsFrom } from "./fields";
import { LAST_SYNCED_PROPERTY, POSTER_PROPERTY, SERVICE_RATING_PROPERTY, TMDB_ID_PROPERTY, TYPE_PROPERTY, YEAR_PROPERTY } from "./properties";

interface StreamingService {
  service: { id: string };
  type: string;
  expiresOn?: number;
  addon?: { name?: string; id?: string };
  link?: string;
}

interface Genre {
  name: string;
}

export interface RefreshField {
  name: string;
  value: unknown;
  always?: boolean;
  enabledBy?: string;
}

export function getTmdbId(show: Show): string {
  return show.tmdbId.split('/').pop() || show.tmdbId;
}

function formatTemplateValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return "";
}

export function getEnabledFields(settings: WhoIsStreamingSettings): string[] {
  const enabledFields = new Set<string>([
    ...getFieldsFrom(settings, "streaming"),
    "Type",
    "tmdb_id",
  ]);

  for (const service of Object.values(settings.streamingServicesToSync)) {
    enabledFields.add(service.name);
  }

  for (const instance of settings.jellyfinInstances) {
    enabledFields.add(instance.name);
  }

  return Array.from(enabledFields);
}

export function isRefreshFieldEnabled(settings: WhoIsStreamingSettings, fieldName: string, enabledFields?: string[]): boolean {
  if (enabledFields) {
    return enabledFields.includes(fieldName);
  }

  return getEnabledFields(settings).includes(fieldName);
}

export function buildRefreshFields(settings: WhoIsStreamingSettings, show: Show, jellyfinAvailability: JellyfinAvailability[] = []): RefreshField[] {
  const tmdbId = getTmdbId(show);
  const fields: RefreshField[] = [
    { name: TMDB_ID_PROPERTY, value: parseInt(tmdbId), always: true },
    { name: TYPE_PROPERTY, value: show.showType, always: true },
    { name: YEAR_PROPERTY, value: show.releaseYear || show.firstAirYear },
    { name: "Directors", value: show.directors },
    { name: "Cast", value: show.cast },
    { name: "Overview", value: typeof show.overview === "string" ? decode(show.overview) : undefined },
    { name: "Genres", value: show.genres?.map((genre: Genre) => genre.name) },
  ];

  if (show.runtime) {
    fields.push({ name: "Runtime", value: `${show.runtime} min` });
  }

  if (show.rating) {
    fields.push({ name: SERVICE_RATING_PROPERTY, value: show.rating });
  }

  if (show.seasonCount) {
    fields.push({ name: "Seasons", value: show.seasonCount });
  }

  if (show.episodeCount) {
    fields.push({ name: "Episodes", value: show.episodeCount });
  }

  if (show.imageSet?.verticalPoster?.w480 && settings.posterMode !== "none") {
    const posterValue = settings.posterMode === "local"
      ? `![[${settings.posterFolder}/${tmdbId}.jpg]]`
      : show.imageSet.verticalPoster.w480;

    fields.push({
      name: POSTER_PROPERTY,
      value: posterValue,
    });
  }

  fields.push(...buildStreamingServiceFields(settings, show), ...buildJellyfinFields(settings, jellyfinAvailability));

  fields.push({ name: LAST_SYNCED_PROPERTY, value: formatLastSynced(new Date()), always: true });

  return fields.filter((field) => field.value !== null && field.value !== undefined && field.value !== "");
}

function buildStreamingServiceFields(settings: WhoIsStreamingSettings, show: Show): RefreshField[] {
  const showsStreamingServices = (show.streamingOptions[settings.country] || []).filter((service: StreamingService) => {
    return !service.addon?.id?.startsWith("tvs.sbd")
      && (service.type === "subscription" || service.type === "addon");
  });

  if (getFieldSource(settings, STREAMING_AVAILABILITY_FIELD) !== "streaming") return [];
  const withLinks = getFieldSource(settings, STREAMING_LINKS_FIELD) === "streaming";

  return Object.values(settings.streamingServicesToSync).flatMap((streamingServiceToSync) => {
    const streamingServiceName = formatTemplateValue(streamingServiceToSync.name);
    if (streamingServiceName.length === 0) {
      return [];
    }

    const matchedService = showsStreamingServices.find(
      (showsService) => showsService.service.id === streamingServiceToSync.id
    );
    const fields: RefreshField[] = [{
      name: streamingServiceName,
      value: describeStreamingService(matchedService),
    }];

    const streamingLink = formatTemplateValue(matchedService?.link);
    if (withLinks && streamingLink.length > 0) {
      fields.push({
        name: `${streamingServiceName} link`,
        value: streamingLink,
        enabledBy: streamingServiceName,
      });
    }

    return fields;
  });
}

function describeStreamingService(service: StreamingService | undefined): string {
  if (!service) {
    return "Not available";
  }

  if (service.type === "subscription") {
    return service.expiresOn
      ? `Available until ${new Date(service.expiresOn * 1000).toLocaleDateString()}`
      : "Available";
  }

  if (service.type === "addon") {
    return service.addon?.name ? `Available with ${service.addon.name}` : "Available with addon";
  }

  return "Not available";
}

export function buildJellyfinFields(settings: WhoIsStreamingSettings, jellyfinAvailability: JellyfinAvailability[]): RefreshField[] {
  if (getFieldSource(settings, JELLYFIN_AVAILABILITY_FIELD) !== "jellyfin") return [];
  const withLinks = getFieldSource(settings, JELLYFIN_LINKS_FIELD) === "jellyfin";

  return jellyfinAvailability.flatMap((availability) => {
    const instanceName = formatTemplateValue(availability.instanceName);
    if (instanceName.length === 0) {
      return [];
    }

    const fields: RefreshField[] = [{
      name: instanceName,
      value: availability.available ? "Available" : "Not available",
    }];

    if (withLinks && availability.available && availability.itemId) {
      const itemId = formatTemplateValue(availability.itemId);
      const instance = settings.jellyfinInstances.find((item) => item.name === instanceName);
      if (instance) {
        const baseUrl = instance.url.replace(/\/+$/, '');
        fields.push({
          name: `${instanceName} link`,
          value: `${baseUrl}/web/index.html#!/details?id=${itemId}`,
          enabledBy: instanceName,
        });
      }
    }

    return fields;
  });
}
