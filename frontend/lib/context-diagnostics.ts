type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function modelInputDiagnostics(
  compression: RecordValue,
  progressive: RecordValue,
  usages: RecordValue[],
  diagnostics: RecordValue
) {
  const calls = Array.isArray(diagnostics.prompt_calls) ? diagnostics.prompt_calls : [];
  const latestCall = record(calls[calls.length - 1]);
  const latestUsage = record(usages[usages.length - 1]);
  const providerUsage = latestUsage.source === "provider" && typeof latestUsage.input_tokens === "number";
  const estimatedTokens = number(latestCall.estimated_prompt_tokens);
  const fallbackPressure = record(compression.pressure);
  const pressure = record(latestUsage.input_pressure ?? latestCall.pressure ?? compression.pressure ?? progressive.pressure);
  const inputTokens = providerUsage ? number(latestUsage.input_tokens) : estimatedTokens || number(pressure.token_usage);
  const windowTokens = number(pressure.effective_window_tokens) || number(fallbackPressure.effective_window_tokens);
  let stage = "normal";
  for (const [threshold, nextStage] of [
    ["warning_threshold", "warning"], ["auto_compact_threshold", "auto_compact"],
    ["aggressive_threshold", "aggressive"], ["manual_threshold", "manual_path"]
  ]) {
    if (number(pressure[threshold]) > 0 && inputTokens >= number(pressure[threshold])) stage = nextStage;
  }
  return {
    inputTokens,
    windowTokens,
    remainingTokens: Math.max(0, windowTokens - inputTokens),
    estimatedTokens,
    toolSchemaTokens: number(latestCall.tool_schema_tokens),
    providerUsage,
    stage,
    callCount: usages.length || calls.length,
  };
}
