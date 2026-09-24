import { App, PluginSettingTab, SettingDefinitionItem, SettingGroupItem, debounce } from "obsidian";
import WhoIsStreamingPlugin from "./main";
import { JellyfinInstance, isJellyfinInstanceComplete } from "./settings";

const FIELD_KEY_PREFIX = "field:";
const SERVICE_KEY_PREFIX = "service:";
const JELLYFIN_KEY_PREFIX = "jellyfin:";

const JELLYFIN_PROPERTIES = ["name", "url", "apiKey", "userId"] as const;

type JellyfinProperty = typeof JELLYFIN_PROPERTIES[number];

const SYNC_FIELDS = [
  { id: "File Name", name: "File name", desc: "Rename the note based on the configured format" },
  { id: "Poster", name: "Poster", desc: "Poster image" },
  { id: "Year", name: "Year", desc: "Release year or first air year" },
  { id: "Directors", name: "Directors", desc: "Director names" },
  { id: "Cast", name: "Cast", desc: "Cast member names" },
  { id: "Overview", name: "Overview", desc: "Show description/synopsis" },
  { id: "Genres", name: "Genres", desc: "Genre list" },
  { id: "Runtime", name: "Runtime", desc: "Runtime in minutes" },
  { id: "Rating", name: "Rating", desc: "IMDB rating" },
  { id: "Seasons", name: "Seasons", desc: "Number of seasons" },
  { id: "Episodes", name: "Episodes", desc: "Number of episodes" },
];

const API_SIGNUP_URL = "https://developers.movieofthenight.com/";

const COUNTRY_RELOAD_DELAY_MS = 1000;

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

    const definitions: SettingDefinitionItem[] = [
      {
        type: "group",
        heading: "API configuration",
        items: [
          {
            name: "API key",
            desc: createFragment((frag) => {
              frag.appendText("Sign up for an API key: ");
              frag.createEl("a", { text: "Streaming Availability API signup", href: API_SIGNUP_URL });
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
        ],
      },
      {
        type: "group",
        heading: "Bulk refresh",
        items: [
          {
            name: "Bulk refresh limit",
            desc: "Notes are refreshed starting with the least recently synced. Set to 0 to refresh everything in the base.",
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
        heading: "Note formatting",
        items: [
          {
            name: "Movie note format",
            desc: "Format for movie notes. Available: ${title}, ${year}, ${tmdb_id}, ${rating}, ${runtime}",
            control: { type: "text", key: "noteNameFormat", placeholder: "${title} (${year})" },
          },
          {
            name: "Series note format",
            desc: "Format for series notes. Available: ${title}, ${firstAirYear}, ${lastAirYear}, ${tmdb_id}, ${rating}",
            control: { type: "text", key: "noteNameFormatSeries", placeholder: "${title} (${firstAirYear}-${lastAirYear})" },
          },
        ],
      },
      {
        type: "group",
        heading: "Poster images",
        items: [
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
      this.getJellyfinList(),
      {
        type: "group",
        heading: "Sync behavior",
        items: [
          {
            name: "Show preview dialog",
            desc: "Show a preview of changes before syncing",
            control: { type: "toggle", key: "showPreviewDialog" },
          },
          {
            name: "Add streaming links",
            desc: "Add direct links to streaming services",
            control: { type: "toggle", key: "addStreamingLinks" },
          },
          {
            type: "page",
            name: "Default fields",
            desc: "Fields enabled by default for preview and bulk refresh. Required fields are always included.",
            displayValue: () => `${this.getEnabledFieldCount()} of ${SYNC_FIELDS.length}`,
            items: SYNC_FIELDS.map((field) => ({
              name: field.name,
              desc: field.desc,
              control: { type: "toggle" as const, key: `${FIELD_KEY_PREFIX}${field.id}` },
            })),
          },
        ],
      },
      {
        type: "group",
        heading: "Movies view display",
        items: [
          {
            name: "Default grid poster size",
            desc: "Poster width in pixels for grid view (height is auto-calculated)",
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

    const services = this.getStreamingServicesPage();
    if (services) {
      definitions.push(services);
    }

    definitions.push({
      name: "Streaming Availability API",
      desc: createFragment((frag) => {
        frag.appendText("This plugin uses ");
        frag.createEl("a", { text: "Streaming Availability API", href: API_SIGNUP_URL });
        frag.appendText(" for streaming availability data.");
      }),
      searchable: false,
    });

    return definitions;
  }

  getControlValue(key: string): unknown {
    if (key.startsWith(FIELD_KEY_PREFIX)) {
      return this.plugin.settings.defaultEnabledFields.includes(key.slice(FIELD_KEY_PREFIX.length));
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

    return (this.plugin.settings as unknown as Record<string, unknown>)[key];
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    if (key.startsWith(FIELD_KEY_PREFIX)) {
      this.setFieldEnabled(key.slice(FIELD_KEY_PREFIX.length), value === true);
    } else if (key.startsWith(SERVICE_KEY_PREFIX)) {
      this.setServiceEnabled(key.slice(SERVICE_KEY_PREFIX.length), value === true);
    } else if (key.startsWith(JELLYFIN_KEY_PREFIX)) {
      const instance = this.getJellyfinInstance(key);
      const property = this.getJellyfinProperty(key);
      if (!instance || !property) return;
      instance[property] = typeof value === "string" ? value : "";
    } else {
      (this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
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
      heading: "Jellyfin instances",
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
      desc: "Server to check for movie availability",
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
          desc: "Optional. Used to sync watched status.",
          control: { type: "text", key: keyFor("userId"), placeholder: "User ID" },
        },
      ],
    };
  }

  private getStreamingServicesPage(): SettingDefinitionItem | null {
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

  private getEnabledFieldCount(): number {
    return SYNC_FIELDS.filter((field) => this.plugin.settings.defaultEnabledFields.includes(field.id)).length;
  }

  private setFieldEnabled(field: string, enabled: boolean): void {
    const fields = this.plugin.settings.defaultEnabledFields;
    const index = fields.indexOf(field);

    if (enabled && index === -1) {
      fields.push(field);
    } else if (!enabled && index > -1) {
      fields.splice(index, 1);
    }
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
