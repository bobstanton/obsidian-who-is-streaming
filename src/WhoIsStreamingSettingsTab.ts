import { App, PluginSettingTab, Setting } from "obsidian";
import { isPluginEnabled } from "obsidian-dataview";
import * as streamingAvailability from "streaming-availability";
import WhoIsStreamingPlugin from "./main";

/**
 * Represents the settings tab for the WhoIsStreaming plugin.
 */
export class WhoIsStreamingSettingsTab extends PluginSettingTab {
  plugin: WhoIsStreamingPlugin;
  countySetting: Setting;
  streamingServicesElement: HTMLElement;

  constructor(app: App, plugin: WhoIsStreamingPlugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.streamingServicesElement = createDiv();
  }

  /**
   * Displays the settings tab.
   */
  async display(): Promise<void> {
    const { containerEl } = this;

    containerEl.empty();
    containerEl.createEl("h2", { text: "Who is Streaming?" });

    const fragment = new DocumentFragment();
    fragment.createDiv({ cls: "setting-item-description" }).innerHTML = 'Sign up for an API Key: <a href="https://www.movieofthenight.com/about/api">https://www.movieofthenight.com/about/api</a>';

    // API Key setting
    new Setting(containerEl)
      .setName("API Key")
      .setDesc(fragment)
      .addText((text) => {
        text.setValue(this.plugin.settings.apiKey).onChange(async (value) => {
          this.plugin.settings.apiKey = value;
          await this.plugin.saveSettings();
          this.plugin.setupApiClient();
          await this.initializeCountries();
        });
      });

    // Country setting
    this.countySetting = new Setting(containerEl)
      .setName("Country")
      .setDesc("Country to check streaming services for");

    //Format used for renaming note
    new Setting(containerEl)
      .setName("Note Name Format")
      .setDesc("Format to use when a note is being renamed. Acceptable placeholders are: ${title} ${year} ${tmdb_id}")
      .addText((text) => {
        text
          .setValue(this.plugin.settings.noteNameFormat)
          .onChange(async (value) => {
            this.plugin.settings.noteNameFormat = value;
            await this.plugin.saveSettings();
          });
      });

    //only show the dataview query setting if the dataview plugin is enabled
    if (isPluginEnabled(this.app)) {
      new Setting(containerEl)
        .setName("Sync All Dataview Query")
        .setDesc("When refreshing all shows, this query can be used to determine which shows are synced.")
        .setClass("who-is-streaming-textarea")
        .addTextArea((text) => {
          text
            .setValue(this.plugin.settings.bulkSyncDataviewQuery)
            .onChange(async (value) => {
              this.plugin.settings.bulkSyncDataviewQuery = value;
              await this.plugin.saveSettings();
            });
        });
    }

    containerEl.append(this.streamingServicesElement);

    await this.initializeCountries();
    await this.initializeStreamingServices();
  }

  /**
   * Initializes the countries dropdown. Requires an API key to be set.
   */
  async initializeCountries(): Promise<void> {
    if (!this.plugin.streamingAvailabilityApi.validateApiKey()) {
      return;
    }

    const countries = await this.plugin.streamingAvailabilityApi.getCountries();

    //get user's country to sort it to the top
    const userCountryCode = Intl.DateTimeFormat().resolvedOptions().locale.split("-")[1].toLocaleLowerCase() || "us";

    const sorted = Object.entries(countries)
      .sort(([lk, lv], [rk, rv]) => {
        if (lv.countryCode === userCountryCode) return -1;
        if (rv.countryCode === userCountryCode) return 1;
        return lv.name.localeCompare(rv.name);
      })
      .reduce(
        (record: { [key: string]: string }, [key, country]) => {
          record[country.countryCode] = country.name;
          return record;
        },
        { "": "" }
      );

    this.countySetting.addDropdown((dropdown) => {
      dropdown
        .addOptions(sorted)
        .setValue(this.plugin.settings.country)
        .onChange(async (value) => {
          this.plugin.settings.country = value;
          this.plugin.settings.streamingServicesToSync = {};
          
          await this.plugin.saveSettings();
          await this.initializeStreamingServices();
        });
    });
  }

  /**
   * Initializes the toggles for the streaming services available for the country. Requires a country to be set.
   */
  async initializeStreamingServices(): Promise<void> {
    if (this.plugin.settings.country?.length < 2) return;

    this.streamingServicesElement.empty();
    this.streamingServicesElement.createDiv({ cls: "setting-item" });
    this.streamingServicesElement.createEl("h2", {
      text: "Streaming Services to sync",
    });

	const countries = await this.plugin.streamingAvailabilityApi.getCountries();

    Object.entries(
      countries[this.plugin.settings.country].services
    ).forEach(([key, service]) => {
      new Setting(this.streamingServicesElement)
        .setName(service.name)
        .addToggle((toggle) => {
          toggle
            .setValue(this.plugin.settings.streamingServicesToSync.hasOwnProperty(key))
            .onChange(async (value) => {
              if (value)
                this.plugin.settings.streamingServicesToSync[key] = service; //store the entire service object so that we can use the id and name later
              else 
                delete this.plugin.settings.streamingServicesToSync[key];
              await this.plugin.saveSettings();
            });
        });
    });

    this.streamingServicesElement.createEl("h2", { text: "Attribution" });
    this.streamingServicesElement.createEl("p").innerHTML = 'This plugin uses <a href="https://www.movieofthenight.com/about/api">Streaming Availability API by Movie of the Night</a> but is not affiliated with Movie of the Night.';
  }
}
