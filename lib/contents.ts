import type { Cell } from "./notebook";

export function baseUrlFromDocument(root: ParentNode = document): string {
  const text = root.querySelector<HTMLScriptElement>("#jupyter-config-data")?.textContent;
  try { return new URL(JSON.parse(text || "{}").baseUrl || "/", location.origin).href; } catch { return new URL("/", location.origin).href; }
}

export function contentsCandidates(search = location.search, title = document.title): string[] {
  const query = new URLSearchParams(search);
  return [...new Set([query.get("path"), query.get("notebook"), "__notebook_source__.ipynb", "__notebook_source__", title.replace(/\s*[|].*$/, "").trim()].filter(Boolean) as string[])];
}

export function contentsUrl(base: string, path: string): string {
  const encoded = path.replace(/^\/+/, "").split("/").map(encodeURIComponent).join("/");
  const url = new URL(`api/contents/${encoded.endsWith(".ipynb") ? encoded : `${encoded}.ipynb`}`, base);
  url.search = new URLSearchParams({ content: "1", type: "notebook", format: "json" }).toString();
  return url.href;
}

export async function fetchNotebook(fetcher: typeof fetch, base: string, candidates: string[]): Promise<Cell[] | null> {
  for (const path of candidates) try {
    const response = await fetcher(contentsUrl(base, path), { credentials: "same-origin", headers: { Accept: "application/json" } });
    if (!response.ok) continue;
    const data = await response.json();
    if (Array.isArray(data.content?.cells)) return data.content.cells;
  } catch { /* Try the next configured path. */ }
  return null;
}

export function rememberVisibleCells(observed: Map<number, Cell>, cells: Cell[]): void {
  for (const [localIndex, cell] of cells.entries()) {
    const globalIndex = cell.index ?? localIndex;
    observed.set(globalIndex, { ...cell, index: globalIndex });
  }
}

export function mergeObservedCells(cells: Cell[], observed: ReadonlyMap<number, Cell>): Cell[] {
  const merged = new Map<number, Cell>();
  cells.forEach((cell, index) => {
    const globalIndex = cell.index ?? index;
    merged.set(globalIndex, { ...cell, index: globalIndex });
  });
  for (const [index, cell] of observed) merged.set(index, { ...merged.get(index), ...cell, index });
  return [...merged.values()].sort((left, right) => (left.index ?? 0) - (right.index ?? 0));
}
