import { parse, unparse } from "papaparse";

export function parseCsv(text: string): string[][] {
  return parse<string[]>(text, { delimiter: ",", skipEmptyLines: "greedy" }).data;
}

export function parseCsvRecords(text: string): { headers: string[]; records: Record<string, string>[] } {
  const [headerRow, ...rows] = parseCsv(text);

  if (!headerRow) return { headers: [], records: [] };

  const headers = headerRow.map(normaliseHeader);
  const records = rows.map((cells) => {
    const record: Record<string, string> = {};

    for (const [index, header] of headers.entries()) {
      if (header) record[header] = (cells[index] ?? "").trim();
    }

    return record;
  });

  return { headers, records };
}

export function normaliseHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[\s_]+/g, "");
}

export function formatCsvRow(cells: (string | number | boolean | undefined)[]): string {
  return unparse([cells.map((cell) => cell ?? "")]);
}
