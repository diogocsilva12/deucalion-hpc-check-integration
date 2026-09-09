import * as vscode from 'vscode';

import { validateMakefile } from './core/makefile';
import { validateSbatch } from './core/sbatch';
import { createEditorAdapter, type VscodeLike } from './editor/adapter';

export function activate(context: vscode.ExtensionContext): void {
  const adapter = createEditorAdapter(vscode as unknown as VscodeLike, {
    validateMakefile,
    validateSbatch,
  });
  context.subscriptions.push(adapter);
}

export function deactivate(): void {
  // VS Code disposes the adapter registered in the extension context.
}
