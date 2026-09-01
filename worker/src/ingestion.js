import * as XLSX from "xlsx";
import { parseLargeXlsx } from "./xlsx-streaming.js";

export const UPLOAD_LIMITS = Object.freeze({
  maxFiles: 32,
  maxRequestBytes: 25 * 1024 * 1024,
  maxFileBytes: 25 * 1024 * 1024,
  maxRowsPerSheet: 50_000,
  maxColumnsPerSheet: 200,
});

const extensionOf = name => String(name).toLowerCase().split(".").pop();

const cleanMatrix = matrix => {
  const populated = matrix.filter(row =>
    Array.isArray(row) && row.some(value => value !== null && value !== undefined && value !== ""),
  );
  if (!populated.length) return null;
  const headers = populated[0].map((value, index) => {
    const header = String(value ?? "").trim();
    return header || `coluna_${index + 1}`;
  });
  const rows = populated.slice(1).map(row => headers.map((_, index) => row[index] ?? null));
  return { headers, rows };
};

const detectDelimiter = text => {
  const firstRecord = text.split(/\r?\n/, 1)[0] || "";
  const candidates = [",", ";", "\t", "|"];
  return candidates.reduce(
    (best, delimiter) => {
      const count = firstRecord.split(delimiter).length - 1;
      return count > best.count ? { delimiter, count } : best;
    },
    { delimiter: ",", count: -1 },
  ).delimiter;
};

export function parseCsv(text) {
  const source = text.replace(/^\uFEFF/, "");
  const delimiter = detectDelimiter(source);
  const matrix = [];
  let row = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      row.push(value);
      value = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(value);
      matrix.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }
  if (value || row.length) {
    row.push(value);
    matrix.push(row);
  }
  return cleanMatrix(matrix);
}

export const spreadsheetSources = async (file, context) => {
  if (file.size > 8 * 1024 * 1024 && String(file.name).toLowerCase().endsWith(".xlsx")) {
    return parseLargeXlsx(file, context);
  }
  const workbook = XLSX.read(await file.arrayBuffer(), {
    type: "array",
    cellDates: false,
    dense: true,
  });
  const sources = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet?.["!ref"]) continue;
    const range = XLSX.utils.decode_range(sheet["!ref"]);
    const rowCount = range.e.r - range.s.r + 1;
    const columnCount = range.e.c - range.s.c + 1;
    if (rowCount > UPLOAD_LIMITS.maxRowsPerSheet || columnCount > UPLOAD_LIMITS.maxColumnsPerSheet) {
      throw new Error(`Aba ${sheetName} excede o limite seguro de linhas ou colunas.`);
    }
    const parsed = cleanMatrix(
      XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null }),
    );
    if (parsed) sources.push({ filename: file.name, sheet: sheetName, context, ...parsed });
  }
  return sources;
};

export const csvSources = async (file, context) => {
  const parsed = parseCsv(await file.text());
  return parsed ? [{ filename: file.name, sheet: null, context, ...parsed }] : [];
};

const parseRulePdf = async file => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const raw = new TextDecoder("latin1").decode(bytes);
  const marker = raw.match(/RECOVERY_RULE_B64_([A-Za-z0-9+/=]+)/)?.[1];
  if (!marker) throw new Error(`O PDF ${file.name} não contém uma regra Recovery estruturada.`);
  let rule;
  try {
    const decoded = Uint8Array.from(atob(marker), character => character.charCodeAt(0));
    rule = JSON.parse(new TextDecoder().decode(decoded));
  } catch {
    throw new Error(`A regra estruturada do PDF ${file.name} é inválida.`);
  }
  const allowedFields = new Set(["quantity", "weight_g", "max_dimension_cm"]);
  const allowedOps = new Set(["lt", "lte", "gt", "gte", "eq"]);
  if (
    rule?.scope !== "attached_audit_only" ||
    !Array.isArray(rule?.conditions) ||
    !rule.conditions.length ||
    rule.conditions.some(condition => !allowedFields.has(condition?.field) || !allowedOps.has(condition?.op)) ||
    rule?.calculation?.type !== "fixed" ||
    !Number.isFinite(Number(rule?.calculation?.amount))
  ) {
    throw new Error(`A regra do PDF ${file.name} não atende ao contrato seguro do Recovery.`);
  }
  return [{
    name: `Regra anexada: ${file.name}`,
    version: String(rule.version || "1.0"),
    seller_id: null,
    marketplace: null,
    logistics_mode: null,
    carrier: null,
    rules: [{
      id: String(rule.id || "regra_anexada"),
      priority: 100,
      conditions: rule.conditions,
      calculation: { type: "fixed", amount: Number(rule.calculation.amount) },
      source_reference: file.name,
    }],
  }];
};

