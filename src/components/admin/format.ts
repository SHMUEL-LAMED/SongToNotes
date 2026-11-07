import { toCsv } from "../../lib/admin";
import { downloadFile } from "../../lib/export";

const dateTime = new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short" });

/** A full date and time, or a dash for nothing. */
export function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : dateTime.format(date);
}

/** Rows as a CSV file, with a BOM so a spreadsheet opens the Hebrew headings as Hebrew. */
export function downloadCsv(rows: readonly Record<string, unknown>[], name: string) {
  downloadFile(`${String.fromCharCode(0xfeff)}${toCsv(rows)}`, name, "text/csv;charset=utf-8");
}
