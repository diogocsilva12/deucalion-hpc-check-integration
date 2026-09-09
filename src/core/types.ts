export interface HpcPosition {
  line: number;
  character: number;
}

export interface HpcDiagnostic {
  code: string;
  message: string;
  severity: 'error' | 'warning' | 'information';
  range: { start: HpcPosition; end: HpcPosition };
  sourceUrl?: string;
}
