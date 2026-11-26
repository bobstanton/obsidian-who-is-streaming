import { LETTERBOXD_PROPERTY, TMDB_ID_PROPERTY } from "./properties";

export type FrontmatterWriter = (frontmatter: Record<string, unknown>) => void;

export function getFrontmatterString(fm: Record<string, unknown>, key: string): string | undefined {
  const value = fm[key];

  return typeof value === "string" ? value : undefined;
}

export function getFrontmatterStringOrNumber(fm: Record<string, unknown>, key: string): string | undefined {
  const value = fm[key];

  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);

  return undefined;
}

export function getFrontmatterNumber(fm: Record<string, unknown>, key: string): number | undefined {
  const value = fm[key];
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number.parseFloat(value) : Number.NaN;

  return Number.isFinite(parsed) ? parsed : undefined;
}

export function getFrontmatterStringArray(fm: Record<string, unknown>, key: string): string[] | undefined {
  const value = fm[key];

  if (!Array.isArray(value)) return undefined;

  return value.filter((item): item is string => typeof item === "string");
}

export function frontmatterEquals(fm: Record<string, unknown>, key: string, expected: string): boolean {
  const value = fm[key];

  return typeof value === "string" && value === expected;
}

export function frontmatterNotEquals(fm: Record<string, unknown>, key: string, notExpected: string): boolean {
  const value = fm[key];

  return typeof value === "string" && value !== notExpected;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isTitleNote(fm: Record<string, unknown>): boolean {
  return fm[TMDB_ID_PROPERTY] != null || typeof fm[LETTERBOXD_PROPERTY] === "string";
}
