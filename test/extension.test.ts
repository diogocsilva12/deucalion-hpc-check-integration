import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createEditorAdapter,
  type ConfigurationChangeEventLike,
  type DiagnosticLike,
  type DisposableLike,
  type EditorDocument,
  type UriLike,
  type VscodeLike,
} from '../src/editor/adapter';
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
  public workspaceName?: string;
  public workspaceFolders?: readonly { uri: UriLike; name: string }[];

  public readonly listeners = {
    open: [] as Listener<EditorDocument>[],
    save: [] as Listener<EditorDocument>[],
    change: [] as Listener<{ document: EditorDocument }>[],
    close: [] as Listener<EditorDocument>[],
    delete: [] as Listener<{ files: readonly UriLike[] }>[],
    rename: [] as Listener<{
      files: readonly { oldUri: UriLike; newUri: UriLike }[];
    }>[],
    config: [] as Listener<ConfigurationChangeEventLike>[],
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
      get name(): string | undefined {
        return fakeSelf.workspaceName;
      },
      get workspaceFolders() {
        return fakeSelf.workspaceFolders;
      },
      textDocuments: documents,
      getConfiguration: (section?: string) => ({
        get: <T>(key: string, defaultValue?: T): T | undefined => {
          const fullKey = section ? `${section}.${key}` : key;
          if (fakeSelf.configMap.has(fullKey)) {
            return fakeSelf.configMap.get(fullKey) as T;
          }
          if (fakeSelf.configMap.has(key)) {
            return fakeSelf.configMap.get(key) as T;
          }
          return defaultValue;
        },
      }),
      onDidChangeConfiguration: (listener) =>
        this.listen(this.listeners.config, listener),
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

  public save(document: EditorDocument): void {
    for (const listener of this.listeners.save) listener(document);
  }

  public change(document: EditorDocument): void {
    for (const listener of this.listeners.change) listener({ document });
  }

  public close(document: EditorDocument): void {
    for (const listener of this.listeners.close) listener(document);
  }

  public delete(...uris: UriLike[]): void {
    for (const listener of this.listeners.delete) listener({ files: uris });
  }

  public rename(oldUri: UriLike, newUri: UriLike): void {
    for (const listener of this.listeners.rename) {
      listener({ files: [{ oldUri, newUri }] });
    }
  }

  public changeConfig(affectedKey = 'deucalionHpc'): void {
    const event: ConfigurationChangeEventLike = {
      affectsConfiguration: (section: string) =>
        affectedKey === section || affectedKey.startsWith(`${section}.`),
    };
    for (const listener of this.listeners.config) {
      listener(event);
    }
  }

  private listen<T>(listeners: Listener<T>[], listener: Listener<T>): DisposableLike {
    listeners.push(listener);
    return new FakeDisposable(() => {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    });
  }
}

const sampleDiagnostic: HpcDiagnostic = {
  code: 'MAKE_SAMPLE',
  message: 'Sample problem',
  severity: 'warning',
  range: {
    start: { line: 2, character: 3 },
    end: { line: 2, character: 7 },
  },
  sourceUrl: 'https://example.test/rule',
};

test('activation validates an already-open Makefile and preserves diagnostic details', () => {
  const document = new FakeDocument('/workspace/Makefile', 'makefile', 'all:\n');
  const fake = new FakeVscode([document]);

  const disposable = createEditorAdapter(fake.asApi(), {
    validateMakefile: () => [sampleDiagnostic],
    validateSbatch: () => [],
  });

  const diagnostics = fake.collection.entries.get(document.uri.toString());
  assert.equal(diagnostics?.length, 1);
  assert.equal(diagnostics?.[0]?.source, 'Deucalion HPC');
  assert.deepEqual(diagnostics?.[0]?.code, {
    value: 'MAKE_SAMPLE',
    target: new FakeUri('https://example.test/rule'),
  });
  assert.deepEqual({ ...(diagnostics?.[0]?.range as object) }, {
    startLine: 2,
    startCharacter: 3,
    endLine: 2,
    endCharacter: 7,
  });
  assert.equal(diagnostics?.[0]?.severity, fake.DiagnosticSeverity.Warning);

  disposable.dispose();
});

