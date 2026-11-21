import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../lib/knowledge-graph-labels.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`;
const { graphViewBox, placeGraphLabels } = await import(moduleUrl);

function assertSeparateLabels(labels) {
  const boxes = Array.from(labels.values(), (label) => label.box);
  for (let index = 0; index < boxes.length; index++) {
    const box = boxes[index];
    assert.ok(box.left >= graphViewBox.left && box.right <= graphViewBox.right);
    assert.ok(box.top >= graphViewBox.top && box.bottom <= graphViewBox.bottom);
    for (const other of boxes.slice(0, index)) {
      assert.ok(box.right <= other.left || other.right <= box.left ||
        box.bottom <= other.top || other.bottom <= box.top);
    }
  }
}

test("keeps the selected label in a cluster and skips names that cannot fit", () => {
  const nodes = Array.from({ length: 12 }, (_, index) => ({
    key: `issue:${index}`, title: `发布权限与配置检查任务 ${index}`, x: 360, y: 190, radius: 15,
  }));
  const labels = placeGraphLabels(nodes, [], "issue:11", 18);

  assert.ok(labels.has("issue:11"));
  assert.ok(labels.size < nodes.length);
  assertSeparateLabels(labels);
});

test("places relationship labels in available space without covering node names", () => {
  const nodes = [
    { key: "issue:1", title: "排查发布系统的请求超时", x: 180, y: 160, radius: 19 },
    { key: "pr:2", title: "修复缓存与数据库连接", x: 500, y: 160, radius: 15 },
  ];
  const relations = [
    { key: "edge:1", title: "修复", x: 340, y: 160 },
    { key: "edge:2", title: "提及", x: 340, y: 160 },
  ];
  const labels = placeGraphLabels(nodes, relations, "issue:1", 22);

  assert.ok(labels.has("issue:1") && labels.has("pr:2") && labels.has("edge:1"));
  assertSeparateLabels(labels);
});
