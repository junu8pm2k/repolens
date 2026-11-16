import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../lib/context-diagnostics.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { modelInputDiagnostics } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

const pressure = { effective_window_tokens: 24000, token_usage: 13253, warning_threshold: 13200,
  auto_compact_threshold: 19200, aggressive_threshold: 21000, manual_threshold: 22500 };
const compression = { pressure, assembled_prompt_estimated_tokens: 7091 };
const diagnostics = { prompt_calls: [{ estimated_prompt_tokens: 37657, tool_schema_tokens: 25321, pressure }] };

test("historical diagnostics use provider input rather than raw history as window occupancy", () => {
  const result = modelInputDiagnostics(compression, {}, [{ source: "provider", input_tokens: 23266 }], diagnostics);
  assert.equal(result.inputTokens, 23266);
  assert.equal(result.remainingTokens, 734);
  assert.equal(result.estimatedTokens, 37657);
  assert.equal(result.stage, "manual_path");
  assert.equal(result.providerUsage, true);
});

test("without provider usage, occupancy includes the complete estimated prompt", () => {
  const result = modelInputDiagnostics(compression, {}, [], diagnostics);
  assert.equal(result.inputTokens, 37657);
  assert.equal(result.remainingTokens, 0);
  assert.equal(result.providerUsage, false);
});

test("unbound final synthesis may legitimately have no tool-schema tokens", () => {
  const result = modelInputDiagnostics(compression, {}, [{ source: "provider", input_tokens: 1200 }], {
    prompt_calls: [{ estimated_prompt_tokens: 1600, tool_schema_tokens: 0, pressure }],
  });
  assert.equal(result.toolSchemaTokens, 0);
  assert.equal(result.stage, "normal");
});
