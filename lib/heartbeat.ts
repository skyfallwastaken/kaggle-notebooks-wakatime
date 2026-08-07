import type { Activity, NotebookMetadata } from "./types";
export const DEFAULT_ENDPOINT = "https://hackatime.hackclub.com/api/hackatime/v1/users/current/heartbeats";
export interface Boundaries { now: () => number; fetch: typeof fetch; getLast: (entity: string) => Promise<number>; setLast: (entity: string, time: number) => Promise<void>; timeout?: number }
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
    user_agent: `kaggle-wakatime/0.1.0 ${navigator.userAgent}`,
    plugin: "kaggle-notebooks-wakatime/0.1.0",
    line_additions: activity.lineAdditions,
    line_deletions: activity.lineDeletions,
    human_line_changes: activity.humanLineChanges,
  };
}
async function submitUnlocked(meta: NotebookMetadata, activity: Activity, settings: { apiKey: string; endpoint: string; machine: string }, b: Boundaries): Promise<boolean> {
  const now = b.now(), last = await b.getLast(meta.entity);
  if (!activity.force && now - last < 120) return false;
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), b.timeout ?? 5000);
  try {
    const send = b.fetch;
    const response = await send(settings.endpoint, { method: "POST", headers: { Authorization: `Basic ${btoa(settings.apiKey)}`, "Content-Type": "application/json" }, body: JSON.stringify([createPayload(meta, activity, settings.machine, now)]), signal: controller.signal });
    if (!response.ok) throw new Error("Heartbeat request failed");
    await b.setLast(meta.entity, now); return true;
  } catch { throw new Error("Heartbeat request failed"); } finally { clearTimeout(timer); }
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
