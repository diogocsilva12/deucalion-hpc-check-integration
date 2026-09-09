export interface DeucalionSettings {
  readonly enabled: boolean;
  readonly disabledWorkspaces: readonly string[];
  readonly enabledWorkspaces: readonly string[];
  readonly makefileEnabled: boolean;
  readonly slurmEnabled: boolean;
  readonly disabledRules: readonly string[];
  readonly rules: Record<string, boolean>;
  readonly allowedPartitions: readonly string[];
}

export const DEFAULT_SETTINGS: DeucalionSettings = {
  enabled: true,
  disabledWorkspaces: [],
  enabledWorkspaces: [],
  makefileEnabled: true,
  slurmEnabled: true,
  disabledRules: [],
  rules: {},
  allowedPartitions: [],
};

export interface ConfigAccessorLike {
  get<T>(section: string, defaultValue?: T): T | undefined;
}

export function isWorkspaceMatch(
  pattern: string,
  workspaceName?: string,
  workspacePaths: readonly string[] = [],
): boolean {
  const normPattern = pattern.trim().toLowerCase();
  if (!normPattern) {
    return false;
  }
  if (
    workspaceName &&
    (workspaceName.toLowerCase() === normPattern ||
      workspaceName.toLowerCase().includes(normPattern))
  ) {
    return true;
  }
  for (const path of workspacePaths) {
    const normPath = path.toLowerCase();
    if (
      normPath === normPattern ||
      normPath.includes(normPattern) ||
      normPath.endsWith(normPattern)
    ) {
      return true;
    }
  }
  return false;
}

export function isWorkspaceAllowed(
  workspaceName: string | undefined,
  workspacePaths: readonly string[],
  settings: DeucalionSettings,
): boolean {
  if (!settings.enabled) {
    return false;
  }
  if (settings.enabledWorkspaces.length > 0) {
    const matched = settings.enabledWorkspaces.some((pattern) =>
      isWorkspaceMatch(pattern, workspaceName, workspacePaths),
    );
    if (!matched) {
      return false;
    }
  }
  if (settings.disabledWorkspaces.length > 0) {
    const matched = settings.disabledWorkspaces.some((pattern) =>
      isWorkspaceMatch(pattern, workspaceName, workspacePaths),
    );
    if (matched) {
      return false;
    }
  }
  return true;
}

export function isRuleEnabled(
  ruleCode: string,
  settings: DeucalionSettings,
): boolean {
  // 1. Explicit per-rule overrides
  if (Object.prototype.hasOwnProperty.call(settings.rules, ruleCode)) {
    return Boolean(settings.rules[ruleCode]);
  }

  // 2. Disabled rules list (exact match or wildcard prefix)
  for (const pattern of settings.disabledRules) {
    if (pattern === ruleCode) {
      return false;
    }
    if (pattern.endsWith('*')) {
      const prefix = pattern.slice(0, -1);
      if (ruleCode.startsWith(prefix)) {
        return false;
      }
    }
  }

  // 3. Category toggles
  if (ruleCode.startsWith('makefile.') && !settings.makefileEnabled) {
    return false;
  }
  if (
    (ruleCode.startsWith('SBATCH_') || ruleCode.startsWith('DEUCALION_')) &&
    !settings.slurmEnabled
  ) {
    return false;
  }

  return true;
}

export function resolveSettings(
  accessor?: ConfigAccessorLike,
): DeucalionSettings {
  if (!accessor) {
    return DEFAULT_SETTINGS;
  }

  const enabled = accessor.get<boolean>('enabled', true) ?? true;
  const disabledWorkspaces =
    accessor.get<string[]>('disabledWorkspaces', []) ?? [];
  const enabledWorkspaces =
    accessor.get<string[]>('enabledWorkspaces', []) ?? [];

  const makefileVal = accessor.get<boolean>('makefile.enabled');
  const makefileObj = accessor.get<{ enabled?: boolean }>('makefile');
  const makefileEnabled =
    makefileVal ?? (makefileObj?.enabled ?? DEFAULT_SETTINGS.makefileEnabled);

  const slurmVal = accessor.get<boolean>('slurm.enabled');
  const slurmObj = accessor.get<{ enabled?: boolean }>('slurm');
  const slurmEnabled =
    slurmVal ?? (slurmObj?.enabled ?? DEFAULT_SETTINGS.slurmEnabled);

  const disabledRules = accessor.get<string[]>('disabledRules', []) ?? [];
  const rules = accessor.get<Record<string, boolean>>('rules', {}) ?? {};

  const allowedPartitionsVal = accessor.get<string[]>('slurm.allowedPartitions');
  const allowedPartitions = allowedPartitionsVal ?? (accessor.get<string[]>('allowedPartitions', []) ?? []);

  return {
    enabled,
    disabledWorkspaces,
    enabledWorkspaces,
    makefileEnabled,
    slurmEnabled,
    disabledRules,
    rules,
    allowedPartitions,
  };
}
