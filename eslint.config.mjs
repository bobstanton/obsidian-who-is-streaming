import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";
import { DEFAULT_BRANDS } from "eslint-plugin-obsidianmd/dist/lib/rules/ui/brands.js";
import globals from "globals";
import { globalIgnores } from "eslint/config";

const obsidianRecommended = obsidianmd.configs.recommended.map((config) => {
  if (config.files || !config.rules) {
    return config;
  }

  const hasObsidianRules = Object.keys(config.rules).some((rule) => rule.startsWith("obsidianmd/"));
  return hasObsidianRules
    ? { ...config, files: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"] }
    : config;
});

const pluginBrands = [
  "Dataview",
  "Jellyfin",
  "Movie of the Night",
  "Streaming Availability API",
];

const brands = [
  ...DEFAULT_BRANDS,
  ...pluginBrands.filter((brand) => !DEFAULT_BRANDS.includes(brand)),
];

export default tseslint.config(
  {
    languageOptions: {
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            "eslint.config.mjs",
            "manifest.json",
          ],
        },
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: [".json"],
      },
    },
  },
  ...obsidianRecommended,
  {
    rules: {
      "obsidianmd/ui/sentence-case": ["error", {
        brands,
        acronyms: ["API", "ID", "TMDB", "TV", "URL"],
        enforceCamelCaseLower: true,
      }],
    },
  },
  globalIgnores([
    "node_modules",
    "dist",
    "esbuild.config.mjs",
    "eslint.config.mjs",
    "version-bump.mjs",
    "versions.json",
    "main.js",
  ]),
);
