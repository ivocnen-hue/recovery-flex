import { parseAuditUpload, parseSingleAuditSource } from "./ingestion.js";
import * as XLSX from "xlsx";

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
    const reconciliationMethod = nullableText(result?.evidence?.reconciliation?.method);
    const canonicalMatchMethod = reconciliationMethod === "unmatched"
      ? null
      : reconciliationMethod || (sourceFiles.length > 1 ? "identifier" : null);
    const evidence = sourceFiles.map((sourceFile, evidenceIndex) => ({
      evidence_id: `${findingId}:evidence:${evidenceIndex + 1}`,
      source_file: String(sourceFile),
      sheet: null,
      row: null,
      original_column: null,
      original_value: null,
      normalized_value: null,
      canonical_field: null,
      match_method: canonicalMatchMethod,
      confidence: nullableNumber(result?.evidence?.reconciliation?.confidence),
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
      items: (Array.isArray(result.items) ? result.items : []).map(item => ({
        sku: nullableText(item?.sku),
        product_name: nullableText(item?.product_name),
        quantity: nullableNumber(item?.quantity),
        source_file: nullableText(item?.source_file),
        source_sheet: nullableText(item?.source_sheet),
        source_row: Number.isInteger(item?.source_row) ? item.source_row : null,
      })),
      quantity: nullableNumber(result.quantity),
      charged_amount: nullableNumber(result.charged_amount),
      expected_amount: nullableNumber(result.expected_amount),
      difference: nullableNumber(result.difference),
      recoverable_amount: nullableNumber(result.recoverable_amount),
      rule_id: nullableText(result.matched_rule_id),
      rule_version: nullableText(result.matched_rule_set?.version || result.matched_rule_set),
      marketplace: nullableText(result.marketplace),
      carrier: nullableText(result.carrier),
      match_method: canonicalMatchMethod,
      confidence: nullableNumber(result?.evidence?.reconciliation?.confidence),
      technical_data: {
        dimensions_raw: nullableText(result?.technical_data?.dimensions_raw),
        height_cm: nullableNumber(result?.technical_data?.height_cm),
        width_cm: nullableNumber(result?.technical_data?.width_cm),
        length_cm: nullableNumber(result?.technical_data?.length_cm),
        weight_g: nullableNumber(result?.technical_data?.weight_g),
        volume_cm3: nullableNumber(result?.technical_data?.volume_cm3),
      },
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
  const channels = Array.isArray(input.channels) && input.channels.length
    ? input.channels.map(String)
    : marketplace.split(",").map(item => item.trim()).filter(Boolean);
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
      operation: nullableText(input.operation || input.logistics_mode),
      carrier: nullableText(input.carrier),
      channels,
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
    `INSERT INTO audits
      (audit_id, seller, marketplace, period, status, source_rows, findings,
       total_recoverable, summary_json, warnings_json, errors_json, created_at,
       operation, carrier, channels_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(audit_id) DO UPDATE SET
       seller = excluded.seller,
       marketplace = excluded.marketplace,
       period = excluded.period,
       status = excluded.status,
       source_rows = excluded.source_rows,
       findings = excluded.findings,
       total_recoverable = excluded.total_recoverable,
       summary_json = excluded.summary_json,
       warnings_json = excluded.warnings_json,
       errors_json = excluded.errors_json,
       created_at = excluded.created_at,
       operation = excluded.operation,
       carrier = excluded.carrier,
       channels_json = excluded.channels_json`,
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
    listItem.operation,
    listItem.carrier,
    JSON.stringify(listItem.channels),
  ).run();

  if (env.SOURCES) {
    await env.SOURCES.put(
      `audit-artifacts/${audit.audit_id}/findings.json`,
      JSON.stringify(findings),
      { httpMetadata: { contentType: "application/json; charset=utf-8" } },
    );
    return;
  }

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

async function loadStoredFindings(env, auditId) {
  if (env.SOURCES) {
    const object = await env.SOURCES.get(`audit-artifacts/${auditId}/findings.json`);
    if (object) {
      const parsed = parseJson(await object.text());
      if (Array.isArray(parsed)) return parsed;
    }
  }
  const { results = [] } = await env.DB.prepare(
    "SELECT payload_json FROM findings WHERE audit_id = ? ORDER BY rowid",
  ).bind(auditId).all();
  return results.map(row => parseJson(row.payload_json)).filter(Boolean);
}

async function listAudits(env, json) {
  const { results = [] } = await env.DB.prepare(
    `SELECT audit_id, seller, marketplace, period, status, source_rows,
            findings, total_recoverable, created_at, operation, carrier, channels_json
       FROM audits ORDER BY created_at DESC LIMIT 100`,
  ).all();
  return json({ ok: true, schema_version: SCHEMA_VERSION, items: results.map(row => ({
    ...row,
    channels: parseJson(row.channels_json) || [row.marketplace],
    channels_json: undefined,
  })), next_cursor: null });
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
    context: {
      seller: row.seller,
      operation: nullableText(row.operation),
      carrier: nullableText(row.carrier),
      channels: parseJson(row.channels_json) || [row.marketplace],
      period: row.period,
      created_at: row.created_at,
    },
  });
}

