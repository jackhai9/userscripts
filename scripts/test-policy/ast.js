export function isFunction(node) {
  return ['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration'].includes(node.type);
}

export function walk(sourceCode, node, visit, { enterFunctions = true } = {}) {
  visit(node);
  for (const key of sourceCode.visitorKeys[node.type] || []) {
    const children = Array.isArray(node[key]) ? node[key] : [node[key]];
    for (const child of children) {
      if (!child || (!enterFunctions && isFunction(child))) continue;
      walk(sourceCode, child, visit, { enterFunctions });
    }
  }
}

export function staticText(node) {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node?.type === 'TemplateLiteral') {
    return node.quasis.map((quasi) => quasi.value.cooked).join('${value}');
  }
  return null;
}

export function propertyName(node) {
  if (!node.computed && node.property.type === 'Identifier') return node.property.name;
  if (node.property.type === 'TemplateLiteral' && node.property.expressions.length > 0) return null;
  return staticText(node.property);
}

/** Resolve the imported runner and ordinary aliases, including destructuring. */
export function createReferenceResolver(sourceCode) {
  function importedPath(definition) {
    const specifier = definition.node;
    const source = definition.parent.source.value;
    const imported = specifier.type === 'ImportDefaultSpecifier' ? 'default' : specifier.imported?.name;
    if (source === 'node:test' || source === '@playwright/test' || source.endsWith('/test.js')) {
      if (specifier.type === 'ImportNamespaceSpecifier') return ['testModule'];
      if (['default', 'test', 'it'].includes(imported)) return ['test'];
      if (['describe', 'suite'].includes(imported)) return ['describe'];
      if (imported === 'mock') return ['context', 'mock'];
      if (imported === 'expect') return ['expect'];
    }
    if (['node:assert', 'node:assert/strict'].includes(source)) {
      return ['default', 'strict'].includes(imported) || specifier.type === 'ImportNamespaceSpecifier'
        ? ['assert'] : ['assert', imported];
    }
    if (['node:timers/promises', 'timers/promises'].includes(source)) {
      return specifier.type === 'ImportNamespaceSpecifier' || imported === 'default'
        ? ['promiseTimers'] : ['promiseTimers', imported];
    }
    return null;
  }
  function propertyPath(pattern, name) {
    if (pattern.type === 'Identifier') return pattern.name === name ? [] : null;
    if (pattern.type === 'AssignmentPattern') return propertyPath(pattern.left, name);
    if (pattern.type !== 'ObjectPattern') return null;
    for (const property of pattern.properties) {
      if (property.type !== 'Property') continue;
      const nested = propertyPath(property.value, name);
      if (nested !== null) {
        const key = property.computed ? staticText(property.key) : property.key.name || property.key.value;
        return [key, ...nested];
      }
    }
    return null;
  }
  function resolve(node, seen = new Set()) {
    if (!node) return [];
    if (node.type === 'ChainExpression' || node.type === 'AwaitExpression') return resolve(node.expression || node.argument, seen);
    if (node.type === 'Identifier') {
      let variable;
      for (let scope = sourceCode.getScope(node); scope && !variable; scope = scope.upper) variable = scope.set.get(node.name);
      if (!variable || variable.defs.length === 0) return [node.name];
      if (seen.has(variable)) return [];
      const nextSeen = new Set([...seen, variable]);
      const definition = variable.defs[0];
      if (definition.type === 'ImportBinding') return importedPath(definition) || [node.name];
      if (definition.type === 'Variable' && definition.node.init) {
        const base = resolve(definition.node.init, nextSeen);
        const property = propertyPath(definition.node.id, node.name);
        if (base.length > 0 && property !== null) return [...base, ...property];
      }
      if (definition.type === 'Parameter') {
        const callback = definition.node;
        if (callback.parent.type === 'CallExpression' && isTestCall(callback.parent, (value) => resolve(value, nextSeen))) {
          const property = propertyPath(callback.params[0], node.name);
          if (property !== null) return ['context', ...property];
        }
      }
      // A local parameter named "test" is not the imported runner it shadows.
      return ['test', 'it', 'describe', 'suite'].includes(node.name) ? ['local', node.name] : [node.name];
    }
    if (node.type === 'MemberExpression') {
      const object = resolve(node.object, seen);
      const property = propertyName(node);
      if (object.length === 1 && object[0] === 'testModule') {
        if (['test', 'it'].includes(property)) return ['test'];
        if (['describe', 'suite'].includes(property)) return ['describe'];
        if (property === 'mock') return ['context', 'mock'];
        if (property === 'expect') return ['expect'];
      }
      return object.length > 0 ? [...object, property] : [];
    }
    if (node.type === 'CallExpression') {
      const callee = resolve(node.callee, seen);
      if (callee[0] === 'test' && callee.at(-1) === 'extend') return ['test'];
      if (callee.at(-1) === 'bind') return callee.slice(0, -1);
    }
    return [];
  }
  return resolve;
}

export function runnerPath(path) {
  if (path[0] === 'testModule') return path.slice(1);
  if (['t', 'context'].includes(path[0]) && path[1] === 'test') return path.slice(1);
  return path;
}

export function isTestCall(node, resolve) {
  const path = runnerPath(resolve(node.callee));
  return ['test', 'it'].includes(path[0])
    && (path.length === 1 || (path.length === 2 && ['only', 'skip', 'todo', 'fixme'].includes(path[1])));
}

export function testCallback(node) {
  return node.arguments.findLast((argument) => isFunction(argument));
}

export function ownerFunction(node) {
  for (let parent = node; parent; parent = parent.parent) {
    if (isFunction(parent)) return parent;
  }
  return null;
}

export function executableStatements(sourceCode, body) {
  const statements = [];
  walk(sourceCode, body, (node) => {
    if (node.type === 'ExpressionStatement' && node.expression.type !== 'Literal') statements.push(node);
    if (node.type === 'VariableDeclaration' && node.declarations.some((declaration) => declaration.init)) statements.push(node);
    if (['ThrowStatement', 'ReturnStatement'].includes(node.type) && node.argument) statements.push(node);
  }, { enterFunctions: false });
  return statements;
}

export function isConstant(node) {
  if (!node) return false;
  if (node.type === 'Literal') return true;
  if (node.type === 'Identifier') return ['undefined', 'NaN', 'Infinity'].includes(node.name);
  if (node.type === 'TemplateLiteral') return node.expressions.every(isConstant);
  if (node.type === 'UnaryExpression') return node.operator !== 'delete' && isConstant(node.argument);
  if (['BinaryExpression', 'LogicalExpression'].includes(node.type)) return isConstant(node.left) && isConstant(node.right);
  if (node.type === 'ArrayExpression') return node.elements.every((element) => element === null || isConstant(element));
  if (node.type === 'ObjectExpression') {
    return node.properties.every((property) => property.type === 'Property'
      && property.kind === 'init' && (!property.computed || isConstant(property.key)) && isConstant(property.value));
  }
  return false;
}
