export type MarkerKind = "recipe" | "gotcha" | "deadend" | "note";
export const MARKER_KINDS: MarkerKind[] = ["recipe", "gotcha", "deadend", "note"];

/** One operational marker. All kinds share this shape; `kind` drives id-prefix
 * and recipe-only verifiedAt/staleness. ISO 8601 timestamps. */
export interface Marker {
  id: string;
  kind: MarkerKind;
  title: string; // raw display text
  body?: string;
  command?: string;
  cwd?: string;
  exitCode?: number;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  verifiedAt?: string;
}

/** A marker decorated with read-time staleness (never persisted). */
export type MarkerView = Marker & { stale: boolean };

/** On-disk shape of ~/.semkeep/operational.json. Project key = resolved abs path. */
export interface OperationalData {
  version: 1;
  projects: Record<string, { markers: Marker[] }>;
}
