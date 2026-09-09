import assert from 'node:assert/strict';
import test from 'node:test';

import { validateSbatch } from '../src/core/sbatch';

test('accepts standard long resource options in the SBATCH header', () => {
  const diagnostics = validateSbatch([
    '#!/bin/bash',
    '#SBATCH --nodes=2',
    '#SBATCH --ntasks 8',
    '#SBATCH --cpus-per-task=4',
    '#SBATCH --time=01:30:00',
    '#SBATCH --mem=8G',
    '',
    'srun ./solver',
  ].join('\n'));

  assert.deepEqual(diagnostics.filter(({ severity }) => severity === 'error'), []);
});

test('reports ignored directives after commands but ignores heredoc payload text', () => {
  const diagnostics = validateSbatch([
    '#!/bin/bash',
    '#SBATCH --time=10',
    'echo started',
    '#SBATCH --nodes=not-a-count',
    "cat <<'PAYLOAD'",
    '#SBATCH --nodes=999',
    'PAYLOAD',
  ].join('\n'));

  assert.deepEqual(diagnostics.filter(({ code }) => code === 'SBATCH_LATE_DIRECTIVE').map(({ code, range }) => ({ code, range })), [{
    code: 'SBATCH_LATE_DIRECTIVE',
    range: {
      start: { line: 3, character: 0 },
      end: { line: 3, character: 27 },
    },
  }]);
});

test('rejects a descending node range', () => {
  const diagnostics = validateSbatch('#SBATCH --nodes=4-2\necho run\n');

  assert.deepEqual(diagnostics.filter(({ code }) => code === 'SBATCH_INVALID_NODES').map(({ severity, range }) => ({
    severity,
    range,
  })), [{
    severity: 'error',
    range: {
      start: { line: 0, character: 16 },
      end: { line: 0, character: 19 },
    },
  }]);
});

test('rejects malformed fixed task, CPU, time, memory, and array values', () => {
  const diagnostics = validateSbatch([
    '#SBATCH --ntasks=0',
    '#SBATCH -c nope',
    '#SBATCH --time=1:60',
    '#SBATCH --mem=12GB',
    '#SBATCH --array=9-3',
    'true',
  ].join('\n'));

  assert.deepEqual(diagnostics.filter(({ severity }) => severity === 'error').map(({ code }) => code), [
    'SBATCH_INVALID_NTASKS',
    'SBATCH_INVALID_CPUS_PER_TASK',
    'SBATCH_INVALID_TIME',
    'SBATCH_INVALID_MEMORY',
    'SBATCH_INVALID_ARRAY',
  ]);
});

test('marks dynamic resource values as unverified without definite errors', () => {
  const diagnostics = validateSbatch([
    '#SBATCH -N $NODE_COUNT',
    '#SBATCH --time=${WALLTIME}',
    '#SBATCH --mem={{MEMORY}}',
    '#SBATCH --array=@ARRAY_RANGE@',
    'true',
  ].join('\n'));

  assert.equal(diagnostics.some(({ severity }) => severity === 'error'), false);
  assert.equal(diagnostics.filter(({ code }) => code === 'SBATCH_DYNAMIC_VALUE').length, 4);
});

test('marks Deucalion partition and QoS boundaries as unverified when policy evidence is blocked', () => {
  const diagnostics = validateSbatch([
    '#SBATCH --partition=future-partition',
    '#SBATCH --qos=future-qos',
    '#SBATCH --nodes=999999',
    'true',
  ].join('\n'));

  assert.equal(diagnostics.some(({ severity }) => severity === 'error'), false);
  assert.equal(diagnostics.filter(({ code }) => code === 'DEUCALION_POLICY_UNVERIFIED').length, 1);
});

test('does not imply that a syntactically valid resource value fits an unknown cluster boundary', () => {
  const diagnostics = validateSbatch('#SBATCH --nodes=999999\ntrue\n');

  assert.deepEqual(diagnostics.map(({ code, severity }) => ({ code, severity })), [{
    code: 'DEUCALION_POLICY_UNVERIFIED',
    severity: 'information',
  }]);
});

test('rejects mutually exclusive memory request modes', () => {
  const diagnostics = validateSbatch([
    '#SBATCH --mem=8G',
    '#SBATCH --mem-per-cpu=2G',
    'true',
  ].join('\n'));

  assert.deepEqual(diagnostics.filter(({ severity }) => severity === 'error').map(({ code }) => code), [
    'SBATCH_CONFLICTING_MEMORY',
  ]);
});

test('reports required option values that are missing', () => {
  const diagnostics = validateSbatch([
    '#SBATCH --nodes',
    '#SBATCH -c',
    '#SBATCH --partition=',
    'true',
  ].join('\n'));

  assert.deepEqual(diagnostics.filter(({ severity }) => severity === 'error').map(({ code }) => code), [
    'SBATCH_MISSING_VALUE',
    'SBATCH_MISSING_VALUE',
    'SBATCH_MISSING_VALUE',
  ]);
});

test('does not treat a quoted heredoc-looking string as a heredoc', () => {
  const diagnostics = validateSbatch([
    '#!/bin/sh',
    'echo "<<NOT_A_HEREDOC"',
    '#SBATCH --nodes=2',
  ].join('\n'));

  assert.deepEqual(diagnostics.map(({ code }) => code), ['SBATCH_LATE_DIRECTIVE']);
});

test('accepts short forms, CRLF, ranges, special values, and unknown future options', () => {
  const diagnostics = validateSbatch([
    '#SBATCH -N2-8',
    '#SBATCH -n 16',
    '#SBATCH -c=4',
    '#SBATCH -t UNLIMITED',
    '#SBATCH --time=0',
    '#SBATCH --time-min=2-03:04:05',
    '#SBATCH --mem=0',
    '#SBATCH --mem=2g',
    '#SBATCH --array=0,2-10:2%3',
    '#SBATCH --future-option=opaque',
    '#SBATCH -Zopaque',
    'true',
  ].join('\r\n'));

  assert.equal(diagnostics.some(({ severity }) => severity === 'error'), false);
  assert.equal(diagnostics.filter(({ code }) => code === 'DEUCALION_POLICY_UNVERIFIED').length, 1);
});

test('checks CPU-per-GPU counts', () => {
  const diagnostics = validateSbatch('#SBATCH --cpus-per-gpu=0\ntrue\n');

  assert.deepEqual(diagnostics.filter(({ severity }) => severity === 'error').map(({ code }) => code), [
    'SBATCH_INVALID_CPUS_PER_GPU',
  ]);
});

test('accepts empty input', () => {
  assert.deepEqual(validateSbatch(''), []);
});

test('reports unterminated directive quoting', () => {
  const diagnostics = validateSbatch('#SBATCH --nodes="2\ntrue\n');
  assert.deepEqual(diagnostics.map(({ code, severity }) => ({ code, severity })), [{
    code: 'SBATCH_UNTERMINATED_QUOTE',
    severity: 'error',
  }]);
});
