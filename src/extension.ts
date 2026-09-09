import * as vscode from 'vscode';

import { validateMakefile } from './core/makefile';
import { validateSbatch } from './core/sbatch';
import { createEditorAdapter, type VscodeLike } from './editor/adapter';
import {
  DeucalionFindingsProvider,
  type FindingsViewVscode,
} from './editor/findingsView';

export function activate(context: vscode.ExtensionContext): void {
  const adapter = createEditorAdapter(vscode as unknown as VscodeLike, {
    validateMakefile,
    validateSbatch,
  });
  context.subscriptions.push(adapter);

  const findingsProvider = new DeucalionFindingsProvider(
    adapter,
    vscode as unknown as FindingsViewVscode,
  );
  context.subscriptions.push(findingsProvider);

  const treeView = vscode.window.createTreeView('deucalionHpcFindings', {
    treeDataProvider: findingsProvider,
    showCollapseAll: true,
  });
  context.subscriptions.push(treeView);

  const updateBadge = (): void => {
    const count = findingsProvider.getTotalFindingsCount();
    treeView.badge =
      count > 0
        ? {
            value: count,
            tooltip: `${count} Deucalion HPC finding${count === 1 ? '' : 's'}`,
          }
        : undefined;
  };

  context.subscriptions.push(
    findingsProvider.onDidChangeTreeData(updateBadge),
    vscode.commands.registerCommand('deucalionHpc.refreshFindings', () => {
      findingsProvider.refresh();
      updateBadge();
    }),
    vscode.commands.registerCommand('deucalionHpc.clearFindings', () => {
      findingsProvider.clear();
      updateBadge();
    }),
  );

  updateBadge();
}

export function deactivate(): void {
  // VS Code disposes the subscriptions registered in the extension context.
}
