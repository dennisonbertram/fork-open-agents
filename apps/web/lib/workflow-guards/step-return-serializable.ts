import path from "node:path";
import * as ts from "typescript";

/**
 * Static guard for the constraint documented in apps/web/app/workflows/chat.ts
 * ("persist return values") and apps/web/app/workflows/chat.test.ts ("return
 * values are serialized"): a `"use step"` function's return value is
 * persisted by the workflow runtime, so it must not contain anything
 * callable (a function, a method, a `ToolSet`'s `execute` closures, ...).
 *
 * This inspects the *declared or inferred TypeScript return type* of every
 * `"use step"` function reachable from the given entry files — it does not
 * execute anything or attempt to reproduce the runtime's own serializer.
 * That is a deliberate choice (see #1281): a type-level check needs no
 * mocks, runs deterministically, and inspects exactly the shape that broke
 * production (a return type containing something callable).
 *
 * Bias: prefer a false negative over a false positive. Class instances
 * (including built-ins backed by lib.d.ts interfaces, like `Date`, `Map`,
 * `Set`, `RegExp`) are treated as opaque leaves and never walked into, even
 * though some carry method-typed properties — flagging those would make the
 * guard noisy enough to get deleted (docs/process/guard-integrity.md).
 */

export type StepReturnViolation = {
  /** Name of the `"use step"` function whose return type was flagged. */
  functionName: string;
  /** Absolute path to the source file containing the function. */
  filePath: string;
  /** Property path to the offending member, e.g. "tools.bash.execute". */
  propertyPath: string;
};

const USE_STEP_DIRECTIVE = "use step";
const MAX_WALK_DEPTH = 8;

/** Type names whose *instances* are natively serializable and must not be
 * walked into even though they carry method-typed properties. This list is
 * deliberately generous — an unrecognized class-shaped type is also skipped
 * (see `isPlainObjectType` below), so this only needs to cover cases where
 * we still want to confirm the type isn't itself callable. */
const OPAQUE_BUILTIN_TYPE_NAMES = new Set([
  "Date",
  "RegExp",
  "Map",
  "ReadonlyMap",
  "WeakMap",
  "Set",
  "ReadonlySet",
  "WeakSet",
  "ArrayBuffer",
  "SharedArrayBuffer",
  "DataView",
  "URL",
  "URLSearchParams",
  "Error",
  "Int8Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "Int16Array",
  "Uint16Array",
  "Int32Array",
  "Uint32Array",
  "Float32Array",
  "Float64Array",
  "BigInt64Array",
  "BigUint64Array",
]);

type StepFunctionNode =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration;

/**
 * Runs the checker against `entryFiles`, resolving compiler options from
 * apps/web/tsconfig.json so `@/*` path aliases and `node_modules` types
 * (e.g. `ToolSet` from `ai`) resolve the same way the real app does.
 *
 * Only `entryFiles` and whatever they transitively import are type-checked
 * — not the whole apps/web tree — to keep this fast enough to run in a unit
 * test.
 */
export function findStepReturnViolations(
  entryFiles: string[],
): StepReturnViolation[] {
  const program = ts.createProgram(entryFiles, loadCompilerOptions());
  const checker = program.getTypeChecker();
  const violations: StepReturnViolation[] = [];

  for (const entryFile of entryFiles) {
    const sourceFile = program.getSourceFile(entryFile);
    if (!sourceFile) {
      throw new Error(
        `workflow-guards: could not load "${entryFile}" into the TypeScript program`,
      );
    }
    collectViolations(sourceFile, checker, violations);
  }

  return violations;
}

function loadCompilerOptions(): ts.CompilerOptions {
  const appsWebDir = path.join(import.meta.dir, "..", "..");
  const tsconfigPath = path.join(appsWebDir, "tsconfig.json");

  const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (configFile.error) {
    throw new Error(
      `workflow-guards: failed to read ${tsconfigPath}: ${ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n")}`,
    );
  }

  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    appsWebDir,
  );
  return parsed.options;
}

function collectViolations(
  node: ts.Node,
  checker: ts.TypeChecker,
  violations: StepReturnViolation[],
): void {
  const stepFunction = asStepFunction(node);
  if (stepFunction) {
    const propertyPath = findNonSerializableReturnPath(stepFunction, checker);
    if (propertyPath !== null) {
      violations.push({
        functionName: getStepFunctionName(stepFunction),
        filePath: stepFunction.getSourceFile().fileName,
        propertyPath,
      });
    }
  }

  ts.forEachChild(node, (child) =>
    collectViolations(child, checker, violations),
  );
}

function asStepFunction(node: ts.Node): StepFunctionNode | undefined {
  if (
    !(
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node)
    )
  ) {
    return;
  }
  return hasUseStepDirective(node.body) ? node : undefined;
}

function hasUseStepDirective(body: ts.ConciseBody | undefined): boolean {
  if (!body || !ts.isBlock(body)) {
    return false;
  }
  const first = body.statements[0];
  return (
    !!first &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteralLike(first.expression) &&
    first.expression.text === USE_STEP_DIRECTIVE
  );
}

