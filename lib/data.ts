// The pipeline publishes to the repo's `data` branch; the static site reads it
// at runtime through raw.githubusercontent.com (CORS *, ~5 min CDN cache).
export const DATA_BASE =
  process.env.NEXT_PUBLIC_DATA_BASE ??
  "https://raw.githubusercontent.com/crankyMagician/ais/data";

export async function fetchData<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${DATA_BASE}/${path}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function fetchNdjson<T>(path: string): Promise<T[]> {
  try {
    const res = await fetch(`${DATA_BASE}/${path}`, { cache: "no-store" });
    if (!res.ok) return [];
    const text = await res.text();
    return text
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as T);
  } catch {
    return [];
  }
}
