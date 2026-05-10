type DiagnosticCheckStatus = 'pass' | 'fail';

type DiagnosticCheck = {
  label: string;
  status: DiagnosticCheckStatus;
  section: string;
};

type DiagnosticSection = {
  name: string;
  status: 'pass' | 'fail' | 'pending';
  pass_count: number;
  fail_count: number;
  line: string;
};

const DEFAULT_SECTION = 'ungrouped';

export function create_tool_assisted_inputs_diagnostic_report(): {
  reset: () => void;
  record_failure: (failure: Record<string, unknown>) => void;
  record_marker: (label: string) => void;
  record_check: (label: string, status: DiagnosticCheckStatus) => void;
  failure_count: () => number;
  passed: () => boolean;
  get_compact_report: () => {
    status: 'pass' | 'fail';
    current_section: string;
    total_failures: number;
    total_checks: number;
    sections: DiagnosticSection[];
    failed_checks: DiagnosticCheck[];
    recent_checks: DiagnosticCheck[];
    summary: string;
    text_lines: string[];
    compact_text: string;
  };
} {
  let failures: Array<Record<string, unknown>> = [];
  let checks: DiagnosticCheck[] = [];
  let section_order: string[] = [];
  let current_section = DEFAULT_SECTION;

  function ensure_section(name: string): void {
    if (!section_order.includes(name)) section_order.push(name);
  }

  function normalize_label(value: string): string {
    const trimmed = String(value ?? '').trim();
    return trimmed || 'unnamed_check';
  }

  function get_sections(): DiagnosticSection[] {
    return section_order.map((name) => {
      const section_checks = checks.filter((check) => check.section === name);
      const pass_count = section_checks.filter((check) => check.status === 'pass').length;
      const fail_count = section_checks.filter((check) => check.status === 'fail').length;
      const status = fail_count > 0 ? 'fail' : (section_checks.length > 0 ? 'pass' : 'pending');
      const emoji = status === 'pass' ? 'pass' : status === 'fail' ? 'fail' : 'pending';
      return {
        name,
        status,
        pass_count,
        fail_count,
        line: `${name}: ${emoji} (${pass_count} pass, ${fail_count} fail)`,
      };
    });
  }

  function build_summary(sections: DiagnosticSection[]): string {
    const failed_sections = sections.filter((section) => section.status === 'fail').map((section) => section.name);
    if (failed_sections.length > 0) return `Failed sections: ${failed_sections.join(', ')}`;
    if (checks.length > 0) return 'All recorded checks passed.';
    if (failures.length > 0) return 'Failures recorded without named checks.';
    return 'No checks were recorded.';
  }

  return {
    reset(): void {
      failures = [];
      checks = [];
      section_order = [];
      current_section = DEFAULT_SECTION;
      ensure_section(DEFAULT_SECTION);
    },
    record_failure(failure): void { failures.push(failure); },
    record_marker(label): void {
      current_section = normalize_label(label);
      ensure_section(current_section);
    },
    record_check(label, status): void {
      ensure_section(current_section);
      checks.push({
        label: normalize_label(label),
        status,
        section: current_section,
      });
    },
    failure_count(): number { return failures.length; },
    passed(): boolean { return failures.length === 0; },
    get_compact_report() {
      const sections = get_sections();
      const failed_checks = checks.filter((check) => check.status === 'fail');
      const summary = build_summary(sections);
      const text_lines = [
        `status: ${failures.length === 0 ? 'pass' : 'fail'}`,
        `checks: ${checks.length}`,
        `failures: ${failures.length}`,
        ...sections.map((section) => section.line),
        ...failed_checks.slice(0, 8).map((check) => `${check.section} / ${check.label}: fail`),
        `summary: ${summary}`,
      ];
      return {
        status: failures.length === 0 ? 'pass' : 'fail',
        current_section,
        total_failures: failures.length,
        total_checks: checks.length,
        sections,
        failed_checks: failed_checks.slice(0, 12),
        recent_checks: checks.slice(-12),
        summary,
        text_lines,
        compact_text: text_lines.join(' | '),
      };
    },
  };
}
