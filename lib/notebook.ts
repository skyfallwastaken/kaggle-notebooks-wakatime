import type { Activity } from "./types";

export interface Cell { cell_type: string; source: string | string[]; index?: number; id?: string }
export interface Cursor { cell: number; line: number; column: number }
const sourceOf = (cell: Cell) => Array.isArray(cell.source) ? cell.source.join("") : cell.source;
const linesOf = (source: string) => source.split("\n");

export function dependencies(cells: Cell[]): string[] {
  const names = new Set<string>();
  for (const cell of cells.filter(cell => cell.cell_type === "code")) {
    for (const raw of sourceOf(cell).split("\n")) {
      const line = raw.replace(/#.*$/, "");
      const direct = line.match(/^\s*import\s+(.+)$/)?.[1];
      if (direct) for (const part of direct.split(",")) {
        const name = part.trim().match(/^([A-Za-z_]\w*)/)?.[1];
        if (name) names.add(name);
      }
      const from = line.match(/^\s*from\s+(\.*)([A-Za-z_]\w*)?(?:\.\w+)*\s+import\s+/);
      if (from?.[1] === "" && from[2]) names.add(from[2]);
    }
  }
  return [...names].sort();
}

const normalizedKernel = (kernel: string) => {
  if (/^python(?:\s*\d+(?:\.\d+)*)?$/i.test(kernel.trim())) return "Python";
  return kernel.trim() || "Python";
};

export function languageFor(cell: Cell | undefined, kernel = "Python"): string {
  if (!cell || cell.cell_type !== "code") return cell?.cell_type === "markdown" ? "Markdown" : normalizedKernel(kernel);
  const magic = sourceOf(cell).match(/^\s*%%(bash|sh|javascript|js|r|sql|html|ruby)\b/i)?.[1]?.toLowerCase();
  return ({ sh: "Bash", bash: "Bash", js: "JavaScript", javascript: "JavaScript", r: "R", sql: "SQL", html: "HTML", ruby: "Ruby" } as Record<string, string>)[magic ?? ""] ?? normalizedKernel(kernel);
}

export function snapshot(cells: Cell[], cursor: Cursor, kernel = "Python") {
  const safeCells = cells.length ? cells : [{ cell_type: "code", source: "", index: 0 }];
  const active = Math.max(0, safeCells.findIndex((cell, index) => (cell.index ?? index) === cursor.cell));
  const counts = safeCells.map(cell => Math.max(1, linesOf(sourceOf(cell)).length));
  const lines = Math.max(1, counts.reduce((sum, count) => sum + count, 0));
  const local = Math.min(Math.max(0, cursor.line), counts[active]! - 1);
  const lineno = Math.min(lines, Math.max(1, counts.slice(0, active).reduce((sum, count) => sum + count, 0) + local + 1));
  const selectedLine = linesOf(sourceOf(safeCells[active]!))[local] ?? "";
  return {
    lines, lineno, cursorpos: Math.min(selectedLine.length + 1, Math.max(1, cursor.column + 1)),
    language: languageFor(safeCells[active], kernel), dependencies: dependencies(safeCells),
    activeSource: sourceOf(safeCells[active]!), active,
  };
}

export function lineChanges(before: string, after: string) {
  const oldLines = linesOf(before), newLines = linesOf(after);
  let prefix = 0;
  while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix]) prefix++;
  let suffix = 0;
  while (suffix < oldLines.length - prefix && suffix < newLines.length - prefix && oldLines.at(-1 - suffix) === newLines.at(-1 - suffix)) suffix++;
  const lineAdditions = newLines.length - prefix - suffix;
  const lineDeletions = oldLines.length - prefix - suffix;
  return { lineAdditions, lineDeletions, humanLineChanges: lineAdditions + lineDeletions };
}

export function createActivityBuilder() {
  const baselines = new Map<string, string>();
  return (cells: Cell[], cursor: Cursor, write = false, force = false, partial = false, kernel = "Python"): Activity => {
    const data = snapshot(cells, cursor, kernel);
    const cell = cells[data.active];
    const key = cell?.id ?? String(cell?.index ?? data.active);
    const previous = baselines.get(key);
    const changes = write && previous !== undefined ? lineChanges(previous, data.activeSource) : { lineAdditions: 0, lineDeletions: 0, humanLineChanges: 0 };
    if (previous === undefined || write) baselines.set(key, data.activeSource);
    return { kind: "activity", lines: data.lines, lineno: data.lineno, cursorpos: data.cursorpos, language: data.language, dependencies: data.dependencies, isWrite: write, force, ...changes, ...(partial ? { partial: true } : {}) };
  };
}

function cellElement(anchor: Node): HTMLElement | null {
  const element = anchor.nodeType === Node.ELEMENT_NODE ? anchor as Element : anchor.parentElement;
  return element?.closest<HTMLElement>(".jp-Cell, .jp-CodeCell, [data-cell-index]") ?? null;
}

export function domCursor(root: ParentNode = document): Cursor | null {
  const selection = window.getSelection(), anchor = selection?.anchorNode;
  if (!selection || !anchor) return null;
  const cell = cellElement(anchor), content = cell?.querySelector<HTMLElement>(".cm-content") ?? (cell?.matches("[data-cell-index]") ? cell : null);
  if (!cell || !content || !content.contains(anchor)) return null;

  const editorLine = (anchor.nodeType === Node.ELEMENT_NODE ? anchor as Element : anchor.parentElement)?.closest<HTMLElement>(".cm-line");
  let line = 0;
  let column = 0;
  if (editorLine && content.contains(editorLine)) {
    line = [...content.querySelectorAll(".cm-line")].indexOf(editorLine);
    const range = document.createRange();
    range.selectNodeContents(editorLine);
    range.setEnd(anchor, selection.anchorOffset);
    column = range.toString().length;
  } else {
    const range = document.createRange();
    range.selectNodeContents(content);
    range.setEnd(anchor, selection.anchorOffset);
    const parts = range.toString().split("\n");
    line = parts.length - 1;
    column = parts.at(-1)?.length ?? 0;
  }

  return {
    cell: Number(cell.dataset.windowedListIndex ?? cell.dataset.cellIndex ?? 0),
    line: Math.max(0, line),
    column,
  };
}

export function visibleDomCells(root: ParentNode = document): { cells: Cell[]; partial: true } {
  const elements = [...root.querySelectorAll<HTMLElement>(".jp-Cell, [data-cell-index]")];
  return {
    cells: elements.flatMap((element, localIndex) => {
      const content = element.querySelector<HTMLElement>(".cm-content") ?? (element.matches("[data-cell-index]") ? element : null);
      if (!content) return [];
      return [{ cell_type: element.classList.contains("jp-MarkdownCell") || element.dataset.cellType === "markdown" ? "markdown" : "code", source: content.innerText, index: Number(element.dataset.windowedListIndex ?? element.dataset.cellIndex ?? localIndex) }];
    }), partial: true,
  };
}
