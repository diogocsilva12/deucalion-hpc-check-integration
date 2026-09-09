# GNU Makefile validation

`validateMakefile(text)` is a deterministic, offline static check. It does not invoke GNU Make, a shell, an included makefile, or any command found in a recipe. Diagnostics use zero-based UTF-16 positions with an end-exclusive range and are returned in source order. CRLF input is normalized for parsing without changing reported line or character positions.

The recipe checks follow GNU Make's documented [recipe syntax](https://www.gnu.org/software/make/manual/html_node/Recipe-Syntax.html) and [`.RECIPEPREFIX` behavior](https://www.gnu.org/software/make/manual/html_node/Special-Variables.html).

## Diagnostic codes

All currently supported findings are certain syntax errors and therefore have severity `error`.

| Code | Reported condition |
| --- | --- |
| `makefile.space-indented-recipe` | A command-like, otherwise unrecognized line follows a definite rule but begins with spaces instead of the active recipe prefix. The range covers the leading spaces. |
| `makefile.space-before-recipe-prefix` | Spaces occur before the known active prefix on a command-like line in a definite rule context. The range covers only those spaces. |
| `makefile.wrong-recipe-prefix` | A command-like line begins with a tab while a different literal `.RECIPEPREFIX` is active. |
| `makefile.recipe-without-rule` | A line begins with the known active recipe prefix when no rule can own it. |
| `makefile.missing-rule-target` | A top-level rule separator has no target before it. |
| `makefile.missing-assignment-name` | An assignment operator has no variable name before it. |
| `makefile.unexpected-endef` | `endef` has no open `define`. |
| `makefile.unterminated-define` | End of input is reached with an open `define`. |
| `makefile.unexpected-else` | `else` has no open conditional. |
| `makefile.duplicate-else` | A conditional has more than one unconditional `else`. |
| `makefile.unexpected-endif` | `endif` has no open conditional. |
| `makefile.unterminated-conditional` | End of input is reached with an open conditional. |

The code strings are the stable programmatic identifiers. Message wording is intended for people and may become clearer without changing a code.

## Recognized valid constructs

The validator accounts for:

- tab-prefixed recipes and literal `.RECIPEPREFIX` assignments, including resetting an empty value to the default tab;
- direct `=`, `:=`, `::=`, `:::=`, `?=`, and `+=` prefix assignments, plus `!=` as an intentionally unknown value;
- continued assignments and rules, and continued physical recipe lines;
- nested `define`/`endef` bodies, whose contents are treated as data;
- `ifeq`, `ifneq`, `ifdef`, and `ifndef`, including `else`, `else if...`, and nested conditionals;
- comments and blank lines between a rule and its recipe;
- inline recipes introduced by a semicolon on a rule line;
- target-specific assignments, including target-specific `.RECIPEPREFIX` assignments that do not change the global parsing prefix;
- common top-level directives such as `include`, `-include`, `sinclude`, `vpath`, `load`, `export`, `unexport`, and `undefine`;
- ordinary, double-colon, static-pattern, grouped, and expanded-target rule shapes to the extent that their top-level separator can be identified without expansion.

Conditional paths carry separate possible rule and recipe-prefix states. A recipe-placement finding is emitted only when every path known at that location supports it.

## Conservative limitations

This is deliberately not a complete GNU Make parser.

- Variable references, functions, `eval`, included files, and generated make syntax are not expanded. There is no cross-file analysis.
- A `.RECIPEPREFIX` value containing a non-literal dollar reference, an escape, a shell assignment, or differing conditional values becomes unknown. Indentation and ownership findings that depend on that value are suppressed until a later definitely parsed literal assignment restores certainty.
- Assignment modifiers and unusual dynamically generated variable names can make classification ambiguous. Ambiguous lines are suppressed rather than guessed.
- The contents or correctness of shell recipes, prerequisite expressions, function calls, conditional arguments, and include paths are not validated.
- Rule semantics such as duplicate recipes, circular dependencies, implicit-rule resolution, secondary expansion, archive-member meaning, and whether targets or prerequisites exist are outside scope.
- Once an unknown recipe prefix could also change how block-closing text is interpreted, unterminated-block findings are suppressed for that parse. This avoids reporting a structural error based on a guessed prefix.

These limits are intentional: running Make would execute parsing features such as `$(shell ...)`, included generated content, or other user-controlled behavior and is prohibited by the extension contract.
