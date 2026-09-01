import { parseAuditUpload } from "./ingestion.js";

const SCHEMA_VERSION = "1.0";

const nullableText = value => {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
};

const nullableNumber = value => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const findingStatus = status => {
  if (status === "OVERCHARGED" || status === "OK") return status;
  if (status === "RULE_AMBIGUOUS" || status === "NO_RULE") {
    return "REVIEW_REQUIRED";
  }
  return "PENDING";
};

export function canonicalizeAudit(payload, input = {}, forcedAuditId) {
  const auditId = forcedAuditId || input.audit_id || crypto.randomUUID();
  const results = Array.isArray(payload.results) ? payload.results : [];
  const sourceRows = (Array.isArray(input.sources) ? input.sources : []).reduce(
    (total, source) => total + (Array.isArray(source?.rows) ? source.rows.length : 0),
    0,
  );

  const findings = results.map((result, index) => {
    const findingId = `${auditId}:finding:${index + 1}`;
    const sourceFiles = Array.isArray(result?.evidence?.source_files)
      ? result.evidence.source_files.filter(Boolean)
      : [];
    const evidence = sourceFiles.map((sourceFile, evidenceIndex) => ({
      evidence_id: `${findingId}:evidence:${evidenceIndex + 1}`,
      source_file: String(sourceFile),
      sheet: null,
      row: null,
      original_column: null,
      original_value: null,
      normalized_value: null,
      canonical_field: null,
      match_method: sourceFiles.length > 1 ? "identifier" : null,
      confidence: null,
      rule: nullableText(result?.evidence?.source_reference),
      conflicts: [],
    }));

    return {
      finding_id: findingId,
      status: findingStatus(result.status),
      tracking_number: nullableText(result.tracking_number),
      order_id: nullableText(result.order_id),
      shipment_id: nullableText(result.shipment_id),
      pack_id: nullableText(result.pack_id),
      sku: nullableText(result.sku),
      quantity: nullableNumber(result.quantity),
      charged_amount: nullableNumber(result.charged_amount),
      expected_amount: nullableNumber(result.expected_amount),
      difference: nullableNumber(result.difference),
      recoverable_amount: nullableNumber(result.recoverable_amount),
      rule_id: nullableText(result.matched_rule_id),
      rule_version: nullableText(result.matched_rule_set?.version || result.matched_rule_set),
      marketplace: nullableText(result.marketplace),
      carrier: nullableText(result.carrier),
      match_method: sourceFiles.length > 1 ? "identifier" : null,
      confidence: null,
      evidence,
    };
  });

  const overchargedRows = findings.filter(item => item.status === "OVERCHARGED").length;
  const okRows = findings.filter(item => item.status === "OK").length;
  const pendingRows = findings.length - overchargedRows - okRows;
  const summary = {
    source_rows: sourceRows,
    normalized_rows: Number(payload.summary?.normalized_rows || 0),
    matched_rows: findings.filter(item => item.match_method !== null).length,
    pending_rows: pendingRows,
    overcharged_rows: overchargedRows,
    ok_rows: okRows,
    missing_charged_amount_rows: findings.filter(item => item.charged_amount === null).length,
    total_recoverable: Number(payload.summary?.total_recoverable || 0),
  };
  const warnings = Array.isArray(payload.warnings) ? payload.warnings.map(String) : [];
  const status = pendingRows > 0 ? "REVIEW_REQUIRED" : "COMPLETED";
  const createdAt = new Date().toISOString();
  const marketplace = nullableText(input.marketplace) || nullableText(findings[0]?.marketplace) || "Não informado";
  const period = input.period || [input.period_start, input.period_end].filter(Boolean).join(" — ") || "Não informado";

  return {
    audit: {
      ok: true,
      schema_version: SCHEMA_VERSION,
      audit_id: auditId,
      status,
      summary,
      warnings,
      errors: [],
    },
    listItem: {
      audit_id: auditId,
      seller: nullableText(input.seller) || nullableText(input.seller_id) || "Não informado",
      marketplace,
      period,
      status,
      source_rows: sourceRows,
      findings: findings.length,
      total_recoverable: summary.total_recoverable,
      created_at: createdAt,
    },
    findings,
  };
}

async function persistCanonical(env, canonical) {
  const { audit, listItem, findings } = canonical;
  await env.DB.prepare(
    `INSERT OR REPLACE INTO audits
      (audit_id, seller, marketplace, period, status, source_rows, findings,
       total_recoverable, summary_json, warnings_json, errors_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    audit.audit_id,
    listItem.seller,
    listItem.marketplace,
    listItem.period,
    audit.status,
    listItem.source_rows,
    listItem.findings,
    listItem.total_recoverable,
    JSON.stringify(audit.summary),
    JSON.stringify(audit.warnings),
    JSON.stringify(audit.errors),
    listItem.created_at,
  ).run();

  await env.DB.prepare("DELETE FROM evidence WHERE audit_id = ?").bind(audit.audit_id).run();
  await env.DB.prepare("DELETE FROM findings WHERE audit_id = ?").bind(audit.audit_id).run();

  const statements = [];
  for (const finding of findings) {
    statements.push(
      env.DB.prepare(
        `INSERT INTO findings
          (finding_id, audit_id, status, recoverable_amount, payload_json)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(
        finding.finding_id,
        audit.audit_id,
        finding.status,
        finding.recoverable_amount,
        JSON.stringify(finding),
      ),
    );
    for (const item of finding.evidence) {
      statements.push(
        env.DB.prepare(
          `INSERT INTO evidence (evidence_id, audit_id, finding_id, payload_json)
           VALUES (?, ?, ?, ?)`,
        ).bind(item.evidence_id, audit.audit_id, finding.finding_id, JSON.stringify(item)),
      );
    }
  }
  for (let index = 0; index < statements.length; index += 50) {
    await env.DB.batch(statements.slice(index, index + 50));
  }
}

