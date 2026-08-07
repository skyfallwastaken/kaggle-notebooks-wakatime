export interface NotebookMetadata { owner: string; slug: string; title: string; entity: string; project: string }
export interface Activity { kind: "activity"; lines: number; lineno: number; cursorpos: number; language: string; dependencies: string[]; isWrite: boolean; force: boolean; lineAdditions: number; lineDeletions: number; humanLineChanges: number; partial?: boolean }
export type ExtensionMessage = { kind: "metadata"; metadata: NotebookMetadata } | Activity;

export function validActivity(value: unknown): value is Activity {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const positionIsValid = ["lines", "lineno", "cursorpos"].every(
    key => Number.isInteger(v[key]) && Number(v[key]) >= 1,
  );
  const changesAreValid = ["lineAdditions", "lineDeletions", "humanLineChanges"].every(
    key => Number.isInteger(v[key]) && Number(v[key]) >= 0,
  );
  return v.kind === "activity" && positionIsValid && changesAreValid &&
    Number(v.lineno) <= Number(v.lines) &&
    typeof v.language === "string" && v.language.length > 0 && v.language.length < 200 &&
    Array.isArray(v.dependencies) && v.dependencies.length <= 1000 &&
    v.dependencies.every(dependency => typeof dependency === "string" && dependency.length > 0 && dependency.length < 500) &&
    typeof v.isWrite === "boolean" && typeof v.force === "boolean";
}

export function validMetadata(value: unknown): value is NotebookMetadata {
  if (!value || typeof value !== "object") return false;
  const metadata = value as Record<string, unknown>;
  return ["owner", "slug", "title", "entity", "project"].every(
    key => typeof metadata[key] === "string" && metadata[key].length > 0 && metadata[key].length < 1000,
  );
}

export function decodeBridgeDetail(detail: unknown): Activity | null {
  if (typeof detail !== "string" || detail.length > 100_000) return null;
  try {
    const value: unknown = JSON.parse(detail);
    if (!validActivity(value)) return null;
    return {
      kind: "activity", lines: value.lines, lineno: value.lineno, cursorpos: value.cursorpos,
      language: value.language, dependencies: [...value.dependencies], isWrite: value.isWrite,
      force: value.force, lineAdditions: value.lineAdditions, lineDeletions: value.lineDeletions,
      humanLineChanges: value.humanLineChanges, ...(value.partial === true ? { partial: true } : {}),
    };
  } catch { return null; }
}
