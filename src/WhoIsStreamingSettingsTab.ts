import { App, PluginSettingTab, SettingDefinitionItem, SettingGroupItem, debounce } from "obsidian";
import WhoIsStreamingPlugin from "./main";
import { DEFAULT_SETTINGS, JellyfinInstance, WhoIsStreamingSettings, isJellyfinInstanceComplete } from "./settings";
import { FieldId, FieldSource, JELLYFIN_AVAILABILITY_FIELD, JELLYFIN_LINKS_FIELD, JELLYFIN_ONLY_FIELDS, NOTE_NAME_FIELD, SHARED_FIELDS, STREAMING_AVAILABILITY_FIELD, STREAMING_LINKS_FIELD, STREAMING_ONLY_FIELDS, TMDB_ONLY_FIELDS, getFieldSource, isFieldId, onlySourceOf, sourcesFor } from "./fields";
import { validateTemplate } from "./templates";
import { EPISODES_WATCHED_PROPERTY, WATCHED_DATES_PROPERTY, WATCHED_PROPERTY } from "./properties";

const FIELD_KEY_PREFIX = "field:";
const SOURCE_KEY_PREFIX = "source:";
const SERVICE_KEY_PREFIX = "service:";
const JELLYFIN_KEY_PREFIX = "jellyfin:";

const JELLYFIN_PROPERTIES = ["name", "url", "apiKey", "userId"] as const;

type JellyfinProperty = typeof JELLYFIN_PROPERTIES[number];

const FIELD_LABELS: Record<FieldId, { name: string; desc: string }> = {
  [NOTE_NAME_FIELD]: { name: "Note name", desc: "Rename the note to the configured name format" },
  "Poster": { name: "Poster", desc: "Poster image" },
  "Year": { name: "Year", desc: "Release year or first air year" },
  "Directors": { name: "Directors", desc: "Director names" },
  "Cast": { name: "Cast", desc: "Cast member names" },
  "Overview": { name: "Overview", desc: "Description of the title" },
  "Genres": { name: "Genres", desc: "Genre list" },
  "Runtime": { name: "Runtime", desc: "Runtime in minutes" },
  "Seasons": { name: "Seasons", desc: "Number of seasons" },
  "Episodes": { name: "Episodes", desc: "Number of episodes" },
  "Streaming Availability rating": { name: "Streaming Availability rating", desc: "Rating reported by the Streaming Availability API" },
  "TMDB rating": { name: "TMDB rating", desc: "Rating reported by TMDB, out of 10" },
  [STREAMING_AVAILABILITY_FIELD]: { name: "Streaming availability", desc: "A property for each streaming service you check, saying whether the title is on it" },
  [STREAMING_LINKS_FIELD]: { name: "Streaming links", desc: "A link to the title on each streaming service that has it" },
  [WATCHED_PROPERTY]: { name: "Watched", desc: "Ticked from Jellyfin when the title has been played or has watch dates" },
  [WATCHED_DATES_PROPERTY]: { name: "Watched dates", desc: "Days Jellyfin last played the title, or each episode of a series" },
  [EPISODES_WATCHED_PROPERTY]: { name: "Episodes watched", desc: "How many episodes of a series Jellyfin has as played" },
  [JELLYFIN_AVAILABILITY_FIELD]: { name: "Jellyfin availability", desc: "A property for each Jellyfin server, saying whether the title is in its library" },
  [JELLYFIN_LINKS_FIELD]: { name: "Jellyfin links", desc: "A link to the title on each Jellyfin server that has it" },
};


const SOURCE_NAMES: Record<FieldSource, string> = {
  streaming: "Streaming Availability API",
  tmdb: "TMDB",
  jellyfin: "Jellyfin",
  off: "Off",
};

const API_SIGNUP_URL = "https://developers.movieofthenight.com/";
const TMDB_KEY_URL = "https://www.themoviedb.org/settings/api";
const TMDB_SITE_URL = "https://www.themoviedb.org/";

const COUNTRY_RELOAD_DELAY_MS = 1000;

const KNAP_DOCS_URL = "https://knap.md";

