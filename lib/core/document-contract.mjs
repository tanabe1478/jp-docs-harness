import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { hashContent } from "./content-hash.mjs";

export async function createContractValidator({ Ajv, intentSchemaPath }) {
  const schema = JSON.parse(await readFile(intentSchemaPath, "utf8"));
  return new Ajv({ allErrors: true, strict: false }).compile(schema);
}

export async function loadDocumentContract({
  absolutePath,
  relativePath,
  yaml,
  validate,
}) {
  if (!existsSync(absolutePath)) {
    return { path: relativePath, status: "missing", errors: [] };
  }

  const source = await readFile(absolutePath, "utf8");
  const lineCounter = new yaml.LineCounter();
  const parsed = yaml.parseDocument(source, { lineCounter });
  const contractHash = hashContent(source);

  if (parsed.errors.length > 0) {
    return {
      path: relativePath,
      status: "invalid",
      contractHash,
      source,
      errors: parsed.errors.map((error) => ({
        kind: "yaml",
        keyword: "yaml",
        message: error.message,
        location: error.linePos?.[0]
          ? pointLocation(error.linePos[0].line, error.linePos[0].col)
          : pointLocation(1, 1),
      })),
    };
  }

  const data = parsed.toJS();
  const valid = validate(data);
  const errors = valid
    ? []
    : (validate.errors ?? []).map((error) => ({
        kind: "schema",
        keyword: error.keyword,
        message: `${error.instancePath || "/"} ${error.message ?? "契約がSchemaに適合しません"}`,
        location: locateYamlPath(parsed, lineCounter, error.instancePath),
      }));

  return {
    path: relativePath,
    status: valid ? "valid" : "invalid",
    contractHash,
    source,
    data: valid ? data : undefined,
    errors,
  };
}

function locateYamlPath(document, lineCounter, instancePath) {
  const parts = instancePath
    .split("/")
    .filter(Boolean)
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))
    .map((part) => (/^\d+$/.test(part) ? Number(part) : part));
  const node = parts.length > 0 ? document.getIn(parts, true) : document.contents;
  const offset = node?.range?.[0];
  if (typeof offset !== "number") return pointLocation(1, 1);
  const position = lineCounter.linePos(offset);
  return pointLocation(position.line, position.col);
}

function pointLocation(line, column) {
  return { startLine: line, startColumn: column, endLine: line, endColumn: column };
}
