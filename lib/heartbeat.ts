import type { Activity, NotebookMetadata } from "./types";
export const DEFAULT_ENDPOINT = "https://hackatime.hackclub.com/api/hackatime/v1/users/current/heartbeats";
export interface Boundaries { now: () => number; fetch: typeof fetch; getLast: (entity: string) => Promise<number>; setLast: (entity: string, time: number) => Promise<void>; timeout?: number }
export type HeartbeatFailureReason = "http" | "network" | "timeout";
export function normaliseEndpoint(endpoint: string) { return endpoint.trim().replace(/\/+$/, ""); }
export class HeartbeatRequestError extends Error {
  constructor(public readonly reason: HeartbeatFailureReason, public readonly status?: number) {
    super("Heartbeat request failed");
  }
}

export function heartbeatFailureMessage(error: unknown) {
  if (!(error instanceof HeartbeatRequestError)) return "Heartbeat request failed.";
  if (error.reason === "timeout") return "The heartbeat endpoint timed out.";
  if (error.reason === "network") return "The heartbeat endpoint could not be reached.";
  if (error.status === 401) return "The heartbeat endpoint rejected the API key.";
  if (error.status === 403) return "The heartbeat endpoint refused this account.";
  if (error.status === 422) return "The heartbeat endpoint rejected the heartbeat data.";
  if (error.status === 429) return "The heartbeat endpoint rate limit was reached.";
  if (error.status && error.status >= 500) return "The heartbeat endpoint is temporarily unavailable.";
  return `The heartbeat endpoint returned HTTP ${error.status ?? "error"}.`;
}

export function createPayload(meta: NotebookMetadata, activity: Activity, machine: string, now = Date.now() / 1000) {
  return {
    entity: meta.entity,
    type: "file",
    category: "coding",
    time: now,
    project: meta.project,
    language: activity.language,
    dependencies: activity.dependencies,
    lines: activity.lines,
    lineno: activity.lineno,
    cursorpos: activity.cursorpos,
    is_write: activity.isWrite,
    project_root_count: Math.max(0, meta.entity.split("/").filter(Boolean).length - 1),
    editor: "Kaggle Notebooks",
    operating_system: navigator.platform || "Unknown",
    machine,
    user_agent: `kaggle-wakatime/0.1.4 ${navigator.userAgent}`,
    plugin: "kaggle-notebooks-wakatime/0.1.4",
    line_additions: activity.lineAdditions,
    line_deletions: activity.lineDeletions,
    human_line_changes: activity.humanLineChanges,
  };
}

async function postPayload(payload: ReturnType<typeof createPayload>, settings: { apiKey: string; endpoint: string }, request: typeof fetch, timeout = 10_000) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeout);
  let response: Response;
  try {
    response = await request.call(globalThis, normaliseEndpoint(settings.endpoint), {
      method: "POST",
      headers: { Authorization: `Basic ${btoa(settings.apiKey.trim())}`, "Content-Type": "application/json" },
      body: JSON.stringify([payload]),
      signal: controller.signal,
    });
  } catch {
    throw new HeartbeatRequestError(controller.signal.aborted ? "timeout" : "network");
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) throw new HeartbeatRequestError("http", response.status);
}

async function submitUnlocked(meta: NotebookMetadata, activity: Activity, settings: { apiKey: string; endpoint: string; machine: string }, b: Boundaries): Promise<boolean> {
  const now = b.now(), last = await b.getLast(meta.entity);
  if (!activity.force && now - last < 120) return false;
  await postPayload(createPayload(meta, activity, settings.machine, now), settings, b.fetch, b.timeout);
  await b.setLast(meta.entity, now);
  return true;
}

export async function testHeartbeatConnection(settings: { apiKey: string; endpoint: string }, request: typeof fetch = fetch, timeout = 10_000) {
  const metadata = { owner: "connection-test", slug: "test", title: "Connection test", entity: "test.txt", project: "Kaggle Notebooks" };
  const activity = { kind: "activity" as const, lines: 1, lineno: 1, cursorpos: 1, language: "Text", dependencies: [], isWrite: false, force: true, lineAdditions: 0, lineDeletions: 0, humanLineChanges: 0 };
  await postPayload(createPayload(metadata, activity, "kaggle-connection-test"), settings, request, timeout);
}

export function createSubmitter() {
  const pending = new Map<string, Promise<unknown>>();
  return async (meta: NotebookMetadata, activity: Activity, settings: { apiKey: string; endpoint: string; machine: string }, boundaries: Boundaries): Promise<boolean> => {
    const previous = pending.get(meta.entity) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(
      () => submitUnlocked(meta, activity, settings, boundaries),
    );
    pending.set(meta.entity, current);
    try {
      return await current;
    } finally {
      if (pending.get(meta.entity) === current) pending.delete(meta.entity);
    }
  };
}

export const submit = createSubmitter();
