import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_SETTINGS,
  isRuleEnabled,
  isWorkspaceAllowed,
  isWorkspaceMatch,
  resolveSettings,
  type ConfigAccessorLike,
  type DeucalionSettings,
} from '../src/editor/config';

test('resolveSettings returns defaults when accessor is omitted or empty', () => {
  const defaults = resolveSettings();
  assert.deepEqual(defaults, DEFAULT_SETTINGS);

  const emptyAccessor: ConfigAccessorLike = {
    get: () => undefined,
  };
  assert.deepEqual(resolveSettings(emptyAccessor), DEFAULT_SETTINGS);
});

test('resolveSettings correctly reads user overrides', () => {
  const map: Record<string, unknown> = {
    enabled: false,
    disabledWorkspaces: ['my-repo', '/home/user/hpc'],
    enabledWorkspaces: ['allowed-repo'],
    'makefile.enabled': false,
    'slurm.enabled': true,
    disabledRules: ['makefile.space-indented-recipe', 'SBATCH_DYNAMIC_VALUE*'],
    rules: {
      'makefile.missing-rule-target': false,
      'SBATCH_DYNAMIC_VALUE': true,
    },
  };

  const accessor: ConfigAccessorLike = {
    get: <T>(key: string, defaultValue?: T) => (map[key] !== undefined ? (map[key] as T) : defaultValue),
  };

  const settings = resolveSettings(accessor);
  assert.equal(settings.enabled, false);
  assert.deepEqual(settings.disabledWorkspaces, ['my-repo', '/home/user/hpc']);
  assert.deepEqual(settings.enabledWorkspaces, ['allowed-repo']);
  assert.equal(settings.makefileEnabled, false);
  assert.equal(settings.slurmEnabled, true);
  assert.deepEqual(settings.disabledRules, ['makefile.space-indented-recipe', 'SBATCH_DYNAMIC_VALUE*']);
  assert.equal(settings.rules['makefile.missing-rule-target'], false);
  assert.equal(settings.rules['SBATCH_DYNAMIC_VALUE'], true);
});

test('isWorkspaceMatch matches workspace names and folder paths case-insensitively', () => {
  assert.equal(isWorkspaceMatch('my-cluster', 'My-Cluster', []), true);
  assert.equal(isWorkspaceMatch('cluster', 'my-cluster', []), true);
  assert.equal(isWorkspaceMatch('deucalion', 'other', ['/Users/test/Projects/deucalion-work']), true);
  assert.equal(isWorkspaceMatch('/Projects/foo', undefined, ['/projects/foo/bar']), true);
  assert.equal(isWorkspaceMatch('nomatch', 'project', ['/var/log']), false);
});

test('isWorkspaceAllowed handles enabled/disabled lists and global enabled flag', () => {
  const baseSettings: DeucalionSettings = { ...DEFAULT_SETTINGS };
  assert.equal(isWorkspaceAllowed('my-proj', ['/path/to/my-proj'], baseSettings), true);

  // Disabled globally
  assert.equal(isWorkspaceAllowed('my-proj', ['/path/to/my-proj'], { ...baseSettings, enabled: false }), false);

  // Disabled workspaces list
  const withDisabled: DeucalionSettings = {
    ...baseSettings,
    disabledWorkspaces: ['ignore-me', '/data/scratch'],
  };
  assert.equal(isWorkspaceAllowed('ignore-me', [], withDisabled), false);
  assert.equal(isWorkspaceAllowed('other', ['/data/scratch/sub'], withDisabled), false);
  assert.equal(isWorkspaceAllowed('other', ['/data/work'], withDisabled), true);

  // Enabled workspaces allowlist
  const withEnabled: DeucalionSettings = {
    ...baseSettings,
    enabledWorkspaces: ['allowed-cluster'],
  };
  assert.equal(isWorkspaceAllowed('other', [], withEnabled), false);
  assert.equal(isWorkspaceAllowed('allowed-cluster', [], withEnabled), true);
});

test('isRuleEnabled evaluates rule overrides, disabledRules wildcards, and category toggles', () => {
  const base: DeucalionSettings = { ...DEFAULT_SETTINGS };

  // Default: everything enabled
  assert.equal(isRuleEnabled('makefile.space-indented-recipe', base), true);
  assert.equal(isRuleEnabled('SBATCH_MEMORY_LIMIT', base), true);

  // Category toggle: makefile disabled
  const noMake: DeucalionSettings = { ...base, makefileEnabled: false };
  assert.equal(isRuleEnabled('makefile.space-indented-recipe', noMake), false);
  assert.equal(isRuleEnabled('SBATCH_MEMORY_LIMIT', noMake), true);

  // Category toggle: slurm disabled
  const noSlurm: DeucalionSettings = { ...base, slurmEnabled: false };
  assert.equal(isRuleEnabled('SBATCH_MEMORY_LIMIT', noSlurm), false);
  assert.equal(isRuleEnabled('DEUCALION_POLICY_UNVERIFIED', noSlurm), false);
  assert.equal(isRuleEnabled('makefile.space-indented-recipe', noSlurm), true);

  // disabledRules exact match
  const disabledRule: DeucalionSettings = {
    ...base,
    disabledRules: ['makefile.space-indented-recipe'],
  };
  assert.equal(isRuleEnabled('makefile.space-indented-recipe', disabledRule), false);
  assert.equal(isRuleEnabled('makefile.wrong-recipe-prefix', disabledRule), true);

  // disabledRules wildcard
  const wildcardDisabled: DeucalionSettings = {
    ...base,
    disabledRules: ['makefile.*'],
  };
  assert.equal(isRuleEnabled('makefile.space-indented-recipe', wildcardDisabled), false);
  assert.equal(isRuleEnabled('makefile.missing-rule-target', wildcardDisabled), false);
  assert.equal(isRuleEnabled('SBATCH_NODES_ORDER', wildcardDisabled), true);

  // Explicit rules dictionary override takes precedence over disabledRules or category
  const overrides: DeucalionSettings = {
    ...base,
    makefileEnabled: false,
    disabledRules: ['SBATCH_DYNAMIC_VALUE'],
    rules: {
      'makefile.space-indented-recipe': true, // explicit enable despite makefileEnabled: false
      'SBATCH_DYNAMIC_VALUE': true, // explicit enable despite disabledRules
      'SBATCH_NODES_ORDER': false, // explicit disable
    },
  };
  assert.equal(isRuleEnabled('makefile.space-indented-recipe', overrides), true);
  assert.equal(isRuleEnabled('SBATCH_DYNAMIC_VALUE', overrides), true);
  assert.equal(isRuleEnabled('SBATCH_NODES_ORDER', overrides), false);
});
