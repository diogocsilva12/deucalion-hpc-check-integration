import assert from 'node:assert/strict';
import test from 'node:test';

import { parseSlurmTimeToMinutes } from '../src/core/deucalion';
import { validateSbatch } from '../src/core/sbatch';

test('accepts standard long resource options in the SBATCH header with valid Deucalion partition', () => {
  const diagnostics = validateSbatch([
    '#!/bin/bash',
    '#SBATCH --partition=normal-x86',
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

test('accepts all 11 valid Deucalion partitions within time limits', () => {
  const partitions = [
    { name: 'dev-a100-40', time: '04:00:00' },
    { name: 'normal-a100-40', time: '2-00:00:00' },
    { name: 'dev-a100-80', time: '03:59:00' },
    { name: 'normal-a100-80', time: '48:00:00' },
    { name: 'dev-x86', time: '240' },
    { name: 'normal-x86', time: '1-12:00:00' },
    { name: 'large-x86', time: '3-00:00:00' },
    { name: 'dev-arm', time: '04:00:00' },
    { name: 'normal-arm', time: '2-00:00:00' },
    { name: 'large-arm', time: '72:00:00' },
    { name: 'ooda', time: '08:00:00' },
  ];

  for (const p of partitions) {
    const diagnostics = validateSbatch([
      `#SBATCH --partition=${p.name}`,
      `#SBATCH --time=${p.time}`,
      'true',
    ].join('\n'));

    const errors = diagnostics.filter(({ severity }) => severity === 'error');
    assert.deepEqual(errors, [], `Expected no errors for partition ${p.name} with time ${p.time}`);
  }
});

test('rejects unknown Deucalion partition name', () => {
  const diagnostics = validateSbatch([
    '#SBATCH --partition=nonexistent-gpu',
    'true',
  ].join('\n'));

  const errors = diagnostics.filter(({ code }) => code === 'DEUCALION_UNKNOWN_PARTITION');
  assert.equal(errors.length, 1);
  assert.match(errors[0]?.message ?? '', /Unknown Deucalion partition 'nonexistent-gpu'/);
  assert.equal(errors[0]?.sourceUrl, 'https://docs.deucalion.macc.fccn.pt/');
});

test('rejects unknown partition in comma-separated list', () => {
  const diagnostics = validateSbatch([
    '#SBATCH -p dev-x86,invalid-arm,normal-x86',
    'true',
  ].join('\n'));

  const errors = diagnostics.filter(({ code }) => code === 'DEUCALION_UNKNOWN_PARTITION');
  assert.equal(errors.length, 1);
  assert.match(errors[0]?.message ?? '', /Unknown Deucalion partition 'invalid-arm'/);
});

test('rejects time request exceeding Deucalion partition time limit', () => {
  // dev-x86 max time is 4 hours (240 min)
  const diagnostics = validateSbatch([
    '#SBATCH --partition=dev-x86',
    '#SBATCH --time=05:00:00',
    'true',
  ].join('\n'));

  const errors = diagnostics.filter(({ code }) => code === 'DEUCALION_TIME_EXCEEDS_PARTITION_LIMIT');
  assert.equal(errors.length, 1);
  assert.match(errors[0]?.message ?? '', /Requested time '05:00:00' exceeds the maximum time limit of 04:00:00 for Deucalion partition 'dev-x86'/);
  assert.equal(errors[0]?.sourceUrl, 'https://docs.deucalion.macc.fccn.pt/');
});

test('rejects UNLIMITED time request on partition with finite limit', () => {
  const diagnostics = validateSbatch([
    '#SBATCH --partition=ooda',
    '#SBATCH --time=UNLIMITED',
    'true',
  ].join('\n'));

  const errors = diagnostics.filter(({ code }) => code === 'DEUCALION_TIME_EXCEEDS_PARTITION_LIMIT');
  assert.equal(errors.length, 1);
  assert.match(errors[0]?.message ?? '', /Requested time 'UNLIMITED' exceeds the maximum time limit of 08:00:00 for Deucalion partition 'ooda'/);
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

test('marks Deucalion QoS and unbounded cluster resources as unverified', () => {
  const diagnostics = validateSbatch([
    '#SBATCH --partition=dev-x86',
    '#SBATCH --qos=future-qos',
    '#SBATCH --nodes=999999',
    'true',
  ].join('\n'));

  assert.equal(diagnostics.some(({ severity }) => severity === 'error'), false);
  assert.equal(diagnostics.filter(({ code }) => code === 'DEUCALION_POLICY_UNVERIFIED').length, 1);
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
    '#SBATCH -t 01:00:00',
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

test('parses various Slurm time formats correctly into minutes', () => {
  assert.equal(parseSlurmTimeToMinutes('60'), 60);
  assert.equal(parseSlurmTimeToMinutes('30:00'), 30);
  assert.equal(parseSlurmTimeToMinutes('30:30'), 30.5);
  assert.equal(parseSlurmTimeToMinutes('04:00:00'), 240);
  assert.equal(parseSlurmTimeToMinutes('1-00:00:00'), 1440);
  assert.equal(parseSlurmTimeToMinutes('2-00:00:00'), 2880);
  assert.equal(parseSlurmTimeToMinutes('3-00:00:00'), 4320);
  assert.equal(parseSlurmTimeToMinutes('UNLIMITED'), Infinity);
  assert.equal(parseSlurmTimeToMinutes('INFINITE'), Infinity);
  assert.equal(parseSlurmTimeToMinutes(undefined), undefined);
});
