import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../lib/api.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { apiPostStream, apiGet } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("streams preserve LF, CRLF and CR frames across arbitrary UTF-8 chunks", async (t) => {
  const encoder = new TextEncoder();
  for (const ending of ["\n", "\r\n", "\r"]) {
    const wire = [": heartbeat", "event:delta", 'data:{"text":', 'data:"中文"}', "", "event: done", 'data: {"ok":true}', "", ""].join(ending);
    const bytes = encoder.encode(wire);
    const stream = new ReadableStream({
      start(controller) {
        for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      },
    });
    t.mock.method(globalThis, "fetch", async () => new Response(stream));
    const events = [];
    await apiPostStream("/test", {}, (event, data) => events.push([event, data]));
    assert.deepEqual(events, [["delta", { text: "中文" }], ["done", { ok: true }]]);
    assert.equal(stream.locked, false);
    t.mock.restoreAll();
  }
});

test("a failed event consumer cancels and unlocks its stream", async (t) => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('data: {"ok":true}\n\n')); },
    cancel() { cancelled = true; },
  });
  t.mock.method(globalThis, "fetch", async () => new Response(stream));
  await assert.rejects(apiPostStream("/test", {}, () => { throw new Error("consumer failed"); }), /consumer failed/);
  assert.equal(cancelled, true);
  assert.equal(stream.locked, false);
});

test("JSON validation errors retain the API's useful message", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json({ detail: [{ msg: "question is required" }] }, { status: 422 }));
  await assert.rejects(apiGet("/test"), /question is required/);
});
