# Deucalion HPC Check — v0.1

## Agreed requirements

- TypeScript VS Code extension with deterministic, offline checks; no AI and no code upload.
- GNU Makefile formatting/syntax checks and Slurm sbatch syntax/resource checks, plus documented Deucalion rules from https://docs.deucalion.macc.fccn.pt/ .
- Run on opening and saving supported files, not while typing. Built-in Problems panel and editor squiggles use source `Deucalion HPC`.
- Support local VS Code and Remote SSH. Do not execute user code, make, shell scripts, or sbatch, even for validation. No submission blocking.
- Distinguish certain errors, likely issues (warnings), and unverified/dynamic cases. Prefer conservative checks over false positives. Honor GNU Make exceptions such as .RECIPEPREFIX, continuations, define/endef and conditionals.
- Bundle versioned cluster rules with exact source URLs, retrieval dates, and evidence. Never invent current cluster constraints. Document inaccessible or ambiguous information instead.
- No cross-file executable analysis for v0.1.
- File support: Makefile/makefile/GNUmakefile and *.mk; *.sbatch/*.slurm plus shell files containing SBATCH directives. Handle CRLF and empty files.
- Clear stale diagnostics on editing (without revalidation), close, deletion, rename or unsupported-file transition; check existing open documents on activation.
- Bound processing of oversized files; explain limits in README. No network or child processes at runtime.

## Shared implementation contract

`src/core/types.ts` contains `HpcDiagnostic` with stable code, message, severity ('error'|'warning'|'information'), and a zero-based UTF-16 start/end range (end exclusive). Optional sourceUrl is a verified documentation URL.

- `src/core/makefile.ts` exports `validateMakefile(text: string): HpcDiagnostic[]`.
- `src/core/sbatch.ts` exports `validateSbatch(text: string): HpcDiagnostic[]`; imports its bundled profile internally.
- VS Code adapter imports these two functions directly; no core index needed.
- Core modules import `./types` (CommonJS TypeScript compilation).
- Tests use Node built-in node:test and assert in TypeScript, compiled with tsc to out/. `npm test` builds then runs `node --test out/test/*.test.js`.
- Strict TS targeting ES2022/CommonJS. No runtime dependencies expected.

## Ownership

1. Makefile worker: only src/core/makefile.ts, test/makefile.test.ts, test/fixtures/makefile/**, docs/makefile-rules.md.
2. Slurm worker: only src/core/sbatch.ts, src/core/deucalion.ts (and additional core/slurm-specific helpers), test/sbatch.test.ts, test/fixtures/sbatch/**, docs/deucalion-rules.md. Own source verification and provenance.
3. Extension worker: package.json, package-lock.json, tsconfig.json, src/extension.ts, src/editor/**, test/extension.test.ts, README.md, .vscode/**, .vscodeignore, .gitignore, .github/**. Do not modify core files or create fake core stubs to commit. Core imports may remain unresolved until integration.

Each worker commits on its isolated branch, never pushes, never merges main. Report commit hash, test results, caveats. Coordinator reviews diffs, integrates on a branch, fixes and tests, then merges reviewed work into main. Do not claim real Remote SSH verification without a real session.
