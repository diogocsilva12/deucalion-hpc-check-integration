export interface DeucalionProfile {
  readonly version: string;
  readonly verification: 'verified' | 'blocked';
  readonly attemptedOn: string;
  readonly blockedReason: string;
  readonly sourceAttempts: readonly {
    readonly url: string;
    readonly evidence: string;
  }[];
  /** Per-partition limits only. Never populate this with QoS limits. */
  readonly partitions: Readonly<Record<string, never>>;
  /** QoS limits only. Never apply these as intrinsic partition limits. */
  readonly qos: Readonly<Record<string, never>>;
}

/**
 * No cluster constraints are bundled until the official documentation can be
 * retrieved and verified. An empty profile must never be interpreted as
 * unlimited cluster resources.
 */
export const DEUCALION_PROFILE: DeucalionProfile = Object.freeze({
  version: '2026-09-09-blocked',
  verification: 'blocked',
  attemptedOn: '2026-09-09',
  blockedReason: 'DeepAPI credentials and ~/.deepapi/env were unavailable; no official page was retrieved.',
  sourceAttempts: Object.freeze([
    Object.freeze({
      url: 'https://docs.deucalion.macc.fccn.pt/',
      evidence: 'Not retrieved; no partition or QoS fact was accepted.',
    }),
    Object.freeze({
      url: 'https://slurm.schedmd.com/sbatch.html',
      evidence: 'Not retrieved; no URL-backed Slurm claim is attached to diagnostics.',
    }),
    Object.freeze({
      url: 'https://slurm.schedmd.com/qos.html',
      evidence: 'Not retrieved; QoS limits remain separate and empty.',
    }),
    Object.freeze({
      url: 'https://slurm.schedmd.com/resource_limits.html',
      evidence: 'Not retrieved; no precedence between partition and QoS limits was inferred.',
    }),
  ]),
  partitions: Object.freeze({}),
  qos: Object.freeze({}),
});
