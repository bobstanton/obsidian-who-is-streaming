import { LetterboxdImportModal } from "./LetterboxdImportModal";
import { exportForLetterboxd } from "./letterboxdExport";
import type WhoIsStreamingPlugin from "./main";
import { isTitleNote } from "./frontmatterUtils";
import { getFrontmatter } from "./vaultTitles";

interface CommandSpec {
  id: string;
  name: string;
  note?: boolean;
  available?: () => boolean;
  run: () => unknown;
}

function getCommands(plugin: WhoIsStreamingPlugin): CommandSpec[] {
  const { jellyfinNotes: jellyfin, tmdbNotes: tmdb } = plugin;
  const hasJellyfin = () => jellyfin.hasServers();
  const hasTmdb = () => tmdb.isConfigured();

  return [
    { id: "search", name: "Search", note: true, run: () => plugin.searchActiveNote() },
    { id: "refresh", name: "Refresh", note: true, run: () => plugin.refreshActiveNote() },
    { id: "bulk-refresh", name: "Bulk refresh", run: () => plugin.bulkRefresh() },
    {
      id: "refresh-imported",
      name: "Refresh imported notes",
      available: () => plugin.getImportedNotesToRefresh().length > 0,
      run: () => plugin.refreshImportedNotes(),
    },
    { id: "check-leaving-soon", name: "Check what's leaving soon", run: () => plugin.checkLeavingSoon() },

    { id: "tmdb-refresh", name: "TMDB: refresh", note: true, available: hasTmdb, run: () => tmdb.refreshActiveNote() },
    { id: "tmdb-bulk-refresh", name: "TMDB: bulk refresh", available: hasTmdb, run: () => tmdb.refreshAllNotes() },

    { id: "jellyfin-refresh", name: "Jellyfin: refresh", note: true, available: hasJellyfin, run: () => jellyfin.refreshActiveNote() },
    { id: "jellyfin-bulk-refresh", name: "Jellyfin: bulk refresh", available: hasJellyfin, run: () => jellyfin.refreshAllNotes() },
    { id: "jellyfin-sync-library", name: "Jellyfin: sync library", available: hasJellyfin, run: () => jellyfin.syncLibrary() },

    {
      id: "letterboxd-import",
      name: "Letterboxd: import",
      run: () => new LetterboxdImportModal(plugin.app, plugin.settings, tmdb.isConfigured() ? tmdb : undefined).open(),
    },
    { id: "letterboxd-export-watched", name: "Letterboxd: export watched films", run: () => exportForLetterboxd(plugin, "watched") },
    { id: "letterboxd-export-watchlist", name: "Letterboxd: export watchlist", run: () => exportForLetterboxd(plugin, "watchlist") },

    {
      id: "mark-watched-today",
      name: "Mark as watched today",
      note: true,
      available: () => {
        const file = plugin.app.workspace.getActiveFile();

        return file !== null && isTitleNote(getFrontmatter(plugin.app, file));
      },
      run: () => {
        const file = plugin.app.workspace.getActiveFile();

        return file ? plugin.markWatchedToday(file) : undefined;
      },
    },
  ];
}

export function registerCommands(plugin: WhoIsStreamingPlugin): void {
  const hasNote = () => plugin.app.workspace.getActiveFile()?.extension === "md";

  for (const { id, name, note, available, run } of getCommands(plugin)) {
    const start = () => void run();
    const usable = () => (!note || hasNote()) && (!available || available());

    plugin.addCommand(note || available
      ? {
        id,
        name,
        checkCallback: (checking: boolean) => {
          if (!usable()) return false;
          if (!checking) start();

          return true;
        },
      }
      : { id, name, callback: start });
  }
}