test('opening and saving supported documents selects the matching validator', () => {
  const fake = new FakeVscode();
  const calls: string[] = [];
  const { sourceUrl: _sourceUrl, ...diagnostic } = sampleDiagnostic;
  const disposable = createEditorAdapter(fake.asApi(), {
    validateMakefile: (text) => {
      calls.push(`make:${text}`);
      return [diagnostic];
    },
    validateSbatch: (text) => {
      calls.push(`sbatch:${text}`);
      return [diagnostic];
    },
  });
  const mk = new FakeDocument('/workspace/rules.mk', 'plaintext', 'mk');
  const sbatch = new FakeDocument('/workspace/job.sbatch', 'plaintext', 'sbatch');
  const slurm = new FakeDocument('/workspace/job.slurm', 'plaintext', '');
  const shell = new FakeDocument(
    '/workspace/run.sh',
    'shellscript',
    '#!/bin/sh\r\n#SBATCH --time=00:01:00\r\n',
  );
  const ordinaryShell = new FakeDocument('/workspace/local.sh', 'shellscript', 'echo local\n');
  const bareDirective = new FakeDocument('/workspace/bare.sh', 'shellscript', '#SBATCH\r\n');
  const text = new FakeDocument('/workspace/notes.txt', 'plaintext', '#SBATCH --nodes=1\n');

  fake.open(mk);
  fake.open(sbatch);
  fake.open(slurm);
  fake.open(shell);
  fake.open(ordinaryShell);
  fake.open(bareDirective);
  fake.open(text);
  shell.replaceText('#!/bin/sh\n#SBATCH --nodes=2\n');
  fake.save(shell);

  assert.deepEqual(calls, [
    'make:mk',
    'sbatch:sbatch',
    'sbatch:',
    'sbatch:#!/bin/sh\r\n#SBATCH --time=00:01:00\r\n',
    'sbatch:#SBATCH\r\n',
    'sbatch:#!/bin/sh\n#SBATCH --nodes=2\n',
  ]);
  assert.equal(fake.collection.entries.has(ordinaryShell.uri.toString()), false);
  assert.equal(fake.collection.entries.has(text.uri.toString()), false);

  disposable.dispose();
});

test('editing clears stale diagnostics without revalidating', () => {
  const document = new FakeDocument('/workspace/Makefile', 'makefile', 'old');
  const fake = new FakeVscode();
  let validations = 0;
  const disposable = createEditorAdapter(fake.asApi(), {
    validateMakefile: () => {
      validations += 1;
      return [sampleDiagnostic];
    },
    validateSbatch: () => [],
  });

  fake.open(document);
  assert.equal(validations, 1);
  assert.equal(fake.collection.entries.has(document.uri.toString()), true);

  document.replaceText('new');
  fake.change(document);

  assert.equal(validations, 1);
  assert.equal(fake.collection.entries.has(document.uri.toString()), false);

  disposable.dispose();
});

