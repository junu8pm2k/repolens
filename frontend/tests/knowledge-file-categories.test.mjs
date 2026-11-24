import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../lib/knowledge-file-categories.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { groupKnowledgeFiles } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

test("groups by repository paths, titles and manifest metadata without dropping files", () => {
  const files = [
    { path: "notes/context.md" },
    { path: "evals\\activation\\README.md" },
    { path: "apps/cli/package.json", manifest: true },
    { path: "README.md" },
    { path: "docs/feature.md", title: "API 设计" },
    { path: "生产部署指南.pdf" },
    { path: "回归_测试报告.docx" },
  ];

  const groups = groupKnowledgeFiles(files, (file) => file);

  assert.deepEqual(groups.map(({ id }) => id), ["overview", "guide", "development", "testing", "configuration", "other"]);
  assert.deepEqual(groups.map(({ files }) => files), [[files[3]], [files[5]], [files[4]], [files[1], files[6]], [files[2]], [files[0]]]);
});

test("omits empty categories and puts an unfamiliar upload in other materials", () => {
  assert.deepEqual(groupKnowledgeFiles([], (file) => file), []);
  const files = [{ name: "record.pdf" }];
  assert.deepEqual(groupKnowledgeFiles(files, (file) => ({ path: file.name })), [
    { id: "other", label: "其他资料", files },
  ]);
});
