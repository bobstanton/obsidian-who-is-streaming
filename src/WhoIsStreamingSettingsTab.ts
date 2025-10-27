import { App, Modal, PluginSettingTab, Setting, Notice } from "obsidian";
import { isPluginEnabled } from "obsidian-dataview";
import WhoIsStreamingPlugin from "./main";
import { JellyfinInstance } from "./settings";

class FolderSelectionModal extends Modal {
  folders: string[];
  onSelect: (folder: string) => void;

  constructor(app: App, folders: string[], onSelect: (folder: string) => void) {
    super(app);
    this.folders = folders;
    this.onSelect = onSelect;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Select poster folder" });

    const folderList = contentEl.createDiv({ cls: "folder-selection-list" });

    this.folders.forEach((folder) => {
      const folderItem = folderList.createDiv({ cls: "folder-selection-item" });
      folderItem.setText(folder || "(Root folder)");

      folderItem.addEventListener("click", () => {
        this.onSelect(folder);
        this.close();
      });
    });

    const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });

    const cancelBtn = buttonContainer.createEl("button");
    cancelBtn.setText("Cancel");
    cancelBtn.addEventListener("click", () => {
      this.close();
    });
  }
}

class JellyfinInstanceModal extends Modal {
  instance: JellyfinInstance;
  onSave: (instance: JellyfinInstance) => void;
  isEdit: boolean;

  constructor(app: App, instance: JellyfinInstance | null, onSave: (instance: JellyfinInstance) => void) {
    super(app);
    this.instance = instance || { name: "", url: "", apiKey: "", userId: "" };
    this.isEdit = instance !== null;
    this.onSave = onSave;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: this.isEdit ? "Edit Jellyfin instance" : "Add Jellyfin instance" });

    new Setting(contentEl)
      .setName("Name")
      .setDesc("A friendly name for this Jellyfin instance")
      .addText((text) => {
        text
          .setPlaceholder("My Jellyfin Server")
          .setValue(this.instance.name)
          .onChange((value) => {
            this.instance.name = value;
          });
      });

    new Setting(contentEl)
      .setName("URL")
      .setDesc("Jellyfin server URL (e.g., http://localhost:8096)")
      .addText((text) => {
        text
          .setPlaceholder("http://localhost:8096")
          .setValue(this.instance.url)
          .onChange((value) => {
            this.instance.url = value;
          });
      });

    new Setting(contentEl)
      .setName("API Key")
      .setDesc("Jellyfin API key (generate in Dashboard → API Keys)")
      .addText((text) => {
        text
          .setPlaceholder("API Key")
          .setValue(this.instance.apiKey)
          .onChange((value) => {
            this.instance.apiKey = value;
          });
      });

    new Setting(contentEl)
      .setName("User id")
      .setDesc("Optional, if provided will be used to set watch status")
      .addText((text) => {
        text
          .setPlaceholder("User Id")
          .setValue(this.instance.userId)
          .onChange((value) => {
            this.instance.userId = value;
          });
      });

    const buttonContainer = contentEl.createDiv({ cls: "jellyfin-modal-buttons" });

    const saveBtn = buttonContainer.createEl("button", { cls: "mod-cta" });
    saveBtn.setText("Save");
    saveBtn.addEventListener("click", () => {
      if (!this.instance.name || !this.instance.url || !this.instance.apiKey) {
        new Notice("Please fill in all required fields");
        return;
      }
      this.onSave(this.instance);
      this.close();
    });

    const cancelBtn = buttonContainer.createEl("button");
    cancelBtn.setText("Cancel");
    cancelBtn.addEventListener("click", () => {
      this.close();
    });
  }
}

export class WhoIsStreamingSettingsTab extends PluginSettingTab {
  plugin: WhoIsStreamingPlugin;
  countrySetting: Setting;
  streamingServicesElement: HTMLElement;

  constructor(app: App, plugin: WhoIsStreamingPlugin) {
    super(app, plugin);
    this.plugin = plugin;
    this.streamingServicesElement = createDiv();
  }

