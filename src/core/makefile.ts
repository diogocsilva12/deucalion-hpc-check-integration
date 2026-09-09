import type { HpcDiagnostic } from './types';

const NO_RULE = 1;
const HAS_RULE = 2;
type RuleState = 1 | 2 | 3;

interface SourceMark {
  line: number;
  character: number;
  length: number;
}

interface ConditionalFrame extends SourceMark {
  base: RuleState;
  basePrefix: RecipePrefixState;
  completedBranches: RuleState[];
  completedPrefixes: RecipePrefixState[];
  fallbackPossible: boolean;
}

interface LogicalLine {
  text: string;
  firstPhysicalText: string;
  startLine: number;
}

interface Assignment {
  operator: string;
  operatorIndex: number;
  lhs: string;
  rhs: string;
}

interface SyntaxScan {
  assignment?: Assignment;
  ruleColon?: number;
}

interface RecipePrefixState {
  defined: boolean;
  rawValue: string | undefined;
}

const messages = {
  missingTarget: 'A rule separator must have at least one target before it.',
  recipeWithoutRule: 'Recipe appears before any rule target.',
  spaceBeforePrefix: 'The active recipe prefix must be the first character on the line.',
  spaceRecipe:
    'Recipe lines must start with a tab (or the active .RECIPEPREFIX character), not spaces.',
  unexpectedElse: 'Conditional "else" has no matching opening directive.',
  unexpectedEndef: '"endef" has no matching "define" directive.',
  unexpectedEndif: '"endif" has no matching opening conditional directive.',
  unterminatedConditional: 'Conditional directive is not closed by an "endif".',
  unterminatedDefine: '"define" block is not closed by an "endef".',
};

/**
 * Statically validates GNU Make syntax that can be established without expansion.
 * The validator never runs Make, expands user variables, or executes recipes.
 */