function checkTemplate(value: string): string | undefined {
  const problem = validateTemplate(value);

  return problem ? `Template problem: ${problem}` : undefined;
}

function isFieldSource(value: unknown): value is FieldSource {
  return value === "streaming" || value === "tmdb" || value === "jellyfin" || value === "off";
}

function isSettingKey(key: string): key is keyof WhoIsStreamingSettings {
  return key in DEFAULT_SETTINGS;
}

function required(label: string): (value: string) => string | undefined {
  return (value: string) => value.trim().length === 0 ? `${label} is required.` : undefined;
}

export class WhoIsStreamingSettingsTab extends PluginSettingTab {
  plugin: WhoIsStreamingPlugin;

  private countriesRequested = false;

  private readonly reloadCountries = debounce(() => {
    void this.loadCountries();
  }, COUNTRY_RELOAD_DELAY_MS, true);

  constructor(app: App, plugin: WhoIsStreamingPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    this.requestCountries();

    const services = this.getStreamingServicesPage();

    const definitions: SettingDefinitionItem[] = [
      {
        type: "group",
        heading: "Streaming Availability API",
        items: [
          {
            name: "API key",
            desc: createFragment((frag) => {
              frag.appendText("Sign up for an API key: ");
              frag.createEl("a", { text: "API signup page", href: API_SIGNUP_URL });
            }),
            control: { type: "text", key: "apiKey", placeholder: "motn-key-…" },
          },
          {
            name: "Country",
            desc: this.getCountryDescription(),
            control: {
              type: "dropdown",
              key: "country",
              options: this.getCountryOptions(),
              disabled: () => Object.keys(this.plugin.settings.countriesCache).length === 0,
            },
          },
          ...(services ? [services] : []),
          {
            name: "Rate limit warning threshold",
            desc: "Show a warning when API quota usage reaches this percentage (0 to disable)",
            render: (setting) => {
              setting.addSlider((slider) => {
                slider
                  .setLimits(0, 100, 5)
                  .setValue(this.plugin.settings.rateLimitWarningThreshold)
                  .onChange((value) => {
                    void this.setControlValue("rateLimitWarningThreshold", value);
                  });
              });
              setting.addExtraButton((button) => {
                button
                  .setIcon("reset")
                  .setTooltip("Reset to default (80%)")
                  .onClick(() => {
                    void this.setControlValue("rateLimitWarningThreshold", 80).then(() => {
                      this.update();
                    });
                  });
              });
            },
          },
          {
            name: "Bulk refresh limit",
            desc: "Notes are refreshed starting with the least recently refreshed. Set to 0 to refresh everything in the base. Also limits each run of \"Refresh imported notes\".",
            control: {
              type: "number",
              key: "bulkRefreshLimit",
              placeholder: "15",
              min: 0,
              step: 1,
              validate: (value) => Number.isInteger(value) && value >= 0
                ? undefined
                : "Enter a whole number of notes, or 0 for no limit.",
            },
          },
        ],
      },
      {
        type: "group",
        heading: "TMDB",
        items: [
          {
            name: "TMDB API key",
            desc: createFragment((frag) => {
              frag.appendText("Optional. Used when importing from Letterboxd. Get a key from ");
              frag.createEl("a", { text: "TMDB account settings", href: TMDB_KEY_URL });
            }),
            control: { type: "text", key: "tmdbApiKey", placeholder: "TMDB key or token" },
          },
        ],
      },
      this.getJellyfinList(),
      {
        type: "group",
        heading: "Refresh",
        items: [
          {
            name: "Show preview dialog",
            desc: "Show the changes a refresh of one note would make, and choose which to keep, before anything is written",
            control: { type: "toggle", key: "showPreviewDialog" },
          },
          {
            type: "page",
            name: "Field sources",
            desc: "Where each property comes from. A field is written only by its source, which replaces its value on each refresh. Fields only one source can supply are switched on or off.",
            displayValue: () => this.getFieldSourceSummary(),
            items: [
              ...SHARED_FIELDS.map((field) => ({
                ...FIELD_LABELS[field],
                control: {
                  type: "dropdown" as const,
                  key: `${SOURCE_KEY_PREFIX}${field}`,
                  options: Object.fromEntries(sourcesFor(field).map((source) => [source, SOURCE_NAMES[source]])),
                },
              })),
              ...[...STREAMING_ONLY_FIELDS, ...TMDB_ONLY_FIELDS, ...JELLYFIN_ONLY_FIELDS].map((field) => ({
                name: FIELD_LABELS[field].name,
                desc: `${FIELD_LABELS[field].desc}. From ${SOURCE_NAMES[onlySourceOf(field) ?? "off"]}.`,
                control: { type: "toggle" as const, key: `${FIELD_KEY_PREFIX}${field}` },
              })),
            ],
          },
        ],
      },
      {
        type: "group",
        heading: "Notes",
        items: [
          {
            name: "Movie note name format",
            desc: "File name for movie notes. Available: ${title}, ${year}, ${tmdb_id}, ${rating}, ${runtime}. Knap syntax such as {{ title | upper }} also works.",
            control: { type: "text", key: "noteNameFormat", placeholder: "${title} (${year})", validate: checkTemplate },
          },
          {
            name: "Series note name format",
            desc: "File name for series notes. Available: ${title}, ${firstAirYear}, ${lastAirYear}, ${tmdb_id}, ${rating}. Knap syntax also works.",
            control: { type: "text", key: "noteNameFormatSeries", placeholder: "${title} (${firstAirYear}-${lastAirYear})", validate: checkTemplate },
          },
          {
            name: "Note template",
            desc: createFragment((frag) => {
              frag.appendText("A note in your vault whose contents become the body of every note the plugin creates. Written in ");
              frag.createEl("a", { text: "Knap", href: KNAP_DOCS_URL });
              frag.appendText(", with the title as title, its properties under camel-case names such as genres, cast and watchedDates, and when the source provides them type, year, firstAirYear, lastAirYear, tmdb, overview, seasons and episodes. Leave blank for an empty body.");
            }),
            control: { type: "file", key: "noteTemplateFile", placeholder: "Templates/Title.md", filter: (file) => file.extension === "md" },
          },
          {
            name: "Poster mode",
            desc: "How to handle poster images in notes",
            control: {
              type: "dropdown",
              key: "posterMode",
              options: {
                none: "Don't use posters",
                local: "Download posters locally",
                remote: "Use remote posters",
              },
            },
          },
          {
            name: "Poster folder",
            desc: "Folder path for storing downloaded posters",
            control: {
              type: "folder",
              key: "posterFolder",
              placeholder: "Posters",
              includeRoot: true,
              disabled: () => this.plugin.settings.posterMode !== "local",
            },
          },
        ],
      },
      {
        type: "group",
        heading: "General",
        items: [
          {
            name: "Poster size",
            desc: "Poster width in the Titles, Streaming discover and Title stats views, for views that don't set their own",
            control: {
              type: "slider",
              key: "gridPosterSize",
              min: 120,
              max: 300,
              step: 10,
              displayFormat: (value) => `${value}px`,
            },
          },
        ],
      },
    ];

    definitions.push({
      name: "Data sources",
      desc: createFragment((frag) => {
        frag.appendText("Streaming availability data comes from Movie of the Night. See the ");
        frag.createEl("a", { text: "API provider's site", href: API_SIGNUP_URL });
        frag.appendText(".");
        frag.createEl("br");
        frag.appendText("Posters and title details come from TMDB when a TMDB API key is set. See the ");
        frag.createEl("a", { text: "TMDB site", href: TMDB_SITE_URL });
        frag.appendText(". This product uses the TMDB API but is not endorsed or certified by TMDB.");
      }),
      searchable: false,
    });

    return definitions;
  }

