import type * as vscode from 'vscode';
import type {
  DiagnosticLike,
  EditorAdapter,
  UriLike,
} from './adapter';

export type FindingsTreeElement =
  | {
      readonly type: 'file';
      readonly uri: UriLike;
      readonly label: string;
      readonly count: number;
    }
  | {
      readonly type: 'diagnostic';
      readonly uri: UriLike;
      readonly diagnostic: DiagnosticLike;
    }
  | {
      readonly type: 'empty';
    };

export interface FindingsViewVscode {
  TreeItem: typeof vscode.TreeItem;
  TreeItemCollapsibleState: typeof vscode.TreeItemCollapsibleState;
  ThemeIcon: typeof vscode.ThemeIcon;
  ThemeColor: typeof vscode.ThemeColor;
  EventEmitter: new <T>() => vscode.EventEmitter<T>;
  DiagnosticSeverity: typeof vscode.DiagnosticSeverity;
}

function baseName(path: string): string {
  return path.split(/[\\/]/).at(-1) ?? path;
}

export class DeucalionFindingsProvider
  implements vscode.TreeDataProvider<FindingsTreeElement>, vscode.Disposable
{
  private readonly _onDidChangeTreeData: vscode.EventEmitter<
    FindingsTreeElement | undefined | null | void
  >;
  public readonly onDidChangeTreeData: vscode.Event<
    FindingsTreeElement | undefined | null | void
  >;

  private readonly adapterSubscription?: { dispose(): void };
  private isManuallyCleared = false;

  public constructor(
    private readonly adapter: EditorAdapter,
    private readonly api: FindingsViewVscode,
  ) {
    this._onDidChangeTreeData = new this.api.EventEmitter<
      FindingsTreeElement | undefined | null | void
    >();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;

    if (adapter.onDidChangeFindings) {
      this.adapterSubscription = adapter.onDidChangeFindings(() => {
        this.isManuallyCleared = false;
        this.refresh();
      });
    }
  }

  public refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  public clear(): void {
    this.isManuallyCleared = true;
    this.refresh();
  }

  public getTotalFindingsCount(): number {
    if (this.isManuallyCleared) {
      return 0;
    }
    const findings = this.adapter.getFindings();
    let count = 0;
    for (const entry of findings.values()) {
      count += entry.diagnostics.length;
    }
    return count;
  }

  public getTreeItem(element: FindingsTreeElement): vscode.TreeItem {
    if (element.type === 'empty') {
      const item = new this.api.TreeItem(
        'No Deucalion HPC findings detected',
        this.api.TreeItemCollapsibleState.None,
      );
      item.description = 'All checked files pass validation';
      item.iconPath = new this.api.ThemeIcon(
        'pass',
        new this.api.ThemeColor('testing.iconPassed'),
      );
      return item;
    }

    if (element.type === 'file') {
      const item = new this.api.TreeItem(
        element.label,
        this.api.TreeItemCollapsibleState.Expanded,
      );
      item.description = `${element.count} finding${element.count === 1 ? '' : 's'}`;
      item.tooltip = `${element.uri.path} (${element.count} finding${element.count === 1 ? '' : 's'})`;
      item.resourceUri = element.uri as unknown as vscode.Uri;
      item.iconPath = this.api.ThemeIcon.File;
      return item;
    }

    const diag = element.diagnostic;
    const code =
      typeof diag.code === 'object' && diag.code !== null
        ? diag.code.value
        : String(diag.code ?? 'FINDING');

    const range = diag.range as
      | {
          start?: { line?: number; character?: number };
          end?: { line?: number; character?: number };
          startLine?: number;
          startCharacter?: number;
        }
      | undefined;
    const line = ((range?.start?.line ?? range?.startLine) ?? 0) + 1;
    const character =
      ((range?.start?.character ?? range?.startCharacter) ?? 0) + 1;

    const item = new this.api.TreeItem(
      code,
      this.api.TreeItemCollapsibleState.None,
    );
    item.description = `Line ${line}: ${diag.message}`;
    item.tooltip = `[${code}] ${diag.message}\nLine ${line}, Col ${character}`;

    if (
      diag.severity === this.api.DiagnosticSeverity.Error ||
      diag.severity === 0
    ) {
      item.iconPath = new this.api.ThemeIcon(
        'error',
        new this.api.ThemeColor('problemsErrorIcon.foreground'),
      );
    } else if (
      diag.severity === this.api.DiagnosticSeverity.Warning ||
      diag.severity === 1
    ) {
      item.iconPath = new this.api.ThemeIcon(
        'warning',
        new this.api.ThemeColor('problemsWarningIcon.foreground'),
      );
    } else {
      item.iconPath = new this.api.ThemeIcon(
        'info',
        new this.api.ThemeColor('problemsInfoIcon.foreground'),
      );
    }

    item.command = {
      command: 'vscode.open',
      title: 'Go to Problem',
      arguments: [element.uri as unknown as vscode.Uri, { selection: diag.range }],
    };

    return item;
  }

  public getChildren(
    element?: FindingsTreeElement,
  ): vscode.ProviderResult<FindingsTreeElement[]> {
    if (this.isManuallyCleared) {
      return [{ type: 'empty' }];
    }

    const findings = this.adapter.getFindings();
    if (findings.size === 0) {
      return [{ type: 'empty' }];
    }

    if (!element) {
      const fileElements: FindingsTreeElement[] = [];
      for (const entry of findings.values()) {
        if (entry.diagnostics.length > 0) {
          fileElements.push({
            type: 'file',
            uri: entry.uri,
            label: baseName(entry.uri.path),
            count: entry.diagnostics.length,
          });
        }
      }
      if (fileElements.length === 0) {
        return [{ type: 'empty' }];
      }
      return fileElements;
    }

    if (element.type === 'file') {
      const entry = findings.get(element.uri.toString());
      if (!entry || entry.diagnostics.length === 0) {
        return [];
      }
      return entry.diagnostics.map((diag) => ({
        type: 'diagnostic',
        uri: element.uri,
        diagnostic: diag,
      }));
    }

    return [];
  }

  public dispose(): void {
    this._onDidChangeTreeData.dispose();
    this.adapterSubscription?.dispose();
  }
}