const parseJson = value => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

async function listAudits(env, json) {
  const { results = [] } = await env.DB.prepare(
    `SELECT audit_id, seller, marketplace, period, status, source_rows,
            findings, total_recoverable, created_at
       FROM audits ORDER BY created_at DESC LIMIT 100`,
  ).all();
  return json({ ok: true, schema_version: SCHEMA_VERSION, items: results, next_cursor: null });
}

async function getAudit(env, json, auditId) {
  const row = auditId === "latest"
    ? await env.DB.prepare("SELECT * FROM audits ORDER BY created_at DESC LIMIT 1").first()
    : await env.DB.prepare("SELECT * FROM audits WHERE audit_id = ?").bind(auditId).first();
  if (!row) return apiError(json, 404, "AUDIT_NOT_FOUND", "Auditoria não encontrada.");
  return json({
    ok: true,
    schema_version: SCHEMA_VERSION,
    audit_id: row.audit_id,
    status: row.status,
    summary: parseJson(row.summary_json),
    warnings: parseJson(row.warnings_json) || [],
    errors: parseJson(row.errors_json) || [],
  });
}

async function getFindings(env, json, auditId) {
  if (auditId === "latest") {
    const latest = await env.DB.prepare("SELECT audit_id FROM audits ORDER BY created_at DESC LIMIT 1").first();
    if (!latest) return apiError(json, 404, "AUDIT_NOT_FOUND", "Auditoria não encontrada.");
    auditId = latest.audit_id;
  }
  const { results = [] } = await env.DB.prepare(
    "SELECT payload_json FROM findings WHERE audit_id = ? ORDER BY rowid",
  ).bind(auditId).all();
  return json({
    ok: true,
    schema_version: SCHEMA_VERSION,
    audit_id: auditId,
    items: results.map(row => parseJson(row.payload_json)).filter(Boolean),
    next_cursor: null,
  });
}

async function getEvidence(env, json, auditId) {
  if (auditId === "latest") {
    const latest = await env.DB.prepare("SELECT audit_id FROM audits ORDER BY created_at DESC LIMIT 1").first();
    if (!latest) return apiError(json, 404, "AUDIT_NOT_FOUND", "Auditoria não encontrada.");
    auditId = latest.audit_id;
  }
  const { results = [] } = await env.DB.prepare(
    "SELECT payload_json FROM evidence WHERE audit_id = ? ORDER BY rowid",
  ).bind(auditId).all();
  return json({
    ok: true,
    schema_version: SCHEMA_VERSION,
    finding_id: auditId,
    items: results.map(row => parseJson(row.payload_json)).filter(Boolean),
  });
}

const apiError = (json, status, code, message) =>
  json({ ok: false, schema_version: SCHEMA_VERSION, error: { code, message } }, status);

async function runAudit(request, env, json, auditFull, forcedAuditId) {
  const contentType = request.headers.get("content-type") || "";
  let input;
  try {
    input = contentType.includes("multipart/form-data")
      ? await parseAuditUpload(request)
      : await request.json();
  } catch (error) {
    return apiError(json, 400, "INVALID_UPLOAD", error instanceof Error ? error.message : "Envio inválido.");
  }
  const engineRequest = new Request(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(input),
  });
  const engineResponse = await auditFull(engineRequest, env);
  if (!engineResponse.ok) return engineResponse;
  const payload = await engineResponse.json();
  const canonical = canonicalizeAudit(payload, input, forcedAuditId);
  await persistCanonical(env, canonical);
  return json(canonical.audit);
}

export async function handleV1Request(request, env, url, dependencies) {
  if (!url.pathname.startsWith("/api/v1/audits")) return null;
  const { json, auditFull } = dependencies;
  if (!env.DB) {
    return apiError(json, 503, "STORAGE_UNAVAILABLE", "Armazenamento de homologação indisponível.");
  }

  if (url.pathname === "/api/v1/audits") {
    if (request.method === "GET") return listAudits(env, json);
    if (request.method === "POST") return runAudit(request, env, json, auditFull);
  }

  const match = url.pathname.match(/^\/api\/v1\/audits\/([^/]+)(?:\/(findings|evidence|run))?$/);
  if (!match) return apiError(json, 404, "ENDPOINT_NOT_FOUND", "Endpoint não encontrado.");
  const auditId = decodeURIComponent(match[1]);
  const resource = match[2];
  if (request.method === "GET" && !resource) return getAudit(env, json, auditId);
  if (request.method === "GET" && resource === "findings") return getFindings(env, json, auditId);
  if (request.method === "GET" && resource === "evidence") return getEvidence(env, json, auditId);
  if (request.method === "POST" && resource === "run") {
    return runAudit(request, env, json, auditFull, auditId);
  }
  return apiError(json, 405, "METHOD_NOT_ALLOWED", "Método não permitido.");
}
