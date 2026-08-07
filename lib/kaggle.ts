import type { NotebookMetadata } from "./types";

export function parseKaggle(url: string, title: string): NotebookMetadata | null {
  const match = new URL(url).pathname.match(/^\/code\/([^/]+)\/([^/]+)\/edit\/?$/);
  if (!match) return null;

  const owner = decodeURIComponent(match[1]!);
  const slug = decodeURIComponent(match[2]!);
  const cleanTitle = title.replace(/\s*[|·]\s*Kaggle.*$/i, "").trim() || slug;
  return {
    owner,
    slug,
    title: cleanTitle,
    entity: `/kaggle/notebooks/${owner}/${slug}.ipynb`,
    project: cleanTitle,
  };
}