async function getFindings(env, json, auditId) {
  if (auditId === "latest") {
    const latest = await env.DB.prepare("SELECT audit_id FROM audits ORDER BY created_at DESC LIMIT 1").first();
    if (!latest) return apiError(json, 404, "AUDIT_NOT_FOUND", "Auditoria não encontrada.");
    auditId = latest.audit_id;
  }
  const findings = await loadStoredFindings(env, auditId);
  return json({
    ok: true,
    schema_version: SCHEMA_VERSION,
    audit_id: auditId,
    items: findings,
    next_cursor: null,
  });
}

async function getEvidence(env, json, auditId) {
  if (auditId === "latest") {
    const latest = await env.DB.prepare("SELECT audit_id FROM audits ORDER BY created_at DESC LIMIT 1").first();
    if (!latest) return apiError(json, 404, "AUDIT_NOT_FOUND", "Auditoria não encontrada.");
    auditId = latest.audit_id;
  }
  const items = (await loadStoredFindings(env, auditId))
    .flatMap(finding => Array.isArray(finding.evidence) ? finding.evidence : []);
  return json({
    ok: true,
    schema_version: SCHEMA_VERSION,
    finding_id: auditId,
    items,
  });
}

const excelText = value => value === null || value === undefined ? "" : String(value);

