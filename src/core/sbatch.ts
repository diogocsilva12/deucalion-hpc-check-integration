import { DEUCALION_PROFILE } from './deucalion';
import type { HpcDiagnostic } from './types';

interface Heredoc {
  delimiter: string;
  stripTabs: boolean;
}

interface Token {
  value: string;
  start: number;
  end: number;
}

interface OptionOccurrence {
  name: string;
  value?: string;
  valueStart: number;
  valueEnd: number;
}

interface ValidationState {
  memoryMode?: string;
  policyReported: boolean;
}

const REQUIRED_VALUES = new Set([
  'array',
  'cpus-per-gpu',
  'cpus-per-task',
  'mem',
  'mem-per-cpu',
  'mem-per-gpu',
  'nodes',
  'ntasks',
  'ntasks-per-core',
  'ntasks-per-node',
  'ntasks-per-socket',
  'partition',
  'qos',
  'time',
  'time-min',
]);

const SHORT_OPTIONS: Readonly<Record<string, string>> = Object.freeze({
  a: 'array',
  c: 'cpus-per-task',
  N: 'nodes',
  n: 'ntasks',
  p: 'partition',
  q: 'qos',
  t: 'time',
});

const CLUSTER_BOUND_OPTIONS = REQUIRED_VALUES;

function lineDiagnostic(
  code: string,
  message: string,
  severity: HpcDiagnostic['severity'],
  line: number,
  text: string,
): HpcDiagnostic {
  return {
    code,
    message,
    severity,
    range: {
      start: { line, character: 0 },
      end: { line, character: text.length },
    },
  };
}

function heredocsStartedBy(line: string): Heredoc[] {
  const result: Heredoc[] = [];
  let index = 0;
  let quote: "'" | '"' | undefined;

  while (index < line.length) {
    const character = line[index];
    if (quote !== undefined) {
      if (character === quote) quote = undefined;
      else if (character === '\\' && quote === '"') index += 1;
      index += 1;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      index += 1;
      continue;
    }
    if (character === '\\') {
      index += 2;
      continue;
    }
    if (character === '#' && (index === 0 || /[\s;|&()]/.test(line[index - 1]))) break;
    if (character !== '<' || line[index + 1] !== '<' || line[index + 2] === '<') {
      index += 1;
      continue;
    }

    index += 2;
    const stripTabs = line[index] === '-';
    if (stripTabs) index += 1;
    while (line[index] === ' ' || line[index] === '\t') index += 1;

    let delimiter = '';
    let delimiterQuote: "'" | '"' | undefined;
    while (index < line.length) {
      const delimiterCharacter = line[index];
      if (delimiterQuote !== undefined) {
        if (delimiterCharacter === delimiterQuote) delimiterQuote = undefined;
        else if (delimiterCharacter === '\\' && delimiterQuote === '"' && index + 1 < line.length) {
          index += 1;
          delimiter += line[index];
        } else delimiter += delimiterCharacter;
        index += 1;
      } else if (delimiterCharacter === "'" || delimiterCharacter === '"') {
        delimiterQuote = delimiterCharacter;
        index += 1;
      } else if (delimiterCharacter === '\\' && index + 1 < line.length) {
        index += 1;
        delimiter += line[index];
        index += 1;
      } else if (/[\s;|&<>]/.test(delimiterCharacter)) {
        break;
      } else {
        delimiter += delimiterCharacter;
        index += 1;
      }
    }
    if (delimiter.length > 0) result.push({ delimiter, stripTabs });
  }
  return result;
}

