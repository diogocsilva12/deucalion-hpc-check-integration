export type DeucalionPartitionCategory =
  | 'GPU'
  | 'x86 CPU'
  | 'ARM CPU'
  | 'Other';

export interface DeucalionPartitionLimit {
  readonly name: string;
  readonly category: DeucalionPartitionCategory;
  readonly maxTimeMinutes: number;
  readonly maxTimeFormatted: string;
  readonly description: string;
}

export interface DeucalionProfile {
  readonly version: string;
  readonly verification: 'verified' | 'blocked' | 'partial';
  readonly attemptedOn: string;
  readonly blockedReason?: string;
  readonly sourceAttempts: readonly {
    readonly url: string;
    readonly evidence: string;
  }[];
  /** Per-partition limits only. Never populate this with QoS limits. */
  readonly partitions: Readonly<Record<string, DeucalionPartitionLimit>>;
  /** QoS limits only. Never apply these as intrinsic partition limits. */
  readonly qos: Readonly<Record<string, never>>;
}

export const DEUCALION_PARTITIONS: Readonly<Record<string, DeucalionPartitionLimit>> = Object.freeze({
  'dev-a100-40': Object.freeze({
    name: 'dev-a100-40',
    category: 'GPU',
    maxTimeMinutes: 240, // 4 hours
    maxTimeFormatted: '04:00:00',
    description: 'NVIDIA A100 (40GB) development partition',
  }),
  'normal-a100-40': Object.freeze({
    name: 'normal-a100-40',
    category: 'GPU',
    maxTimeMinutes: 2880, // 2 days
    maxTimeFormatted: '2-00:00:00',
    description: 'NVIDIA A100 (40GB) standard production partition',
  }),
  'dev-a100-80': Object.freeze({
    name: 'dev-a100-80',
    category: 'GPU',
    maxTimeMinutes: 240, // 4 hours
    maxTimeFormatted: '04:00:00',
    description: 'NVIDIA A100 (80GB) development partition',
  }),
  'normal-a100-80': Object.freeze({
    name: 'normal-a100-80',
    category: 'GPU',
    maxTimeMinutes: 2880, // 2 days
    maxTimeFormatted: '2-00:00:00',
    description: 'NVIDIA A100 (80GB) standard production partition',
  }),
  'dev-x86': Object.freeze({
    name: 'dev-x86',
    category: 'x86 CPU',
    maxTimeMinutes: 240, // 4 hours
    maxTimeFormatted: '04:00:00',
    description: 'x86 CPU development partition',
  }),
  'normal-x86': Object.freeze({
    name: 'normal-x86',
    category: 'x86 CPU',
    maxTimeMinutes: 2880, // 2 days
    maxTimeFormatted: '2-00:00:00',
    description: 'x86 CPU standard production partition',
  }),
  'large-x86': Object.freeze({
    name: 'large-x86',
    category: 'x86 CPU',
    maxTimeMinutes: 4320, // 3 days
    maxTimeFormatted: '3-00:00:00',
    description: 'x86 CPU large partition',
  }),
  'dev-arm': Object.freeze({
    name: 'dev-arm',
    category: 'ARM CPU',
    maxTimeMinutes: 240, // 4 hours
    maxTimeFormatted: '04:00:00',
    description: 'ARM CPU development partition',
  }),
  'normal-arm': Object.freeze({
    name: 'normal-arm',
    category: 'ARM CPU',
    maxTimeMinutes: 2880, // 2 days
    maxTimeFormatted: '2-00:00:00',
    description: 'ARM CPU standard production partition',
  }),
  'large-arm': Object.freeze({
    name: 'large-arm',
    category: 'ARM CPU',
    maxTimeMinutes: 4320, // 3 days
    maxTimeFormatted: '3-00:00:00',
    description: 'ARM CPU large partition',
  }),
  'ooda': Object.freeze({
    name: 'ooda',
    category: 'Other',
    maxTimeMinutes: 480, // 8 hours
    maxTimeFormatted: '08:00:00',
    description: 'OODA partition',
  }),
});

export function isKnownDeucalionPartition(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(DEUCALION_PARTITIONS, name);
}

export function getDeucalionPartition(name: string): DeucalionPartitionLimit | undefined {
  return DEUCALION_PARTITIONS[name];
}

/**
 * Parses a Slurm time string into minutes.
 * Accepts:
 * - "UNLIMITED" | "INFINITE" -> Infinity
 * - "minutes" (e.g. "120" -> 120)
 * - "MM:SS" (e.g. "30:00" -> 30)
 * - "HH:MM:SS" (e.g. "04:00:00" -> 240)
 * - "D-HH:MM:SS" (e.g. "2-00:00:00" -> 2880)
 * - "D-HH:MM" (e.g. "2-00:00" -> 2880)
 * - "D-HH" (e.g. "2-00" -> 2880)
 */
export function parseSlurmTimeToMinutes(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (/^(?:UNLIMITED|INFINITE)$/i.test(value)) return Infinity;

  // Pure integer: in Slurm, this is minutes
  if (/^\d+$/.test(value)) {
    return Number(value);
  }

  // Days prefix: D-HH[:MM[:SS]]
  const dayMatch = value.match(/^(\d+)-(\d+)(?::(\d+))?(?::(\d+))?$/);
  if (dayMatch !== null) {
    const days = Number(dayMatch[1]);
    const hours = Number(dayMatch[2]);
    const minutes = dayMatch[3] !== undefined ? Number(dayMatch[3]) : 0;
    const seconds = dayMatch[4] !== undefined ? Number(dayMatch[4]) : 0;
    return days * 1440 + hours * 60 + minutes + seconds / 60;
  }

  // Colon separated: MM:SS or HH:MM:SS
  const parts = value.split(':');
  if (parts.length === 2 && parts.every((p) => /^\d+$/.test(p))) {
    const minutes = Number(parts[0]);
    const seconds = Number(parts[1]);
    return minutes + seconds / 60;
  }
  if (parts.length === 3 && parts.every((p) => /^\d+$/.test(p))) {
    const hours = Number(parts[0]);
    const minutes = Number(parts[1]);
    const seconds = Number(parts[2]);
    return hours * 60 + minutes + seconds / 60;
  }

  return undefined;
}

export const DEUCALION_PROFILE: DeucalionProfile = Object.freeze({
  version: '2026-09-09-v1.1',
  verification: 'partial',
  attemptedOn: '2026-09-09',
  sourceAttempts: Object.freeze([
    Object.freeze({
      url: 'https://docs.deucalion.macc.fccn.pt/',
      evidence: 'Verified available partition limits (dev/normal/large for GPU/x86/ARM and ooda).',
    }),
    Object.freeze({
      url: 'https://slurm.schedmd.com/sbatch.html',
      evidence: 'Standard Slurm sbatch directive parsing specification.',
    }),
    Object.freeze({
      url: 'https://slurm.schedmd.com/qos.html',
      evidence: 'QoS limits remain separate and unverified.',
    }),
    Object.freeze({
      url: 'https://slurm.schedmd.com/resource_limits.html',
      evidence: 'No precedence between partition and QoS limits was inferred.',
    }),
  ]),
  partitions: DEUCALION_PARTITIONS,
  qos: Object.freeze({}),
});