  getControlValue(key: string): unknown {
    if (key.startsWith(SOURCE_KEY_PREFIX)) {
      return getFieldSource(this.plugin.settings, key.slice(SOURCE_KEY_PREFIX.length));
    }

    if (key.startsWith(FIELD_KEY_PREFIX)) {
      return getFieldSource(this.plugin.settings, key.slice(FIELD_KEY_PREFIX.length)) !== "off";
    }

    if (key.startsWith(SERVICE_KEY_PREFIX)) {
      return Object.prototype.hasOwnProperty.call(
        this.plugin.settings.streamingServicesToSync,
        key.slice(SERVICE_KEY_PREFIX.length)
      );
    }

    if (key.startsWith(JELLYFIN_KEY_PREFIX)) {
      const instance = this.getJellyfinInstance(key);
      const property = this.getJellyfinProperty(key);
      return instance && property ? instance[property] : "";
    }

    return isSettingKey(key) ? this.plugin.settings[key] : undefined;
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    if (key.startsWith(SOURCE_KEY_PREFIX)) {
      const field = key.slice(SOURCE_KEY_PREFIX.length);

      if (isFieldId(field) && isFieldSource(value)) this.plugin.settings.fieldSources[field] = value;
    } else if (key.startsWith(FIELD_KEY_PREFIX)) {
      const field = key.slice(FIELD_KEY_PREFIX.length);

      if (isFieldId(field)) this.plugin.settings.fieldSources[field] = value === true ? onlySourceOf(field) ?? "off" : "off";
    } else if (key.startsWith(SERVICE_KEY_PREFIX)) {
      this.setServiceEnabled(key.slice(SERVICE_KEY_PREFIX.length), value === true);
    } else if (key.startsWith(JELLYFIN_KEY_PREFIX)) {
      const instance = this.getJellyfinInstance(key);
      const property = this.getJellyfinProperty(key);
      if (!instance || !property) return;
      instance[property] = typeof value === "string" ? value : "";
    } else {
      Object.assign(this.plugin.settings, { [key]: value });
    }

    await this.plugin.saveSettings();

    if (key === "apiKey") {
      this.plugin.setupApiClient();
      this.countriesRequested = true;
      this.reloadCountries();
    } else if (key === "country") {
      this.plugin.settings.streamingServicesToSync = {};
      await this.plugin.saveSettings();
      this.update();
    }
  }

