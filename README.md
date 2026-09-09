# Deucalion HPC Check

Deucalion HPC Check is a deterministic, offline VS Code extension that reports GNU Make and Slurm `sbatch` issues in the built-in Problems panel, in squiggles, and in a dedicated **Deucalion HPC Findings** panel tab. Every diagnostic uses the source `Deucalion HPC`; rule codes and verified documentation links are preserved when supplied by the validator.

The extension validates only when a supported document is opened or saved. Editing immediately removes stale diagnostics and does not run validation. Closing, deleting, or renaming a file also removes its diagnostics, as does saving a document that is no longer supported. Documents already open when the extension activates are checked.

## Supported documents

- `Makefile`, `makefile`, `GNUmakefile`, and `*.mk`
- `*.sbatch` and `*.slurm`
- documents identified by VS Code as `shellscript` when they contain a line beginning with optional horizontal whitespace followed by `#SBATCH`

The extension activates for Make and shell language documents, on view focus, and after VS Code startup so custom Slurm filename extensions are not missed.

## Deucalion HPC Findings Panel Tab

In addition to publishing standard diagnostics to the VS Code Problems view, the extension provides a dedicated **Deucalion HPC Findings** tab in the bottom panel (alongside Problems, Output, and Terminal):

- **Hierarchical tree display**: Grouped by file, showing individual findings with rule code, line/column location, and descriptive message.
- **One-click jump**: Clicking any finding opens the file and places the cursor on the exact problem location.
- **Severity indicators**: Distinct icons for errors, warnings, and information notices.
- **Live badge counter**: Displays the total count of unresolved Deucalion findings.
- **Toolbar actions**: Includes **Refresh Findings** and **Clear Findings** buttons in the view title menu.

## Deucalion Partition & Time Limit Verification

The extension validates partition requests against the official partition registry of the Deucalion supercomputer:

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

- **`DEUCALION_UNKNOWN_PARTITION`**: Flags partition names not present in the Deucalion partition table (supports comma-separated partitions).
- **`DEUCALION_TIME_EXCEEDS_PARTITION_LIMIT`**: Flags execution time requests (`--time` / `-t`) that exceed the maximum time allowed for the chosen partition (including `UNLIMITED`/`INFINITE` requests).

## Safety and limits

Validation reads the in-memory text of the open document. At runtime the extension starts no child processes, runs neither `make` nor shell/Slurm commands, performs no network requests, uploads no code, and never blocks job submission. It is declared safe for untrusted workspaces because the same non-executing behavior is used there.

Processing is bounded:

- Documents over 1,000,000 UTF-16 code units are not passed to a validator. An `HPC_FILE_TOO_LARGE` information diagnostic explains the limit.
- At most 500 diagnostics are published for one document. If more are returned, the final published item is `HPC_DIAGNOSTICS_TRUNCATED`.

## Configuration settings

All settings are configured under the `deucalionHpc.*` namespace in VS Code Settings (`.vscode/settings.json`). In the VS Code Settings UI, **"Add Item"** provides predefined dropdown menus with descriptions for all available rules and partitions:

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `deucalionHpc.enabled` | `boolean` | `true` | Master switch to enable or disable diagnostics globally or per workspace/folder. |
| `deucalionHpc.disabledWorkspaces` | `string[]` | `[]` | List of workspace names or path patterns where validation is disabled. |
| `deucalionHpc.enabledWorkspaces` | `string[]` | `[]` | When non-empty, only matching workspace names or paths are validated. |
| `deucalionHpc.makefile.enabled` | `boolean` | `true` | Enable or disable GNU Makefile syntax and recipe checks. |
| `deucalionHpc.slurm.enabled` | `boolean` | `true` | Enable or disable Slurm `sbatch` script checks. |
| `deucalionHpc.slurm.allowedPartitions` | `string[]` | `[]` | Allowed partitions with dropdown selector. When empty, all standard Deucalion partitions are allowed. |
| `deucalionHpc.disabledRules` | `string[]` | `[]` | List of rule codes to suppress with dropdown selector. Supports wildcards such as `"makefile.*"`. |
| `deucalionHpc.rules` | `object` | `{}` | Map of individual rule codes to their enabled boolean status with direct toggles. |

### Example `.vscode/settings.json`

```json
{
  "deucalionHpc.enabled": true,
  "deucalionHpc.makefile.enabled": true,
  "deucalionHpc.slurm.enabled": true,
  "deucalionHpc.slurm.allowedPartitions": [
    "normal-x86",
    "dev-x86"
  ],
  "deucalionHpc.disabledRules": [
    "SBATCH_DYNAMIC_VALUE"
  ],
  "deucalionHpc.rules": {
    "makefile.space-indented-recipe": true,
    "DEUCALION_UNKNOWN_PARTITION": true,
    "DEUCALION_TIME_EXCEEDS_PARTITION_LIMIT": true
  }
}
```

## Development

Prerequisites for this pinned development toolchain are Node.js 22 or newer, npm, and VS Code 1.96 or newer. The extension runtime itself uses only the VS Code interface and has no npm runtime dependencies.

```sh
npm ci --ignore-scripts
npm run build
npm run lint
npm test
```

`npm run lint` is an honest strict TypeScript type-check (`tsc --noEmit`); this project has no separate style-linter dependency. Tests use Node's built-in test runner after compiling to `out/test`. Adapter lifecycle and findings tests inject a fake VS Code interface, so the automated suite needs no graphical Extension Development Host.

The TypeScript configuration is strict, targets ES2022, and emits CommonJS. There are no runtime npm dependencies. Development tool versions are exact in `package.json` and the complete dependency graph is pinned by `package-lock.json`.

## Build and install a VSIX

```sh
npm run package
code --install-extension deucalion-hpc-check-1.1.0.vsix
```

The package script runs the build through VS Code's `vscode:prepublish` hook and then invokes `@vscode/vsce`. It packages compiled extension/core JavaScript, SVG resources, and rule documentation, while excluding TypeScript sources, tests, source maps, editor settings, CI files, and development dependencies.
