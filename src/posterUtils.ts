import { App } from "obsidian";

export function resolvePosterUrl(app: App, posterString: string): string | null {
  if (posterString.includes("http")) {
    return posterString;
  } else if (posterString.startsWith("![[")) {
    const match = posterString.match(/!\[\[(.+?)\]\]/);

    if (match) {
      const posterPath = match[1].split("|")[0];
      const posterFile = app.metadataCache.getFirstLinkpathDest(posterPath, "");

      if (posterFile) {
        return app.vault.getResourcePath(posterFile);
      }
    }
  }

  return null;
}
