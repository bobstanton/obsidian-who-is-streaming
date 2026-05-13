import { App, Modal, PluginSettingTab, Setting, Notice } from "obsidian";
import WhoIsStreamingPlugin from "./main";
import { JellyfinInstance } from "./settings";
import { isDataviewPluginEnabled } from "./dataviewApi";

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

    const buttonContainer = contentEl.createDiv({ cls: "who-is-streaming-modal-button-container" });

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
      .setDesc("Display name for this server")
      .addText((text) => {
        text
          .setPlaceholder("My server")
          .setValue(this.instance.name)
          .onChange((value) => {
            this.instance.name = value;
          });
      });

    new Setting(contentEl)
      .setName("URL")
      .setDesc("Server URL")
      .addText((text) => {
        text
          .setPlaceholder("Server URL")
          .setValue(this.instance.url)
          .onChange((value) => {
            this.instance.url = value;
          });
      });

    new Setting(contentEl)
      .setName("API key")
      .setDesc("Generate this in the server dashboard API keys page.")
      .addText((text) => {
        text
          .setPlaceholder("API key")
          .setValue(this.instance.apiKey)
          .onChange((value) => {
            this.instance.apiKey = value;
          });
      });

    new Setting(contentEl)
      .setName("User ID")
      .setDesc("Optional. Used to sync watched status.")
      .addText((text) => {
        text
          .setPlaceholder("User ID")
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

  saveSettings(update: () => void, afterSave?: () => void | Promise<void>): void {
    void (async () => {
      update();
      await this.plugin.saveSettings();
      await afterSave?.();
    })();
  }

  display(): void {
    const { containerEl } = this;

    containerEl.empty();

    new Setting(containerEl).setName("API configuration").setHeading();

    const fragment = new DocumentFragment();
    const descDiv = fragment.createDiv({ cls: "who-is-streaming-setting-description" });
    descDiv.appendText("Sign up for an API key: ");
    descDiv.createEl("a", {
      text: "Streaming Availability API signup",
      href: "https://www.movieofthenight.com/about/api"
    });

    new Setting(containerEl)
      .setName("API key")
      .setDesc(fragment)
      .addText((text) => {
        text.setValue(this.plugin.settings.apiKey).onChange((value) => {
          this.saveSettings(() => {
            this.plugin.settings.apiKey = value;
          }, async () => {
            this.plugin.setupApiClient();
            await this.initializeCountries();
          });
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
          .onChange((value) => {
            this.saveSettings(() => {
              this.plugin.settings.rateLimitWarningThreshold = value;
            });
          });
      })
      .addExtraButton((button) => {
        button
          .setIcon("reset")
          .setTooltip("Reset to default (80%)")
          .onClick(() => {
            this.saveSettings(() => {
              this.plugin.settings.rateLimitWarningThreshold = 80;
            }, () => {
              this.display();
            });
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
          .onChange((value) => {
            this.saveSettings(() => {
              this.plugin.settings.noteNameFormat = value;
            });
          });
      });

    new Setting(containerEl)
      .setName("Series note format")
      .setDesc("Format for series notes. Available: ${title}, ${firstAirYear}, ${lastAirYear}, ${tmdb_id}, ${rating}")
      .addText((text) => {
        text
          .setPlaceholder("${title} (${firstAirYear}-${lastAirYear})")
          .setValue(this.plugin.settings.noteNameFormatSeries)
          .onChange((value) => {
            this.saveSettings(() => {
              this.plugin.settings.noteNameFormatSeries = value;
            });
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
          .onChange((value) => {
            this.saveSettings(() => {
              this.plugin.settings.posterMode = value as "none" | "local" | "remote";
            });
          });
      });

    new Setting(containerEl)
      .setName("Poster folder")
      .setDesc("Folder path for storing downloaded posters")
      .addText((text) => {
        text
          .setPlaceholder("Posters")
          .setValue(this.plugin.settings.posterFolder)
          .onChange((value) => {
            this.saveSettings(() => {
              this.plugin.settings.posterFolder = value;
            });
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
              (selectedFolder) => {
                this.saveSettings(() => {
                  this.plugin.settings.posterFolder = selectedFolder;
                }, () => {
                  this.display();
                });
              }
            ).open();
          });
      });

    new Setting(containerEl).setName("Jellyfin integration").setHeading();

    new Setting(containerEl)
      .setName("Jellyfin instances")
      .setDesc("Add servers to check for movie availability");

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
                (updatedInstance) => {
                  this.saveSettings(() => {
                    this.plugin.settings.jellyfinInstances[index] = updatedInstance;
                  }, () => {
                    this.display();
                  });
                }
              ).open();
            });
        })
        .addButton((button) => {
          button
            .setButtonText("Remove")
            .setWarning()
            .onClick(() => {
              this.saveSettings(() => {
                this.plugin.settings.jellyfinInstances.splice(index, 1);
              }, () => {
                this.display();
              });
            });
        });
    });

    new Setting(containerEl)
      .addButton((button) => {
        button
          .setButtonText("Add server")
          .setCta()
          .onClick(() => {
            new JellyfinInstanceModal(
              this.app,
              null,
              (newInstance) => {
                this.saveSettings(() => {
                  this.plugin.settings.jellyfinInstances.push(newInstance);
                }, () => {
                  this.display();
                });
              }
            ).open();
          });
      });

    if (isDataviewPluginEnabled(this.app)) {
      new Setting(containerEl).setName("Bulk refresh").setHeading();
      new Setting(containerEl)
        .setName("Dataview query")
        .setDesc("Filter which notes to refresh when using bulk refresh")
        .setClass("who-is-streaming-textarea")
        .addTextArea((text) => {
          text
            .setPlaceholder("Dataview query")
            .setValue(this.plugin.settings.bulkSyncDataviewQuery)
            .onChange((value) => {
              this.saveSettings(() => {
                this.plugin.settings.bulkSyncDataviewQuery = value;
              });
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
          .onChange((value) => {
            this.saveSettings(() => {
              this.plugin.settings.showPreviewDialog = value;
            });
          });
      });

    new Setting(containerEl)
      .setName("Add streaming links")
      .setDesc("Add direct links to streaming services")
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.addStreamingLinks)
          .onChange((value) => {
            this.saveSettings(() => {
              this.plugin.settings.addStreamingLinks = value;
            });
          });
      });

    containerEl.createEl("p", {
      text: "Choose the fields enabled by default for preview and bulk refresh. Required fields are always included.",
      cls: "who-is-streaming-setting-description"
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
            .onChange((value) => {
              this.saveSettings(() => {
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
              });
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
          .onChange((value) => {
            this.saveSettings(() => {
              this.plugin.settings.gridPosterSize = value;
            });
          });
      });

    containerEl.append(this.streamingServicesElement);

    void this.initializeCountries();
    void this.initializeStreamingServices();
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

      const sortedCountries = Object.values(countries).sort((lv, rv) => {
        if (lv.countryCode === userCountryCode) return -1;
        if (rv.countryCode === userCountryCode) return 1;
        return lv.name.localeCompare(rv.name);
      });

      const sorted: { [key: string]: string } = { "": "" };
      for (const country of sortedCountries) {
        sorted[country.countryCode] = country.name;
      }

      this.countrySetting.addDropdown((dropdown) => {
        dropdown
          .addOptions(sorted)
          .setValue(this.plugin.settings.country)
          .onChange((value) => {
            this.saveSettings(() => {
              this.plugin.settings.country = value;
              this.plugin.settings.streamingServicesToSync = {};
            }, () => {
              void this.initializeStreamingServices();
            });
          });
      });
    } catch (error: unknown) {
      // Keep cached country data if refresh fails.
      console.debug('Failed to load countries:', error);
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

      countries[this.plugin.settings.country].services.forEach((service) => {
        const key = service.id;
        const isEnabled = Object.prototype.hasOwnProperty.call(this.plugin.settings.streamingServicesToSync, key) === true;
        new Setting(this.streamingServicesElement)
          .setName(service.name)
          .addToggle((toggle) => {
            toggle
              .setValue(isEnabled)
              .onChange((value) => {
                this.saveSettings(() => {
                  if (value)
                    this.plugin.settings.streamingServicesToSync[key] = service;
                  else
                    delete this.plugin.settings.streamingServicesToSync[key];
                });
              });
          });
      });

      new Setting(this.streamingServicesElement).setName("Attribution").setHeading();
      const attributionSetting = new Setting(this.streamingServicesElement);
      attributionSetting.descEl.empty();
      attributionSetting.descEl.appendText("This plugin uses ");
      attributionSetting.descEl.createEl("a", {
        text: "Streaming Availability API",
        href: "https://www.movieofthenight.com/about/api"
      });
      attributionSetting.descEl.appendText(" for streaming availability data.");
    } catch (error: unknown) {
      // Leave the current service list unchanged if refresh fails.
      console.debug('Failed to initialize streaming services:', error);
    }
  }
}
