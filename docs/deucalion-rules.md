# Deucalion and Slurm rules

Policy bundle version: `2026-09-09-v1.1`

## Verification status

Deucalion partition configuration is **verified**. The available partitions and their maximum execution time limits on the Deucalion supercomputer are:

| Category | Partition | Max Time Limit | Max Time (Minutes) | Description |
| --- | --- | --- | --- | --- |
| GPU | `dev-a100-40` | `04:00:00` | 240 | NVIDIA A100 (40GB) development partition |
| GPU | `normal-a100-40` | `2-00:00:00` | 2880 | NVIDIA A100 (40GB) standard production partition |
| GPU | `dev-a100-80` | `04:00:00` | 240 | NVIDIA A100 (80GB) development partition |
| GPU | `normal-a100-80` | `2-00:00:00` | 2880 | NVIDIA A100 (80GB) standard production partition |
| x86 CPU | `dev-x86` | `04:00:00` | 240 | x86 CPU development partition |
| x86 CPU | `normal-x86` | `2-00:00:00` | 2880 | x86 CPU standard production partition |
| x86 CPU | `large-x86` | `3-00:00:00` | 4320 | x86 CPU large partition |
| ARM CPU | `dev-arm` | `04:00:00` | 240 | ARM CPU development partition |
| ARM CPU | `normal-arm` | `2-00:00:00` | 2880 | ARM CPU standard production partition |
| ARM CPU | `large-arm` | `3-00:00:00` | 4320 | ARM CPU large partition |
| Other | `ooda` | `08:00:00` | 480 | OODA partition |

QoS limits and unverified scheduler boundaries (such as cluster-wide max array size or CPU socket topologies) remain unverified and produce advisory notices when encountered.

## Deucalion Partition & Time Diagnostics

1. **`DEUCALION_UNKNOWN_PARTITION`** (`error`):
   Reported when `-p` or `--partition` specifies a partition name not found in the official Deucalion partition registry. Supports comma-separated lists (e.g. `--partition=dev-x86,normal-x86`).

2. **`DEUCALION_TIME_EXCEEDS_PARTITION_LIMIT`** (`error`):
   Reported when the requested `--time` (or `-t`) exceeds the maximum time limit configured for the target Deucalion partition (e.g. requesting `5:00:00` on `dev-x86`, whose limit is `4:00:00`). Also flags `UNLIMITED` / `INFINITE` requests on partitions with finite limits.

3. **`DEUCALION_POLICY_UNVERIFIED`** (`information`):
   Advisory notice emitted when resource options without authoritative published boundaries (such as QoS policies) are specified.

## Offline generic checks

The validator performs conservative parsing without networking, subprocesses, or execution of a submitted file. It recognizes only exact `#SBATCH` directive lines before the first executable, non-comment, non-whitespace line. Later exact directives are reported as ignored. Shell heredoc bodies are skipped, including quoted delimiters and `<<-` tab stripping, so payload text is not treated as an active directive.

Known long options accept both `--name=value` and `--name value`. Known short resource options accept separate, attached, and equals forms such as `-N 2`, `-N2`, and `-N=2`. Unknown options are ignored by this checker; being outside its known set is not itself an error.

The generic checks cover:

- positive integer or ascending `MIN-MAX` node counts;
- positive task, task-density, CPU-per-task, and CPU-per-GPU counts;
- Slurm-style numeric, `MM:SS`, `HH:MM:SS`, and day-prefixed time shapes, plus zero, `UNLIMITED`, and `INFINITE`;
- non-negative integer memory values with optional case-insensitive `K`, `M`, `G`, or `T` suffix, where zero remains a valid special value;
- comma-separated array indices and ascending ranges, with optional positive step and `%` concurrency limit;
- mutually exclusive `--mem`, `--mem-per-cpu`, and `--mem-per-gpu` request modes;
- missing values and unterminated directive quotes.

Values that appear to contain shell variables, command substitution, or common template placeholders are reported as `SBATCH_DYNAMIC_VALUE` information and are not given a definite numeric error. The message notes that `#SBATCH` values are not shell-expanded; the downgrade exists to avoid treating an unresolved generated template as a known fixed value.