test('close, delete, rename, and unsupported transitions clear diagnostics', () => {
  const fake = new FakeVscode();
  const disposable = createEditorAdapter(fake.asApi(), {
    validateMakefile: () => [sampleDiagnostic],
    validateSbatch: () => [sampleDiagnostic],
  });

  const closed = new FakeDocument('/workspace/closed.mk', 'makefile', 'x');
  fake.open(closed);
  fake.close(closed);
  assert.equal(fake.collection.entries.has(closed.uri.toString()), false);

  const deleted = new FakeDocument('/workspace/deleted.mk', 'makefile', 'x');
  fake.open(deleted);
  fake.delete(deleted.uri);
  assert.equal(fake.collection.entries.has(deleted.uri.toString()), false);

  const renamed = new FakeDocument('/workspace/old.mk', 'makefile', 'x');
  const newUri = new FakeUri('/workspace/new.mk');
  fake.open(renamed);
  fake.collection.set(newUri, []);
  fake.rename(renamed.uri, newUri);
  assert.equal(fake.collection.entries.has(renamed.uri.toString()), false);
  assert.equal(fake.collection.entries.has(newUri.toString()), false);

  const shell = new FakeDocument('/workspace/job.sh', 'shellscript', '#SBATCH --nodes=1\n');
  fake.open(shell);
  shell.replaceText('echo local\n');
  fake.save(shell);
  assert.equal(fake.collection.entries.has(shell.uri.toString()), false);

  disposable.dispose();
});

test('oversized supported documents are bounded before validation', () => {
  const document = new FakeDocument('/workspace/Makefile', 'makefile', 'four');
  const fake = new FakeVscode([document]);
  let validations = 0;
  const disposable = createEditorAdapter(
    fake.asApi(),
    {
      validateMakefile: () => {
        validations += 1;
        return [];
      },
      validateSbatch: () => [],
    },
    { maxDocumentCharacters: 3 },
  );

  const diagnostics = fake.collection.entries.get(document.uri.toString());
  assert.equal(validations, 0);
  assert.equal(diagnostics?.length, 1);
  assert.equal(diagnostics?.[0]?.code, 'HPC_FILE_TOO_LARGE');
  assert.equal(diagnostics?.[0]?.source, 'Deucalion HPC');
  assert.equal(diagnostics?.[0]?.severity, fake.DiagnosticSeverity.Information);

  disposable.dispose();
});

test('diagnostic output is capped and reports truncation', () => {
  const document = new FakeDocument('/workspace/Makefile', 'makefile', 'x');
  const fake = new FakeVscode([document]);
  const disposable = createEditorAdapter(
    fake.asApi(),
    {
      validateMakefile: () => [
        { ...sampleDiagnostic, code: 'ONE' },
        { ...sampleDiagnostic, code: 'TWO' },
        { ...sampleDiagnostic, code: 'THREE' },
      ],
      validateSbatch: () => [],
    },
    { maxDiagnostics: 2 },
  );

  const diagnostics = fake.collection.entries.get(document.uri.toString());
  assert.equal(diagnostics?.length, 2);
  assert.deepEqual(
    diagnostics?.map((diagnostic) =>
      typeof diagnostic.code === 'string' ? diagnostic.code : diagnostic.code?.value,
    ),
    ['ONE', 'HPC_DIAGNOSTICS_TRUNCATED'],
  );

  disposable.dispose();
});

test('a validator failure becomes a stable diagnostic instead of escaping the event', () => {
  const document = new FakeDocument('/workspace/Makefile', 'makefile', 'x');
  const fake = new FakeVscode();
  const disposable = createEditorAdapter(fake.asApi(), {
    validateMakefile: () => {
      throw new Error('private implementation detail');
    },
    validateSbatch: () => [],
  });

  assert.doesNotThrow(() => fake.open(document));
  const diagnostics = fake.collection.entries.get(document.uri.toString());
  assert.equal(diagnostics?.length, 1);
  assert.equal(diagnostics?.[0]?.code, 'HPC_VALIDATION_FAILED');
  assert.equal(diagnostics?.[0]?.message, 'Validation failed unexpectedly. Save the document to retry.');

  disposable.dispose();
});

test('plugin can be toggled off globally via deucalionHpc.enabled = false', () => {
  const document = new FakeDocument('/workspace/Makefile', 'makefile', 'all:\n');
  const fake = new FakeVscode([document]);
  fake.configMap.set('enabled', false);

  const disposable = createEditorAdapter(fake.asApi(), {
    validateMakefile: () => [sampleDiagnostic],
    validateSbatch: () => [],
  });

  assert.equal(fake.collection.entries.has(document.uri.toString()), false);
  disposable.dispose();
});

