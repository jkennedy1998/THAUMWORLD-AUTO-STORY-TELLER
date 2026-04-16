export function create_tool_assisted_inputs_diagnostic_report(): {
  reset: () => void;
  record_failure: (failure: Record<string, unknown>) => void;
  failure_count: () => number;
  passed: () => boolean;
} {
  let failures: Array<Record<string, unknown>> = [];
  return {
    reset(): void { failures = []; },
    record_failure(failure): void { failures.push(failure); },
    failure_count(): number { return failures.length; },
    passed(): boolean { return failures.length === 0; },
  };
}
