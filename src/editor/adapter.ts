import type { HpcDiagnostic } from '../core/types';

export interface DisposableLike {
  dispose(): void;
}

export interface UriLike {
  readonly path: string;
  toString(): string;
}

export interface EditorDocument {
  readonly uri: UriLike;
  readonly fileName: string;
  readonly languageId: string;
  getText(): string;
}

export interface DiagnosticLike {
  readonly range: unknown;
  readonly message: string;
  readonly severity: unknown;
  source?: string;
  code?: string | { value: string; target: UriLike };
}

export interface DiagnosticCollectionLike extends DisposableLike {
  set(uri: UriLike, diagnostics: readonly DiagnosticLike[]): void;
  delete(uri: UriLike): void;
}

type Listener<T> = (event: T) => unknown;

export interface VscodeLike {
  readonly workspace: {
    readonly textDocuments: readonly EditorDocument[];
    onDidOpenTextDocument(listener: Listener<EditorDocument>): DisposableLike;
    onDidSaveTextDocument(listener: Listener<EditorDocument>): DisposableLike;
    onDidChangeTextDocument(
      listener: Listener<{ document: EditorDocument }>,
    ): DisposableLike;
    onDidCloseTextDocument(listener: Listener<EditorDocument>): DisposableLike;
    onDidDeleteFiles(
      listener: Listener<{ files: readonly UriLike[] }>,
    ): DisposableLike;
    onDidRenameFiles(
      listener: Listener<{
        files: readonly { oldUri: UriLike; newUri: UriLike }[];
      }>,
    ): DisposableLike;
  };
  readonly languages: {
    createDiagnosticCollection(name: string): DiagnosticCollectionLike;
  };
  readonly DiagnosticSeverity: {
    readonly Error: unknown;
    readonly Warning: unknown;
    readonly Information: unknown;
  };
  readonly Range: new (
    startLine: number,
    startCharacter: number,
    endLine: number,
    endCharacter: number,
  ) => unknown;
  readonly Diagnostic: new (
    range: unknown,
    message: string,
    severity: unknown,
  ) => DiagnosticLike;
  readonly Uri: {
    parse(value: string): UriLike;
  };
}

export interface Validators {
  validateMakefile(text: string): HpcDiagnostic[];
  validateSbatch(text: string): HpcDiagnostic[];
}

export interface AdapterLimits {
  readonly maxDocumentCharacters?: number;
  readonly maxDiagnostics?: number;
}

export const DEFAULT_MAX_DOCUMENT_CHARACTERS = 1_000_000;
export const DEFAULT_MAX_DIAGNOSTICS = 500;

function baseName(fileName: string): string {
  return fileName.split(/[\\/]/).at(-1) ?? fileName;
}

function isMakefile(document: EditorDocument): boolean {
  const name = baseName(document.fileName);
  return (
    name === 'Makefile' ||
    name === 'makefile' ||
    name === 'GNUmakefile' ||
    name.endsWith('.mk')
  );
}

function isSbatchFile(document: EditorDocument): boolean {
  const name = baseName(document.fileName);
  return name.endsWith('.sbatch') || name.endsWith('.slurm');
}

function isShellWithSbatch(document: EditorDocument, text: string): boolean {
  return (
    document.languageId === 'shellscript' &&
    /^[\t ]*#SBATCH(?:[\t ]|$)/m.test(text)
  );
}

function severityFor(api: VscodeLike, severity: HpcDiagnostic['severity']): unknown {
  switch (severity) {
    case 'error':
      return api.DiagnosticSeverity.Error;
    case 'warning':
      return api.DiagnosticSeverity.Warning;
    case 'information':
      return api.DiagnosticSeverity.Information;
  }
}

function toDiagnostic(api: VscodeLike, item: HpcDiagnostic): DiagnosticLike {
  const range = new api.Range(
    item.range.start.line,
    item.range.start.character,
    item.range.end.line,
    item.range.end.character,
  );
  const diagnostic = new api.Diagnostic(
    range,
    item.message,
    severityFor(api, item.severity),
  );
  diagnostic.source = 'Deucalion HPC';
  diagnostic.code = item.sourceUrl
    ? { value: item.code, target: api.Uri.parse(item.sourceUrl) }
    : item.code;
  return diagnostic;
}

export function createEditorAdapter(
  api: VscodeLike,
  validators: Validators,
  limits: AdapterLimits = {},
): DisposableLike {
  const collection = api.languages.createDiagnosticCollection('Deucalion HPC');
  const maxDocumentCharacters =
    limits.maxDocumentCharacters ?? DEFAULT_MAX_DOCUMENT_CHARACTERS;
  const maxDiagnostics = limits.maxDiagnostics ?? DEFAULT_MAX_DIAGNOSTICS;

  const validateDocument = (document: EditorDocument): void => {
    const text = document.getText();
    const makefile = isMakefile(document);
    const sbatch = isSbatchFile(document) || isShellWithSbatch(document, text);
    if (!makefile && !sbatch) {
      collection.delete(document.uri);
      return;
    }

    if (text.length > maxDocumentCharacters) {
      const limitDiagnostic: HpcDiagnostic = {
        code: 'HPC_FILE_TOO_LARGE',
        message: `Document exceeds the ${maxDocumentCharacters} UTF-16 code-unit validation limit.`,
        severity: 'information',
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
      };
      collection.set(document.uri, [toDiagnostic(api, limitDiagnostic)]);
      return;
    }

    let items: HpcDiagnostic[];
    try {
      items = makefile
        ? validators.validateMakefile(text)
        : validators.validateSbatch(text);
    } catch {
      const failure: HpcDiagnostic = {
        code: 'HPC_VALIDATION_FAILED',
        message: 'Validation failed unexpectedly. Save the document to retry.',
        severity: 'information',
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
        },
      };
      collection.set(document.uri, [toDiagnostic(api, failure)]);
      return;
    }

    if (items.length > maxDiagnostics) {
      items = [
        ...items.slice(0, Math.max(0, maxDiagnostics - 1)),
        {
          code: 'HPC_DIAGNOSTICS_TRUNCATED',
          message: `More than ${maxDiagnostics} diagnostics were found; additional diagnostics were omitted.`,
          severity: 'information',
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
          },
        },
      ];
    }
    const diagnostics = items.map((item) => toDiagnostic(api, item));
    if (diagnostics.length === 0) {
      collection.delete(document.uri);
    } else {
      collection.set(document.uri, diagnostics);
    }
  };

  const disposables = [
    api.workspace.onDidOpenTextDocument(validateDocument),
    api.workspace.onDidSaveTextDocument(validateDocument),
    api.workspace.onDidChangeTextDocument(({ document }) => {
      collection.delete(document.uri);
    }),
    api.workspace.onDidCloseTextDocument((document) => {
      collection.delete(document.uri);
    }),
    api.workspace.onDidDeleteFiles(({ files }) => {
      for (const uri of files) collection.delete(uri);
    }),
    api.workspace.onDidRenameFiles(({ files }) => {
      for (const { oldUri, newUri } of files) {
        collection.delete(oldUri);
        collection.delete(newUri);
      }
    }),
  ];

  for (const document of api.workspace.textDocuments) {
    validateDocument(document);
  }

  return {
    dispose: () => {
      for (const disposable of disposables.reverse()) disposable.dispose();
      collection.dispose();
    },
  };
}