export function buildAuditWorkbook(audit, findings) {
  const workbook = XLSX.utils.book_new();
  workbook.Workbook = { CalcPr: { fullCalcOnLoad: true, forceFullCalc: true, calcMode: "auto" } };
  const skuDisplay = item => {
    const skus = (Array.isArray(item.items) ? item.items : []).map(entry => entry?.sku).filter(Boolean);
    return [...new Set([item.sku, ...skus].filter(Boolean))].join(" | ");
  };
  const detailRows = findings.map(item => [
    item.finding_id,
    item.status,
    excelText(item.marketplace),
    excelText(item.tracking_number),
    excelText(item.order_id),
    excelText(item.shipment_id),
    excelText(skuDisplay(item)),
    item.quantity,
    item.charged_amount,
    item.expected_amount,
    item.difference,
    null,
    item.recoverable_amount,
    null,
    excelText(item.rule_id),
    item.confidence,
    (item.evidence || []).map(evidence => evidence.source_file).filter(Boolean).join(" | "),
    null,
  ]);
  const detailHeader = [
    "Finding ID", "Status", "Canal", "Rastreamento", "Pedido", "Shipment", "SKU",
    "Qtd.", "Cobrado", "Esperado", "Diferença backend", "Diferença verificada",
    "Recuperável backend", "Recuperável verificado", "Regra", "Confiança",
    "Arquivos de evidência", "Controle",
  ];
  const detailSheet = XLSX.utils.aoa_to_sheet([detailHeader, ...detailRows]);
  const lastRow = Math.max(2, detailRows.length + 1);
  for (let row = 2; row <= lastRow; row += 1) {
    const item = findings[row - 2];
    const verifiedDifference = item?.charged_amount == null || item?.expected_amount == null
      ? null
      : Number(item.charged_amount) - Number(item.expected_amount);
    const verifiedRecovery = item?.status === "OVERCHARGED" ? Math.max(0, Number(verifiedDifference || 0)) : 0;
    const differenceOk = item?.difference == null || verifiedDifference == null || Math.abs(Number(item.difference) - verifiedDifference) < 0.01;
    const recoveryOk = item?.recoverable_amount == null || Math.abs(Number(item.recoverable_amount) - verifiedRecovery) < 0.01;
    detailSheet[`L${row}`] = { t: verifiedDifference == null ? "s" : "n", f: `IF(OR(I${row}="",J${row}=""),"",I${row}-J${row})`, v: verifiedDifference ?? "" };
    detailSheet[`N${row}`] = { t: "n", f: `IF(B${row}="OVERCHARGED",MAX(0,L${row}),0)`, v: verifiedRecovery };
    detailSheet[`R${row}`] = { t: "s", f: `IF(AND(OR(K${row}="",ROUND(K${row},2)=ROUND(L${row},2)),OR(M${row}="",ROUND(M${row},2)=ROUND(N${row},2))),"OK","REVISAR")`, v: differenceOk && recoveryOk ? "OK" : "REVISAR" };
  }
  detailSheet["!autofilter"] = { ref: `A1:R${lastRow}` };
  detailSheet["!freeze"] = { xSplit: 0, ySplit: 1 };
  detailSheet["!cols"] = [28,16,18,20,20,20,22,9,14,14,17,18,19,20,25,12,55,14].map(wch => ({ wch }));
  for (const column of ["I", "J", "K", "L", "M", "N"]) {
    for (let row = 2; row <= lastRow; row += 1) if (detailSheet[`${column}${row}`]) detailSheet[`${column}${row}`].z = 'R$ #,##0.00;[Red]-R$ #,##0.00';
  }
  XLSX.utils.book_append_sheet(workbook, detailSheet, "3 Pedidos Auditados");

  const groups = new Map();
  for (const item of findings) {
    const key = skuDisplay(item) || "SEM SKU IDENTIFICADO";
    const group = groups.get(key) || { sku: key, findings: 0, recoverable: 0, units: 0, missingTracking: 0 };
    group.findings += 1;
    group.recoverable += Number(item.recoverable_amount || 0);
    group.units += Number(item.quantity || 0);
    if (!item.tracking_number) group.missingTracking += 1;
    groups.set(key, group);
  }
  const summaryRows = [...groups.values()].sort((a, b) => b.recoverable - a.recoverable).map(group => [
    group.sku, group.findings, group.units, group.recoverable, group.missingTracking,
    group.sku === "SEM SKU IDENTIFICADO" ? "PENDENTE" : "OK",
  ]);
  const summaryTotals = summaryRows.reduce((totals, row) => ({
    findings: totals.findings + Number(row[1] || 0),
    units: totals.units + Number(row[2] || 0),
    recoverable: totals.recoverable + Number(row[3] || 0),
    missingTracking: totals.missingTracking + Number(row[4] || 0),
  }), { findings: 0, units: 0, recoverable: 0, missingTracking: 0 });
  const summarySheet = XLSX.utils.aoa_to_sheet([
    ["DOSSIE DE AUDITORIA — ENVIOS FLEX"],
    [`Auditoria ${audit.audit_id} | ${audit.seller} | ${audit.period}`],
    [],
    ["SKU / Família", "Findings", "Unidades", "Recuperável", "Sem tracking", "Completude"],
    ...summaryRows,
    ["TOTAL", { f: `SUM(B5:B${summaryRows.length + 4})`, v: summaryTotals.findings }, { f: `SUM(C5:C${summaryRows.length + 4})`, v: summaryTotals.units }, { f: `SUM(D5:D${summaryRows.length + 4})`, v: summaryTotals.recoverable }, { f: `SUM(E5:E${summaryRows.length + 4})`, v: summaryTotals.missingTracking }, ""],
  ]);
  summarySheet["!cols"] = [{ wch: 32 }, { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 15 }, { wch: 16 }];
  for (let row = 5; row <= summaryRows.length + 5; row += 1) if (summarySheet[`D${row}`]) summarySheet[`D${row}`].z = 'R$ #,##0.00;[Red]-R$ #,##0.00';
  summarySheet["!freeze"] = { xSplit: 0, ySplit: 4 };
  XLSX.utils.book_append_sheet(workbook, summarySheet, "1 Resumo Executivo");

  const dimensionGroups = new Map();
  for (const item of findings) {
    const technical = item.technical_data || {};
    const maximum = [technical.height_cm, technical.width_cm, technical.length_cm]
      .filter(value => value != null)
      .reduce((max, value) => Math.max(max, Number(value)), 0) || null;
    const displayedSku = skuDisplay(item);
    const key = [displayedSku || "SEM SKU", item.quantity ?? "", technical.dimensions_raw || "", technical.weight_g ?? ""].join("|");
    const group = dimensionGroups.get(key) || {
      sku: displayedSku || "SEM SKU IDENTIFICADO",
      quantity: item.quantity,
      dimensions: technical.dimensions_raw,
      weight: technical.weight_g,
      maximum,
      findings: 0,
    };
    group.findings += 1;
    dimensionGroups.set(key, group);
  }
  const dimensionRows = [...dimensionGroups.values()].map(group => [
    group.sku,
    group.quantity,
    excelText(group.dimensions),
    group.weight,
    group.maximum,
    group.quantity != null && group.quantity <= 3 && group.weight != null && group.weight < 2000 && group.maximum != null && group.maximum <= 80 ? "SIM" : "PENDENTE",
    group.findings,
  ]);
  const dimensionsSheet = XLSX.utils.aoa_to_sheet([
    ["DIMENSOES OBSERVADAS NOS ENVIOS — FLEX"],
    ["Regra auditada: ate 3 unidades, peso menor que 2 kg e maior dimensao de ate 80 cm."],
    [],
    ["SKU", "Qtd. unidades", "Dimensão", "Peso (g)", "Maior dimensão (cm)", "Atende regra?", "Findings"],
    ...dimensionRows,
  ]);
  dimensionsSheet["!autofilter"] = { ref: `A4:G${Math.max(5, dimensionRows.length + 4)}` };
  dimensionsSheet["!freeze"] = { xSplit: 0, ySplit: 4 };
  dimensionsSheet["!cols"] = [{ wch: 30 }, { wch: 15 }, { wch: 30 }, { wch: 14 }, { wch: 22 }, { wch: 18 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(workbook, dimensionsSheet, "2 Dimensoes x Quantidade");

  const evidenceRows = [];
  for (const item of findings) for (const evidence of item.evidence || []) evidenceRows.push([
    item.finding_id, skuDisplay(item), item.tracking_number, evidence.source_file, evidence.sheet,
    evidence.row, evidence.original_column, excelText(evidence.original_value),
    evidence.canonical_field, excelText(evidence.normalized_value), evidence.match_method,
    evidence.confidence, evidence.rule, (evidence.conflicts || []).join(" | "),
  ]);
  const evidenceSheet = XLSX.utils.aoa_to_sheet([["Finding ID", "SKU", "Tracking", "Arquivo fonte", "Aba", "Linha", "Coluna original", "Valor original", "Campo canônico", "Valor normalizado", "Matching", "Confiança", "Regra", "Conflitos"], ...evidenceRows]);
  evidenceSheet["!autofilter"] = { ref: `A1:N${Math.max(2, evidenceRows.length + 1)}` };
  evidenceSheet["!freeze"] = { xSplit: 0, ySplit: 1 };
  evidenceSheet["!cols"] = [28,22,20,48,18,10,22,22,22,22,18,12,28,40].map(wch => ({ wch }));
  XLSX.utils.book_append_sheet(workbook, evidenceSheet, "4 Evidencias");

  const backendRecovery = findings.reduce((total, item) => total + Number(item.recoverable_amount || 0), 0);
  const verifiedRecovery = findings.reduce((total, item) => {
    if (item.status !== "OVERCHARGED" || item.charged_amount == null || item.expected_amount == null) return total;
    return total + Math.max(0, Number(item.charged_amount) - Number(item.expected_amount));
  }, 0);
  const missingSku = findings.filter(item => !skuDisplay(item)).length;
  const missingTracking = findings.filter(item => !item.tracking_number).length;
  const calculationDivergences = findings.filter(item => {
    const difference = item.charged_amount == null || item.expected_amount == null ? null : Number(item.charged_amount) - Number(item.expected_amount);
    const recovery = item.status === "OVERCHARGED" ? Math.max(0, Number(difference || 0)) : 0;
    return (item.difference != null && difference != null && Math.abs(Number(item.difference) - difference) >= 0.01)
      || (item.recoverable_amount != null && Math.abs(Number(item.recoverable_amount) - recovery) >= 0.01);
  }).length;
  const warningCount = Array.isArray(audit.warnings) ? audit.warnings.length : 0;
  const controlStatuses = [
    Math.abs(backendRecovery - Number(audit.total_recoverable || 0)) < 0.01,
    Math.abs(verifiedRecovery - backendRecovery) < 0.01,
    findings.length === Number(audit.findings || findings.length),
    missingSku === 0,
    missingTracking === 0,
    calculationDivergences === 0,
    warningCount === 0,
  ];
  const controls = [
    ["CONTROLES E CONCILIACOES"],
    ["Controle", "Valor apurado", "Valor esperado", "Diferença", "Status", "Observação"],
    ["Total recuperável", { f: `SUM('3 Pedidos Auditados'!M2:M${lastRow})`, v: backendRecovery }, Number(audit.total_recoverable || 0), { f: "=B3-C3", v: backendRecovery - Number(audit.total_recoverable || 0) }, { f: '=IF(ABS(D3)<0.01,"OK","REVISAR")', v: controlStatuses[0] ? "OK" : "REVISAR" }, "Soma dos findings versus resumo do Worker"],
    ["Memória de cálculo", { f: `SUM('3 Pedidos Auditados'!N2:N${lastRow})`, v: verifiedRecovery }, { f: `SUM('3 Pedidos Auditados'!M2:M${lastRow})`, v: backendRecovery }, { f: "=B4-C4", v: verifiedRecovery - backendRecovery }, { f: '=IF(ABS(D4)<0.01,"OK","REVISAR")', v: controlStatuses[1] ? "OK" : "REVISAR" }, "Recálculo cobrado - esperado"],
    ["Findings", findings.length, Number(audit.findings || findings.length), { f: "=B5-C5", v: findings.length - Number(audit.findings || findings.length) }, { f: '=IF(D5=0,"OK","REVISAR")', v: controlStatuses[2] ? "OK" : "REVISAR" }, "Quantidade exportada versus banco"],
    ["SKUs ausentes", { f: `COUNTBLANK('3 Pedidos Auditados'!G2:G${lastRow})`, v: missingSku }, 0, { f: "=B6-C6", v: missingSku }, { f: '=IF(D6=0,"OK","PENDENTE")', v: controlStatuses[3] ? "OK" : "PENDENTE" }, "Todo caso deve identificar SKU"],
    ["Trackings ausentes", { f: `COUNTBLANK('3 Pedidos Auditados'!D2:D${lastRow})`, v: missingTracking }, 0, { f: "=B7-C7", v: missingTracking }, { f: '=IF(D7=0,"OK","PENDENTE")', v: controlStatuses[4] ? "OK" : "PENDENTE" }, "Todo envio deve ser rastreável"],
    ["Cálculos divergentes", { f: `COUNTIF('3 Pedidos Auditados'!R2:R${lastRow},"REVISAR")`, v: calculationDivergences }, 0, { f: "=B8-C8", v: calculationDivergences }, { f: '=IF(D8=0,"OK","REVISAR")', v: controlStatuses[5] ? "OK" : "REVISAR" }, "Diferença e recuperável por linha"],
    ["Alertas do Worker", warningCount, 0, { f: "=B9-C9", v: warningCount }, { f: '=IF(D9=0,"OK","PENDENTE")', v: controlStatuses[6] ? "OK" : "PENDENTE" }, "Alertas de parsing, mapping e contexto"],
    [],
    ["STATUS FINAL", "", "", "", { f: '=IF(COUNTIF(E3:E9,"<>OK")=0,"VERIFICADO","PENDENTE DE REVISAO")', v: controlStatuses.every(Boolean) ? "VERIFICADO" : "PENDENTE DE REVISAO" }, "Só fica verificado quando todos os controles fecham"],
  ];
  const controlsSheet = XLSX.utils.aoa_to_sheet(controls);
  controlsSheet["!cols"] = [{ wch: 27 }, { wch: 18 }, { wch: 18 }, { wch: 14 }, { wch: 24 }, { wch: 55 }];
  for (const row of [3, 4]) for (const column of ["B", "C", "D"]) if (controlsSheet[`${column}${row}`]) controlsSheet[`${column}${row}`].z = 'R$ #,##0.00;[Red]-R$ #,##0.00';
  XLSX.utils.book_append_sheet(workbook, controlsSheet, "5 Controles");
  workbook.SheetNames = ["1 Resumo Executivo", "2 Dimensoes x Quantidade", "3 Pedidos Auditados", "4 Evidencias", "5 Controles"];
  return workbook;
}

async function downloadDossier(env, json, auditId) {
  const audit = await env.DB.prepare("SELECT * FROM audits WHERE audit_id = ?").bind(auditId).first();
  if (!audit) return apiError(json, 404, "AUDIT_NOT_FOUND", "Auditoria não encontrada.");
  const findings = await loadStoredFindings(env, auditId);
  const workbook = buildAuditWorkbook({
    ...audit,
    warnings: parseJson(audit.warnings_json) || [],
  }, findings);
  const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx", compression: true });
  return new Response(bytes, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="dossie-recovery-${auditId}.xlsx"`,
      "Access-Control-Allow-Origin": "*",
    },
  });
}

const apiError = (json, status, code, message) =>
  json({ ok: false, schema_version: SCHEMA_VERSION, error: { code, message } }, status);

export const streamSourcesJson = sources => {
  const encoder = new TextEncoder();
  let sourceIndex = 0;
  let rowIndex = -1;
  return new ReadableStream({
    pull(controller) {
      if (sourceIndex >= sources.length) {
        controller.enqueue(encoder.encode("]"));
        controller.close();
        return;
      }
      const source = sources[sourceIndex];
      if (rowIndex === -1) {
        const metadata = { ...source, rows: undefined };
        const prefix = `${sourceIndex ? "," : "["}${JSON.stringify(metadata).replace(/}$/, ',"rows":[')}`;
        controller.enqueue(encoder.encode(prefix));
        rowIndex = 0;
        return;
      }
      if (rowIndex < source.rows.length) {
        controller.enqueue(encoder.encode(`${rowIndex ? "," : ""}${JSON.stringify(source.rows[rowIndex])}`));
        rowIndex += 1;
        return;
      }
      controller.enqueue(encoder.encode("]}"));
      sourceIndex += 1;
      rowIndex = -1;
    },
  });
};

export const sourcesJsonByteLength = sources => {
  const encoder = new TextEncoder();
  let length = 2;
  for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
    const source = sources[sourceIndex];
    const metadata = { ...source, rows: undefined };
    length += encoder.encode(`${sourceIndex ? "," : ""}${JSON.stringify(metadata).replace(/}$/, ',"rows":[')}`).byteLength;
    for (let rowIndex = 0; rowIndex < source.rows.length; rowIndex += 1) {
      length += encoder.encode(`${rowIndex ? "," : ""}${JSON.stringify(source.rows[rowIndex])}`).byteLength;
    }
    length += 2;
  }
  return length;
};

async function runAudit(request, env, json, auditFull, auditFullInput, forcedAuditId) {
  const contentType = request.headers.get("content-type") || "";
  let input;
  try {
    input = contentType.includes("multipart/form-data")
      ? await parseAuditUpload(request)
      : await request.json();
  } catch (error) {
    return apiError(json, 400, "INVALID_UPLOAD", error instanceof Error ? error.message : "Envio inválido.");
  }
  return executeAudit(request.url, env, json, auditFull, auditFullInput, input, forcedAuditId);
}

async function executeAudit(url, env, json, auditFull, auditFullInput, input, forcedAuditId) {
  const engineResponse = auditFullInput
    ? await auditFullInput(input, env)
    : await auditFull(new Request(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }), env);
  if (!engineResponse.ok) return engineResponse;
  const payload = await engineResponse.json();
  const canonical = canonicalizeAudit(payload, input, forcedAuditId);
  await persistCanonical(env, canonical);
  return json(canonical.audit);
}

const emptySummary = () => ({
  source_rows: 0,
  normalized_rows: 0,
  matched_rows: 0,
  pending_rows: 0,
  overcharged_rows: 0,
  ok_rows: 0,
  missing_charged_amount_rows: 0,
  total_recoverable: 0,
});

async function createDraft(request, env, json) {
  let input;
  try {
    input = await request.json();
  } catch {
    return apiError(json, 400, "INVALID_DRAFT", "Contexto da auditoria inválido.");
  }
  const auditId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const seller = nullableText(input.seller) || "Não informado";
  const marketplace = nullableText(input.marketplace) || "Não informado";
  const channels = Array.isArray(input.channels) && input.channels.length
    ? input.channels.map(String)
    : marketplace.split(",").map(item => item.trim()).filter(Boolean);
  const period = [input.period_start, input.period_end].filter(Boolean).join(" — ") || "Não informado";
  await env.DB.prepare(
    `INSERT INTO audits
      (audit_id, seller, marketplace, period, status, source_rows, findings,
       total_recoverable, summary_json, warnings_json, errors_json, created_at,
       operation, carrier, channels_json)
     VALUES (?, ?, ?, ?, 'UPLOADING', 0, 0, 0, ?, '[]', '[]', ?, ?, ?, ?)`,
  ).bind(
    auditId,
    seller,
    marketplace,
    period,
    JSON.stringify(emptySummary()),
    createdAt,
    nullableText(input.operation),
    nullableText(input.carrier),
    JSON.stringify(channels),
  ).run();
  return json({ ok: true, schema_version: SCHEMA_VERSION, audit_id: auditId, status: "UPLOADING" }, 201);
}

async function uploadSource(request, env, json, auditId) {
  if (!env.SOURCES) return apiError(json, 503, "SOURCE_STORAGE_UNAVAILABLE", "Armazenamento de arquivos indisponível.");
  const audit = await env.DB.prepare("SELECT audit_id FROM audits WHERE audit_id = ?").bind(auditId).first();
  if (!audit) return apiError(json, 404, "AUDIT_NOT_FOUND", "Auditoria não encontrada.");
  let parsed;
  try {
    parsed = await parseSingleAuditSource(request);
  } catch (error) {
    return apiError(json, 400, "INVALID_UPLOAD", error instanceof Error ? error.message : "Envio inválido.");
  }
  const sourceId = crypto.randomUUID();
  const safeName = parsed.file.name.replace(/[^a-zA-Z0-9._-]+/g, "_");
  const rawKey = `audits/${auditId}/raw/${sourceId}-${safeName}`;
  const parsedKey = `audits/${auditId}/parsed/${sourceId}.json`;
  const rowCount = parsed.sources.reduce((total, source) => total + source.rows.length, 0);
  const sheetCount = parsed.kind === "rule" ? 1 : parsed.sources.length;
  await env.SOURCES.put(rawKey, parsed.file.stream(), {
    httpMetadata: { contentType: parsed.file.type || "application/octet-stream" },
    customMetadata: { audit_id: auditId, source_id: sourceId, filename: encodeURIComponent(parsed.file.name) },
  });
  const parsedOptions = {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { audit_id: auditId, source_id: sourceId },
  };
  if (parsed.kind === "rule") {
    await env.SOURCES.put(parsedKey, JSON.stringify(parsed.ruleSets), parsedOptions);
  } else {
    const parsedStream = streamSourcesJson(parsed.sources);
    if (typeof FixedLengthStream === "function") {
      const fixed = new FixedLengthStream(sourcesJsonByteLength(parsed.sources));
      await Promise.all([
        parsedStream.pipeTo(fixed.writable),
        env.SOURCES.put(parsedKey, fixed.readable, parsedOptions),
      ]);
    } else {
      await env.SOURCES.put(parsedKey, parsedStream, parsedOptions);
    }
  }
  await env.DB.prepare(
    `INSERT INTO audit_sources
      (source_id, audit_id, filename, raw_r2_key, parsed_r2_key, source_rows, sheets, created_at, source_kind)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    sourceId,
    auditId,
    parsed.file.name,
    rawKey,
    parsedKey,
    rowCount,
    sheetCount,
    new Date().toISOString(),
    parsed.kind,
  ).run();
  return json({
    ok: true,
    schema_version: SCHEMA_VERSION,
    audit_id: auditId,
    source_id: sourceId,
    filename: parsed.file.name,
    source_rows: rowCount,
    sheets: sheetCount,
  }, 201);
}