  private getJellyfinList(): SettingDefinitionItem {
    return {
      type: "list",
      heading: "Jellyfin servers",
      emptyState: "No servers yet. Add one to check your own library for availability.",
      addItem: {
        name: "Add server",
        action: () => {
          this.plugin.settings.jellyfinInstances.push({ name: "", url: "", apiKey: "", userId: "" });
          void this.saveAndUpdate();
        },
      },
      onDelete: (index) => {
        this.plugin.settings.jellyfinInstances.splice(index, 1);
        void this.saveAndUpdate();
      },
      onReorder: (oldIndex, newIndex) => {
        const instances = this.plugin.settings.jellyfinInstances;
        const [moved] = instances.splice(oldIndex, 1);
        instances.splice(newIndex, 0, moved);
        void this.saveAndUpdate();
      },
      items: this.plugin.settings.jellyfinInstances.map((instance, index) => this.getJellyfinPage(instance, index)),
    };
  }

  private getJellyfinPage(instance: JellyfinInstance, index: number): SettingGroupItem {
    const keyFor = (property: JellyfinProperty) => `${JELLYFIN_KEY_PREFIX}${index}:${property}`;

    return {
      type: "page",
      name: instance.name.trim().length > 0 ? instance.name : "Untitled server",
      desc: "Server to check for availability",
      displayValue: () => this.plugin.settings.jellyfinInstances[index]?.url || "Not configured",
      status: () => isJellyfinInstanceComplete(instance) ? null : "warning",
      items: [
        {
          name: "Name",
          desc: "Display name for this server",
          control: { type: "text", key: keyFor("name"), placeholder: "My server", validate: required("Name") },
        },
        {
          name: "URL",
          desc: "Server URL",
          control: { type: "text", key: keyFor("url"), placeholder: "http://localhost:8096", validate: required("URL") },
        },
        {
          name: "API key",
          desc: "Generate this in the server dashboard API keys page.",
          control: { type: "text", key: keyFor("apiKey"), placeholder: "API key", validate: required("API key") },
        },
        {
          name: "User ID",
          desc: "Optional. Used to read watched status and dates.",
          control: { type: "text", key: keyFor("userId"), placeholder: "User ID" },
        },
      ],
    };
  }

