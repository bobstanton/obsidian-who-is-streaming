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

