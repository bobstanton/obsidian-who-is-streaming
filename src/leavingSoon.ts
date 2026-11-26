import { App, TFile } from "obsidian";
import { Show } from "streaming-availability";
import StreamingAvailabilityApiService from "./StreamingAvailabilityApiService";
import { getFrontmatterString, getFrontmatterStringArray } from "./frontmatterUtils";
import { WhoIsStreamingSettings } from "./settings";
import { toDayString } from "./watchHistory";
import { LEAVING_FROM_PROPERTY, LEAVING_PROPERTY } from "./properties";
import { getVaultTitles } from "./vaultTitles";
import { noteKey, showKey } from "./titleId";

export interface LeavingTitle {
  file: TFile;
  date?: string;
  services: string[];
}

export interface LeavingSummary {
  leaving: LeavingTitle[];
  cleared: number;
  complete: boolean;
}

export function applyLeavingFromShow(frontmatter: Record<string, unknown>, settings: WhoIsStreamingSettings, show: Show): void {
  const options = (show.streamingOptions?.[settings.country] ?? []).filter((option) =>
    !option.addon?.id?.startsWith("tvs.sbd") && (option.type === "subscription" || option.type === "addon")
  );

  const services: string[] = [];
  let earliest: string | undefined;

  for (const service of Object.values(settings.streamingServicesToSync)) {
    const option = options.find((candidate) => candidate.service.id === service.id);

    if (!option || !isLeavingSoon(option)) continue;

    services.push(service.name);

    if (option.expiresOn !== undefined) {
      const day = toDayString(new Date(option.expiresOn * 1000));

      if (earliest === undefined || day < earliest) earliest = day;
    }
  }

  if (services.length === 0) {
    delete frontmatter[LEAVING_PROPERTY];
    delete frontmatter[LEAVING_FROM_PROPERTY];

    return;
  }

  if (earliest) frontmatter[LEAVING_PROPERTY] = earliest;
  else delete frontmatter[LEAVING_PROPERTY];
  frontmatter[LEAVING_FROM_PROPERTY] = services.sort();
}

const LEAVING_WINDOW_DAYS = 30;

function isLeavingSoon(option: { expiresSoon?: boolean; expiresOn?: number }): boolean {
  if (option.expiresSoon) return true;
  if (option.expiresOn === undefined) return false;
  const daysLeft = (option.expiresOn * 1000 - Date.now()) / (24 * 60 * 60 * 1000);

  return daysLeft <= LEAVING_WINDOW_DAYS;
}

export async function updateLeavingSoon(app: App, api: StreamingAvailabilityApiService): Promise<LeavingSummary | undefined> {
  const lookup = await api.getChanges("expiring", { force: true });

  if (!lookup) return undefined;

  const expiring = new Map<string, { date?: string; services: Set<string> }>();

  for (const item of lookup.items) {
    const key = showKey(item.show);
    const entry = expiring.get(key) ?? { services: new Set<string>() };

    entry.services.add(item.serviceName);

    if (item.timestamp !== undefined) {
      const day = toDayString(new Date(item.timestamp * 1000));

      if (entry.date === undefined || day < entry.date) entry.date = day;
    }

    expiring.set(key, entry);
  }

  const today = toDayString(new Date());
  const summary: LeavingSummary = { leaving: [], cleared: 0, complete: lookup.complete };

  for (const title of getVaultTitles(app)) {
    const key = noteKey(title.frontmatter);

    if (!key) continue;

    const entry = expiring.get(key);
    const currentDate = getFrontmatterString(title.frontmatter, LEAVING_PROPERTY);
    const currentServices = getFrontmatterStringArray(title.frontmatter, LEAVING_FROM_PROPERTY) ?? [];
    const isMarked = currentDate !== undefined || title.frontmatter[LEAVING_FROM_PROPERTY] !== undefined;

    if (entry) {
      const services = [...entry.services].sort();

      summary.leaving.push({ file: title.file, date: entry.date, services });

      const unchanged = currentDate === entry.date && currentServices.join("|") === services.join("|");

      if (unchanged) continue;

      await app.fileManager.processFrontMatter(title.file, (frontmatter: Record<string, unknown>) => {
        if (entry.date) frontmatter[LEAVING_PROPERTY] = entry.date;
        else delete frontmatter[LEAVING_PROPERTY];
        frontmatter[LEAVING_FROM_PROPERTY] = services;
      });
    } else if (isMarked) {
      const expired = currentDate !== undefined && currentDate < today;

      if (!lookup.complete && !expired) continue;

      await app.fileManager.processFrontMatter(title.file, (frontmatter: Record<string, unknown>) => {
        delete frontmatter[LEAVING_PROPERTY];
        delete frontmatter[LEAVING_FROM_PROPERTY];
      });
      summary.cleared++;
    }
  }

  summary.leaving.sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999") || a.file.basename.localeCompare(b.file.basename));

  return summary;
}
