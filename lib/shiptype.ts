// AIS ship-type codes (ITU-R M.1371 table 53).

export type TypeCategory =
  | "fishing"
  | "tug-special"
  | "sailing-pleasure"
  | "high-speed"
  | "passenger"
  | "cargo"
  | "tanker"
  | "other"
  | "unknown";

export function typeCategory(code: number | undefined | null): TypeCategory {
  if (code == null || code <= 0) return "unknown";
  if (code === 30) return "fishing";
  if (code >= 31 && code <= 35) return "tug-special";
  if (code === 36 || code === 37) return "sailing-pleasure";
  if (code >= 40 && code <= 49) return "high-speed";
  if (code >= 50 && code <= 59) return "tug-special";
  if (code >= 60 && code <= 69) return "passenger";
  if (code >= 70 && code <= 79) return "cargo";
  if (code >= 80 && code <= 89) return "tanker";
  return "other";
}

export function typeLabel(code: number | undefined | null): string {
  const cat = typeCategory(code);
  const labels: Record<TypeCategory, string> = {
    fishing: "Fishing",
    "tug-special": "Tug / special craft",
    "sailing-pleasure": "Sailing / pleasure",
    "high-speed": "High-speed craft",
    passenger: "Passenger",
    cargo: "Cargo",
    tanker: "Tanker",
    other: "Other",
    unknown: "Unknown",
  };
  return labels[cat];
}
