import ts from "typescript";
import { ConflictError, ParseError } from "./sync.ts";

type JsonObject = Record<string, unknown>;
type Edit = { start: number; end: number; text: string };

export function mergeTypeScriptConfig(
  path: string,
  existing: string,
  template: string,
): string {
  const ast = ts.parseJsonText(path, existing);
  const parsed = ts.parseConfigFileTextToJson(path, existing);
  if (parsed.error || !isObject(parsed.config))
    throw new ParseError(path, "invalid JSONC object");
  const root = ast.statements[0]?.expression;
  if (!root || !ts.isObjectLiteralExpression(root))
    throw new ParseError(path, "expected an object");
  const wanted = JSON.parse(template) as JsonObject;
  const edits: Edit[] = [];
  const merge = (
    node: ts.ObjectLiteralExpression,
    current: JsonObject,
    required: JsonObject,
    prefix = "",
  ) => {
    const missing: [string, unknown][] = [];
    for (const [key, value] of Object.entries(required)) {
      const name = prefix ? `${prefix}.${key}` : key;
      const found = current[key];
      if (!Object.hasOwn(current, key)) {
        missing.push([key, value]);
        continue;
      }
      if (isObject(value) && isObject(found)) {
        const property = node.properties.find(
          (prop) =>
            ts.isPropertyAssignment(prop) &&
            prop.name.getText(ast).replace(/^['"]|['"]$/g, "") === key,
        );
        if (
          !property ||
          !ts.isPropertyAssignment(property) ||
          !ts.isObjectLiteralExpression(property.initializer)
        )
          throw new ParseError(path, `invalid object at ${name}`);
        merge(property.initializer, found, value, name);
      } else if (JSON.stringify(found) !== JSON.stringify(value)) {
        throw new ConflictError(
          "compilerOptions",
          name,
          found,
          JSON.stringify(value),
          path,
        );
      }
    }
    if (!missing.length) return;
    const close = node.getEnd() - 1;
    const lineStart = existing.lastIndexOf("\n", node.getStart(ast)) + 1;
    const indent =
      existing.slice(lineStart, node.getStart(ast)).match(/^\s*/)?.[0] ?? "";
    const last = node.properties.at(-1);
    if (last) {
      const scanner = ts.createScanner(
        ts.ScriptTarget.Latest,
        true,
        ts.LanguageVariant.Standard,
        existing,
      );
      scanner.setTextPos(last.getEnd());
      if (scanner.scan() !== ts.SyntaxKind.CommaToken)
        edits.push({ start: last.getEnd(), end: last.getEnd(), text: "," });
    }
    const items = missing.map(
      ([key, value]) =>
        `${indent}  ${JSON.stringify(key)}: ${JSON.stringify(value)}`,
    );
    edits.push({
      start: close,
      end: close,
      text: `\n${items.join(",\n")}\n${indent}`,
    });
  };
  merge(root, parsed.config, wanted);
  return edits
    .sort((a, b) => b.start - a.start)
    .reduce(
      (text, edit) =>
        text.slice(0, edit.start) + edit.text + text.slice(edit.end),
      existing,
    );
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