test('plugin respects workspace filtering (disabledWorkspaces and enabledWorkspaces)', () => {
  const docA = new FakeDocument('/workspaces/cluster-a/Makefile', 'makefile', 'all:\n');
  const docB = new FakeDocument('/workspaces/cluster-b/Makefile', 'makefile', 'all:\n');
  const fake = new FakeVscode([docA, docB]);
  fake.configMap.set('disabledWorkspaces', ['cluster-a']);

  const disposable = createEditorAdapter(fake.asApi(), {
    validateMakefile: () => [sampleDiagnostic],
    validateSbatch: () => [],
  });

  assert.equal(fake.collection.entries.has(docA.uri.toString()), false);
  assert.equal(fake.collection.entries.has(docB.uri.toString()), true);

  disposable.dispose();
});

test('makefile and slurm checks can be toggled independently', () => {
  const makeDoc = new FakeDocument('/workspace/Makefile', 'makefile', 'all:\n');
  const sbatchDoc = new FakeDocument('/workspace/job.sbatch', 'plaintext', '#SBATCH --nodes=1\n');
  const fake = new FakeVscode([makeDoc, sbatchDoc]);
  fake.configMap.set('makefile.enabled', false);
  fake.configMap.set('slurm.enabled', true);

  const disposable = createEditorAdapter(fake.asApi(), {
    validateMakefile: () => [sampleDiagnostic],
    validateSbatch: () => [{ ...sampleDiagnostic, code: 'SBATCH_NODES' }],
  });

  assert.equal(fake.collection.entries.has(makeDoc.uri.toString()), false);
  assert.equal(fake.collection.entries.has(sbatchDoc.uri.toString()), true);

  disposable.dispose();
});

test('specific rules can be disabled via disabledRules and per-rule overrides', () => {
  const document = new FakeDocument('/workspace/Makefile', 'makefile', 'all:\n');
  const fake = new FakeVscode([document]);
  fake.configMap.set('disabledRules', ['MAKE_SAMPLE']);
  fake.configMap.set('rules', { 'MAKE_ALLOWED': true, 'MAKE_DISABLED': false });

  const disposable = createEditorAdapter(fake.asApi(), {
    validateMakefile: () => [
      { ...sampleDiagnostic, code: 'MAKE_SAMPLE' },
      { ...sampleDiagnostic, code: 'MAKE_ALLOWED' },
      { ...sampleDiagnostic, code: 'MAKE_DISABLED' },
    ],
    validateSbatch: () => [],
  });

  const diagnostics = fake.collection.entries.get(document.uri.toString());
  assert.equal(diagnostics?.length, 1);
  assert.deepEqual(
    typeof diagnostics?.[0]?.code === 'string' ? diagnostics[0].code : diagnostics?.[0]?.code?.value,
    'MAKE_ALLOWED',
  );

  disposable.dispose();
});

test('configuration changes dynamically revalidate open documents', () => {
  const document = new FakeDocument('/workspace/Makefile', 'makefile', 'all:\n');
  const fake = new FakeVscode([document]);
  // Initially enabled
  fake.configMap.set('enabled', true);

  const disposable = createEditorAdapter(fake.asApi(), {
    validateMakefile: () => [sampleDiagnostic],
    validateSbatch: () => [],
  });

  assert.equal(fake.collection.entries.has(document.uri.toString()), true);

  // Disable extension dynamically
  fake.configMap.set('enabled', false);
  fake.changeConfig('deucalionHpc.enabled');
  assert.equal(fake.collection.entries.has(document.uri.toString()), false);

  // Re-enable extension dynamically
  fake.configMap.set('enabled', true);
  fake.changeConfig('deucalionHpc.enabled');
  assert.equal(fake.collection.entries.has(document.uri.toString()), true);

  disposable.dispose();
});