function getStepFunctionName(node: StepFunctionNode): string {
  if (
    (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
    node.name
  ) {
    return node.name.getText();
  }
  const parent = node.parent;
  if (
    parent &&
    ts.isVariableDeclaration(parent) &&
    ts.isIdentifier(parent.name)
  ) {
    return parent.name.text;
  }
  return `<anonymous:${node.getSourceFile().fileName}:${node.getStart()}>`;
}

function findNonSerializableReturnPath(
  node: StepFunctionNode,
  checker: ts.TypeChecker,
): string | null {
  const signature = checker.getSignatureFromDeclaration(node);
  if (!signature) {
    return null;
  }
  const returnType = checker.getReturnTypeOfSignature(signature);
  return walkForCallable(returnType, "", 0, {
    checker,
    visited: new Set<ts.Type>(),
  });
}

type WalkContext = {
  checker: ts.TypeChecker;
  visited: Set<ts.Type>;
};

function walkForCallable(
  type: ts.Type,
  path: string,
  depth: number,
  ctx: WalkContext,
): string | null {
  if (depth > MAX_WALK_DEPTH) {
    return null;
  }

  const resolved = unwrapPromise(type, ctx.checker);
  if (ctx.visited.has(resolved)) {
    return null;
  }
  ctx.visited.add(resolved);

  if (resolved.getCallSignatures().length > 0) {
    return path || "<return value>";
  }

  if (resolved.isUnionOrIntersection()) {
    for (const member of resolved.types) {
      const hit = walkForCallable(member, path, depth + 1, ctx);
      if (hit !== null) {
        return hit;
      }
    }
    return null;
  }

  // Not an object type (primitive, `any`, `unknown`, `never`, enum, ...) —
  // nothing to recurse into and it can't be callable on its own.
  if (!(resolved.flags & ts.TypeFlags.Object)) {
    return null;
  }

  if (ctx.checker.isArrayType(resolved) || ctx.checker.isTupleType(resolved)) {
    const elementTypes = ctx.checker.getTypeArguments(
      resolved as ts.TypeReference,
    );
    for (const [index, elType] of elementTypes.entries()) {
      const hit = walkForCallable(
        elType,
        appendIndex(path, index),
        depth + 1,
        ctx,
      );
      if (hit !== null) {
        return hit;
      }
    }
    return null;
  }

  if (!isPlainObjectType(resolved)) {
    return null;
  }

  const stringIndexType = resolved.getStringIndexType();
  if (stringIndexType) {
    const hit = walkForCallable(
      stringIndexType,
      appendIndex(path, "key"),
      depth + 1,
      ctx,
    );
    if (hit !== null) {
      return hit;
    }
  }
  const numberIndexType = resolved.getNumberIndexType();
  if (numberIndexType) {
    const hit = walkForCallable(
      numberIndexType,
      appendIndex(path, "n"),
      depth + 1,
      ctx,
    );
    if (hit !== null) {
      return hit;
    }
  }

  for (const property of ctx.checker.getPropertiesOfType(resolved)) {
    const propertyType = ctx.checker.getTypeOfSymbol(property);
    const hit = walkForCallable(
      propertyType,
      appendProperty(path, property.getName()),
      depth + 1,
      ctx,
    );
    if (hit !== null) {
      return hit;
    }
  }

  return null;
}

/**
 * `Promise<T>` (or a chain of them) unwraps to `T` — the runtime awaits a
 * step's return value before persisting it, so only the resolved value
 * matters. Applied at every level, not just the top, since a nested
 * `Promise` would be just as unpersistable.
 */
function unwrapPromise(type: ts.Type, checker: ts.TypeChecker): ts.Type {
  let current = type;
  for (let i = 0; i < MAX_WALK_DEPTH; i++) {
    if (
      current.getSymbol()?.getName() !== "Promise" ||
      !isTypeReference(current)
    ) {
      break;
    }
    const args = checker.getTypeArguments(current);
    if (args.length !== 1) {
      break;
    }
    current = args[0];
  }
  return current;
}

function isTypeReference(type: ts.Type): type is ts.TypeReference {
  return (
    !!(type.flags & ts.TypeFlags.Object) &&
    !!((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference)
  );
}

/**
 * Only plain object shapes (type literals, interfaces, `Record<...>`) are
 * walked. Class instances — including built-ins like `Date`, whose
 * structural type carries method-typed properties (`getTime`,
 * `toISOString`, ...) — are treated as opaque leaves. Recursing into every
 * class instance would flag ordinary data (a `Date` field, a Zod-parsed
 * value, a Drizzle row) as a violation; the bias here is a false negative
 * on an actual class-backed closure leak over a false positive on data.
 */
function isPlainObjectType(type: ts.Type): boolean {
  const symbol = type.getSymbol();
  const name = symbol?.getName();
  if (name && OPAQUE_BUILTIN_TYPE_NAMES.has(name)) {
    return false;
  }
  const declarations = symbol?.declarations ?? [];
  const isClassBacked = declarations.some(
    (decl) => ts.isClassDeclaration(decl) || ts.isClassExpression(decl),
  );
  return !isClassBacked;
}

function appendProperty(path: string, name: string): string {
  return path ? `${path}.${name}` : name;
}

function appendIndex(path: string, index: number | string): string {
  return `${path}[${index}]`;
}