export function validateMakefile(text: string): HpcDiagnostic[] {
  const diagnostics: HpcDiagnostic[] = [];
  const physicalLines = text
    .split('\n')
    .map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));

  let ruleState: RuleState = NO_RULE;
  const prefixState: RecipePrefixState = { defined: false, rawValue: '' };
  let recipeContinuation = false;
  let pendingLogical: LogicalLine | undefined;
  let structureUncertain = false;
  const defineStack: SourceMark[] = [];
  const conditionalStack: ConditionalFrame[] = [];

  const report = (
    code: string,
    message: string,
    line: number,
    startCharacter: number,
    endCharacter: number,
  ): void => {
    diagnostics.push({
      code,
      message,
      severity: 'error',
      range: {
        start: { line, character: startCharacter },
        end: { line, character: endCharacter },
      },
    });
  };

  const processLogicalLine = (logical: LogicalLine): void => {
    const { text: logicalText, firstPhysicalText, startLine } = logical;
    const uncommented = stripComment(logicalText);
    const trimmed = uncommented.trimStart();
    const prefix = effectivePrefix(prefixState);

    if (trimmed.length === 0) {
      return;
    }

    const defineMatch = /^(?:(?:override|export|private)\s+)*define(?:\s|$)/.exec(trimmed);
    if (defineMatch !== null) {
      const keywordOffset = firstPhysicalText.indexOf('define');
      defineStack.push({ line: startLine, character: Math.max(0, keywordOffset), length: 6 });
      ruleState = NO_RULE;
      return;
    }

    if (/^endef(?:\s|$)/.test(trimmed)) {
      const at = keywordMark(firstPhysicalText, startLine, 'endef');
      report(
        'makefile.unexpected-endef',
        messages.unexpectedEndef,
        at.line,
        at.character,
        at.character + at.length,
      );
      ruleState = NO_RULE;
      return;
    }

    const conditionalMatch = /^(ifeq|ifneq|ifdef|ifndef)(?=\s|\(|$)/.exec(trimmed);
    if (conditionalMatch !== null) {
      const keyword = conditionalMatch[1];
      if (keyword === undefined) {
        return;
      }
      const at = keywordMark(firstPhysicalText, startLine, keyword);
      conditionalStack.push({
        ...at,
        base: ruleState,
        basePrefix: clonePrefixState(prefixState),
        completedBranches: [],
        completedPrefixes: [],
        fallbackPossible: true,
      });
      return;
    }

    const elseMatch = /^else(?=\s|$)(?:\s+(ifeq|ifneq|ifdef|ifndef)(?=\s|\(|$))?/.exec(trimmed);
    if (elseMatch !== null) {
      const frame = conditionalStack.at(-1);
      if (frame === undefined) {
        const at = keywordMark(firstPhysicalText, startLine, 'else');
        report(
          'makefile.unexpected-else',
          messages.unexpectedElse,
          at.line,
          at.character,
          at.character + at.length,
        );
        ruleState = NO_RULE;
        return;
      }

      if (!frame.fallbackPossible) {
        const at = keywordMark(firstPhysicalText, startLine, 'else');
        report(
          'makefile.duplicate-else',
          'Conditional contains more than one unconditional "else" branch.',
          at.line,
          at.character,
          at.character + at.length,
        );
        ruleState = unionStates(frame.base, ruleState);
        return;
      }

      frame.completedBranches.push(ruleState);
      frame.completedPrefixes.push(clonePrefixState(prefixState));
      ruleState = frame.base;
      assignPrefixState(prefixState, frame.basePrefix);
      if (elseMatch[1] === undefined) {
        frame.fallbackPossible = false;
      }
      return;
    }

    if (/^endif(?=\s|$)/.test(trimmed)) {
      const frame = conditionalStack.pop();
      if (frame === undefined) {
        const at = keywordMark(firstPhysicalText, startLine, 'endif');
        report(
          'makefile.unexpected-endif',
          messages.unexpectedEndif,
          at.line,
          at.character,
          at.character + at.length,
        );
        ruleState = NO_RULE;
        return;
      }

      const outcomes = [...frame.completedBranches, ruleState];
      const prefixOutcomes = [...frame.completedPrefixes, clonePrefixState(prefixState)];
      if (frame.fallbackPossible) {
        outcomes.push(frame.base);
        prefixOutcomes.push(frame.basePrefix);
      }
      ruleState = outcomes.reduce(unionStates);
      assignPrefixState(prefixState, mergePrefixStates(prefixOutcomes));
      return;
    }

    if (/^(?:(?:override|private)\s+)*(?:-?include|sinclude|vpath|load|undefine)(?:\s|$)/.test(trimmed)) {
      ruleState = NO_RULE;
      return;
    }

    const syntax = scanSyntax(uncommented);
    if (syntax.ruleColon !== undefined) {
      const targetText = uncommented.slice(0, syntax.ruleColon).trim();
      if (targetText.length === 0) {
        report(
          'makefile.missing-rule-target',
          messages.missingTarget,
          startLine,
          syntax.ruleColon,
          syntax.ruleColon + 1,
        );
        ruleState = NO_RULE;
      } else {
        ruleState = HAS_RULE;
      }
      return;
    }

    if (syntax.assignment !== undefined) {
      if (assignmentName(syntax.assignment).length === 0) {
        report(
          'makefile.missing-assignment-name',
          'Assignment operator must have a variable name before it.',
          startLine,
          syntax.assignment.operatorIndex,
          syntax.assignment.operatorIndex + syntax.assignment.operator.length,
        );
        ruleState = NO_RULE;
        return;
      }
      updateRecipePrefix(prefixState, syntax.assignment);
      ruleState = NO_RULE;
      return;
    }

    if (/^(?:export|unexport)(?:\s|$)/.test(trimmed)) {
      ruleState = NO_RULE;
      return;
    }

    const leadingSpaces = /^ +/.exec(firstPhysicalText)?.[0].length ?? 0;
    if (ruleState === HAS_RULE && leadingSpaces > 0) {
      if (prefix !== undefined && firstPhysicalText.startsWith(prefix, leadingSpaces)) {
        report(
          'makefile.space-before-recipe-prefix',
          messages.spaceBeforePrefix,
          startLine,
          0,
          leadingSpaces,
        );
      } else {
        report(
          'makefile.space-indented-recipe',
          messages.spaceRecipe,
          startLine,
          0,
          leadingSpaces,
        );
      }
      return;
    }

    if (ruleState === HAS_RULE && prefix !== undefined && prefix !== '\t' && firstPhysicalText.startsWith('\t')) {
      report(
        'makefile.wrong-recipe-prefix',
        `Recipe line starts with a tab, but the active .RECIPEPREFIX is ${JSON.stringify(prefix)}.`,
        startLine,
        0,
        1,
      );
      return;
    }

    ruleState = unionStates(ruleState, NO_RULE);
  };

  for (const [lineNumber, physical] of physicalLines.entries()) {

    if (recipeContinuation) {
      recipeContinuation = hasTrailingContinuation(physical);
      continue;
    }

    if (defineStack.length > 0) {
      const bodyTrimmed = physical.trimStart();
      if (/^(?:(?:override|export|private)\s+)*define(?:\s|$)/.test(bodyTrimmed)) {
        const at = keywordMark(physical, lineNumber, 'define');
        defineStack.push(at);
      } else if (/^endef(?:\s*(?:#.*)?)?$/.test(bodyTrimmed)) {
        defineStack.pop();
      }
      continue;
    }

    if (pendingLogical !== undefined) {
      pendingLogical.text = `${removeTrailingContinuation(pendingLogical.text)} ${physical.trimStart()}`;
      if (hasTrailingContinuation(physical)) {
        continue;
      }
      const complete = pendingLogical;
      pendingLogical = undefined;
      processLogicalLine(complete);
      continue;
    }

    const prefix = effectivePrefix(prefixState);
    if (prefix !== undefined && physical.startsWith(prefix)) {
      if (ruleState === NO_RULE) {
        report(
          'makefile.recipe-without-rule',
          messages.recipeWithoutRule,
          lineNumber,
          0,
          prefix.length,
        );
      }
      recipeContinuation = hasTrailingContinuation(physical);
      continue;
    }

    if (prefix === undefined && (ruleState & HAS_RULE) !== 0) {
      structureUncertain = true;
      continue;
    }

    const logical: LogicalLine = {
      text: physical,
      firstPhysicalText: physical,
      startLine: lineNumber,
    };
    if (hasTrailingContinuation(physical)) {
      pendingLogical = logical;
    } else {
      processLogicalLine(logical);
    }
  }

  if (pendingLogical !== undefined) {
    processLogicalLine(pendingLogical);
  }

  if (!structureUncertain) {
    for (const opening of defineStack) {
      report(
        'makefile.unterminated-define',
        messages.unterminatedDefine,
        opening.line,
        opening.character,
        opening.character + opening.length,
      );
    }

    for (const opening of conditionalStack) {
      report(
        'makefile.unterminated-conditional',
        messages.unterminatedConditional,
        opening.line,
        opening.character,
        opening.character + opening.length,
      );
    }
  }

  diagnostics.sort(
    (left, right) =>
      left.range.start.line - right.range.start.line ||
      left.range.start.character - right.range.start.character ||
      left.code.localeCompare(right.code),
  );
  return diagnostics;
}

function effectivePrefix(state: RecipePrefixState): string | undefined {
  if (state.rawValue === undefined) {
    return undefined;
  }
  return Array.from(state.rawValue)[0] ?? '\t';
}

function updateRecipePrefix(state: RecipePrefixState, assignment: Assignment): void {
  const name = assignmentName(assignment);
  if (name !== '.RECIPEPREFIX') {
    return;
  }

  const literal = literalAssignmentValue(assignment.rhs.trimStart());
  if (assignment.operator === '?=') {
    if (!state.defined) {
      state.defined = true;
      state.rawValue = literal;
    }
    return;
  }

  if (assignment.operator === '+=') {
    if (!state.defined) {
      state.defined = true;
      state.rawValue = literal;
    } else if (state.rawValue !== undefined && literal !== undefined) {
      state.rawValue = state.rawValue.length === 0 ? literal : `${state.rawValue} ${literal}`;
    } else {
      state.rawValue = undefined;
    }
    return;
  }

  state.defined = true;
  state.rawValue = assignment.operator === '!=' ? undefined : literal;
}

function assignmentName(assignment: Assignment): string {
  return assignment.lhs
    .trim()
    .replace(/^(?:(?:override|export|private)\s+)*/, '')
    .trim();
}

function literalAssignmentValue(value: string): string | undefined {
  let result = '';
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '\\') {
      return undefined;
    }
    if (value[index] !== '$') {
      result += value[index];
      continue;
    }
    if (value[index + 1] !== '$') {
      return undefined;
    }
    result += '$';
    index += 1;
  }
  return result;
}

function clonePrefixState(state: RecipePrefixState): RecipePrefixState {
  return { defined: state.defined, rawValue: state.rawValue };
}

function assignPrefixState(target: RecipePrefixState, source: RecipePrefixState): void {
  target.defined = source.defined;
  target.rawValue = source.rawValue;
}

function mergePrefixStates(states: RecipePrefixState[]): RecipePrefixState {
  const first = states[0];
  if (first !== undefined && states.every((state) => state.defined === first.defined && state.rawValue === first.rawValue)) {
    return clonePrefixState(first);
  }
  return { defined: true, rawValue: undefined };
}

function scanSyntax(text: string): SyntaxScan {
  const stack: string[] = [];
  let ruleColon: number | undefined;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '\\') {
      index += 1;
      continue;
    }
    if (character === '$' && (text[index + 1] === '(' || text[index + 1] === '{')) {
      stack.push(text[index + 1] === '(' ? ')' : '}');
      index += 1;
      continue;
    }
    if (stack.length > 0) {
      if (character === stack.at(-1)) {
        stack.pop();
      } else if (character === '(') {
        stack.push(')');
      } else if (character === '{') {
        stack.push('}');
      }
      continue;
    }

    const operator = [':::=', '::=', ':=', '?=', '+=', '!=', '='].find((candidate) =>
      text.startsWith(candidate, index),
    );
    if (operator !== undefined) {
      const assignment = {
        operator,
        operatorIndex: index,
        lhs: text.slice(0, index),
        rhs: text.slice(index + operator.length),
      };
      const targetColon = findRuleColon(assignment.lhs);
      return targetColon === undefined ? { assignment } : { assignment, ruleColon: targetColon };
    }

    if (character === ':') {
      ruleColon = index;
      break;
    }
  }
  return ruleColon === undefined ? {} : { ruleColon };
}

