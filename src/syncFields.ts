import { Show } from "streaming-availability";
import { decode } from "he";
import { WhoIsStreamingSettings } from "./settings";
import { JellyfinAvailability } from "./JellyfinApiService";

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

export interface SyncField {
  name: string;
  value: unknown;
  previewValue?: string;
  isPoster?: boolean;
  posterUrl?: string;
  alwaysSync?: boolean;
  enabledBy?: string;
  showInPreview?: boolean;
}

export function getTmdbId(show: Show): string {
  return show.tmdbId.split('/').pop() || show.tmdbId;
}

export function applyShowTemplate(template: string, show: Show): string {
  return template
    .replace("${title}", show.title)
    .replace("${year}", formatTemplateValue(show.releaseYear || show.firstAirYear))
    .replace("${firstAirYear}", formatTemplateValue(show.firstAirYear))
    .replace("${lastAirYear}", formatTemplateValue(show.lastAirYear))
    .replace("${tmdb_id}", formatTemplateValue(show.tmdbId))
    .replace("${rating}", formatTemplateValue(show.rating))
    .replace("${runtime}", formatTemplateValue(show.runtime))
    .replace(/[/\\?%*:|"<>]/g, "-");
}

function formatTemplateValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return "";
}

export function getEnabledSyncFields(settings: WhoIsStreamingSettings, overrides: Map<string, boolean> = new Map()): string[] {
  const enabledFields = new Set<string>([
    ...settings.defaultEnabledFields,
    "Type",
    "tmdb_id",
  ]);

  Object.values(settings.streamingServicesToSync).forEach((service) => {
    enabledFields.add(service.name);
  });

  settings.jellyfinInstances.forEach((instance) => {
    enabledFields.add(instance.name);
  });

  overrides.forEach((enabled, field) => {
    if (enabled) {
      enabledFields.add(field);
    } else {
      enabledFields.delete(field);
    }
  });

  return Array.from(enabledFields);
}

export function isSyncFieldEnabled(settings: WhoIsStreamingSettings, fieldName: string, enabledFields?: string[]): boolean {
  if (enabledFields) {
    return enabledFields.includes(fieldName);
  }

  return getEnabledSyncFields(settings).includes(fieldName);
}

export function buildSyncFields(
  settings: WhoIsStreamingSettings,
  show: Show,
  jellyfinAvailability: JellyfinAvailability[] = []
): SyncField[] {
  const tmdbId = getTmdbId(show);
  const fields: SyncField[] = [
    { name: "tmdb_id", value: parseInt(tmdbId), alwaysSync: true, showInPreview: false },
    { name: "Type", value: show.showType, alwaysSync: true },
    { name: "Year", value: show.releaseYear || show.firstAirYear },
    { name: "Directors", value: show.directors },
    { name: "Cast", value: show.cast },
    { name: "Overview", value: typeof show.overview === "string" ? decode(show.overview) : undefined },
    { name: "Genres", value: show.genres?.map((genre: Genre) => genre.name) },
  ];

  if (show.runtime) {
    fields.push({ name: "Runtime", value: `${show.runtime} min` });
  }

  if (show.rating) {
    fields.push({ name: "Rating", value: show.rating });
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
      name: "Poster",
      value: posterValue,
      isPoster: true,
      posterUrl: show.imageSet.verticalPoster.w240,
    });
  }

  buildStreamingServiceFields(settings, show).forEach((field) => fields.push(field));
  buildJellyfinSyncFields(settings, jellyfinAvailability).forEach((field) => fields.push(field));

  const isWatched = jellyfinAvailability.some((availability) => availability.watched === true);
  if (isWatched) {
    fields.push({ name: "Watched", value: true, alwaysSync: true, showInPreview: false });
  }

  fields.push({ name: "Last Synced", value: new Date().toLocaleString(), alwaysSync: true, showInPreview: false });

  return fields.filter((field) => field.value !== null && field.value !== undefined && field.value !== "");
}

function buildStreamingServiceFields(settings: WhoIsStreamingSettings, show: Show): SyncField[] {
  const showsStreamingServices = (show.streamingOptions[settings.country] || []).filter((service: StreamingService) => {
    return !service.addon?.id?.startsWith("tvs.sbd")
      && (service.type === "subscription" || service.type === "addon");
  });

  return Object.values(settings.streamingServicesToSync).flatMap((streamingServiceToSync) => {
    const streamingServiceName = formatTemplateValue(streamingServiceToSync.name);
    if (streamingServiceName.length === 0) {
      return [];
    }

    const matchedService = showsStreamingServices.find(
      (showsService) => showsService.service.id === streamingServiceToSync.id
    );
    const fields: SyncField[] = [{
      name: streamingServiceName,
      value: describeStreamingService(matchedService),
    }];

    const streamingLink = formatTemplateValue(matchedService?.link);
    if (settings.addStreamingLinks && streamingLink.length > 0) {
      fields.push({
        name: `${streamingServiceName} Link`,
        value: streamingLink,
        enabledBy: streamingServiceName,
        showInPreview: false,
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

export function buildJellyfinSyncFields(settings: WhoIsStreamingSettings, jellyfinAvailability: JellyfinAvailability[]): SyncField[] {
  return jellyfinAvailability.flatMap((availability) => {
    const instanceName = formatTemplateValue(availability.instanceName);
    if (instanceName.length === 0) {
      return [];
    }

    const fields: SyncField[] = [{
      name: instanceName,
      value: availability.available ? "Available" : "Not available",
    }];

    if (availability.available && availability.itemId) {
      const itemId = formatTemplateValue(availability.itemId);
      const instance = settings.jellyfinInstances.find((item) => item.name === instanceName);
      if (instance) {
        const baseUrl = instance.url.replace(/\/+$/, '');
        fields.push({
          name: `${instanceName} Link`,
          value: `${baseUrl}/web/index.html#!/details?id=${itemId}`,
          enabledBy: instanceName,
          showInPreview: false,
        });
      }
    }

    return fields;
  });
}