function tokenizeDirective(line: string, lineNumber: number): { tokens: Token[]; diagnostic?: HpcDiagnostic } {
  const tokens: Token[] = [];
  let index = '#SBATCH'.length;

  while (index < line.length) {
    while (/\s/.test(line[index] ?? '')) index += 1;
    if (index >= line.length) break;

    const start = index;
    let value = '';
    let quote: "'" | '"' | undefined;
    while (index < line.length) {
      const character = line[index];
      if (quote !== undefined) {
        if (character === quote) {
          quote = undefined;
          index += 1;
        } else if (character === '\\' && quote === '"' && index + 1 < line.length) {
          value += line[index + 1];
          index += 2;
        } else {
          value += character;
          index += 1;
        }
      } else if (character === "'" || character === '"') {
        quote = character;
        index += 1;
      } else if (/\s/.test(character)) {
        break;
      } else if (character === '\\' && index + 1 < line.length) {
        value += line[index + 1];
        index += 2;
      } else {
        value += character;
        index += 1;
      }
    }

    if (quote !== undefined) {
      return {
        tokens,
        diagnostic: {
          code: 'SBATCH_UNTERMINATED_QUOTE',
          message: 'This #SBATCH directive contains an unterminated quoted value.',
          severity: 'error',
          range: {
            start: { line: lineNumber, character: start },
            end: { line: lineNumber, character: line.length },
          },
        },
      };
    }
    tokens.push({ value, start, end: index });
  }
  return { tokens };
}

function parseOptions(tokens: readonly Token[]): OptionOccurrence[] {
  const options: OptionOccurrence[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.value.startsWith('--')) {
      const equals = token.value.indexOf('=');
      const name = token.value.slice(2, equals < 0 ? undefined : equals);
      if (!REQUIRED_VALUES.has(name)) continue;
      if (equals >= 0) {
        const offset = token.value.indexOf('=') + 1;
        options.push({
          name,
          value: token.value.slice(offset),
          valueStart: token.start + offset,
          valueEnd: token.end,
        });
      } else {
        const next = tokens[index + 1];
        if (next !== undefined && !next.value.startsWith('-')) {
          options.push({ name, value: next.value, valueStart: next.start, valueEnd: next.end });
          index += 1;
        } else {
          options.push({ name, valueStart: token.end, valueEnd: token.end });
        }
      }
      continue;
    }

    if (token.value.startsWith('-') && token.value.length >= 2) {
      const name = SHORT_OPTIONS[token.value[1]];
      if (name === undefined) continue;
      const attached = token.value.slice(2).replace(/^=/, '');
      if (attached.length > 0) {
        const rawOffset = token.value[2] === '=' ? 3 : 2;
        options.push({ name, value: attached, valueStart: token.start + rawOffset, valueEnd: token.end });
      } else {
        const next = tokens[index + 1];
        if (next !== undefined && !next.value.startsWith('-')) {
          options.push({ name, value: next.value, valueStart: next.start, valueEnd: next.end });
          index += 1;
        } else {
          options.push({ name, valueStart: token.end, valueEnd: token.end });
        }
      }
    }
  }
  return options;
}

function positiveInteger(value: string | undefined): boolean {
  return value !== undefined && /^[1-9]\d*$/.test(value);
}

function validTime(value: string | undefined): boolean {
  if (value === undefined) return false;
  if (/^(?:UNLIMITED|INFINITE)$/i.test(value)) return true;
  if (/^\d+$/.test(value)) return true;

  const dayMatch = value.match(/^(\d+)-(\d+)(?::(\d+))?(?::(\d+))?$/);
  if (dayMatch !== null) {
    const hours = Number(dayMatch[2]);
    const minutes = dayMatch[3] === undefined ? 0 : Number(dayMatch[3]);
    const seconds = dayMatch[4] === undefined ? 0 : Number(dayMatch[4]);
    return hours <= 23 && minutes <= 59 && seconds <= 59;
  }

  const parts = value.split(':');
  if (parts.length === 2 && parts.every((part) => /^\d+$/.test(part))) {
    return Number(parts[1]) <= 59;
  }
  if (parts.length === 3 && parts.every((part) => /^\d+$/.test(part))) {
    return Number(parts[1]) <= 59 && Number(parts[2]) <= 59;
  }
  return false;
}

