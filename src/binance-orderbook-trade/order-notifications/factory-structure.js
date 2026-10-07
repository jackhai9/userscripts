import { parse } from 'acorn';
import { analyze } from 'eslint-scope';

const MAX_FACTORY_SOURCE_LENGTH = 64 * 1024;
const SUPPORTED_SCOPES = new Set([
  'global', 'function', 'function-expression-name', 'block', 'for', 'switch',
  'catch', 'class', 'class-field-initializer', 'class-static-block',
]);
const SOURCE_POSITION_FIELDS = new Set(['start', 'end', 'loc', 'range']);

/** Property names stay observable even when Acorn reuses a shorthand identifier. */
function isPropertyName(parent, key) {
  return parent && !parent.computed && (
    (key === 'key' && ['Property', 'MethodDefinition', 'PropertyDefinition'].includes(parent.type))
    || (key === 'property' && parent.type === 'MemberExpression')
  );
}

/**
 * Canonical identities come from resolved variables, never identifier spelling.
 * Declaration positions define local indices because eslint-scope reserves its
 * first variable slot for arguments even when a later parameter declares it.
 */
function collectBindingIdentities(scopeManager) {
  const identities = new Map();
  scopeManager.scopes.forEach((scope, scopeIndex) => {
    if (!SUPPORTED_SCOPES.has(scope.type) || scope.directCallToEvalScope
      || (scope.dynamic && scope.type !== 'global')) {
      throw new Error(`Unsupported native notification factory dynamic scope: ${scope.type}`);
    }
    const declaredVariables = scope.variables.filter(variable => variable.defs.length > 0)
      .sort((left, right) => left.identifiers[0].range[0] - right.identifiers[0].range[0]);
    const declarationIndices = new Map(declaredVariables.map((variable, index) => [variable, index]));
    for (const variable of scope.variables) {
      let identity;
      if (variable.defs.length === 0) {
        if (variable.name !== 'arguments' || scope.type !== 'function') {
          throw new Error('Unsupported native notification factory implicit binding');
        }
        identity = { scope: scopeIndex, implicit: 'arguments' };
      } else {
        identity = { scope: scopeIndex, variable: declarationIndices.get(variable) };
        // A var named arguments can reuse the preinitialized arguments object.
        if (variable.name === 'arguments' && !variable.defs.every(definition => definition.type === 'Parameter')) {
          identity.name = 'arguments';
        }
      }
      for (const identifier of [...variable.identifiers, ...variable.references.map(reference => reference.identifier)]) {
        if (!identities.has(identifier)) identities.set(identifier, []);
        const bindings = identities.get(identifier);
        // A class declaration can define its outer and inner name at one node.
        if (!bindings.includes(identity)) bindings.push(identity);
      }
    }
  });
  return identities;
}

/**
 * Preserve all parsed semantics while discarding source locations and literal
 * spelling. Template raw strings remain significant for tagged templates.
 */
function canonicalize(value, bindings, parent, key) {
  if (typeof value === 'bigint') return { bigintValue: String(value) };
  if (typeof value === 'number' && !Number.isFinite(value)) return { numericValue: String(value) };
  if (value instanceof RegExp) return { pattern: value.source, flags: value.flags };
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(child => canonicalize(child, bindings, parent, key));

  // Repackers expand these pure boolean literals even without syntax minification.
  if (value.type === 'UnaryExpression' && value.operator === '!' && value.prefix === true
    && value.argument.type === 'Literal' && typeof value.argument.value === 'number'
    && (value.argument.value === 0 || value.argument.value === 1)) {
    return canonicalize({ type: 'Literal', value: value.argument.value === 0 }, bindings, parent, key);
  }

  const result = {};
  const isNode = typeof value.type === 'string';
  for (const field of Object.keys(value).sort()) {
    if (isNode && (SOURCE_POSITION_FIELDS.has(field) || (value.type === 'Literal' && field === 'raw'))) continue;
    if (value.type === 'Identifier' && field === 'name' && bindings.has(value) && !isPropertyName(parent, key)) {
      result.binding = bindings.get(value);
    } else {
      result[field] = canonicalize(value[field], bindings, value, field);
    }
  }
  return result;
}

/**
 * Recognize a complete pinned webpack factory under formatting and lexical
 * alpha-renaming only. Parsing never executes host source; changed globals,
 * properties, literals, control flow and binding relationships remain distinct.
 * This is deliberately not a proof of arbitrary JavaScript semantic equivalence.
 */
export function createOrderNotificationFactorySignature(source, moduleId) {
  if (typeof source !== 'string') throw new TypeError('Native notification factory source must be a string');
  if (source.length > MAX_FACTORY_SOURCE_LENGTH) throw new Error('Native notification factory source exceeds 64 KiB');
  if (typeof moduleId !== 'string' && typeof moduleId !== 'number') {
    throw new TypeError('Native notification module ID must be a string or number');
  }
  const ast = parse(`({${source}})`, { ecmaVersion: 2022, sourceType: 'script', ranges: true });
  if (ast.body.length !== 1 || ast.body[0].type !== 'ExpressionStatement'
    || ast.body[0].expression.type !== 'ObjectExpression' || ast.body[0].expression.properties.length !== 1) {
    throw new Error('Native notification source must contain one module factory');
  }
  const factory = ast.body[0].expression.properties[0];
  if (factory.type !== 'Property' || factory.computed || !factory.method
    || factory.kind !== 'init' || factory.value.type !== 'FunctionExpression' || factory.key.type !== 'Literal') {
    throw new Error('Native notification source must contain one ordinary module factory');
  }
  if (String(factory.key.value) !== String(moduleId)) throw new Error('Native notification factory module ID does not match');

  const scopeManager = analyze(ast, {
    ecmaVersion: 2022, sourceType: 'script', optimistic: false, ignoreEval: false, fallback: null,
  });
  return JSON.stringify(canonicalize(factory, collectBindingIdentities(scopeManager), null, null));
}
