/**
 * Parse + validate kich ban YAML (S2.1 AC-2).
 * Loi tra ve co cau truc: file, dong (neu xac dinh duoc), truong, ly do
 * bang tieng Viet. Kich ban hop le tra ve doi tuong da parse (ScenarioDefinition).
 */
import { parseDocument, isMap, isSeq, type Document, type Node } from "yaml";
import type { ZodIssue } from "zod";

import { scenarioSchema, type ScenarioDefinition } from "./schema.js";

export interface ValidationIssue {
  file: string;
  /** Dong 1-based trong file YAML; null neu khong xac dinh duoc. */
  line: number | null;
  /** Duong dan truong dang JSON-path don gian, vd "cacBuoc[2].hanhDong". */
  field: string;
  message: string;
  /** Vi tri o tinh (chi co o loi tu bo chuyen doi Excel). */
  cell?: string;
}

export type ValidateResult =
  | { ok: true; scenario: ScenarioDefinition; errors: [] }
  | { ok: false; errors: ValidationIssue[] };

function formatPath(path: (string | number)[]): string {
  let out = "";
  for (const part of path) {
    if (typeof part === "number") out += `[${part}]`;
    else out += out ? `.${part}` : part;
  }
  return out || "(gốc)";
}

/** Tim node YAML theo duong dan de lay so dong tu range cua node. */
function findNodeLine(doc: Document, source: string, path: (string | number)[]): number | null {
  let node: unknown = doc.contents;
  for (const part of path) {
    if (node === null || node === undefined) return null;
    if (typeof part === "number") {
      if (!isSeq(node)) return null;
      node = node.items[part];
    } else {
      if (!isMap(node)) return null;
      const pair = node.items.find(
        (p) => typeof p.key === "object" && p.key !== null && "value" in p.key && p.key.value === part,
      );
      node = pair?.value;
    }
  }
  const range = (node as Node | undefined)?.range;
  if (!range) return null;
  const upTo = source.slice(0, range[0]);
  return upTo.split("\n").length;
}

function vietnameseZodMessage(issue: ZodIssue): string {
  switch (issue.code) {
    case "invalid_type":
      if (issue.received === "undefined") return "Thiếu trường bắt buộc";
      return `Sai kiểu dữ liệu: cần ${issue.expected}, đang nhận ${issue.received}`;
    case "invalid_enum_value":
      return `Giá trị không hợp lệ. Chỉ chấp nhận: ${(issue.options ?? []).join(", ")}`;
    case "invalid_literal":
      return `Giá trị phải là ${JSON.stringify(issue.expected)}`;
    case "too_small":
      return issue.type === "array"
        ? `Danh sách phải có ít nhất ${issue.minimum} phần tử`
        : issue.type === "string"
          ? `Chuỗi phải có ít nhất ${issue.minimum} ký tự`
          : `Giá trị phải từ ${issue.minimum} trở lên`;
    case "too_big":
      return issue.type === "array"
        ? `Danh sách tối đa ${issue.maximum} phần tử`
        : `Giá trị phải nhỏ hơn hoặc bằng ${issue.maximum}`;
    case "invalid_string":
      return "Chuỗi không đúng định dạng yêu cầu";
    case "unrecognized_keys":
      return `Trường không được phép: ${issue.keys.join(", ")} (kịch bản là dữ liệu, không nhúng code/trường lạ)`;
    case "custom":
      return issue.message;
    default:
      return issue.message;
  }
}

/** Validate mot doi tuong (da parse tu YAML/Excel) theo schema. */
export function validateScenarioObject(
  data: unknown,
  file: string,
  source?: string,
  doc?: Document,
): ValidateResult {
  const parsed = scenarioSchema.safeParse(data);
  if (parsed.success) return { ok: true, scenario: parsed.data, errors: [] };
  const errors: ValidationIssue[] = parsed.error.issues.map((issue) => ({
    file,
    line: source && doc ? findNodeLine(doc, source, issue.path as (string | number)[]) : null,
    field: formatPath(issue.path as (string | number)[]),
    message: vietnameseZodMessage(issue),
  }));
  return { ok: false, errors };
}

/** Parse YAML roi validate; loi cu phap YAML cung tra ve co dong. */
export function parseScenarioYaml(text: string, file = "<yaml>"): ValidateResult {
  const doc = parseDocument(text, { keepSourceTokens: false });
  if (doc.errors.length > 0) {
    return {
      ok: false,
      errors: doc.errors.map((err) => ({
        file,
        line: err.linePos?.[0]?.line ?? null,
        field: "(cú pháp YAML)",
        message: `Lỗi cú pháp YAML: ${err.message.split("\n")[0]}`,
      })),
    };
  }
  const data: unknown = doc.toJS();
  if (typeof data !== "object" || data === null) {
    return {
      ok: false,
      errors: [{ file, line: 1, field: "(gốc)", message: "File YAML phải là một đối tượng kịch bản" }],
    };
  }
  return validateScenarioObject(data, file, text, doc);
}
