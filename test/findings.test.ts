import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createEditorAdapter,
  type DiagnosticLike,
  type DisposableLike,
  type EditorDocument,
  type UriLike,
  type VscodeLike,
} from '../src/editor/adapter';
import {
  DeucalionFindingsProvider,
  type FindingsViewVscode,
} from '../src/editor/findingsView';
import type { HpcDiagnostic } from '../src/core/types';

class FakeUri implements UriLike {
  public constructor(public readonly path: string) {}

  public toString(): string {
    return `fake:${this.path}`;
  }
}

class FakeDocument implements EditorDocument {
  public readonly uri: FakeUri;

  public constructor(
    public readonly fileName: string,
    public languageId: string,
    private text: string,
  ) {
    this.uri = new FakeUri(fileName);
  }

  public getText(): string {
    return this.text;
  }

  public replaceText(text: string): void {
    this.text = text;
  }
}

type Listener<T> = (event: T) => unknown;

class FakeDisposable implements DisposableLike {
  public disposed = false;

  public constructor(private readonly onDispose: () => void = () => undefined) {}

  public dispose(): void {
    if (!this.disposed) {
      this.disposed = true;
      this.onDispose();
    }
  }
}

class FakeDiagnosticCollection extends FakeDisposable {
  public readonly entries = new Map<string, readonly DiagnosticLike[]>();

  public set(uri: UriLike, diagnostics: readonly DiagnosticLike[]): void {
    this.entries.set(uri.toString(), diagnostics);
  }

  public delete(uri: UriLike): void {
    this.entries.delete(uri.toString());
  }
}

class FakeVscode {
  public readonly collection = new FakeDiagnosticCollection();
  public configMap = new Map<string, unknown>();

  public readonly listeners = {
    open: [] as Listener<EditorDocument>[],
    save: [] as Listener<EditorDocument>[],
    change: [] as Listener<{ document: EditorDocument }>[],
    close: [] as Listener<EditorDocument>[],
    delete: [] as Listener<{ files: readonly UriLike[] }>[],
    rename: [] as Listener<{
      files: readonly { oldUri: UriLike; newUri: UriLike }[];
    }>[],
  };

  public readonly DiagnosticSeverity = {
    Error: 0,
    Warning: 1,
    Information: 2,
  };

  public readonly Range = class {
    public constructor(
      public readonly startLine: number,
      public readonly startCharacter: number,
      public readonly endLine: number,
      public readonly endCharacter: number,
    ) {}
  };

  public readonly Diagnostic = class implements DiagnosticLike {
    public source?: string;
    public code?: string | { value: string; target: UriLike };

    public constructor(
      public readonly range: unknown,
      public readonly message: string,
      public readonly severity: unknown,
    ) {}
  };

  public readonly Uri = {
    parse: (value: string): UriLike => new FakeUri(value),
  };

  public readonly languages = {
    createDiagnosticCollection: (_name: string): FakeDiagnosticCollection =>
      this.collection,
  };

  public readonly workspace: VscodeLike['workspace'];

  public constructor(documents: readonly EditorDocument[] = []) {
    this.workspace = {
      textDocuments: documents,
      getConfiguration: (_section?: string) => ({
        get: <T>(key: string, defaultValue?: T): T | undefined => {
          if (fakeSelf.configMap.has(key)) {
            return fakeSelf.configMap.get(key) as T;
          }
          return defaultValue;
        },
      }),
      onDidOpenTextDocument: (listener) => this.listen(this.listeners.open, listener),
      onDidSaveTextDocument: (listener) => this.listen(this.listeners.save, listener),
      onDidChangeTextDocument: (listener) =>
        this.listen(this.listeners.change, listener),
      onDidCloseTextDocument: (listener) =>
        this.listen(this.listeners.close, listener),
      onDidDeleteFiles: (listener) => this.listen(this.listeners.delete, listener),
      onDidRenameFiles: (listener) => this.listen(this.listeners.rename, listener),
    };
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const fakeSelf = this;
  }

  public asApi(): VscodeLike {
    return this as unknown as VscodeLike;
  }

  public open(document: EditorDocument): void {
    for (const listener of this.listeners.open) listener(document);
  }

  public change(document: EditorDocument): void {
    for (const listener of this.listeners.change) listener({ document });
  }

  public close(document: EditorDocument): void {
    for (const listener of this.listeners.close) listener(document);
  }

  private listen<T>(listeners: Listener<T>[], listener: Listener<T>): DisposableLike {
    listeners.push(listener);
    return new FakeDisposable(() => {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    });
  }
}

class FakeTreeItem {
  public description?: string;
  public tooltip?: string;
  public resourceUri?: unknown;
  public iconPath?: unknown;
  public command?: { command: string; title: string; arguments?: unknown[] };

  public constructor(
    public label: string,
    public collapsibleState?: number,
  ) {}
}

