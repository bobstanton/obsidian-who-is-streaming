export function getFrontmatterString(fm: Record<string, unknown>, key: string): string | undefined {
    const value = fm[key];
    return typeof value === "string" ? value : undefined;
}

export function getFrontmatterNumber(fm: Record<string, unknown>, key: string): number | undefined {
    const value = fm[key];
    return typeof value === "number" ? value : undefined;
}

export function getFrontmatterBoolean(fm: Record<string, unknown>, key: string): boolean | undefined {
    const value = fm[key];
    return typeof value === "boolean" ? value : undefined;
}

export function getFrontmatterStringOrNumber(fm: Record<string, unknown>, key: string): string | undefined {
    const value = fm[key];
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
    return undefined;
}

export function getFrontmatterArray<T = unknown>(fm: Record<string, unknown>, key: string): T[] | undefined {
    const value = fm[key];
    return Array.isArray(value) ? value : undefined;
}

export function getFrontmatterStringArray(fm: Record<string, unknown>, key: string): string[] | undefined {
    const value = fm[key];
    if (!Array.isArray(value)) return undefined;
    return value.filter((item): item is string => typeof item === "string");
}

export function getFrontmatterStringWithDefault(fm: Record<string, unknown>, key: string, defaultValue: string): string {
    return getFrontmatterString(fm, key) ?? defaultValue;
}

export function getFrontmatterNumberWithDefault(fm: Record<string, unknown>, key: string, defaultValue: number): number {
    return getFrontmatterNumber(fm, key) ?? defaultValue;
}

export function frontmatterEquals(fm: Record<string, unknown>, key: string, expected: string): boolean {
    const value = fm[key];
    return typeof value === "string" && value === expected;
}

export function frontmatterNotEquals(fm: Record<string, unknown>, key: string, notExpected: string): boolean {
    const value = fm[key];
    return typeof value === "string" && value !== notExpected;
}

export function frontmatterHasValue(fm: Record<string, unknown>, key: string): boolean {
    const value = fm[key];
    return value != null && value !== "" && value !== false;
}

export function frontmatterIsOneOf(fm: Record<string, unknown>, key: string, options: string[]): boolean {
    const value = fm[key];
    return typeof value === "string" && options.includes(value);
}
