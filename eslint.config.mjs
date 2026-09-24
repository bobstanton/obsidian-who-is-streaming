import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import { DEFAULT_ACRONYMS } from "eslint-plugin-obsidianmd/dist/lib/rules/ui/acronyms.js";
import { DEFAULT_BRANDS } from "eslint-plugin-obsidianmd/dist/lib/rules/ui/brands.js";
import tseslint from "typescript-eslint";

const TYPE_AWARE_RULES = [
  "obsidianmd/no-plugin-as-component",
  "obsidianmd/no-unsupported-api",
  "obsidianmd/no-view-references-in-plugin",
  "obsidianmd/prefer-create-el",
  "obsidianmd/prefer-file-manager-trash-file",
  "obsidianmd/prefer-instanceof",
];

export default defineConfig([
  globalIgnores([
    "main.js",
    "esbuild.config.mjs",
    "eslint.config.mjs",
    "version-bump.mjs",
  ]),
  ...obsidianmd.configs.recommended,
  {
    files: ["manifest.json"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: { allowDefaultProject: ["manifest.json"] },
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: [".json"],
      },
    },
  },
  {
    files: ["**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["package.json"],
    rules: Object.fromEntries(TYPE_AWARE_RULES.map((rule) => [rule, "off"])),
  },
  {
    rules: {
      "obsidianmd/ui/sentence-case": ["error", {
        brands: [...DEFAULT_BRANDS, "Jellyfin", "Movie of the Night", "Streaming Availability API"],
        acronyms: [...DEFAULT_ACRONYMS, "TMDB", "TV"],
        enforceCamelCaseLower: true,
      }],
    },
  },
]);
