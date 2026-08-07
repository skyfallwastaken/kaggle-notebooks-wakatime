import { BRIDGE_EVENT } from "../lib/bridge";
import { baseUrlFromDocument, contentsCandidates, fetchNotebook, mergeObservedCells, rememberVisibleCells } from "../lib/contents";
import { createActivityBuilder, domCursor, visibleDomCells, type Cell } from "../lib/notebook";
import { createActivityScheduler } from "../lib/scheduling";

declare global { interface Window { jupyterapp?: any } }

export default defineContentScript({ matches: ["https://*.jupyter-proxy.kaggle.net/*"], allFrames: true, world: "MAIN", runAt: "document_idle", main() {
  const build = createActivityBuilder();
  const connectedPanels = new WeakSet<object>();
  const observedCells = new Map<number, Cell>();
  let connectedApp: unknown, cache: { at: number; cells: Cell[] } | null = null;
  const emit = (cells: Cell[], write = false, force = false, partial = false, kernel = "Python", cursor = domCursor() ?? { cell: 0, line: 0, column: 0 }) => {
    document.dispatchEvent(new CustomEvent(BRIDGE_EVENT, { detail: JSON.stringify(build(cells, cursor, write, force, partial, kernel)) }));
  };
  const modelSnapshot = (write = false, force = false): boolean => {
    const panel = window.jupyterapp?.shell?.currentWidget, content = panel?.content, widgets = content?.widgets;
    if (!panel?.context?.path || !Array.isArray(widgets)) return false;
    const cells = widgets.map((widget: any, index: number) => ({ cell_type: widget.model?.type ?? "code", source: widget.model?.sharedModel?.getSource?.() ?? "", id: widget.model?.id, index }));
    const position = content.activeCell?.editor?.getCursorPosition?.() ?? { line: 0, column: 0 };
    emit(cells, write, force, false, panel.sessionContext?.kernelDisplayName, { cell: content.activeCellIndex ?? 0, ...position });
    return true;
  };
  const apiSnapshot = async (write = false, force = false) => {
    if (!cache || Date.now() - cache.at > 3000) {
      const cells = await fetchNotebook(fetch, baseUrlFromDocument(), contentsCandidates());
      if (!cells) return false;
      cache = { at: Date.now(), cells };
    }
    const visibleCells = visibleDomCells().cells;
    rememberVisibleCells(observedCells, visibleCells);
    const cells = mergeObservedCells(cache.cells, observedCells);
    const cursor = domCursor();
    emit(cells, write, force, false, "Python", cursor ?? undefined);
    return true;
  };
  const refresh = async (write = false, force = false) => {
    if (!modelSnapshot(write, force) && !(await apiSnapshot(write, force))) {
      const fallback = visibleDomCells(); emit(fallback.cells, write, force, true);
    }
  };
  const scheduler = createActivityScheduler(refresh);
  const connectPanel = (panel: any) => {
    if (!panel || connectedPanels.has(panel)) return;
    connectedPanels.add(panel);
    panel.content?.activeCellChanged?.connect?.(() => void refresh());
    panel.context?.model?.contentChanged?.connect?.(() => {
      scheduler.input();
    });
  };
  const connect = async () => {
    const app = window.jupyterapp;
    if (!app || app === connectedApp) return;
    await app.started;
    if (app === connectedApp) return;
    connectedApp = app;
    app.shell?.currentChanged?.connect?.(() => {
      connectPanel(app.shell?.currentWidget);
      void refresh();
    });
    connectPanel(app.shell?.currentWidget);
    void refresh();
  };
  void refresh(); void connect();
  const appPoll = window.setInterval(() => { void connect(); if (connectedApp) clearInterval(appPoll); }, 250);
  document.addEventListener("beforeinput", scheduler.beforeInput, true);
  document.addEventListener("selectionchange", scheduler.selection);
  document.addEventListener("input", scheduler.input, true);
  document.addEventListener("keydown", event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") scheduler.save(); }, true);
} });
