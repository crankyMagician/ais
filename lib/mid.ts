import midTable from "../pipeline/data-static/mid.json";
import focTable from "../pipeline/data-static/foc.json";

const mids = midTable as Record<string, string>;
const focMids = new Set<string>((focTable as { mids: string[] }).mids);

export function midOf(mmsi: string): string {
  return mmsi.slice(0, 3);
}

export function flagName(mid: string): string {
  if (mid.startsWith("_")) return "Unknown";
  return mids[mid] ?? "Unknown";
}

export function flagOfMmsi(mmsi: string): string {
  return flagName(midOf(mmsi));
}

export function isFocFlag(mid: string): boolean {
  return focMids.has(mid);
}
