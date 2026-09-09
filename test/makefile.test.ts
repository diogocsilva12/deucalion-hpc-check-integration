import assert = require('node:assert/strict');
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { validateMakefile } from '../src/core/makefile';

const fixtures = join(process.cwd(), 'test', 'fixtures', 'makefile');

function fixture(name: string): string {
  return readFileSync(join(fixtures, name), 'utf8');
}

test('accepts empty input', () => {
  assert.deepEqual(validateMakefile(fixture('empty.mk')), []);
});

test('accepts a rule with a tab-indented recipe', () => {
  assert.deepEqual(validateMakefile(fixture('valid-tab.mk')), []);
});

test('reports a space-indented recipe with an exact range', () => {
  assert.deepEqual(validateMakefile(fixture('invalid-space-recipe.mk')), [
    {
      code: 'makefile.space-indented-recipe',
      message: 'Recipe lines must start with a tab (or the active .RECIPEPREFIX character), not spaces.',
      severity: 'error',
      range: {
        start: { line: 1, character: 0 },
        end: { line: 1, character: 4 },
      },
    },
  ]);
});

test('honors literal .RECIPEPREFIX values and suppresses dynamic uncertainty', () => {
  assert.deepEqual(validateMakefile(fixture('valid-recipe-prefix.mk')), []);
});

test('accepts continued lines, define bodies, conditionals, inline recipes, and target-specific assignments', () => {
  assert.deepEqual(validateMakefile(fixture('valid-exceptions.mk')), []);
});

test('distinguishes misplaced and incorrectly indented recipes', () => {
  const diagnostics = validateMakefile(fixture('invalid-recipes.mk'));

  assert.deepEqual(
    diagnostics.map(({ code, severity, range }) => ({ code, severity, range })),
    [
      {
        code: 'makefile.recipe-without-rule',
        severity: 'error',
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      },
      {
        code: 'makefile.space-indented-recipe',
        severity: 'error',
        range: { start: { line: 3, character: 0 }, end: { line: 3, character: 4 } },
      },
      {
        code: 'makefile.space-before-recipe-prefix',
        severity: 'error',
        range: { start: { line: 6, character: 0 }, end: { line: 6, character: 2 } },
      },
      {
        code: 'makefile.recipe-without-rule',
        severity: 'error',
        range: { start: { line: 9, character: 0 }, end: { line: 9, character: 1 } },
      },
      {
        code: 'makefile.wrong-recipe-prefix',
        severity: 'error',
        range: { start: { line: 12, character: 0 }, end: { line: 12, character: 1 } },
      },
    ],
  );
});

test('reports malformed directives, an empty target, and unterminated blocks', () => {
  const malformed = validateMakefile(fixture('malformed-syntax.mk'));
  assert.deepEqual(
    malformed.map(({ code, range }) => ({ code, range })),
    [
      {
        code: 'makefile.unexpected-endef',
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
      },
      {
        code: 'makefile.unexpected-else',
        range: { start: { line: 1, character: 0 }, end: { line: 1, character: 4 } },
      },
      {
        code: 'makefile.unexpected-endif',
        range: { start: { line: 2, character: 0 }, end: { line: 2, character: 5 } },
      },
      {
        code: 'makefile.missing-rule-target',
        range: { start: { line: 3, character: 0 }, end: { line: 3, character: 1 } },
      },
      {
        code: 'makefile.duplicate-else',
        range: { start: { line: 6, character: 0 }, end: { line: 6, character: 4 } },
      },
      {
        code: 'makefile.missing-assignment-name',
        range: { start: { line: 8, character: 0 }, end: { line: 8, character: 1 } },
      },
    ],
  );

  assert.equal(validateMakefile(fixture('unterminated-define.mk'))[0]?.code, 'makefile.unterminated-define');
  assert.equal(
    validateMakefile(fixture('unterminated-conditional.mk'))[0]?.code,
    'makefile.unterminated-conditional',
  );
});

test('suppresses a recipe-placement guess when conditional branches disagree', () => {
  assert.deepEqual(validateMakefile(fixture('valid-conditional-uncertainty.mk')), []);
  assert.deepEqual(validateMakefile(fixture('valid-dynamic-structure.mk')), []);
});

test('keeps end-exclusive ranges stable for CRLF and Unicode input', () => {
  assert.deepEqual(validateMakefile(fixture('crlf.mk'))[0]?.range, {
    start: { line: 1, character: 0 },
    end: { line: 1, character: 4 },
  });

  assert.deepEqual(
    validateMakefile(fixture('unicode.mk')).map(({ code, range }) => ({ code, range })),
    [
      {
        code: 'makefile.recipe-without-rule',
        range: { start: { line: 1, character: 0 }, end: { line: 1, character: 1 } },
      },
      {
        code: 'makefile.space-indented-recipe',
        range: { start: { line: 4, character: 0 }, end: { line: 4, character: 4 } },
      },
    ],
  );
});
