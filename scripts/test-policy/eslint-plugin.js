import {
  createReferenceResolver,
  executableStatements,
  isConstant,
  isFunction,
  isTestCall,
  ownerFunction,
  runnerPath,
  staticText,
  testCallback,
  walk,
} from './ast.js';

const noOptions = [];
const allowanceSchema = [{
  type: 'object',
  properties: {
    allow: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          target: { type: 'string' }, count: { type: 'integer', minimum: 1 },
          reason: { type: 'string', minLength: 20 }, within: { type: 'string', minLength: 1 },
        },
        required: ['target', 'count', 'reason'],
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
}];

/** A shrinking inventory records precise legacy call targets, never directories. */
function allowanceReporter(context) {
  const allowed = context.options[0]?.allow || [];
  const seen = new Map();
  return {
    check(node, target) {
      const entry = allowed.find((item) => item.target === target && (!item.within || withinFunction(node, item.within)));
      if (!entry) { context.report({ node, messageId: 'forbidden', data: { target } }); return; }
      const count = (seen.get(entry) || 0) + 1;
      seen.set(entry, count);
      if (count > entry.count) context.report({ node, messageId: 'forbidden', data: { target } });
    },
    finish(node) {
      for (const entry of allowed) {
        if ((seen.get(entry) || 0) < entry.count) {
          context.report({ node, messageId: 'staleAllowance', data: { target: entry.target } });
        }
      }
    },
  };
}

function withinFunction(node, name) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (!isFunction(parent)) continue;
    if (parent.id?.name === name) return true;
    if (parent.parent.type === 'Property') {
      const property = parent.parent;
      const key = property.computed ? staticText(property.key) : property.key.name || property.key.value;
      if (key === name) return true;
    }
  }
  return false;
}

function phase(text) {
  const match = /^(Given|When|Then)\b\s*(.*)$/s.exec(text.trim());
  if (!match) return null;
  const description = match[2].trim();
  const words = description.match(/[\p{L}\p{N}]+/gu) || [];
  const placeholder = /^(the )?(setup|context|precondition|action|act|assertions?|results?|expected (result|behavior))\.?$/i;
  return { name: match[1], valid: words.length >= 2 && !placeholder.test(description) };
}

function unconditionalPhase(node, callback) {
  for (let parent = node; parent && parent !== callback; parent = parent.parent) {
    if (['IfStatement', 'ConditionalExpression', 'LogicalExpression', 'ForStatement', 'ForOfStatement', 'ForInStatement',
      'WhileStatement', 'DoWhileStatement', 'SwitchCase', 'CatchClause'].includes(parent.type)) return false;
  }
  return true;
}

