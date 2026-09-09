# Deucalion HPC Check

Deucalion HPC Check is a deterministic, offline VS Code extension that reports GNU Make and Slurm `sbatch` issues in the built-in Problems panel and as editor squiggles. Every diagnostic uses the source `Deucalion HPC`; rule codes and verified documentation links are preserved when supplied by the validator.

The extension validates only when a supported document is opened or saved. Editing immediately removes stale diagnostics and does not run validation. Closing, deleting, or renaming a file also removes its diagnostics, as does saving a document that is no longer supported. Documents already open when the extension activates are checked.

## Supported documents

- `Makefile`, `makefile`, `GNUmakefile`, and `*.mk`
- `*.sbatch` and `*.slurm`
- documents identified by VS Code as `shellscript` when they contain a line beginning with optional horizontal whitespace followed by `#SBATCH`

The extension activates for Make and shell language documents and after VS Code startup so custom Slurm filename extensions are not missed. The included workspace settings associate `*.sbatch` and `*.slurm` with shell script mode during extension development.

## Safety and limits

Validation reads the in-memory text of the open document. At runtime the extension starts no child processes, runs neither `make` nor shell/Slurm commands, performs no network requests, uploads no code, and never blocks job submission. It is declared safe for untrusted workspaces because the same non-executing behavior is used there.

Processing is bounded:

- Documents over 1,000,000 UTF-16 code units are not passed to a validator. An `HPC_FILE_TOO_LARGE` information diagnostic explains the limit.
- At most 500 diagnostics are published for one document. If more are returned, the final published item is `HPC_DIAGNOSTICS_TRUNCATED`.

Version 0.1 performs no cross-file analysis and cannot fully verify values assembled dynamically by Make or shell code. Diagnostics are advisory and do not submit, cancel, or block work. The bundled core rule documentation records the cluster sources, retrieval dates, and any inaccessible or ambiguous constraints.

## Configuration settings

All settings are configured under the `deucalionHpc.*` namespace in VS Code User or Workspace settings (`.vscode/settings.json`):

| Setting | Type | Default | Description |
| --- | --- | --- | --- |
| `deucalionHpc.enabled` | `boolean` | `true` | Master switch to enable or disable diagnostics globally or per workspace/folder. |
| `deucalionHpc.disabledWorkspaces` | `string[]` | `[]` | List of workspace names or path patterns where validation is disabled. |
| `deucalionHpc.enabledWorkspaces` | `string[]` | `[]` | When non-empty, only matching workspace names or paths are validated. |
| `deucalionHpc.makefile.enabled` | `boolean` | `true` | Enable or disable GNU Makefile syntax and recipe checks. |
| `deucalionHpc.slurm.enabled` | `boolean` | `true` | Enable or disable Slurm `sbatch` script checks. |
| `deucalionHpc.disabledRules` | `string[]` | `[]` | List of rule codes to suppress (e.g. `["makefile.space-indented-recipe", "SBATCH_DYNAMIC_VALUE"]`). Supports wildcards such as `"makefile.*"`. |
| `deucalionHpc.rules` | `object` | `{}` | Map of individual rule codes to their enabled boolean status (e.g. `{"SBATCH_DYNAMIC_VALUE": false}`). |

### Example `.vscode/settings.json`

```json
{
  "deucalionHpc.enabled": true,
  "deucalionHpc.makefile.enabled": true,
  "deucalionHpc.slurm.enabled": true,
  "deucalionHpc.disabledRules": [
    "SBATCH_DYNAMIC_VALUE"
  ],
  "deucalionHpc.rules": {
    "makefile.space-indented-recipe": true
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

`npm run lint` is intentionally an honest strict TypeScript type-check (`tsc --noEmit`); this project has no separate style-linter dependency. Tests use Node's built-in test runner after compiling to `out/test`. Adapter lifecycle tests inject a fake VS Code interface, so the automated suite needs no graphical Extension Development Host.

The TypeScript configuration is strict, targets ES2022, and emits CommonJS. There are no runtime npm dependencies. Development tool versions are exact in `package.json` and the complete dependency graph is pinned by `package-lock.json`.

### F5 manual check

These are manual verification instructions, not a claim that a graphical-host check has already been performed:

1. Run `npm ci --ignore-scripts` and open this repository in VS Code.
2. Press F5 and select **Run Deucalion HPC Check** if prompted.
3. In the Extension Development Host, open a `Makefile`, a `job.sbatch`, and a `run.sh` containing `#SBATCH --time=00:10:00`.
4. Confirm diagnostics appear after open, disappear as soon as text is edited, and return only after save.
5. Confirm the Problems panel shows source `Deucalion HPC`, stable rule codes, and exact squiggle ranges.
6. Rename and delete a diagnosed scratch file and confirm its Problems entry disappears.

## Build and install a VSIX

```sh
npm run package
code --install-extension deucalion-hpc-check-0.1.0.vsix
```

The package script runs the build through VS Code's `vscode:prepublish` hook and then invokes the pinned `@vscode/vsce` development dependency. It packages compiled extension/core JavaScript and rule documentation, while excluding TypeScript sources, tests, source maps, editor settings, CI files, and development dependencies. The current publisher identity is suitable for local/private VSIX use; Marketplace publication requires choosing and owning the final publisher identity and licensing metadata.

### Remote SSH manual check

The extension declares `extensionKind: ["workspace"]`, so VS Code installs/runs it in the remote extension host and validates the remote document text without invoking remote commands.

1. Connect to a test host with **Remote - SSH**.
2. From the connected window, install the generated VSIX in the SSH target when VS Code offers the local/remote choice.
3. Open remote Make and Slurm scratch files and repeat the open, edit, save, rename, and delete checks above.
4. In **Developer: Show Running Extensions**, confirm Deucalion HPC Check is running in the remote extension host.

No live Remote SSH session is exercised by the Node test suite, and these instructions do not claim one was performed for this build.
