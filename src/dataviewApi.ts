import { App } from "obsidian";

export interface DataviewQueryResult<T> {
  successful: boolean;
  value: {
    values: T[];
  };
}

export interface DataviewApi<T> {
  query(query: string): Promise<DataviewQueryResult<T>>;
}

interface AppWithPlugins extends App {
  plugins?: {
    enabledPlugins?: Set<string>;
    plugins?: {
      dataview?: {
        api?: DataviewApi<unknown>;
      };
    };
  };
}

export function isDataviewPluginEnabled(app: App): boolean {
  const plugins = (app as AppWithPlugins).plugins;
  return plugins?.enabledPlugins?.has("dataview") === true
    && plugins.plugins?.dataview?.api !== undefined;
}

export function getDataviewApi<T>(app: App): DataviewApi<T> | undefined {
  return (app as AppWithPlugins).plugins?.plugins?.dataview?.api as DataviewApi<T> | undefined;
}
