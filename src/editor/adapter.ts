import type { HpcDiagnostic } from '../core/types';
import {
  isRuleEnabled,
  isWorkspaceAllowed,
  resolveSettings,
  type ConfigAccessorLike,
  type DeucalionSettings,
} from './config';

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

export interface WorkspaceConfigurationLike extends ConfigAccessorLike {
  get<T>(section: string, defaultValue?: T): T | undefined;
}

export interface WorkspaceFolderLike {
  readonly uri: UriLike;
  readonly name: string;
}

export interface ConfigurationChangeEventLike {
  affectsConfiguration(section: string, scope?: UriLike): boolean;
}

type Listener<T> = (event: T) => unknown;

export interface VscodeLike {
  readonly workspace: {
    readonly name?: string | undefined;
    readonly workspaceFolders?: readonly WorkspaceFolderLike[] | undefined;
    readonly textDocuments: readonly EditorDocument[];
    getConfiguration?(
      section?: string | undefined,
      scope?: UriLike | undefined,
    ): WorkspaceConfigurationLike;
    onDidChangeConfiguration?(
      listener: Listener<ConfigurationChangeEventLike>,
    ): DisposableLike;
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

export interface FindingEntry {
  readonly uri: UriLike;
  readonly diagnostics: readonly DiagnosticLike[];
}

export interface EditorAdapter extends DisposableLike {
  getFindings(): ReadonlyMap<string, FindingEntry>;
  onDidChangeFindings(listener: () => void): DisposableLike;
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
): EditorAdapter {
  const collection = api.languages.createDiagnosticCollection('Deucalion HPC');
  const maxDocumentCharacters =
    limits.maxDocumentCharacters ?? DEFAULT_MAX_DOCUMENT_CHARACTERS;
  const maxDiagnostics = limits.maxDiagnostics ?? DEFAULT_MAX_DIAGNOSTICS;

  const findingsMap = new Map<string, FindingEntry>();
  const findingsListeners = new Set<() => void>();

  const notifyFindings = () => {
    for (const listener of findingsListeners) {
      try {
        listener();
      } catch {
        // ignore errors in listeners
      }
    }
  };

  const updateFindings = (uri: UriLike, diagnostics: readonly DiagnosticLike[]) => {
    if (diagnostics.length === 0) {
      if (findingsMap.delete(uri.toString())) {
        notifyFindings();
      }
    } else {
      findingsMap.set(uri.toString(), { uri, diagnostics });
      notifyFindings();
    }
  };

  const removeFindings = (uri: UriLike) => {
    if (findingsMap.delete(uri.toString())) {
      notifyFindings();
    }
  };

  const getDocumentSettings = (document: EditorDocument): DeucalionSettings => {
    const accessor = api.workspace.getConfiguration?.('deucalionHpc', document.uri);
    return resolveSettings(accessor);
  };

  const isDocumentAllowed = (
    document: EditorDocument,
    settings: DeucalionSettings,
  ): boolean => {
    const workspaceName = api.workspace.name;
    const folderPaths = (api.workspace.workspaceFolders ?? []).map(
      (folder) => folder.uri.path,
    );
    const paths = [...folderPaths, document.fileName, document.uri.path];
    return isWorkspaceAllowed(workspaceName, paths, settings);
  };

  const validateDocument = (document: EditorDocument): void => {
    const text = document.getText();
    const makefile = isMakefile(document);
    const sbatch = isSbatchFile(document) || isShellWithSbatch(document, text);
    if (!makefile && !sbatch) {
      collection.delete(document.uri);
      removeFindings(document.uri);
      return;
    }

    const settings = getDocumentSettings(document);
    if (!isDocumentAllowed(document, settings)) {
      collection.delete(document.uri);
      removeFindings(document.uri);
      return;
    }

    if (makefile && !settings.makefileEnabled) {
      collection.delete(document.uri);
      removeFindings(document.uri);
      return;
    }

    if (sbatch && !settings.slurmEnabled) {
      collection.delete(document.uri);
      removeFindings(document.uri);
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
      const diag = [toDiagnostic(api, limitDiagnostic)];
      collection.set(document.uri, diag);
      updateFindings(document.uri, diag);
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
      const diag = [toDiagnostic(api, failure)];
      collection.set(document.uri, diag);
      updateFindings(document.uri, diag);
      return;
    }

    items = items.filter((item) => isRuleEnabled(item.code, settings));

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
      removeFindings(document.uri);
    } else {
      collection.set(document.uri, diagnostics);
      updateFindings(document.uri, diagnostics);
    }
  };

  const disposables: DisposableLike[] = [
    api.workspace.onDidOpenTextDocument(validateDocument),
    api.workspace.onDidSaveTextDocument(validateDocument),
    api.workspace.onDidChangeTextDocument(({ document }) => {
      collection.delete(document.uri);
      removeFindings(document.uri);
    }),
    api.workspace.onDidCloseTextDocument((document) => {
      collection.delete(document.uri);
      removeFindings(document.uri);
    }),
    api.workspace.onDidDeleteFiles(({ files }) => {
      for (const uri of files) {
        collection.delete(uri);
        removeFindings(uri);
      }
    }),
    api.workspace.onDidRenameFiles(({ files }) => {
      for (const { oldUri, newUri } of files) {
        collection.delete(oldUri);
        collection.delete(newUri);
        removeFindings(oldUri);
        removeFindings(newUri);
      }
    }),
  ];

  if (api.workspace.onDidChangeConfiguration) {
    disposables.push(
      api.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('deucalionHpc')) {
          for (const document of api.workspace.textDocuments) {
            validateDocument(document);
          }
        }
      }),
    );
  }

  for (const document of api.workspace.textDocuments) {
    validateDocument(document);
  }

  return {
    getFindings: () => new Map(findingsMap),
    onDidChangeFindings: (listener: () => void): DisposableLike => {
      findingsListeners.add(listener);
      return {
        dispose: () => {
          findingsListeners.delete(listener);
        },
      };
    },
    dispose: () => {
      findingsListeners.clear();
      findingsMap.clear();
      for (const disposable of disposables.reverse()) disposable.dispose();
      collection.dispose();
    },
  };
}