async function runStagedAudit(request, env, json, auditFull, auditFullInput, auditId) {
  if (!env.SOURCES) return apiError(json, 503, "SOURCE_STORAGE_UNAVAILABLE", "Armazenamento de arquivos indisponível.");
  const audit = await env.DB.prepare("SELECT * FROM audits WHERE audit_id = ?").bind(auditId).first();
  if (!audit) return apiError(json, 404, "AUDIT_NOT_FOUND", "Auditoria não encontrada.");
  const { results = [] } = await env.DB.prepare(
    "SELECT parsed_r2_key, source_kind FROM audit_sources WHERE audit_id = ? ORDER BY created_at, source_id",
  ).bind(auditId).all();
  if (!results.length) return apiError(json, 400, "NO_SOURCES", "Envie ao menos um arquivo antes de executar a auditoria.");
  await env.DB.prepare("UPDATE audits SET status = 'PROCESSING' WHERE audit_id = ?").bind(auditId).run();
  const sources = [];
  const ruleSets = [];
  try {
    for (const row of results) {
      const object = await env.SOURCES.get(row.parsed_r2_key);
      if (!object) throw new Error("Fonte armazenada não encontrada.");
      const stored = JSON.parse(await object.text());
      if (!Array.isArray(stored)) throw new Error("Fonte armazenada inválida.");
      if (row.source_kind === "rule") ruleSets.push(...stored);
      else sources.push(...stored);
    }
  } catch (error) {
    await env.DB.prepare("UPDATE audits SET status = 'FAILED', errors_json = ? WHERE audit_id = ?")
      .bind(JSON.stringify([error instanceof Error ? error.message : "Falha ao recuperar fontes."]), auditId).run();
    return apiError(json, 500, "SOURCE_READ_FAILED", "Não foi possível recuperar os arquivos enviados.");
  }
  const [periodStart, periodEnd] = String(audit.period).split(" — ");
  return executeAudit(request.url, env, json, auditFull, auditFullInput, {
    seller_id: audit.seller,
    seller: audit.seller,
    marketplace: audit.marketplace,
    channels: parseJson(audit.channels_json) || [audit.marketplace],
    operation: audit.operation,
    carrier: audit.carrier,
    period_start: periodStart === "Não informado" ? "" : periodStart,
    period_end: periodEnd || "",
    sources,
    rule_sources: [],
    rule_sets: ruleSets,
    product_catalog: [],
  }, auditId);
}

