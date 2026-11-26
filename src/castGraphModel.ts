import type { TFile } from "obsidian";
import type { SimulationLinkDatum, SimulationNodeDatum } from "d3-force";

export const POSTER_WIDTH = 40;
export const POSTER_HEIGHT = 60;

export interface GraphNode extends SimulationNodeDatum {
  id: string;
  kind: "movie" | "person";
  label: string;
  radius: number;
  file?: TFile;
  posterUrl?: string | null;
  titleCount: number;
  isCast: boolean;
  isDirector: boolean;
}

export interface GraphLink extends SimulationLinkDatum<GraphNode> {
  source: GraphNode;
  target: GraphNode;
  role: "cast" | "director";
}

export interface GraphTitle {
  id: string;
  label: string;
  file?: TFile;
  posterUrl?: string | null;
  cast: string[];
  directors: string[];
}

export interface GraphOptions {
  minTitles: number;
  includeDirectors: boolean;
  showUnconnected: boolean;
}

export interface CastGraph {
  nodes: GraphNode[];
  links: GraphLink[];
  signature: string;
}

export function buildCastGraph(titles: GraphTitle[], options: GraphOptions): CastGraph {
  interface Credit { movie: GraphNode; role: "cast" | "director" }
  const people = new Map<string, { label: string; credits: Map<string, Credit> }>();
  const movies: GraphNode[] = [];

  for (const title of titles) {
    const movie: GraphNode = {
      id: `m:${title.id}`,
      kind: "movie",
      label: title.label,
      radius: Math.hypot(POSTER_WIDTH, POSTER_HEIGHT) / 2,
      file: title.file,
      posterUrl: title.posterUrl,
      titleCount: 0,
      isCast: false,
      isDirector: false,
    };

    movies.push(movie);

    const addCredits = (names: string[], role: Credit["role"]) => {
      for (const rawName of names) {
        const label = cleanName(rawName);

        if (!label) continue;
        const key = label.toLowerCase();
        const person = people.get(key) ?? { label, credits: new Map<string, Credit>() };

        people.set(key, person);
        if (!person.credits.has(movie.id) || role === "cast") person.credits.set(movie.id, { movie, role });
      }
    };

    if (options.includeDirectors) addCredits(title.directors, "director");
    addCredits(title.cast, "cast");
  }

  const nodes: GraphNode[] = [];
  const links: GraphLink[] = [];
  const connectedMovies = new Set<GraphNode>();

  for (const [key, person] of people) {
    const credits = [...person.credits.values()];

    if (credits.length < options.minTitles) continue;

    const node: GraphNode = {
      id: `p:${key}`,
      kind: "person",
      label: person.label,
      radius: 4 + 2.5 * Math.sqrt(credits.length),
      titleCount: credits.length,
      isCast: credits.some((credit) => credit.role === "cast"),
      isDirector: credits.some((credit) => credit.role === "director"),
    };

    nodes.push(node);

    for (const credit of credits) {
      links.push({ source: node, target: credit.movie, role: credit.role });
      connectedMovies.add(credit.movie);
    }
  }

  nodes.push(...movies.filter((movie) => options.showUnconnected || connectedMovies.has(movie)));

  const signature = [
    ...nodes.map((node) => `${node.id}|${node.label}|${node.posterUrl ?? ""}`).sort(),
    ...links.map((link) => `${link.source.id}>${link.target.id}|${link.role}`).sort(),
  ].join("\n");

  return { nodes, links, signature };
}

export function graphDistances(focus: GraphNode, neighbors: Map<GraphNode, Set<GraphNode>>): Map<GraphNode, number> {
  const distances = new Map<GraphNode, number>([[focus, 0]]);
  let frontier = [focus];

  while (frontier.length > 0) {
    const next: GraphNode[] = [];

    for (const node of frontier) {
      const distance = (distances.get(node) ?? 0) + 1;

      for (const neighbor of neighbors.get(node) ?? []) {
        if (distances.has(neighbor)) continue;
        distances.set(neighbor, distance);
        next.push(neighbor);
      }
    }

    frontier = next;
  }

  return distances;
}

export function focusOpacity(distance: number | undefined, minimum: number): number {
  if (distance === undefined) return minimum;

  return Math.max(minimum, 0.5 ** Math.floor(distance / 2));
}

export function cleanName(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/^\[\[(.+?)\]\]$/);

  if (!match) return trimmed;
  const parts = match[1].split("|");

  return parts[parts.length - 1].trim();
}