export async function parseAuditUpload(request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > UPLOAD_LIMITS.maxRequestBytes) {
    throw new Error("O envio excede o limite de 25 MB.");
  }
  const form = await request.formData();
  const files = form.getAll("files").filter(value => typeof value?.arrayBuffer === "function");
  if (!files.length) throw new Error("Adicione ao menos um arquivo CSV ou XLSX.");
  if (files.length > UPLOAD_LIMITS.maxFiles) throw new Error("Envie no máximo 32 arquivos por auditoria.");

  const totalBytes = files.reduce((total, file) => total + Number(file.size || 0), 0);
  if (totalBytes > UPLOAD_LIMITS.maxRequestBytes) throw new Error("Os arquivos excedem o limite total de 25 MB.");

  const context = {
    marketplace: String(form.get("marketplace") || ""),
    logistics_mode: String(form.get("operation") || ""),
    carrier: String(form.get("carrier") || ""),
  };
  const sources = [];
  for (const file of files) {
    if (Number(file.size || 0) > UPLOAD_LIMITS.maxFileBytes) {
      throw new Error(`O arquivo ${file.name} excede o limite de 25 MB.`);
    }
    const extension = extensionOf(file.name);
    if (!["csv", "xls", "xlsx"].includes(extension)) {
      throw new Error(`Formato não aceito: ${file.name}. Use CSV, XLS ou XLSX.`);
    }
    const parsed = extension === "csv"
      ? await csvSources(file, context)
      : await spreadsheetSources(file, context);
    sources.push(...parsed);
  }
  if (!sources.length) throw new Error("Nenhuma aba ou linha utilizável foi encontrada.");

  return {
    seller_id: String(form.get("seller") || ""),
    seller: String(form.get("seller") || ""),
    marketplace: context.marketplace,
    operation: context.logistics_mode,
    carrier: context.carrier,
    period_start: String(form.get("periodStart") || ""),
    period_end: String(form.get("periodEnd") || ""),
    sources,
    rule_sources: [],
    rule_sets: [],
    product_catalog: [],
  };
}

export async function parseSingleAuditSource(request) {
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > UPLOAD_LIMITS.maxFileBytes + 1024 * 1024) {
    throw new Error("O arquivo excede o limite de 25 MB.");
  }
  const form = await request.formData();
  const files = form.getAll("file").filter(value => typeof value?.arrayBuffer === "function");
  if (files.length !== 1) throw new Error("Envie exatamente um arquivo por vez.");
  const file = files[0];
  if (Number(file.size || 0) > UPLOAD_LIMITS.maxFileBytes) {
    throw new Error(`O arquivo ${file.name} excede o limite de 25 MB.`);
  }
  const extension = extensionOf(file.name);
  if (!["csv", "xls", "xlsx", "pdf"].includes(extension)) {
    throw new Error(`Formato não aceito: ${file.name}. Use CSV, XLS, XLSX ou PDF.`);
  }
  const context = {
    marketplace: String(form.get("marketplace") || ""),
    logistics_mode: String(form.get("operation") || ""),
    carrier: String(form.get("carrier") || ""),
  };
  if (extension === "pdf") {
    return { file, kind: "rule", sources: [], ruleSets: await parseRulePdf(file) };
  }
  const sources = extension === "csv" ? await csvSources(file, context) : await spreadsheetSources(file, context);
  if (!sources.length) throw new Error("Nenhuma aba ou linha utilizável foi encontrada.");
  return { file, kind: "data", sources, ruleSets: [] };
}
