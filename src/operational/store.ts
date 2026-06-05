import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname } from "node:path";
import {
  MARKER_KINDS,
  type Marker,
  type MarkerKind,
  type MarkerView,
  type OperationalData,
} from "./types.js";

export const STORE_VERSION = 1 as const;
export const DEFAULT_STALE_DAYS = 30;
const DAY_MS = 86_400_000;
const ID_PREFIX: Record<MarkerKind, string> = {
  recipe: "rcp", gotcha: "gca", deadend: "ded", note: "not",
};

export interface MarkInput {
  kind: MarkerKind;
  title: string;
  body?: string;
  command?: string;
  cwd?: string;
  exitCode?: number;
  tags?: string[];
}
export interface RecallFilter {
  query?: string;
  kind?: MarkerKind;
  includeStale?: boolean; // default true
}
export interface OperationalDeps {
  now?: () => Date;
  genId?: (kind: MarkerKind) => string;
  staleDays?: number;
}

function defaultGenId(kind: MarkerKind): string {
  const prefix = ID_PREFIX[kind] ?? "mrk";
  return `${prefix}_${Math.random().toString(36).slice(2, 8)}`;
}
function normalizeTitle(title: string): string {
  return String(title).trim().toLowerCase().replace(/\s+/g, " ");
}

export class OperationalStore {
  private readonly now: () => Date;
  private readonly genId: (kind: MarkerKind) => string;
  private readonly staleDays: number;

  constructor(private readonly file: string, deps: OperationalDeps = {}) {
    this.now = deps.now ?? (() => new Date());
    this.genId = deps.genId ?? defaultGenId;
    this.staleDays = deps.staleDays ?? DEFAULT_STALE_DAYS;
  }

  private read(): OperationalData {
    if (!existsSync(this.file)) return { version: STORE_VERSION, projects: {} };
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.file, "utf8"));
    } catch {
      throw new Error(
        `semkeep operational store at ${this.file} is not valid JSON. Fix or remove the file to continue.`,
      );
    }
    if (!parsed || typeof parsed !== "object" || typeof (parsed as OperationalData).projects !== "object") {
      throw new Error(`semkeep operational store at ${this.file} has an unexpected shape.`);
    }
    return parsed as OperationalData;
  }

  private write(data: OperationalData): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = this.file + ".tmp";
    writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
    renameSync(tmp, this.file);
  }

  private isStale(m: Marker, nowMs: number): boolean {
    if (m.kind !== "recipe") return false;
    if (!m.verifiedAt) return true;
    const v = Date.parse(m.verifiedAt);
    if (Number.isNaN(v)) return true;
    return nowMs - v > this.staleDays * DAY_MS;
  }

  mark(project: string, input: MarkInput): { marker: Marker; upserted: boolean } {
    if (!project) throw new Error("mark requires a project");
    if (!MARKER_KINDS.includes(input.kind)) {
      throw new Error(`mark requires a kind one of: ${MARKER_KINDS.join(", ")}`);
    }
    const title = String(input.title ?? "").trim();
    if (!title) throw new Error("mark requires a non-empty title");

    const data = this.read();
    const bucket = (data.projects[project] ??= { markers: [] });
    const nowIso = this.now().toISOString();
    const norm = normalizeTitle(title);
    const verified = input.kind === "recipe" && input.exitCode === 0;
    const existing = bucket.markers.find(
      (m) => m.kind === input.kind && normalizeTitle(m.title) === norm,
    );

    if (existing) {
      existing.title = title;
      if (input.body !== undefined) existing.body = input.body;
      if (input.command !== undefined) existing.command = input.command;
      if (input.cwd !== undefined) existing.cwd = input.cwd;
      if (input.exitCode !== undefined) existing.exitCode = input.exitCode;
      if (input.tags !== undefined) existing.tags = input.tags;
      existing.updatedAt = nowIso;
      if (verified) existing.verifiedAt = nowIso;
      this.write(data);
      return { marker: existing, upserted: true };
    }

    const marker: Marker = {
      id: this.genId(input.kind),
      kind: input.kind,
      title,
      ...(input.body !== undefined ? { body: input.body } : {}),
      ...(input.command !== undefined ? { command: input.command } : {}),
      ...(input.cwd !== undefined ? { cwd: input.cwd } : {}),
      ...(input.exitCode !== undefined ? { exitCode: input.exitCode } : {}),
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
      createdAt: nowIso,
      updatedAt: nowIso,
      ...(verified ? { verifiedAt: nowIso } : {}),
    };
    bucket.markers.push(marker);
    this.write(data);
    return { marker, upserted: false };
  }

  recall(project: string, filter: RecallFilter = {}): MarkerView[] {
    if (!project) throw new Error("recall requires a project");
    if (filter.kind && !MARKER_KINDS.includes(filter.kind)) {
      throw new Error(`recall kind must be one of: ${MARKER_KINDS.join(", ")}`);
    }
    const data = this.read();
    const nowMs = this.now().getTime();
    const includeStale = filter.includeStale ?? true;
    const q = filter.query?.toLowerCase().trim();

    let markers: MarkerView[] = (data.projects[project]?.markers ?? []).map((m) => ({
      ...m,
      stale: this.isStale(m, nowMs),
    }));
    if (filter.kind) markers = markers.filter((m) => m.kind === filter.kind);
    if (q) {
      markers = markers.filter((m) =>
        [m.title, m.body, m.command, ...(m.tags ?? [])]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(q),
      );
    }
    if (!includeStale) markers = markers.filter((m) => !m.stale);
    return markers.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
  }

  forget(project: string, id: string): boolean {
    if (!project) throw new Error("forget requires a project");
    if (!id) throw new Error("forget requires an id");
    const data = this.read();
    const bucket = data.projects[project];
    if (!bucket) return false;
    const before = bucket.markers.length;
    bucket.markers = bucket.markers.filter((m) => m.id !== id);
    if (bucket.markers.length === before) return false;
    this.write(data);
    return true;
  }
}