  async display(): Promise<void> {
    const { containerEl } = this;

    containerEl.empty();

    new Setting(containerEl).setName("API Configuration").setHeading();

    const fragment = new DocumentFragment();
    const descDiv = fragment.createDiv({ cls: "setting-item-description" });
    descDiv.appendText("Sign up for an API Key: ");
    descDiv.createEl("a", {
      text: "https://www.movieofthenight.com/about/api",
      href: "https://www.movieofthenight.com/about/api"
    });

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

    this.countrySetting = new Setting(containerEl)
      .setName("Country")
      .setDesc("Country to check streaming services for");

    new Setting(containerEl)
      .setName("Rate limit warning threshold")
      .setDesc("Show a warning when API quota usage reaches this percentage (0 to disable)")
      .addSlider((slider) => {
        slider
          .setLimits(0, 100, 5)
          .setValue(this.plugin.settings.rateLimitWarningThreshold)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.rateLimitWarningThreshold = value;
            await this.plugin.saveSettings();
          });
      })
      .addExtraButton((button) => {
        button
          .setIcon("reset")
          .setTooltip("Reset to default (80%)")
          .onClick(async () => {
            this.plugin.settings.rateLimitWarningThreshold = 80;
            await this.plugin.saveSettings();
            this.display(); 
          });
      });

    new Setting(containerEl).setName("Note formatting").setHeading();

    new Setting(containerEl)
      .setName("Movie note format")
      .setDesc("Format for movie notes. Available: ${title}, ${year}, ${tmdb_id}, ${rating}, ${runtime}")
      .addText((text) => {
        text
          .setPlaceholder("${title} (${year})")
          .setValue(this.plugin.settings.noteNameFormat)
          .onChange(async (value) => {
            this.plugin.settings.noteNameFormat = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("TV series note format")
      .setDesc("Format for TV series notes. Available: ${title}, ${firstAirYear}, ${lastAirYear}, ${tmdb_id}, ${rating}")
      .addText((text) => {
        text
          .setPlaceholder("${title} (${firstAirYear}-${lastAirYear})")
          .setValue(this.plugin.settings.noteNameFormatSeries)
          .onChange(async (value) => {
            this.plugin.settings.noteNameFormatSeries = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl).setName("Poster images").setHeading();

    new Setting(containerEl)
      .setName("Poster mode")
      .setDesc("How to handle poster images in notes")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("none", "Don't use posters")
          .addOption("local", "Download posters locally")
          .addOption("remote", "Use remote posters")
          .setValue(this.plugin.settings.posterMode)
          .onChange(async (value) => {
            this.plugin.settings.posterMode = value as "none" | "local" | "remote";
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Poster folder")
      .setDesc("Folder path for storing downloaded posters")
      .addText((text) => {
        text
          .setPlaceholder("posters")
          .setValue(this.plugin.settings.posterFolder)
          .onChange(async (value) => {
            this.plugin.settings.posterFolder = value;
            await this.plugin.saveSettings();
          });
      })
      .addButton((button) => {
        button
          .setButtonText("Browse")
          .onClick(() => {
            const folders = this.app.vault.getAllFolders();
            const folderNames = folders.map(f => f.path).filter(path => path !== "");
            folderNames.unshift("");

            new FolderSelectionModal(
              this.app,
              folderNames,
              async (selectedFolder) => {
                this.plugin.settings.posterFolder = selectedFolder;
                await this.plugin.saveSettings();
                this.display(); 
              }
            ).open();
          });
      });

    new Setting(containerEl).setName("Jellyfin Integration").setHeading();

    new Setting(containerEl)
      .setName("Jellyfin instances")
      .setDesc("Add Jellyfin servers to check for movie availability");

    this.plugin.settings.jellyfinInstances.forEach((instance, index) => {
      new Setting(containerEl)
        .setName(instance.name)
        .setDesc(`${instance.url}`)
        .addButton((button) => {
          button
            .setButtonText("Edit")
            .onClick(() => {
              new JellyfinInstanceModal(
                this.app,
                { ...instance },
                async (updatedInstance) => {
                  this.plugin.settings.jellyfinInstances[index] = updatedInstance;
                  await this.plugin.saveSettings();
                  this.display();
                }
              ).open();
            });
        })
        .addButton((button) => {
          button
            .setButtonText("Remove")
            .setWarning()
            .onClick(async () => {
              this.plugin.settings.jellyfinInstances.splice(index, 1);
              await this.plugin.saveSettings();
              this.display();
            });
        });
    });

    new Setting(containerEl)
      .addButton((button) => {
        button
          .setButtonText("Add Jellyfin Instance")
          .setCta()
          .onClick(() => {
            new JellyfinInstanceModal(
              this.app,
              null,
              async (newInstance) => {
                this.plugin.settings.jellyfinInstances.push(newInstance);
                await this.plugin.saveSettings();
                this.display();
              }
            ).open();
          });
      });

    if (isPluginEnabled(this.app)) {
      new Setting(containerEl).setName("Bulk sync").setHeading();
      new Setting(containerEl)
        .setName("Dataview query")
        .setDesc("Filter which notes to sync when using 'Sync all shows'")
        .setClass("who-is-streaming-textarea")
        .addTextArea((text) => {
          text
            .setPlaceholder('FROM "Movies"\nWHERE Type = "movie"')
            .setValue(this.plugin.settings.bulkSyncDataviewQuery)
            .onChange(async (value) => {
              this.plugin.settings.bulkSyncDataviewQuery = value;
              await this.plugin.saveSettings();
            });
        });
    }

    new Setting(containerEl).setName("Sync behavior").setHeading();

    new Setting(containerEl)
      .setName("Show preview dialog")
      .setDesc("Show a preview of changes before syncing")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.showPreviewDialog)
          .onChange(async (value) => {
            this.plugin.settings.showPreviewDialog = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Add streaming links")
      .setDesc("Add direct links to streaming services")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.addStreamingLinks)
          .onChange(async (value) => {
            this.plugin.settings.addStreamingLinks = value;
            await this.plugin.saveSettings();
          });
      });

    containerEl.createEl("p", {
      text: "Select which fields should be synced by default in preview and bulk sync operations. Note: Type and tmdb_id are always synced and cannot be disabled.",
      cls: "setting-item-description"
    });

    const fieldDefinitions = [
      { id: "File Name", name: "File Name", desc: "Rename the note based on the configured format" },
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

    fieldDefinitions.forEach((field) => {
      new Setting(containerEl)
        .setName(field.name)
        .setDesc(field.desc)
        .addToggle((toggle) => {
          toggle
            .setValue(this.plugin.settings.defaultEnabledFields.includes(field.id))
            .onChange(async (value) => {
              if (value) {
                if (!this.plugin.settings.defaultEnabledFields.includes(field.id)) {
                  this.plugin.settings.defaultEnabledFields.push(field.id);
                }
              } else {
                const index = this.plugin.settings.defaultEnabledFields.indexOf(field.id);
                if (index > -1) {
                  this.plugin.settings.defaultEnabledFields.splice(index, 1);
                }
              }
              await this.plugin.saveSettings();
            });
        });
    });

    new Setting(containerEl).setName("Movies view display").setHeading();

    new Setting(containerEl)
      .setName("Default grid poster size")
      .setDesc("Poster width in pixels for grid view (height is auto-calculated)")
      .addSlider((slider) => {
        slider
          .setLimits(120, 300, 10)
          .setValue(this.plugin.settings.gridPosterSize)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.gridPosterSize = value;
            await this.plugin.saveSettings();
          });
      });

    containerEl.append(this.streamingServicesElement);

    await this.initializeCountries();
    await this.initializeStreamingServices();
  }

  async initializeCountries(): Promise<void> {
    if (!this.plugin.streamingAvailabilityApi.validateApiKey()) {
      return;
    }

    try {
      const countries = await this.plugin.streamingAvailabilityApi.getCountries();

      if (!countries || Object.keys(countries).length === 0) {
        return;
      }

      const userCountryCode = Intl.DateTimeFormat().resolvedOptions().locale.split("-")[1]?.toLowerCase() || "us";

      const sortedCountries = Object.entries(countries).sort(([lk, lv], [rk, rv]) => {
        if (lv.countryCode === userCountryCode) return -1;
        if (rv.countryCode === userCountryCode) return 1;
        return lv.name.localeCompare(rv.name);
      });

      const sorted: { [key: string]: string } = { "": "" };
      for (const [key, country] of sortedCountries) {
        sorted[country.countryCode] = country.name;
      }

      this.countrySetting.addDropdown((dropdown) => {
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
    } catch (error) {
      
    }
  }

  async initializeStreamingServices(): Promise<void> {
    if (this.plugin.settings.country?.length < 2) return;

    this.streamingServicesElement.empty();
    new Setting(this.streamingServicesElement).setName("Streaming services").setHeading();

    try {
      const countries = await this.plugin.streamingAvailabilityApi.getCountries();

      if (!countries || Object.keys(countries).length === 0) {
        return;
      }

      if (!countries[this.plugin.settings.country]) {
        new Notice(`⚠️ Country "${this.plugin.settings.country}" not available. Please select a different country.`);
        return;
      }

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
                  this.plugin.settings.streamingServicesToSync[key] = service; 
                else
                  delete this.plugin.settings.streamingServicesToSync[key];
                await this.plugin.saveSettings();
              });
          });
      });

      new Setting(this.streamingServicesElement).setName("Attribution").setHeading();
      const attributionSetting = new Setting(this.streamingServicesElement);
      attributionSetting.descEl.empty();
      attributionSetting.descEl.appendText("This plugin uses ");
      attributionSetting.descEl.createEl("a", {
        text: "Streaming Availability API by Movie of the Night",
        href: "https://www.movieofthenight.com/about/api"
      });
      attributionSetting.descEl.appendText(" but is not affiliated with Movie of the Night.");
    } catch (error) {
      
    }
  }
}