function validMemory(value: string | undefined): boolean {
  return value !== undefined && /^\d+(?:[KMGT])?$/i.test(value);
}

function validArray(value: string | undefined): boolean {
  if (value === undefined) return false;
  const percentParts = value.split('%');
  if (percentParts.length > 2 || (percentParts[1] !== undefined && !positiveInteger(percentParts[1]))) return false;

  const segments = percentParts[0].split(',');
  if (segments.length === 0 || segments.some((segment) => segment.length === 0)) return false;
  return segments.every((segment) => {
    if (/^\d+$/.test(segment)) return true;
    const match = segment.match(/^(\d+)-(\d+)(?::([1-9]\d*))?$/);
    return match !== null && BigInt(match[2]) >= BigInt(match[1]);
  });
}

function optionDiagnostic(
  option: OptionOccurrence,
  lineNumber: number,
  code: string,
  message: string,
): HpcDiagnostic {
  return {
    code,
    message,
    severity: 'error',
    range: {
      start: { line: lineNumber, character: option.valueStart },
      end: { line: lineNumber, character: option.valueEnd },
    },
  };
}

function dynamicValue(value: string | undefined): boolean {
  return value !== undefined && (
    /[$`]/.test(value)
    || value.includes('{{')
    || value.includes('}}')
    || /@[A-Za-z_][A-Za-z0-9_]*@/.test(value)
    || value.includes('<%')
    || value.includes('%>')
  );
}

function validateDirective(line: string, lineNumber: number, state: ValidationState): HpcDiagnostic[] {
  const tokenized = tokenizeDirective(line, lineNumber);
  if (tokenized.diagnostic !== undefined) return [tokenized.diagnostic];

  const diagnostics: HpcDiagnostic[] = [];
  for (const option of parseOptions(tokenized.tokens)) {
    if (option.value === undefined || option.value.length === 0) {
      diagnostics.push(optionDiagnostic(
        option,
        lineNumber,
        'SBATCH_MISSING_VALUE',
        `--${option.name} requires a value.`,
      ));
      continue;
    }
    if (dynamicValue(option.value)) {
      diagnostics.push({
        code: 'SBATCH_DYNAMIC_VALUE',
        message: 'This resource value is dynamic or templated, so it was not checked as a fixed value. Slurm does not perform shell expansion in #SBATCH directives.',
        severity: 'information',
        range: {
          start: { line: lineNumber, character: option.valueStart },
          end: { line: lineNumber, character: option.valueEnd },
        },
      });
      continue;
    }
    const diagnosticsBeforeOption = diagnostics.length;
    if (option.name === 'mem' || option.name === 'mem-per-cpu' || option.name === 'mem-per-gpu') {
      if (state.memoryMode !== undefined && state.memoryMode !== option.name) {
        diagnostics.push(optionDiagnostic(
          option,
          lineNumber,
          'SBATCH_CONFLICTING_MEMORY',
          `--${option.name} cannot be combined with --${state.memoryMode}; Slurm memory request modes are mutually exclusive.`,
        ));
      } else {
        state.memoryMode = option.name;
      }
    }
    if (option.name === 'nodes') {
      const match = option.value?.match(/^([1-9]\d*)(?:-([1-9]\d*))?$/);
      const descending = match?.[2] !== undefined && BigInt(match[2]) < BigInt(match[1]);
      if (match === null || match === undefined || descending) {
        diagnostics.push(optionDiagnostic(
          option,
          lineNumber,
          'SBATCH_INVALID_NODES',
          'Node count must be a positive integer or an ascending MIN-MAX range.',
        ));
      }
    } else if (option.name === 'ntasks' || option.name.startsWith('ntasks-per-')) {
      if (!positiveInteger(option.value)) {
        diagnostics.push(optionDiagnostic(
          option,
          lineNumber,
          option.name === 'ntasks' ? 'SBATCH_INVALID_NTASKS' : 'SBATCH_INVALID_TASK_DENSITY',
          'Task count must be a positive integer.',
        ));
      }
    } else if (option.name === 'cpus-per-task' && !positiveInteger(option.value)) {
      diagnostics.push(optionDiagnostic(
        option,
        lineNumber,
        'SBATCH_INVALID_CPUS_PER_TASK',
        'CPU count per task must be a positive integer.',
      ));
    } else if (option.name === 'cpus-per-gpu' && !positiveInteger(option.value)) {
      diagnostics.push(optionDiagnostic(
        option,
        lineNumber,
        'SBATCH_INVALID_CPUS_PER_GPU',
        'CPU count per GPU must be a positive integer.',
      ));
    } else if ((option.name === 'time' || option.name === 'time-min') && !validTime(option.value)) {
      diagnostics.push(optionDiagnostic(
        option,
        lineNumber,
        'SBATCH_INVALID_TIME',
        'Time must use a Slurm time form such as minutes, HH:MM:SS, or days-hours:minutes:seconds.',
      ));
    } else if (option.name.startsWith('mem') && !validMemory(option.value)) {
      diagnostics.push(optionDiagnostic(
        option,
        lineNumber,
        'SBATCH_INVALID_MEMORY',
        'Memory must be a non-negative integer, optionally followed by K, M, G, or T (case-insensitive).',
      ));
    } else if (option.name === 'array' && !validArray(option.value)) {
      diagnostics.push(optionDiagnostic(
        option,
        lineNumber,
        'SBATCH_INVALID_ARRAY',
        'Array indices must be comma-separated integers or ascending ranges, with optional positive step and concurrency limit.',
      ));
    }
    const optionHasError = diagnostics.slice(diagnosticsBeforeOption).some(({ severity }) => severity === 'error');
    if (
      !optionHasError
      && CLUSTER_BOUND_OPTIONS.has(option.name)
      && DEUCALION_PROFILE.verification === 'blocked'
      && !state.policyReported
    ) {
      diagnostics.push({
        code: 'DEUCALION_POLICY_UNVERIFIED',
        message: 'This resource syntax is valid, but Deucalion partition and QoS limits are unverified because the official policy source could not be retrieved; no cluster boundary is assumed.',
        severity: 'information',
        range: {
          start: { line: lineNumber, character: option.valueStart },
          end: { line: lineNumber, character: option.valueEnd },
        },
      });
      state.policyReported = true;
    }
  }
  return diagnostics;
}

export function validateSbatch(text: string): HpcDiagnostic[] {
  void DEUCALION_PROFILE;
  const diagnostics: HpcDiagnostic[] = [];
  const lines = text.split('\n').map((line) => line.endsWith('\r') ? line.slice(0, -1) : line);
  let headerEnded = false;
  const heredocs: Heredoc[] = [];
  const validationState: ValidationState = { policyReported: false };

  for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    const line = lines[lineNumber];

    if (heredocs.length > 0) {
      const current = heredocs[0];
      const candidate = current.stripTabs ? line.replace(/^\t+/, '') : line;
      if (candidate === current.delimiter) heredocs.shift();
      continue;
    }

    if (!headerEnded) {
      if (/^#SBATCH(?:\s|$)/.test(line)) {
        diagnostics.push(...validateDirective(line, lineNumber, validationState));
        continue;
      }
      if (/^\s*$/.test(line) || /^\s*#/.test(line)) continue;
      headerEnded = true;
      heredocs.push(...heredocsStartedBy(line));
      continue;
    }

    if (/^#SBATCH(?:\s|$)/.test(line)) {
      diagnostics.push(lineDiagnostic(
        'SBATCH_LATE_DIRECTIVE',
        'This #SBATCH directive appears after an executable line and Slurm will ignore it.',
        'warning',
        lineNumber,
        line,
      ));
    }
    heredocs.push(...heredocsStartedBy(line));
  }

  return diagnostics;
}
