# Deucalion and Slurm rules

Policy bundle version: `2026-09-09-blocked`

## Verification status

Deucalion policy verification is **blocked**. On 2026-09-09 the required DeepAPI environment variables were absent, and the documented fallback file `~/.deepapi/env` did not exist. The retrieval workflow therefore stopped before making a request. No partition name, partition resource/time limit, QoS name, or QoS resource/time limit has been inferred or bundled.

The offline profile in `src/core/deucalion.ts` deliberately contains two separate empty maps:

- `partitions` is reserved for constraints stated as properties of a partition.
- `qos` is reserved for constraints stated as properties of a QoS.

An empty map means “unverified”, not “unlimited”. A syntactically valid fixed resource request produces `DEUCALION_POLICY_UNVERIFIED` once per validation result. Diagnostics produced from this blocked profile do not carry `sourceUrl`, because the shared contract reserves that field for a verified documentation URL.

## Retrieval record

| Intended authoritative URL | Attempt date | Status | Concise evidence |
| --- | --- | --- | --- |
| <https://docs.deucalion.macc.fccn.pt/> | 2026-09-09 | Blocked before request | DeepAPI credentials were unavailable and its fallback environment file was missing. No page content was retrieved. |
| <https://slurm.schedmd.com/sbatch.html> | 2026-09-09 | Blocked before request | The same retrieval blocker prevented collection of the official `sbatch` page. No source-backed option claim was recorded. |
| <https://slurm.schedmd.com/qos.html> | 2026-09-09 | Blocked before request | QoS documentation was not retrieved, so no QoS boundary was bundled. |
| <https://slurm.schedmd.com/resource_limits.html> | 2026-09-09 | Blocked before request | Resource-limit precedence documentation was not retrieved, so partition and QoS policies were not conflated. |

These URLs are retrieval targets, not citations establishing a rule in this bundle. Exact Deucalion policy work must remain blocked until the official pages can be retrieved and their wording preserved as evidence.

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

## Deliberate limitations

- There is no allowlist of Deucalion partitions or QoS values.
- There are no Deucalion time, node, task, CPU, memory, GPU, or array maxima.
- No QoS limit is applied as a partition limit, or vice versa.
- Scheduler-configured boundaries such as maximum array size are not guessed.
- Unknown Slurm options and complex resources such as GRES/GPU type expressions are left unvalidated rather than rejected.