export async function handleV1Request(request, env, url, dependencies) {
  if (!url.pathname.startsWith("/api/v1/audits")) return null;
  const { json, auditFull, auditFullInput } = dependencies;
  if (!env.DB) {
    return apiError(json, 503, "STORAGE_UNAVAILABLE", "Armazenamento de homologação indisponível.");
  }

  if (url.pathname === "/api/v1/audits") {
    if (request.method === "GET") return listAudits(env, json);
    if (request.method === "POST") return runAudit(request, env, json, auditFull, auditFullInput);
  }

  if (url.pathname === "/api/v1/audits/drafts" && request.method === "POST") {
    return createDraft(request, env, json);
  }

  const match = url.pathname.match(/^\/api\/v1\/audits\/([^/]+)(?:\/(findings|evidence|sources|run|dossier\.xlsx))?$/);
  if (!match) return apiError(json, 404, "ENDPOINT_NOT_FOUND", "Endpoint não encontrado.");
  const auditId = decodeURIComponent(match[1]);
  const resource = match[2];
  if (request.method === "GET" && !resource) return getAudit(env, json, auditId);
  if (request.method === "GET" && resource === "findings") return getFindings(env, json, auditId);
  if (request.method === "GET" && resource === "evidence") return getEvidence(env, json, auditId);
  if (request.method === "GET" && resource === "dossier.xlsx") return downloadDossier(env, json, auditId);
  if (request.method === "POST" && resource === "sources") return uploadSource(request, env, json, auditId);
  if (request.method === "POST" && resource === "run") {
    return runStagedAudit(request, env, json, auditFull, auditFullInput, auditId);
  }
  return apiError(json, 405, "METHOD_NOT_ALLOWED", "Método não permitido.");
}