const mockViewApi: FindingsViewVscode = {
  TreeItem: FakeTreeItem as unknown as FindingsViewVscode['TreeItem'],
  TreeItemCollapsibleState: {
    None: 0,
    Collapsed: 1,
    Expanded: 2,
  } as unknown as FindingsViewVscode['TreeItemCollapsibleState'],
  ThemeIcon: class {
    public constructor(public id: string, public color?: unknown) {}
    public static readonly File = new (class { public readonly id = 'file'; })();
  } as unknown as FindingsViewVscode['ThemeIcon'],
  ThemeColor: class {
    public constructor(public id: string) {}
  } as unknown as FindingsViewVscode['ThemeColor'],
  EventEmitter: class {
    private listeners: ((e: unknown) => unknown)[] = [];
    public event = (listener: (e: unknown) => unknown) => {
      this.listeners.push(listener);
      return {
        dispose: () => {
          const index = this.listeners.indexOf(listener);
          if (index >= 0) this.listeners.splice(index, 1);
        },
      };
    };
    public fire(data: unknown): void {
      for (const listener of this.listeners) listener(data);
    }
    public dispose(): void {
      this.listeners = [];
    }
  } as unknown as FindingsViewVscode['EventEmitter'],
  DiagnosticSeverity: {
    Error: 0,
    Warning: 1,
    Information: 2,
  } as unknown as FindingsViewVscode['DiagnosticSeverity'],
};

const mockDiagnostic: HpcDiagnostic = {
  code: 'SBATCH_INVALID_NODES',
  message: 'Node count must be a positive integer.',
  severity: 'error',
  range: {
    start: { line: 1, character: 10 },
    end: { line: 1, character: 20 },
  },
};

test('adapter tracks findings accurately and fires onDidChangeFindings', () => {
  const doc = new FakeDocument('/workspace/job.sbatch', 'plaintext', '#SBATCH --nodes=0\n');
  const fake = new FakeVscode();

  const adapter = createEditorAdapter(fake.asApi(), {
    validateMakefile: () => [],
    validateSbatch: () => [mockDiagnostic],
  });

  let eventsFired = 0;
  const sub = adapter.onDidChangeFindings(() => {
    eventsFired += 1;
  });

  fake.open(doc);
  assert.equal(eventsFired, 1);
  const findings = adapter.getFindings();
  assert.equal(findings.size, 1);
  assert.equal(findings.get(doc.uri.toString())?.diagnostics.length, 1);

  // Edit file -> diagnostics cleared
  doc.replaceText('editing\n');
  fake.change(doc);
  assert.equal(eventsFired, 2);
  assert.equal(adapter.getFindings().size, 0);

  sub.dispose();
  adapter.dispose();
});

test('DeucalionFindingsProvider tree lifecycle, counts, and items', () => {
  const doc = new FakeDocument('/workspace/cluster/test.sbatch', 'plaintext', '#SBATCH --nodes=0\n');
  const fake = new FakeVscode();

  const adapter = createEditorAdapter(fake.asApi(), {
    validateMakefile: () => [],
    validateSbatch: () => [mockDiagnostic],
  });

  const provider = new DeucalionFindingsProvider(adapter, mockViewApi);

  // Initially empty
  assert.equal(provider.getTotalFindingsCount(), 0);
  const initialChildren = provider.getChildren();
  assert.deepEqual(initialChildren, [{ type: 'empty' }]);
  const emptyItem = provider.getTreeItem({ type: 'empty' });
  assert.equal(emptyItem.label, 'No Deucalion HPC findings detected');

  // Open document with problem
  fake.open(doc);
  assert.equal(provider.getTotalFindingsCount(), 1);

  // Root elements should show file
  const rootChildren = provider.getChildren() as { type: string; label: string; count: number }[];
  assert.equal(rootChildren.length, 1);
  assert.equal(rootChildren[0]?.type, 'file');
  assert.equal(rootChildren[0]?.label, 'test.sbatch');
  assert.equal(rootChildren[0]?.count, 1);

  const fileItem = provider.getTreeItem(rootChildren[0] as any);
  assert.equal(fileItem.label, 'test.sbatch');
  assert.equal(fileItem.description, '1 finding');

  // Child elements should show diagnostic
  const childChildren = provider.getChildren(rootChildren[0] as any) as { type: string; diagnostic: DiagnosticLike }[];
  assert.equal(childChildren.length, 1);
  assert.equal(childChildren[0]?.type, 'diagnostic');

  const diagItem = provider.getTreeItem(childChildren[0] as any);
  assert.equal(diagItem.label, 'SBATCH_INVALID_NODES');
  assert.match(String(diagItem.description), /Line 2:/);
  assert.equal(diagItem.command?.command, 'vscode.open');

  // Manual clear
  provider.clear();
  assert.equal(provider.getTotalFindingsCount(), 0);
  assert.deepEqual(provider.getChildren(), [{ type: 'empty' }]);

  // Refresh
  provider.refresh();

  provider.dispose();
  adapter.dispose();
});