const behaviorContract = {
  meta: {
    type: 'problem', schema: noOptions,
    messages: {
      title: 'Name the observable behavior with a static "user " prefix.',
      callback: 'Use an inline test callback so its behavior stages can be checked.',
      stages: 'Provide ordered, concrete Given, When, and Then stages for this test.',
      description: '{{stage}} needs a concrete scenario description, not a bare keyword or placeholder.',
      emptyStage: '{{stage}} must contain an executable setup, action, or assertion.',
      awaitedStep: 'Await or return this test.step so the behavior stages execute in order.',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    const resolve = createReferenceResolver(sourceCode);
    return {
      CallExpression(node) {
        if (!isTestCall(node, resolve)) return;
        const title = staticText(node.arguments[0]);
        if (!title?.startsWith('user ') || title.trim() === 'user') context.report({ node, messageId: 'title' });
        const callback = testCallback(node);
        if (!callback) { context.report({ node, messageId: 'callback' }); return; }
        const stages = [];
        for (const comment of sourceCode.getAllComments()) {
          if (comment.range[0] <= callback.body.range[0] || comment.range[1] >= callback.body.range[1]) continue;
          const containingNode = sourceCode.getNodeByRangeIndex(comment.range[0]);
          if (ownerFunction(containingNode) !== callback || !unconditionalPhase(containingNode, callback)) continue;
          const parsed = phase(comment.value);
          if (parsed) stages.push({ ...parsed, node: comment, start: comment.range[1], position: comment.range[0] });
        }
        walk(sourceCode, callback.body, (child) => {
          if (child.type !== 'CallExpression' || runnerPath(resolve(child.callee)).join('.') !== 'test.step') return;
          if (!unconditionalPhase(child, callback)) return;
          const text = staticText(child.arguments[0]);
          const parsed = text === null ? null : phase(text);
          if (!parsed) return;
          const step = testCallback(child);
          const awaited = ['AwaitExpression', 'ReturnStatement'].includes(child.parent.type);
          if (!awaited) context.report({ node: child, messageId: 'awaitedStep' });
          stages.push({ ...parsed, node: child, step, position: child.range[0], start: child.range[0] });
        }, { enterFunctions: false });
        stages.sort((left, right) => left.position - right.position);
        let previous = null;
        let ordered = stages.length > 0;
        const statements = executableStatements(sourceCode, callback.body);
        for (const [index, stage] of stages.entries()) {
          if (!stage.valid) context.report({ node: stage.node, messageId: 'description', data: { stage: stage.name } });
          if (stage.name === 'Given') ordered &&= previous === null || previous === 'Given' || previous === 'Then';
          if (stage.name === 'When') ordered &&= previous === 'Given' || previous === 'When' || previous === 'Then';
          if (stage.name === 'Then') ordered &&= previous === 'When' || previous === 'Then';
          previous = stage.name;
          const end = stages[index + 1]?.position ?? callback.body.range[1];
          const nonempty = stage.step
            ? executableStatements(sourceCode, stage.step.body).length > 0
            : statements.some((statement) => statement.range[0] >= stage.start && statement.range[1] <= end);
          if (!nonempty) context.report({ node: stage.node, messageId: 'emptyStage', data: { stage: stage.name } });
        }
        if (!ordered || stages[0]?.name !== 'Given' || previous !== 'Then' || !stages.some((stage) => stage.name === 'When')) {
          context.report({ node, messageId: 'stages' });
        }
      },
    };
  },
};

const noFocusedTests = {
  meta: {
    type: 'problem', schema: noOptions,
    messages: { forbidden: 'Do not focus, skip, defer, or dynamically select a test runner method ({{method}}).' },
  },
  create(context) {
    const resolve = createReferenceResolver(context.sourceCode);
    return {
      CallExpression(node) {
        const rawPath = resolve(node.callee);
        if (rawPath[0] === 'context' && ['skip', 'todo'].includes(rawPath.at(-1))) {
          context.report({ node, messageId: 'forbidden', data: { method: rawPath.at(-1) } });
          return;
        }
        const path = runnerPath(rawPath);
        if (!['test', 'it', 'describe', 'suite'].includes(path[0])) return;
        const restricted = path.find((part) => ['only', 'skip', 'todo', 'fixme', null].includes(part));
        if (restricted !== undefined) context.report({ node, messageId: 'forbidden', data: { method: restricted ?? 'computed method' } });
        if (path.length !== 1 && !isTestCall(node, resolve)) return;
        for (const argument of node.arguments) {
          if (argument.type !== 'ObjectExpression') continue;
          for (const property of argument.properties) {
            if (property.type !== 'Property') continue;
            const key = property.computed ? staticText(property.key) : property.key.name || property.key.value;
            if (['only', 'skip', 'todo'].includes(key) && !(property.value.type === 'Literal' && property.value.value === false)) {
              context.report({ node: property, messageId: 'forbidden', data: { method: key } });
            }
          }
        }
      },
    };
  },
};

const noUncontractedMocks = {
  meta: {
    type: 'problem', schema: allowanceSchema,
    messages: {
      forbidden: 'Replace ad hoc mock {{target}} with an explicit boundary fake and contract tests, or use mock.timers for time.',
      staleAllowance: 'Remove or shrink the migrated mock allowance for {{target}}.',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    const resolve = createReferenceResolver(sourceCode);
    const reporter = allowanceReporter(context);
    return {
      CallExpression(node) {
        const path = resolve(node.callee);
        if (path.at(-2) !== 'mock' || !['method', 'fn', null].includes(path.at(-1))) return;
        const target = path.at(-1) === 'method'
          ? `method:${sourceCode.getText(node.arguments[0])}:${staticText(node.arguments[1])}`
          : path.at(-1) === 'fn' ? 'fn' : 'dynamic mock member';
        reporter.check(node, target);
      },
      'Program:exit': reporter.finish,
    };
  },
};

function timerResolvesPromise(node, sourceCode, resolve) {
  let executor = node.parent;
  while (executor && !(isFunction(executor) && executor.parent.type === 'NewExpression' && executor.parent.callee.name === 'Promise')) {
    executor = executor.parent;
  }
  if (!executor || executor.params[0]?.type !== 'Identifier') return false;
  const resolver = executor.params[0].name;
  const callback = node.arguments[0];
  if (!callback) return false;
  if (resolve(callback).join('.') === resolver) return true;
  if (!isFunction(callback)) return false;
  let resolves = false;
  walk(sourceCode, callback.body, (child) => {
    if (child.type === 'CallExpression' && resolve(child.callee).join('.') === resolver) resolves = true;
  });
  return resolves;
}

const noFixedWaits = {
  meta: {
    type: 'problem', schema: allowanceSchema,
    messages: {
      forbidden: 'Replace fixed wait {{target}} with an observable condition, response gate, or explicit virtual-clock advance.',
      staleAllowance: 'Remove or shrink the migrated fixed-wait allowance for {{target}}.',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    const resolve = createReferenceResolver(sourceCode);
    const reporter = allowanceReporter(context);
    return {
      CallExpression(node) {
        const path = resolve(node.callee);
        const method = path.at(-1);
        const promiseTimer = path[0] === 'promiseTimers' && (method === 'setTimeout' || method === 'wait');
        const timerSleep = method === 'setTimeout' && timerResolvesPromise(node, sourceCode, resolve);
        if (!promiseTimer && !timerSleep && !['waitForTimeout', 'sleep', 'delay'].includes(method)) return;
        const delay = node.arguments[timerSleep ? 1 : 0];
        reporter.check(node, `${path.join('.')}(${delay ? sourceCode.getText(delay) : ''})`);
      },
      'Program:exit': reporter.finish,
    };
  },
};

function assertionArguments(node, resolve) {
  const path = resolve(node.callee);
  if (path[0] === 'assert') {
    const count = ['assert', 'ok', 'fail'].includes(path.at(-1)) ? 1 : 2;
    return node.arguments.slice(0, count);
  }
  if (node.callee.type !== 'MemberExpression') return null;
  let base = node.callee.object;
  while (base.type === 'MemberExpression') base = base.object;
  if (base.type === 'CallExpression' && resolve(base.callee)[0] === 'expect') return [...base.arguments, ...node.arguments];
  return null;
}

const noVacuousTests = {
  meta: {
    type: 'problem', schema: noOptions,
    messages: { empty: 'A test must execute behavior and check an observable result.', constant: 'This test only asserts constants or a value against itself; assert an observable result.' },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    const resolve = createReferenceResolver(sourceCode);
    return {
      CallExpression(node) {
        if (!isTestCall(node, resolve)) return;
        const callback = testCallback(node);
        if (!callback) { context.report({ node, messageId: 'empty' }); return; }
        if (callback.body.type === 'BlockStatement' && executableStatements(sourceCode, callback.body).length === 0) {
          context.report({ node, messageId: 'empty' });
          return;
        }
        const assertions = [];
        walk(sourceCode, callback.body, (child) => {
          if (child.type !== 'CallExpression') return;
          const arguments_ = assertionArguments(child, resolve);
          if (arguments_ !== null) assertions.push(arguments_);
        });
        if (assertions.length > 0 && assertions.every((arguments_) => arguments_.every(isConstant)
          || (arguments_.length === 2 && arguments_.every((argument) => argument.type === 'Identifier') && arguments_[0].name === arguments_[1].name))) {
          context.report({ node, messageId: 'constant' });
        }
      },
    };
  },
};

export default {
  rules: {
    'behavior-contract': behaviorContract,
    'no-focused-tests': noFocusedTests,
    'no-uncontracted-mocks': noUncontractedMocks,
    'no-fixed-waits': noFixedWaits,
    'no-vacuous-tests': noVacuousTests,
  },
};
