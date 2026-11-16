import type { NotebookMetadata } from "./types";

// Titles Kaggle shows before the notebook's real title has loaded. The editor
// sets "Kaggle Notebook Editor" on every full load and every in-app navigation
// into an editor, and the server-rendered shell uses the site-wide title.
const PLACEHOLDER_TITLES = new Set(["kaggle notebook editor", "kaggle: your home for data science", "kaggle"]);

function cleanTitle(title: string) {
  return title.replace(/\s*[|·]\s*Kaggle.*$/i, "").trim();
}

/** Whether a document title names the notebook rather than being a Kaggle loading placeholder. */
export function hasNotebookTitle(title: string) {
  const clean = cleanTitle(title);
  return clean.length > 0 && !PLACEHOLDER_TITLES.has(clean.toLowerCase());
}

export function parseKaggle(url: string, title: string): NotebookMetadata | null {
  const match = new URL(url).pathname.match(/^\/code\/([^/]+)\/([^/]+)\/edit\/?$/);
  if (!match) return null;

  const owner = decodeURIComponent(match[1]!);
  const slug = decodeURIComponent(match[2]!);
  const name = hasNotebookTitle(title) ? cleanTitle(title) : slug;
  return {
    owner,
    slug,
    title: name,
    entity: `/kaggle/notebooks/${owner}/${slug}.ipynb`,
    project: name,
  };
}