  private getStreamingServicesPage(): SettingGroupItem | null {
    const country = this.plugin.settings.countriesCache[this.plugin.settings.country];
    if (!country || country.services.length === 0) {
      return null;
    }

    return {
      type: "page",
      name: "Streaming services",
      desc: `Services to check in ${country.name}`,
      displayValue: () => `${Object.keys(this.plugin.settings.streamingServicesToSync).length} of ${country.services.length}`,
      items: country.services.map((service) => ({
        name: service.name,
        control: { type: "toggle" as const, key: `${SERVICE_KEY_PREFIX}${service.id}` },
      })),
    };
  }

  private getCountryDescription(): string {
    return Object.keys(this.plugin.settings.countriesCache).length === 0
      ? "Add an API key to load the list of countries."
      : "Country to check streaming services for";
  }

  private getCountryOptions(): Record<string, string> {
    const countries = this.plugin.settings.countriesCache;
    const options: Record<string, string> = { "": "" };

    const userCountryCode = Intl.DateTimeFormat().resolvedOptions().locale.split("-")[1]?.toLowerCase() || "us";
    const sorted = Object.values(countries).sort((lv, rv) => {
      if (lv.countryCode === userCountryCode) return -1;
      if (rv.countryCode === userCountryCode) return 1;
      return lv.name.localeCompare(rv.name);
    });

    for (const country of sorted) {
      options[country.countryCode] = country.name;
    }

    // Keep a country chosen before the cache was built selectable.
    const current = this.plugin.settings.country;
    if (current && !(current in options)) {
      options[current] = current.toUpperCase();
    }

    return options;
  }

  private getFieldSourceSummary(): string {
    const count = (source: FieldSource) => SHARED_FIELDS.filter((field) => this.plugin.settings.fieldSources[field] === source).length;

    return `${count("streaming")} Streaming Availability, ${count("tmdb")} TMDB`;
  }

  private setServiceEnabled(serviceId: string, enabled: boolean): void {
    if (!enabled) {
      delete this.plugin.settings.streamingServicesToSync[serviceId];
      return;
    }

    const country = this.plugin.settings.countriesCache[this.plugin.settings.country];
    const service = country?.services.find((candidate) => candidate.id === serviceId);
    if (service) {
      this.plugin.settings.streamingServicesToSync[serviceId] = service;
    }
  }

  private getJellyfinInstance(key: string): JellyfinInstance | undefined {
    const index = Number.parseInt(key.slice(JELLYFIN_KEY_PREFIX.length).split(":")[0], 10);
    return Number.isNaN(index) ? undefined : this.plugin.settings.jellyfinInstances[index];
  }

  private getJellyfinProperty(key: string): JellyfinProperty | undefined {
    const property = key.split(":")[2];
    return JELLYFIN_PROPERTIES.find((candidate) => candidate === property);
  }

  private async saveAndUpdate(): Promise<void> {
    await this.plugin.saveSettings();
    this.update();
  }

  /**
   * The country list comes from the API and is cached in settings, so the definitions
   * are built from the cache. Fetching is left until the tab is on screen, which keeps
   * it off the plugin's load path, where the definitions are only read for search.
   */
  private requestCountries(): void {
    if (this.countriesRequested || !this.containerEl.isShown()) return;
    if (this.plugin.settings.apiKey.trim().length === 0) return;

    this.countriesRequested = true;
    void this.loadCountries();
  }

  private async loadCountries(): Promise<void> {
    void this.plugin.getGenres();
    const cachedAsOf = new Date(this.plugin.settings.countriesCacheAsOf).getTime();
    const countries = await this.plugin.streamingAvailabilityApi.getCountries();
    if (Object.keys(countries).length === 0) return;

    // getCountries() returns the cache while it is fresh, so there is nothing to save or redraw.
    if (new Date(this.plugin.settings.countriesCacheAsOf).getTime() === cachedAsOf) return;

    // getCountries() refreshes the cache on the settings object without saving it.
    await this.plugin.saveSettings();
    this.update();
  }
}