function findRuleColon(text: string): number | undefined {
  const stack: string[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '\\') {
      index += 1;
    } else if (character === '$' && (text[index + 1] === '(' || text[index + 1] === '{')) {
      stack.push(text[index + 1] === '(' ? ')' : '}');
      index += 1;
    } else if (stack.length > 0 && character === stack.at(-1)) {
      stack.pop();
    } else if (stack.length === 0 && character === ':') {
      return index;
    }
  }
  return undefined;
}

function stripComment(text: string): string {
  let precedingBackslashes = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\\') {
      precedingBackslashes += 1;
      continue;
    }
    if (text[index] === '#' && precedingBackslashes % 2 === 0) {
      return text.slice(0, index);
    }
    precedingBackslashes = 0;
  }
  return text;
}

function hasTrailingContinuation(text: string): boolean {
  const match = /\\+$/.exec(text);
  return match !== null && match[0].length % 2 === 1;
}

function removeTrailingContinuation(text: string): string {
  return hasTrailingContinuation(text) ? text.slice(0, -1) : text;
}

function unionStates(left: RuleState, right: RuleState): RuleState {
  return (left | right) as RuleState;
}

function keywordMark(text: string, line: number, keyword: string): SourceMark {
  const character = Math.max(0, text.indexOf(keyword));
  return { line, character, length: keyword.length };
}
