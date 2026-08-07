import { describe, expect, test } from "vitest";
import { createActivityBuilder, dependencies, domCursor, languageFor, lineChanges, snapshot, visibleDomCells } from "../lib/notebook";
import { createActivityScheduler } from "../lib/scheduling";

describe("notebook calculations", () => {
  test("flattens notebook lines globally", () => expect(snapshot([{ cell_type: "code", source: "a\nb" }, { cell_type: "code", source: "c\nd" }], { cell: 1, line: 1, column: 0 })).toMatchObject({ lines: 4, lineno: 4 }));
  test("clamps line and cursor to selected line", () => expect(snapshot([{ cell_type: "code", source: "abc" }], { cell: 0, line: 99, column: 99 })).toMatchObject({ lineno: 1, cursorpos: 4 }));
  test("parses imports and ignores comments and relative modules", () => expect(dependencies([{ cell_type: "code", source: "import a, b as c # import no\nfrom package.module import x\nfrom .relative import y\n# import hidden" }])).toEqual(["a", "b", "package"]));
  test("normalizes kernels and detects magic", () => { expect(languageFor({ cell_type: "code", source: "x" }, "Python 3")).toBe("Python"); expect(languageFor({ cell_type: "code", source: "%%sql\nx" }, "Python 3")).toBe("SQL"); });
  test("uses bounded prefix and suffix changes", () => { const lines = Array.from({ length: 20_000 }, (_, i) => String(i)); expect(lineChanges(lines.join("\n"), [...lines.slice(0, 10_000), "new", ...lines.slice(10_001)].join("\n"))).toEqual({ lineAdditions: 1, lineDeletions: 1, humanLineChanges: 2 }); });
  test("keeps independent cell baselines", () => { const build = createActivityBuilder(), cells = [{ id: "a", cell_type: "code", source: "a" }, { id: "b", cell_type: "code", source: "b" }]; expect(build(cells, { cell: 0, line: 0, column: 0 }).humanLineChanges).toBe(0); expect(build(cells, { cell: 1, line: 0, column: 0 }, true).humanLineChanges).toBe(0); cells[0]!.source = "a\nnew"; expect(build(cells, { cell: 0, line: 1, column: 1 }, true).lineAdditions).toBe(1); });
  test("does not let selection snapshots erase pending edits", () => {
    const build = createActivityBuilder();
    const cells = [{ id: "a", cell_type: "code", source: "a" }];
    build(cells, { cell: 0, line: 0, column: 0 });
    cells[0]!.source = "a\nnew";
    expect(build(cells, { cell: 0, line: 1, column: 0 }).humanLineChanges).toBe(0);
    expect(build(cells, { cell: 0, line: 1, column: 0 }, true)).toMatchObject({
      lineAdditions: 1, lineDeletions: 0, humanLineChanges: 1,
    });
  });
  test("does not let cursor events pre-empt a pending write", async () => {
    const callbacks = new Map<number, () => void>();
    let nextId = 1;
    const refreshes: [boolean | undefined, boolean | undefined][] = [];
    const scheduler = createActivityScheduler(
      async (write, force) => { refreshes.push([write, force]); },
      {
        set: callback => { const id = nextId++; callbacks.set(id, callback); return id; },
        clear: id => { callbacks.delete(id); },
      },
    );
    scheduler.beforeInput();
    scheduler.selection();
    scheduler.input();
    expect(callbacks.size).toBe(1);
    callbacks.values().next().value!();
    await Promise.resolve();
    expect(refreshes).toEqual([[true, undefined]]);
  });
  test("extracts cursor only from CodeMirror line content", () => { document.body.innerHTML = '<div class="jp-Cell" data-windowed-list-index="7"><span>In [1]</span><div class="cm-content"><div class="cm-line">one</div><div class="cm-line">two</div></div><div>output</div></div>'; const text = document.querySelectorAll(".cm-line")[1]!.firstChild!; const range = document.createRange(); range.setStart(text, 2); range.collapse(); getSelection()!.removeAllRanges(); getSelection()!.addRange(range); expect(domCursor()).toEqual({ cell: 7, line: 1, column: 2 }); });
  test("returns partial virtualized cells without output", () => { document.body.innerHTML = '<div class="jp-Cell" data-windowed-list-index="12"><div class="cm-content">source</div><div>secret output</div></div>'; expect(visibleDomCells()).toEqual({ partial: true, cells: [{ cell_type: "code", source: "source", index: 12 }] }); });
});
