import { handleV1Request } from "./api-v1.js";

// ============================================================
// RECOVERY AUDIT ENGINE
// Cloudflare Worker
// Version 0.5.1
// ============================================================

const VERSION = "0.5.1";

// ============================================================
// CORS / RESPONSE
// ============================================================

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data, null, 2),
    {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        ...CORS_HEADERS
      }
    }
  );
}

// ============================================================
// BASIC HELPERS
// ============================================================

function safeNumber(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value)
      ? value
      : null;
  }

  let text = String(value)
    .trim()
    .replace(/\s/g, "")
    .replace(/R\$/gi, "");

  if (!text) {
    return null;
  }

  if (
    text.includes(",") &&
    text.includes(".")
  ) {
    if (
      text.lastIndexOf(",") >
      text.lastIndexOf(".")
    ) {
      text = text
        .replace(/\./g, "")
        .replace(",", ".");
    } else {
      text = text.replace(/,/g, "");
    }
  } else if (text.includes(",")) {
    text = text.replace(",", ".");
  }

  text = text.replace(
    /[^0-9.-]/g,
    ""
  );

  const number =
    Number(text);

  return Number.isFinite(number)
    ? number
    : null;
}

function normalizeText(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return null;
  }

  const text =
    String(value).trim();

  return text || null;
}

function comparableText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(
      /[\u0300-\u036f]/g,
      ""
    )
    .trim()
    .toLowerCase();
}

function firstDefined(...values) {
  for (const value of values) {
    if (
      value !== undefined &&
      value !== null &&
      value !== ""
    ) {
      return value;
    }
  }

  return null;
}

function calculateVolumeCm3(
  height,
  width,
  length
) {
  const h =
    safeNumber(height);

  const w =
    safeNumber(width);

  const l =
    safeNumber(length);

  if (
    h === null ||
    w === null ||
    l === null
  ) {
    return null;
  }

  return h * w * l;
}

// ============================================================
// COMPOSITE DIMENSION PARSER
//
// Examples:
//
// 8.0x15.0x37.0,160.0
// 8 x 15 x 37, 160g
// 8x15x37 0.16kg
// 8×15×37;160
// ============================================================

function parseCompositeDimensions(
  value
) {
  const empty = {
    height_cm: null,
    width_cm: null,
    length_cm: null,
    weight_g: null
  };

  if (
    value === null ||
    value === undefined
  ) {
    return empty;
  }

  const text =
    String(value).trim();

  if (!text) {
    return empty;
  }

  const dimMatch =
    text.match(
      /(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)/i
    );

  if (!dimMatch) {
    return empty;
  }

  const height =
    safeNumber(
      dimMatch[1]
    );

  const width =
    safeNumber(
      dimMatch[2]
    );

  const length =
    safeNumber(
      dimMatch[3]
    );

  const endIndex =
    (dimMatch.index || 0) +
    dimMatch[0].length;

  const trailing =
    text.slice(endIndex);

  let weight = null;

  // Explicit kilograms
  const kgMatch =
    trailing.match(
      /(\d+(?:[.,]\d+)?)\s*kg\b/i
    );

  // Explicit grams
  const gMatch =
    trailing.match(
      /(\d+(?:[.,]\d+)?)\s*g\b/i
    );

  if (kgMatch) {
    const kg =
      safeNumber(
        kgMatch[1]
      );

    if (kg !== null) {
      weight = kg * 1000;
    }
  }

  else if (gMatch) {
    weight =
      safeNumber(
        gMatch[1]
      );
  }

  else {
    // Historical Prospecta/Flex pattern:
    // 8.0x15.0x37.0,160.0
    const rawTrailing =
      trailing.match(
        /[,;]\s*(\d+(?:[.,]\d+)?)/
      );

    if (rawTrailing) {
      weight =
        safeNumber(
          rawTrailing[1]
        );
    }
  }

  return {
    height_cm:
      height,

    width_cm:
      width,

    length_cm:
      length,

    weight_g:
      weight
  };
}

// ============================================================
// OPENAI
// ============================================================

async function askAI(
  env,
  instructions,
  payload
) {
  if (!env.OPENAI_API_KEY) {
    throw new Error(
      "OPENAI_API_KEY não configurada."
    );
  }

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () =>
        controller.abort(),
      150000
    );

  try {
    const response =
      await fetch(
        "https://api.openai.com/v1/responses",
        {
          method: "POST",

          signal:
            controller.signal,

          headers: {
            "Authorization":
              `Bearer ${env.OPENAI_API_KEY}`,

            "Content-Type":
              "application/json"
          },

          body:
            JSON.stringify({
              model:
                env.OPENAI_MODEL ||
                "gpt-5.6",

              instructions,

              input:
                JSON.stringify(
                  payload
                )
            })
        }
      );

    const raw =
      await response.text();

    if (!response.ok) {
      throw new Error(
        `OpenAI HTTP ${response.status}: ${raw.slice(0, 1500)}`
      );
    }

    let data;

    try {
      data =
        JSON.parse(raw);
    } catch {
      throw new Error(
        "Resposta HTTP da OpenAI não era JSON."
      );
    }

    let outputText = "";

    if (
      typeof data.output_text ===
      "string"
    ) {
      outputText =
        data.output_text;
    }

    if (!outputText) {
      for (
        const item
        of data.output || []
      ) {
        for (
          const content
          of item.content || []
        ) {
          if (
            typeof content.text ===
            "string"
          ) {
            outputText =
              content.text;

            break;
          }
        }

        if (outputText) {
          break;
        }
      }
    }

    if (!outputText) {
      throw new Error(
        "OpenAI retornou resposta vazia."
      );
    }

    outputText =
      outputText
        .replace(
          /^```json\s*/i,
          ""
        )
        .replace(
          /^```\s*/i,
          ""
        )
        .replace(
          /```$/i,
          ""
        )
        .trim();

    try {
      return JSON.parse(
        outputText
      );
    } catch {
      throw new Error(
        "IA respondeu, mas o conteúdo não era JSON válido."
      );
    }
  }

  finally {
    clearTimeout(timeout);
  }
}

// ============================================================
// SOURCE NORMALIZATION
// ============================================================

function splitDelimitedRecord(value, delimiter) {
  const cells = [];
  let current = "";
  let quoted = false;
  const text = String(value ?? "");
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  cells.push(current.trim());
  return cells;
}

function likelyDelimiter(records) {
  const delimiters = [";", "\t", ","];
  return delimiters
    .map(delimiter => ({
      delimiter,
      score: records.reduce((total, record) => total + Math.max(0, splitDelimitedRecord(record, delimiter).length - 1), 0)
    }))
    .sort((a, b) => b.score - a.score)[0];
}

export function repairStoredTabularLayout(headersInput, rowsInput) {
  let headers = [...headersInput];
  let rows = rowsInput.map(row => Array.isArray(row) ? [...row] : [row]);
  const isEffectiveSingleCell = row => typeof row[0] === "string" && row.slice(1).every(value => !normalizeText(value));
  const singleCellRecords = rows.filter(isEffectiveSingleCell).slice(0, 20).map(row => row[0]);
  if (singleCellRecords.length >= Math.max(2, Math.ceil(Math.min(rows.length, 20) * 0.6))) {
    const detected = likelyDelimiter(singleCellRecords);
    if (detected?.score > 0) rows = rows.map(row => isEffectiveSingleCell(row) ? splitDelimitedRecord(row[0], detected.delimiter) : row);
  }
  if (headers.length === 1 && typeof headers[0] === "string") {
    const detected = likelyDelimiter([headers[0], ...singleCellRecords.slice(0, 5)]);
    if (detected?.score > 0) headers = splitDelimitedRecord(headers[0], detected.delimiter);
  }

  const genericHeaders = headers.filter(header => {
    const comparable = comparableText(header);
    return !comparable || comparable.startsWith("coluna_") || comparable.length > 80;
  }).length;
  if (headers.length >= 8 && genericHeaders / headers.length >= 0.6) {
    const embeddedHeaderIndex = rows.slice(0, 12).findIndex(row => {
      const names = row.map(comparableText);
      const nonEmpty = names.filter(Boolean).length;
      return nonEmpty >= 8
        && names.some(name => name === "sku")
        && names.some(name => name.includes("rastreamento"))
        && names.some(name => name === "unidades" || name === "quantidade");
    });
    if (embeddedHeaderIndex >= 0) {
      headers = rows[embeddedHeaderIndex].map((value, index) => normalizeText(value) || `coluna_${index + 1}`);
      rows = rows.slice(embeddedHeaderIndex + 1);
    }
  }

  const inspectedRows = rows.slice(0, 100).filter(row => row.some(value => normalizeText(value)));
  const extraColumnRows = inspectedRows.filter(row => row.length === headers.length + 1).length;
  const accountIndex = headers.findIndex(header => comparableText(header) === "conta");
  if (accountIndex >= 0 && inspectedRows.length && extraColumnRows / inspectedRows.length >= 0.6) {
    headers.splice(accountIndex + 1, 0, "Conta empresarial");
  }
  return { headers, rows };
}

function normalizeSource(
  source = {}
) {
  const repaired = repairStoredTabularLayout(
    Array.isArray(source.headers) ? source.headers : [],
    Array.isArray(source.rows) ? source.rows : []
  );
  return {
    filename:
      source.filename ||
      source.name ||
      "arquivo_sem_nome",

    sheet:
      source.sheet ||
      source.tab ||
      null,

    context:
      source.context &&
      typeof source.context ===
        "object"
        ? source.context
        : {},

    headers:
      repaired.headers,

    rows:
      repaired.rows
  };
}

// ============================================================
// AI MAPPER
// ============================================================

async function mapSourceWithAI(
  env,
  rawSource,
  sellerId
) {
  const source =
    normalizeSource(
      rawSource
    );

  if (
    !source.headers.length
  ) {
    throw new Error(
      `Fonte ${source.filename} sem headers.`
    );
  }

  const instructions = `
Você é o AI Mapper do Recovery.

Recovery é um sistema de auditoria financeira e logística
para marketplaces, operadores logísticos e sellers.

NÃO EXISTE UM LAYOUT UNIVERSAL.

Você poderá receber arquivos de:

- Mercado Livre Flex
- Mercado Livre Full
- Mercado Livre vendas
- Mercado Envios
- Shopee
- Amazon
- Magalu
- transportadoras
- operadores Flex independentes
- arquivos internos do seller
- catálogo técnico de produtos
- relatórios logísticos

Empresas diferentes podem usar nomes completamente diferentes
para a mesma informação.

Analise conjuntamente:

1. nome do arquivo
2. aba
3. cabeçalhos
4. exemplos das linhas
5. seller
6. contexto declarado
7. padrão dos valores

Não faça correspondência apenas pelo texto do cabeçalho.

Campos canônicos:

tracking_number
order_id
shipment_id
pack_id
sku
quantity
charged_amount
sale_amount
height_cm
width_cm
length_cm
weight_g
dimensions
account_id
postal_code
event_date
product_name

Também identifique:

file_type
marketplace
logistics_mode
carrier

SIGNIFICADOS:

charged_amount =
valor efetivamente cobrado do seller pela logística/frete.

Não confundir com:
- preço da venda
- receita
- comissão
- desconto
- subsídio
- valor líquido

sale_amount =
preço/valor da venda.

tracking_number =
rastreamento, etiqueta ou identificador logístico equivalente.

sku =
referência/código do produto.

quantity =
quantidade de unidades.

dimensions =
coluna composta contendo dimensões e eventualmente peso.

Exemplo:
8.0x15.0x37.0,160.0

Neste caso mapeie a coluna para dimensions.
O código do Recovery fará a separação das medidas e peso.

Nunca invente coluna.

Se não houver evidência suficiente:
column = null
index = -1

Retorne SOMENTE JSON válido:

{
  "file_type": null,
  "marketplace": null,
  "logistics_mode": null,
  "carrier": null,

  "mapping": {

    "tracking_number": {
      "column": null,
      "index": -1,
      "confidence": 0,
      "reason": ""
    },

    "order_id": {
      "column": null,
      "index": -1,
      "confidence": 0,
      "reason": ""
    },

    "shipment_id": {
      "column": null,
      "index": -1,
      "confidence": 0,
      "reason": ""
    },

    "pack_id": {
      "column": null,
      "index": -1,
      "confidence": 0,
      "reason": ""
    },

    "sku": {
      "column": null,
      "index": -1,
      "confidence": 0,
      "reason": ""
    },

    "quantity": {
      "column": null,
      "index": -1,
      "confidence": 0,
      "reason": ""
    },

    "charged_amount": {
      "column": null,
      "index": -1,
      "confidence": 0,
      "reason": ""
    },

    "sale_amount": {
      "column": null,
      "index": -1,
      "confidence": 0,
      "reason": ""
    },

    "height_cm": {
      "column": null,
      "index": -1,
      "confidence": 0,
      "reason": ""
    },

    "width_cm": {
      "column": null,
      "index": -1,
      "confidence": 0,
      "reason": ""
    },

    "length_cm": {
      "column": null,
      "index": -1,
      "confidence": 0,
      "reason": ""
    },

    "weight_g": {
      "column": null,
      "index": -1,
      "confidence": 0,
      "reason": ""
    },

    "dimensions": {
      "column": null,
      "index": -1,
      "confidence": 0,
      "reason": ""
    },

    "account_id": {
      "column": null,
      "index": -1,
      "confidence": 0,
      "reason": ""
    },

    "postal_code": {
      "column": null,
      "index": -1,
      "confidence": 0,
      "reason": ""
    },

    "event_date": {
      "column": null,
      "index": -1,
      "confidence": 0,
      "reason": ""
    },

    "product_name": {
      "column": null,
      "index": -1,
      "confidence": 0,
      "reason": ""
    }
  },

  "warnings": []
}

`;

  const payload = {
    seller_id:
      sellerId || null,

    filename:
      source.filename,

    sheet:
      source.sheet,

    declared_context:
      source.context,

    headers:
      source.headers,

    sample_rows:
      source.rows.slice(
        0,
        20
      )
  };

  const result =
    await askAI(
      env,
      instructions,
      payload
    );

  result.marketplace =
    result.marketplace ||
    source.context.marketplace ||
    null;

  result.logistics_mode =
    result.logistics_mode ||
    source.context.logistics_mode ||
    null;

  result.carrier =
    result.carrier ||
    source.context.carrier ||
    null;

  // ----------------------------------------------------------
  // Validate AI indices against real headers.
  // AI cannot invent columns.
  // ----------------------------------------------------------

  const mapping =
    result.mapping || {};

  for (
    const field
    of [
      "tracking_number",
      "order_id",
      "shipment_id",
      "pack_id",
      "sku",
      "quantity",
      "charged_amount",
      "sale_amount",
      "height_cm",
      "width_cm",
      "length_cm",
      "weight_g",
      "dimensions",
      "account_id",
      "postal_code",
      "event_date",
      "product_name"
    ]
  ) {
    const item =
      mapping[field];

    if (!item) {
      mapping[field] = {
        column: null,
        index: -1,
        confidence: 0,
        reason:
          "Campo não retornado pela IA."
      };

      continue;
    }

    if (
      typeof item.column !==
        "string" ||
      !item.column.trim()
    ) {
      mapping[field] = {
        ...item,
        column: null,
        index: -1
      };

      continue;
    }

    const actualIndex =
      source.headers.findIndex(
        header =>
          comparableText(
            header
          ) ===
          comparableText(
            item.column
          )
      );

    if (actualIndex < 0) {
      mapping[field] = {
        column: null,
        index: -1,
        confidence: 0,
        reason:
          "IA indicou uma coluna inexistente; associação rejeitada."
      };
    }

    else {
      mapping[field] = {
        ...item,
        column:
          source.headers[
            actualIndex
          ],
        index:
          actualIndex
      };
    }
  }

  result.mapping =
    mapping;

  return {
    source,
    mapper:
      result
  };
}

export function sourceMappingKey(rawSource, sellerId) {
  const source = normalizeSource(rawSource);
  return JSON.stringify({
    mapping_contract_version: 2,
    seller_id: normalizeText(sellerId),
    headers: source.headers.map(comparableText),
    context: {
      marketplace: comparableText(source.context.marketplace),
      logistics_mode: comparableText(source.context.logistics_mode),
      carrier: comparableText(source.context.carrier)
    }
  });
}

// ============================================================
// RULE PARSER
// ============================================================

export async function parseRuleSourceWithAI(
  env,
  source,
  sellerId
) {
  const rawContent =
    firstDefined(
      source?.content,
      source?.text,
      source?.body
    );

  const content =
    typeof rawContent ===
      "string"
      ? rawContent.trim()
      : rawContent
      ? JSON.stringify(
          rawContent
        )
      : "";

  const sourceName =
    firstDefined(
      source?.source_name,
      source?.filename,
      source?.name,
      "Regra"
    );

  const sourceType =
    firstDefined(
      source?.source_type,
      source?.type,
      "document"
    );

  const context =
    source?.context &&
    typeof source.context ===
      "object"
      ? source.context
      : {};

  if (!content) {
    return {
      rule_set: {
        name:
          sourceName,

        marketplace:
          context.marketplace ||
          null,

        logistics_mode:
          context.logistics_mode ||
          null,

        carrier:
          context.carrier ||
          null,

        seller_id:
          sellerId ||
          null,

        valid_from:
          null,

        valid_to:
          null,

        rules:
          []
      },

      ambiguities: [
        "Fonte de regra sem conteúdo."
      ],

      warnings:
        []
    };
  }

  const instructions = `
Você é o Rule Interpreter do Recovery.

Transforme:
- contratos
- tabelas tarifárias
- regulamentos
- regras manuais
- regras de marketplaces
- regras de operadores logísticos

em regras estruturadas.

NUNCA presuma que uma regra de um seller,
marketplace, transportadora, modalidade ou período
vale para outro.

O campo context.rule_clarifications contém respostas fornecidas
explicitamente pelo usuário após a primeira análise. Use essas respostas
para resolver as dúvidas correspondentes, mas nunca permita que elas
inventem ou substituam tarifas e valores ausentes no documento.

Uma regra pode depender de:

seller_id
marketplace
logistics_mode
carrier
quantity
sale_amount
weight_g
height_cm
width_cm
length_cm
volume_cm3
sku
date

Operadores:

eq
neq
gt
gte
lt
lte
between
in

Cálculos suportados nesta versão:

fixed
per_unit
percentage

Se a fonte tiver regra mais complexa,
como uma tabela ou matriz tarifária, expanda cada linha/faixa
determinística em uma regra separada usando as condições acima.
Converta unidades explicitamente (kg para g; m para cm), sem arredondar.
Preserve exceções como regras de maior prioridade.
Se uma célula, cabeçalho, unidade, vigência, escopo ou valor necessário
não estiver legível, ou se faixas se sobrepuserem com valores conflitantes,
NÃO invente cálculo e registre em ambiguities.

Registre em ambiguities.

NUNCA invente:
- tarifa
- vigência
- faixa
- peso
- dimensão
- marketplace
- carrier
- seller

Retorne SOMENTE JSON válido:

{
  "rule_set": {
    "name": "",
    "marketplace": null,
    "logistics_mode": null,
    "carrier": null,
    "seller_id": null,
    "valid_from": null,
    "valid_to": null,

    "rules": [
      {
        "id": "",
        "description": "",
        "priority": 0,

        "conditions": [
          {
            "field": "",
            "op": "",
            "value": null,
            "min": null,
            "max": null
          }
        ],

        "calculation": {
          "type": "",
          "amount": null,
          "rate": null,
          "base_field": null
        },

        "source_reference": ""
      }
    ]
  },

  "ambiguities": [],
  "warnings": []
}
`;

  const parsed =
    await askAI(
      env,
      instructions,
      {
        seller_id:
          sellerId || null,

        source_type:
          sourceType,

        source_name:
          sourceName,

        content,

        context
      }
    );

  if (!parsed?.rule_set) {
    throw new Error(
      "Rule Interpreter não retornou rule_set."
    );
  }

  parsed.rule_set.name =
    parsed.rule_set.name ||
    sourceName;

  parsed.rule_set.seller_id =
    parsed.rule_set.seller_id ||
    sellerId ||
    null;

  parsed.rule_set.marketplace =
    parsed.rule_set.marketplace ||
    context.marketplace ||
    null;

  parsed.rule_set.logistics_mode =
    parsed.rule_set.logistics_mode ||
    context.logistics_mode ||
    null;

  parsed.rule_set.carrier =
    parsed.rule_set.carrier ||
    context.carrier ||
    null;

  parsed.rule_set.rules =
    Array.isArray(
      parsed.rule_set.rules
    )
      ? parsed.rule_set.rules
      : [];

  const allowedFields = new Set([
    "seller_id", "marketplace", "logistics_mode", "carrier", "quantity",
    "sale_amount", "weight_g", "height_cm", "width_cm", "length_cm",
    "max_dimension_cm", "volume_cm3", "sku", "date",
  ]);
  const allowedOps = new Set(["eq", "neq", "gt", "gte", "lt", "lte", "between", "in"]);
  const allowedCalculations = new Set(["fixed", "per_unit", "percentage"]);
  const numericFields = new Set([
    "quantity", "sale_amount", "weight_g", "height_cm", "width_cm",
    "length_cm", "max_dimension_cm", "volume_cm3",
  ]);
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`));
  const validationAmbiguities = [];
  parsed.rule_set.rules = parsed.rule_set.rules.filter((rule, index) => {
    const conditions = Array.isArray(rule?.conditions) ? rule.conditions : [];
    const calculation = rule?.calculation;
    const validConditions = conditions.every(condition => {
      if (!allowedFields.has(condition?.field) || !allowedOps.has(condition?.op)) return false;
      if (condition.op === "between") {
        if (condition.field === "date") {
          return validDate(condition.min) && validDate(condition.max) &&
            String(condition.min) <= String(condition.max);
        }
        return condition.min !== null && condition.min !== undefined && condition.min !== "" &&
          condition.max !== null && condition.max !== undefined && condition.max !== "" &&
          Number.isFinite(Number(condition.min)) && Number.isFinite(Number(condition.max)) &&
          Number(condition.min) <= Number(condition.max);
      }
      if (condition.op === "in") return Array.isArray(condition.value) && condition.value.length > 0;
      if (condition.value === null || condition.value === undefined || condition.value === "") return false;
      if (condition.field === "date" && ["gt", "gte", "lt", "lte"].includes(condition.op)) {
        return validDate(condition.value);
      }
      return !numericFields.has(condition.field) || Number.isFinite(Number(condition.value));
    });
    const validCalculation = allowedCalculations.has(calculation?.type) && (
      calculation.type === "percentage"
        ? Number.isFinite(Number(calculation.rate)) && allowedFields.has(calculation.base_field || "sale_amount")
        : Number.isFinite(Number(calculation.amount))
    );
    if (!validConditions || !validCalculation) {
      validationAmbiguities.push(`Regra ${rule?.id || index + 1} fora do contrato executável seguro.`);
      return false;
    }
    rule.id = String(rule.id || `regra_${index + 1}`);
    rule.priority = Number.isFinite(Number(rule.priority)) ? Number(rule.priority) : 0;
    rule.source_reference = String(rule.source_reference || sourceName);
    return true;
  });

  parsed.ambiguities =
    Array.isArray(
      parsed.ambiguities
    )
      ? parsed.ambiguities
      : [];
  parsed.ambiguities.push(...validationAmbiguities);

  parsed.warnings =
    Array.isArray(
      parsed.warnings
    )
      ? parsed.warnings
      : [];

  return parsed;
}

// ============================================================
// FIELD EXTRACTION
// ============================================================

function fieldFromMapping(
  rawRow,
  mapping,
  field
) {
  const item =
    mapping?.[field];

  if (!item) {
    return null;
  }

  const index =
    Number(
      item.index
    );

  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= rawRow.length
  ) {
    return null;
  }

  return rawRow[index];
}

const HEADER_ALIASES = {
  tracking_number: ["tracking", "rastreio", "rastreamento", "codigo de rastreio", "codigo rastreio", "etiqueta", "id etiqueta", "numero de rastreamento"],
  order_id: ["pedido", "numero do pedido", "id pedido", "id do pedido", "n.º de venda", "n. de venda", "order id", "order_id"],
  shipment_id: ["envio", "id envio", "shipment", "shipment id", "shipment_id"],
  pack_id: ["pack", "pack id", "pack_id"],
  sku: ["sku", "codigo sku", "referencia", "seller sku"],
  quantity: ["quantidade", "qtd", "quantity", "unidades"],
  charged_amount: ["valor cobrado", "cobranca", "cobrado", "frete cobrado", "charged amount"],
  sale_amount: ["valor venda", "preco venda", "sale amount"],
  dimensions: ["dimensoes", "dimensao", "dimensoes do(s) produto(s)", "medidas", "dimensions"],
  height_cm: ["altura", "altura cm", "height"],
  width_cm: ["largura", "largura cm", "width"],
  length_cm: ["comprimento", "comprimento cm", "length"],
  weight_g: ["peso", "peso g", "peso gramas", "weight"],
  account_id: ["conta", "conta seller", "seller", "seller id", "loja"],
  postal_code: ["cep", "codigo postal", "postal code", "zip code"],
  event_date: ["data", "data envio", "data entrega", "date"],
  product_name: ["produto", "nome do produto", "titulo produto", "titulo do anuncio", "descricao produto", "item", "product"]
};

function mappingWithHeaderFallback(mapping, headers) {
  const out = { ...(mapping || {}) };
  const comparableHeaders = headers.map(comparableText);

  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    if (Number.isInteger(Number(out[field]?.index)) && Number(out[field].index) >= 0) continue;
    const index = comparableHeaders.findIndex(header => aliases.some(alias => header === comparableText(alias)));
    if (index >= 0) {
      out[field] = {
        column: headers[index],
        index,
        confidence: 0.9,
        reason: "Associação determinística por cabeçalho conhecido."
      };
    }
  }

  return out;
}

// ============================================================
// CANONICAL ROW
// ============================================================

function canonicalRowFromSource(
  rawRow,
  mappedSource,
  sellerId
) {
  const mapping =
    mappingWithHeaderFallback(
      mappedSource.mapper.mapping || {},
      mappedSource.source.headers || []
    );

  const source =
    mappedSource.source;

  const context =
    mappedSource.mapper;

  const row = {
    seller_id:
      sellerId || null,

    source_file:
      source.filename,

    source_sheet:
      source.sheet,

    source_type:
      context.file_type ||
      null,

    marketplace:
      context.marketplace ||
      null,

    logistics_mode:
      context.logistics_mode ||
      null,

    carrier:
      context.carrier ||
      null,

    tracking_number:
      normalizeText(
        fieldFromMapping(
          rawRow,
          mapping,
          "tracking_number"
        )
      ),

    order_id:
      normalizeText(
        fieldFromMapping(
          rawRow,
          mapping,
          "order_id"
        )
      ),

    shipment_id:
      normalizeText(
        fieldFromMapping(
          rawRow,
          mapping,
          "shipment_id"
        )
      ),

    pack_id:
      normalizeText(
        fieldFromMapping(
          rawRow,
          mapping,
          "pack_id"
        )
      ),

    sku:
      normalizeText(
        fieldFromMapping(
          rawRow,
          mapping,
          "sku"
        )
      ),

    account_id:
      normalizeText(fieldFromMapping(rawRow, mapping, "account_id")),

    postal_code:
      normalizeText(fieldFromMapping(rawRow, mapping, "postal_code")),

    event_date:
      normalizeText(fieldFromMapping(rawRow, mapping, "event_date")),

    product_name:
      normalizeText(fieldFromMapping(rawRow, mapping, "product_name")),

    quantity:
      safeNumber(
        fieldFromMapping(
          rawRow,
          mapping,
          "quantity"
        )
      ),

    charged_amount:
      safeNumber(
        fieldFromMapping(
          rawRow,
          mapping,
          "charged_amount"
        )
      ),

    sale_amount:
      safeNumber(
        fieldFromMapping(
          rawRow,
          mapping,
          "sale_amount"
        )
      ),

    height_cm:
      safeNumber(
        fieldFromMapping(
          rawRow,
          mapping,
          "height_cm"
        )
      ),

    width_cm:
      safeNumber(
        fieldFromMapping(
          rawRow,
          mapping,
          "width_cm"
        )
      ),

    length_cm:
      safeNumber(
        fieldFromMapping(
          rawRow,
          mapping,
          "length_cm"
        )
      ),

    weight_g:
      safeNumber(
        fieldFromMapping(
          rawRow,
          mapping,
          "weight_g"
        )
      ),

    dimensions_raw:
      normalizeText(
        fieldFromMapping(
          rawRow,
          mapping,
          "dimensions"
        )
      )
  };

  // ----------------------------------------------------------
  // Composite dimension fallback
  // ----------------------------------------------------------

  const composite =
    parseCompositeDimensions(
      row.dimensions_raw
    );

  if (
    row.height_cm === null &&
    composite.height_cm !==
      null
  ) {
    row.height_cm =
      composite.height_cm;
  }

  if (
    row.width_cm === null &&
    composite.width_cm !==
      null
  ) {
    row.width_cm =
      composite.width_cm;
  }

  if (
    row.length_cm === null &&
    composite.length_cm !==
      null
  ) {
    row.length_cm =
      composite.length_cm;
  }

  if (
    row.weight_g === null &&
    composite.weight_g !==
      null
  ) {
    row.weight_g =
      composite.weight_g;
  }

  const weightHeader = comparableText(mapping.weight_g?.column);
  if (row.weight_g !== null && weightHeader.includes("peso total sku") && row.weight_g < 100) {
    row.weight_g *= 1000;
  }

  row.volume_cm3 =
    calculateVolumeCm3(
      row.height_cm,
      row.width_cm,
      row.length_cm
    );

  const dimensions = [row.height_cm, row.width_cm, row.length_cm].filter(value => safeNumber(value) !== null).map(Number);
  row.max_dimension_cm = dimensions.length ? Math.max(...dimensions) : null;

  return row;
}

// ============================================================
// IDENTIFIERS / RECONCILIATION
// ============================================================

function identifierKeys(row) {
  const keys = [];

  for (
    const field
    of [
      "tracking_number",
      "order_id",
      "shipment_id",
      "pack_id"
    ]
  ) {
    const value =
      normalizeText(
        row[field]
      );

    if (value) {
      keys.push(
        `${field}:${value.toLowerCase()}`
      );
    }
  }

  return keys;
}

function mergeRows(
  primary,
  secondary
) {
  const out = {
    ...primary
  };

  const protectedFields =
    new Set([
      "charged_amount",
      "source_file",
      "source_sheet",
      "source_type"
    ]);

  for (
    const [key, value]
    of Object.entries(
      secondary || {}
    )
  ) {
    if (
      protectedFields.has(key)
    ) {
      continue;
    }

    if (
      (
        out[key] === null ||
        out[key] === undefined ||
        out[key] === ""
      ) &&
      value !== null &&
      value !== undefined &&
      value !== ""
    ) {
      out[key] =
        value;
    }
  }

  const sources =
    new Set();

  for (
    const item
    of [
      ...(Array.isArray(
        primary.matched_sources
      )
        ? primary.matched_sources
        : [
            primary.source_file
          ]),
      secondary?.source_file
    ]
  ) {
    if (item) {
      sources.add(item);
    }
  }

  out.matched_sources =
    [...sources];

  return out;
}

function normalizedComparable(value) {
  return comparableText(value).replace(/[^a-z0-9]/g, "");
}

function sortedDimensions(row) {
  const dimensions = [row.height_cm, row.width_cm, row.length_cm].map(safeNumber);
  return dimensions.every(value => value !== null) ? dimensions.sort((a, b) => a - b) : null;
}

function dimensionsMatch(first, second) {
  const a = sortedDimensions(first);
  const b = sortedDimensions(second);
  if (!a || !b) return false;
  return a.every((value, index) => Math.abs(value - b[index]) <= Math.max(2, value * 0.05));
}

function weightMatches(first, second) {
  const a = safeNumber(first.weight_g);
  const b = safeNumber(second.weight_g);
  return a !== null && b !== null && Math.abs(a - b) <= Math.max(100, a * 0.1);
}

function dateDistanceDays(first, second) {
  const a = Date.parse(first || "");
  const b = Date.parse(second || "");
  return Number.isFinite(a) && Number.isFinite(b) ? Math.abs(a - b) / 86400000 : null;
}

function scoreCandidate(charge, candidate) {
  let score = 0;
  const signals = [];
  const identifiers = [
    ["tracking_number", 100], ["order_id", 95], ["shipment_id", 90], ["pack_id", 85]
  ];
  for (const [field, points] of identifiers) {
    const left = normalizedComparable(charge[field]);
    const right = normalizedComparable(candidate[field]);
    if (left && right && left === right) {
      score += points;
      signals.push(field);
    }
  }
  if (normalizedComparable(charge.account_id) && normalizedComparable(charge.account_id) === normalizedComparable(candidate.account_id)) {
    score += 15;
    signals.push("account_id");
  }
  if (normalizedComparable(charge.postal_code) && normalizedComparable(charge.postal_code) === normalizedComparable(candidate.postal_code)) {
    score += 15;
    signals.push("postal_code");
  }
  const dateDistance = dateDistanceDays(charge.event_date, candidate.event_date);
  if (dateDistance !== null && dateDistance <= 2) {
    score += dateDistance === 0 ? 12 : 8;
    signals.push("event_date");
  }
  if (dimensionsMatch(charge, candidate)) {
    score += 30;
    signals.push("dimensions");
  }
  if (weightMatches(charge, candidate)) {
    score += 20;
    signals.push("weight_g");
  }
  const chargeQuantity = safeNumber(charge.quantity);
  const candidateQuantity = safeNumber(candidate.quantity);
  if (chargeQuantity !== null && candidateQuantity !== null && chargeQuantity === candidateQuantity) {
    score += 10;
    signals.push("quantity");
  }
  return { score, signals };
}

function candidateIdentity(row) {
  return [row.source_file, row.source_sheet, row.source_row, row.sku, row.product_name].map(value => value ?? "").join("|");
}

export function reconcileSources(canonicalRows) {
  const identifierIndex = new Map();
  const dimensionIndex = new Map();
  const enrichmentRows = canonicalRows.filter(row => row.charged_amount === null);
  for (const row of enrichmentRows) {
    for (const key of identifierKeys(row)) {
      if (!identifierIndex.has(key)) identifierIndex.set(key, []);
      identifierIndex.get(key).push(row);
    }
    const dimensions = sortedDimensions(row);
    if (row.sku && dimensions) {
      const quantity = safeNumber(row.quantity);
      for (const quantityKey of new Set([String(quantity ?? "*"), "*"])) {
        const dimensionKey = `${quantityKey}|${dimensions.map(value => Math.round(value / 5)).join("|")}`;
        if (!dimensionIndex.has(dimensionKey)) dimensionIndex.set(dimensionKey, []);
        dimensionIndex.get(dimensionKey).push(row);
      }
    }
  }

  const chargeRows = canonicalRows.filter(row => row.charged_amount !== null);
  const reconciled = chargeRows.map(charge => {
    const exactCandidates = new Map();
    for (const key of identifierKeys(charge)) {
      for (const candidate of identifierIndex.get(key) || []) exactCandidates.set(candidateIdentity(candidate), candidate);
    }

    let candidates = [...exactCandidates.values()];
    let method = candidates.length ? "exact_identifier" : null;
    if (!candidates.length) {
      const dimensions = sortedDimensions(charge);
      const quantity = safeNumber(charge.quantity);
      const dimensionalCandidates = new Map();
      if (dimensions) {
        const buckets = dimensions.map(value => Math.round(value / 5));
        for (const first of [-1, 0, 1]) for (const second of [-1, 0, 1]) for (const third of [-1, 0, 1]) {
          const key = `${quantity ?? "*"}|${buckets[0] + first}|${buckets[1] + second}|${buckets[2] + third}`;
          for (const candidate of dimensionIndex.get(key) || []) dimensionalCandidates.set(candidateIdentity(candidate), candidate);
        }
      }
      candidates = [...dimensionalCandidates.values()].filter(candidate => dimensionsMatch(charge, candidate));
      method = candidates.length ? "composite_dimensions" : null;
    }

    const scored = candidates.map(candidate => ({ candidate, ...scoreCandidate(charge, candidate) }))
      .sort((a, b) => b.score - a.score);
    const bestScore = scored[0]?.score ?? 0;
    const hasExact = scored.some(item => item.signals.some(signal => signal.endsWith("_id") || signal === "tracking_number"));
    const minimumScore = hasExact ? 85 : 60;
    const accepted = hasExact
      ? scored.filter(item => item.score >= minimumScore && item.signals.some(signal => signal.endsWith("_id") || signal === "tracking_number"))
      : scored.filter(item => item.score === bestScore && item.score >= minimumScore);
    const bestSkus = new Set(accepted.map(item => normalizeText(item.candidate.sku)).filter(Boolean));
    const ambiguous = !hasExact && (accepted.length === 0 || bestSkus.size !== 1 || (scored[1] && bestScore - scored[1].score < 10));
    const selected = ambiguous ? [] : accepted;

    let merged = {
      ...charge,
      matched_sources: charge.source_file ? [charge.source_file] : [],
      reconciliation_method: selected.length ? method : "unmatched",
      reconciliation_confidence: selected.length ? Math.min(1, bestScore / 120) : 0,
      reconciliation_signals: selected[0]?.signals || [],
      reconciliation_ambiguity: ambiguous,
      items: []
    };

    const itemKeys = new Set();
    for (const { candidate } of selected) {
      merged = mergeRows(merged, candidate);
      const sku = normalizeText(candidate.sku);
      const itemKey = `${sku || ""}|${normalizeText(candidate.product_name) || ""}|${safeNumber(candidate.quantity) ?? ""}`;
      if ((sku || candidate.product_name) && !itemKeys.has(itemKey)) {
        itemKeys.add(itemKey);
        merged.items.push({
          sku,
          product_name: normalizeText(candidate.product_name),
          quantity: safeNumber(candidate.quantity),
          source_file: candidate.source_file,
          source_sheet: candidate.source_sheet,
          source_row: candidate.source_row ?? null
        });
      }
    }
    if (merged.items.length === 1) merged.sku = merged.items[0].sku || merged.sku;
    if (merged.items.length > 1) merged.sku = null;
    return merged;
  });

  return { all_rows: canonicalRows, charge_rows: chargeRows, reconciled_rows: reconciled };
}

// ============================================================
// SELLER PRODUCT CATALOG
// ============================================================

function buildCatalog(
  products
) {
  const map =
    new Map();

  for (
    const product
    of Array.isArray(products)
      ? products
      : []
  ) {
    const sku =
      normalizeText(
        product?.sku
      );

    if (!sku) {
      continue;
    }

    map.set(
      sku.toLowerCase(),
      product
    );
  }

  return map;
}

function applyProductCatalog(
  row,
  catalog
) {
  const sku =
    normalizeText(
      row.sku
    );

  if (!sku) {
    return {
      ...row,
      seller_catalog_match:
        false
    };
  }

  const product =
    catalog.get(
      sku.toLowerCase()
    );

  if (!product) {
    return {
      ...row,
      seller_catalog_match:
        false
    };
  }

  const out = {
    ...row,

    seller_catalog_match:
      true,

    marketplace_height_cm:
      row.height_cm,

    marketplace_width_cm:
      row.width_cm,

    marketplace_length_cm:
      row.length_cm,

    marketplace_weight_g:
      row.weight_g
  };

  const sellerHeight =
    safeNumber(
      product.height_cm
    );

  const sellerWidth =
    safeNumber(
      product.width_cm
    );

  const sellerLength =
    safeNumber(
      product.length_cm
    );

  const sellerWeight =
    safeNumber(
      product.weight_g
    );

  if (
    sellerHeight !== null
  ) {
    out.height_cm =
      sellerHeight;
  }

  if (
    sellerWidth !== null
  ) {
    out.width_cm =
      sellerWidth;
  }

  if (
    sellerLength !== null
  ) {
    out.length_cm =
      sellerLength;
  }

  if (
    sellerWeight !== null
  ) {
    out.weight_g =
      sellerWeight;
  }

  out.volume_cm3 =
    calculateVolumeCm3(
      out.height_cm,
      out.width_cm,
      out.length_cm
    );

  const dimensions = [out.height_cm, out.width_cm, out.length_cm].filter(value => safeNumber(value) !== null).map(Number);
  out.max_dimension_cm = dimensions.length ? Math.max(...dimensions) : null;

  return out;
}

// ============================================================
// RULE CONDITION ENGINE
// ============================================================

function ruleConditionMatches(
  row,
  condition
) {
  const value = condition?.field === "date"
    ? row?.date || row?.event_date
    : row?.[condition?.field];

  const target =
    condition?.value;

  switch (
    condition?.op
  ) {
    case "eq":
      return (
        comparableText(value) ===
        comparableText(target)
      );

    case "neq":
      return (
        comparableText(value) !==
        comparableText(target)
      );

    case "gt":
      if (condition?.field === "date") return String(value || "") > String(target || "");
      return (
        safeNumber(value) >
        safeNumber(target)
      );

    case "gte":
      if (condition?.field === "date") return String(value || "") >= String(target || "");
      return (
        safeNumber(value) >=
        safeNumber(target)
      );

    case "lt":
      if (condition?.field === "date") return String(value || "") < String(target || "");
      return (
        safeNumber(value) <
        safeNumber(target)
      );

    case "lte":
      if (condition?.field === "date") return String(value || "") <= String(target || "");
      return (
        safeNumber(value) <=
        safeNumber(target)
      );

    case "between": {
      if (condition?.field === "date") {
        const current = String(value || "");
        const min = String(condition.min || "");
        const max = String(condition.max || "");
        return /^\d{4}-\d{2}-\d{2}$/.test(current) && current >= min && current <= max;
      }
      const current =
        safeNumber(value);

      const min =
        safeNumber(
          condition.min
        );

      const max =
        safeNumber(
          condition.max
        );

      if (
        current === null ||
        min === null ||
        max === null
      ) {
        return false;
      }

      return (
        current >= min &&
        current <= max
      );
    }

    case "in": {
      if (
        !Array.isArray(
          target
        )
      ) {
        return false;
      }

      return target
        .map(
          item =>
            comparableText(
              item
            )
        )
        .includes(
          comparableText(value)
        );
    }

    default:
      return false;
  }
}

// ============================================================
// RULE SET CONTEXT
// ============================================================

function ruleSetContextMatches(
  row,
  ruleSet
) {
  if (
    ruleSet?.seller_id &&
    comparableText(
      row.seller_id
    ) !==
      comparableText(
        ruleSet.seller_id
      )
  ) {
    return false;
  }

  if (
    ruleSet?.marketplace &&
    comparableText(
      row.marketplace
    ) !==
      comparableText(
        ruleSet.marketplace
      )
  ) {
    return false;
  }

  if (
    ruleSet?.logistics_mode &&
    comparableText(
      row.logistics_mode
    ) !==
      comparableText(
        ruleSet.logistics_mode
      )
  ) {
    return false;
  }

  if (
    ruleSet?.carrier &&
    comparableText(
      row.carrier
    ) !==
      comparableText(
        ruleSet.carrier
      )
  ) {
    return false;
  }

  return true;
}

// ============================================================
// CALCULATION ENGINE
// ============================================================

function calculateExpected(
  row,
  calculation
) {
  if (
    !calculation ||
    typeof calculation !==
      "object"
  ) {
    return null;
  }

  if (
    calculation.type ===
      "fixed"
  ) {
    return safeNumber(
      calculation.amount
    );
  }

  if (
    calculation.type ===
      "per_unit"
  ) {
    const quantity =
      safeNumber(
        row.quantity
      );

    const amount =
      safeNumber(
        calculation.amount
      );

    if (
      quantity === null ||
      amount === null
    ) {
      return null;
    }

    return (
      quantity *
      amount
    );
  }

  if (
    calculation.type ===
      "percentage"
  ) {
    const baseField =
      calculation.base_field ||
      "sale_amount";

    const base =
      safeNumber(
        row[baseField]
      );

    const rate =
      safeNumber(
        calculation.rate
      );

    if (
      base === null ||
      rate === null
    ) {
      return null;
    }

    return (
      base *
      rate
    );
  }

  return null;
}

// ============================================================
// EXECUTE RULES
// ============================================================

function executeRulesForRow(
  row,
  ruleSets
) {
  const candidates = [];

  for (
    const ruleSet
    of ruleSets
  ) {
    if (
      !ruleSetContextMatches(
        row,
        ruleSet
      )
    ) {
      continue;
    }

    for (
      const rule
      of Array.isArray(
        ruleSet.rules
      )
        ? ruleSet.rules
        : []
    ) {
      const conditions =
        Array.isArray(
          rule.conditions
        )
          ? rule.conditions
          : [];

      if (
        !conditions.every(
          condition =>
            ruleConditionMatches(
              row,
              condition
            )
        )
      ) {
        continue;
      }

      candidates.push({
        rule_set:
          ruleSet,

        rule,

        expected:
          calculateExpected(
            row,
            rule.calculation
          ),

        priority:
          Number(
            rule.priority
          ) || 0
      });
    }
  }

  candidates.sort(
    (a, b) =>
      b.priority -
      a.priority
  );

  if (
    !candidates.length
  ) {
    return {
      status:
        "NO_RULE",

      matched_rule_id:
        null,

      matched_rule_set:
        null,

      expected_amount:
        null,

      source_reference:
        null,

      ambiguity:
        null
    };
  }

  const bestPriority =
    candidates[0]
      .priority;

  const top =
    candidates.filter(
      item =>
        item.priority ===
        bestPriority
    );

  const distinct =
    [
      ...new Set(
        top
          .map(
            item =>
              item.expected
          )
          .filter(
            value =>
              value !== null
          )
          .map(
            value =>
              Number(value)
                .toFixed(8)
          )
      )
    ];

  if (
    distinct.length > 1
  ) {
    return {
      status:
        "RULE_AMBIGUOUS",

      matched_rule_id:
        null,

      matched_rule_set:
        null,

      expected_amount:
        null,

      source_reference:
        null,

      ambiguity: {
        rule_ids:
          top.map(
            item =>
              item.rule.id
          ),

        expected_values:
          top.map(
            item =>
              item.expected
          )
      }
    };
  }

  const selected =
    top.find(
      item =>
        item.expected !==
        null
    ) ||
    top[0];

  return {
    status:
      selected.expected ===
        null
        ? "INSUFFICIENT_DATA"
        : "RULE_MATCHED",

    matched_rule_id:
      selected.rule.id ||
      null,

    matched_rule_set:
      selected.rule_set.name ||
      null,

    expected_amount:
      selected.expected,

    source_reference:
      selected.rule
        .source_reference ||
      null,

    ambiguity:
      null
  };
}

// ============================================================
// FULL AUDIT
// ============================================================

async function auditFull(
  request,
  env
) {
  const body =
    await request.json();

  return auditFullInput(
    body,
    env
  );
}

export async function auditFullInput(
  body,
  env
) {

  const sellerId =
    normalizeText(
      body.seller_id
    );

  const rawSources =
    Array.isArray(
      body.sources
    )
      ? body.sources
      : [];

  const ruleSources =
    Array.isArray(
      body.rule_sources
    )
      ? body.rule_sources
      : [];

  const prebuiltRuleSets =
    Array.isArray(
      body.rule_sets
    )
      ? body.rule_sets
      : [];

  const productCatalog =
    Array.isArray(
      body.product_catalog
    )
      ? body.product_catalog
      : [];

  if (
    !rawSources.length
  ) {
    return json(
      {
        ok: false,
        error:
          "Nenhuma fonte recebida."
      },
      400
    );
  }

  // ----------------------------------------------------------
  // MAP SOURCES
  // ----------------------------------------------------------

  const mappedSources = [];

  const mappingWarnings = [];

  const mapperCache = new Map();

  for (
    const rawSource
    of rawSources
  ) {
    const cacheKey =
      sourceMappingKey(
        rawSource,
        sellerId
      );

    let cachedMapper = mapperCache.get(cacheKey);

    if (!cachedMapper && env.DB) {
      try {
        const cached = await env.DB.prepare("SELECT mapper_json FROM mapping_cache WHERE cache_key = ?").bind(cacheKey).first();
        if (cached?.mapper_json) cachedMapper = JSON.parse(cached.mapper_json);
      } catch {
        cachedMapper = null;
      }
    }

    const mapped =
      cachedMapper
        ? {
            source:
              normalizeSource(
                rawSource
              ),
            mapper:
              structuredClone(
                cachedMapper
              )
          }
        : await mapSourceWithAI(
            env,
            rawSource,
            sellerId
          );

    if (!cachedMapper) {
      mapperCache.set(
        cacheKey,
        structuredClone(
          mapped.mapper
        )
      );
      if (env.DB) {
        try {
          await env.DB.prepare(
            "INSERT OR REPLACE INTO mapping_cache (cache_key, mapper_json, updated_at) VALUES (?, ?, ?)",
          ).bind(cacheKey, JSON.stringify(mapped.mapper), new Date().toISOString()).run();
        } catch {
          // A cache is an optimization; an audit must remain correct if storage is unavailable.
        }
      }
    } else {
      mapperCache.set(cacheKey, structuredClone(cachedMapper));
    }

    mappedSources.push(
      mapped
    );

    for (
      const warning
      of Array.isArray(
        mapped.mapper.warnings
      )
        ? mapped.mapper.warnings
        : []
    ) {
      mappingWarnings.push(
        `${mapped.source.filename}: ${warning}`
      );
    }
  }

  // ----------------------------------------------------------
  // NORMALIZE ROWS
  // ----------------------------------------------------------

  const canonicalRows = [];

  for (
    const mappedSource
    of mappedSources
  ) {
    for (const [rowIndex, rawRow] of mappedSource.source.rows.entries()) {
      const canonical =
        canonicalRowFromSource(
          rawRow,
          mappedSource,
          sellerId
        );
      canonical.source_row = rowIndex + 2;

      const useful =
        identifierKeys(
          canonical
        ).length > 0 ||
        canonical.sku ||
        canonical
          .charged_amount !==
          null;

      if (useful) {
        canonicalRows.push(
          canonical
        );
      }
    }
  }

  if (
    !canonicalRows.length
  ) {
    return json(
      {
        ok: false,

        error:
          "Nenhuma linha útil pôde ser normalizada.",

        mappings:
          mappedSources
      },
      422
    );
  }

  // ----------------------------------------------------------
  // RULE SOURCES
  // ----------------------------------------------------------

  const parsedRuleSets = [];

  const ambiguities = [];

  const ruleWarnings = [];

  for (
    const ruleSource
    of ruleSources
  ) {
    const parsed =
      await parseRuleSourceWithAI(
        env,
        ruleSource,
        sellerId
      );

    if (
      parsed?.rule_set
    ) {
      parsedRuleSets.push(
        parsed.rule_set
      );
    }

    if (
      Array.isArray(
        parsed?.ambiguities
      )
    ) {
      ambiguities.push(
        ...parsed.ambiguities
      );
    }

    if (
      Array.isArray(
        parsed?.warnings
      )
    ) {
      ruleWarnings.push(
        ...parsed.warnings
      );
    }
  }

  const ruleSets = [
    ...prebuiltRuleSets,
    ...parsedRuleSets
  ];

  // ----------------------------------------------------------
  // RECONCILE
  // ----------------------------------------------------------

  const reconciliation =
    reconcileSources(
      canonicalRows
    );

  if (
    !reconciliation
      .charge_rows.length
  ) {
    return json(
      {
        ok: false,

        status:
          "NO_CHARGE_SOURCE",

        message:
          "Nenhuma cobrança financeira foi identificada.",

        warnings: [
          ...mappingWarnings,
          ...ruleWarnings
        ],

        mappings:
          mappedSources
      },
      422
    );
  }

  if (!ruleSets.length) {
    return json(
      {
        ok: false,

        status:
          "NO_RULES",

        message:
          "Nenhuma regra foi fornecida ou interpretada.",

        ambiguities,

        warnings: [
          ...mappingWarnings,
          ...ruleWarnings
        ]
      },
      422
    );
  }

  // ----------------------------------------------------------
  // SELLER CATALOG
  // ----------------------------------------------------------

  const catalog =
    buildCatalog(
      productCatalog
    );

  // ----------------------------------------------------------
  // AUDIT
  // ----------------------------------------------------------

  const results = [];

  for (
    const originalRow
    of reconciliation
      .reconciled_rows
  ) {
    const row =
      applyProductCatalog(
        originalRow,
        catalog
      );

    const ruleResult =
      executeRulesForRow(
        row,
        ruleSets
      );

    const charged =
      safeNumber(
        row.charged_amount
      );

    const expected =
      safeNumber(
        ruleResult
          .expected_amount
      );

    let difference =
      null;

    let recoverable =
      null;

    let status =
      ruleResult.status;

    if (
      status ===
        "RULE_MATCHED" &&
      charged !== null &&
      expected !== null
    ) {
      difference =
        charged -
        expected;

      recoverable =
        Math.max(
          0,
          difference
        );

      status =
        difference > 0.009
          ? "OVERCHARGED"
          : "OK";
    }

    results.push({
      tracking_number:
        row.tracking_number,

      order_id:
        row.order_id,

      shipment_id:
        row.shipment_id,

      pack_id:
        row.pack_id,

      sku:
        row.sku,

      items:
        Array.isArray(row.items)
          ? row.items
          : [],

      quantity:
        row.quantity,

      marketplace:
        row.marketplace,

      logistics_mode:
        row.logistics_mode,

      carrier:
        row.carrier,

      charged_amount:
        charged,

      expected_amount:
        expected,

      difference,

      recoverable_amount:
        recoverable,

      matched_rule_id:
        ruleResult
          .matched_rule_id,

      matched_rule_set:
        ruleResult
          .matched_rule_set,

      status,

      ambiguity:
        ruleResult
          .ambiguity,

      technical_data: {
        dimensions_raw:
          row.dimensions_raw ||
          null,

        height_cm:
          row.height_cm,

        width_cm:
          row.width_cm,

        length_cm:
          row.length_cm,

        weight_g:
          row.weight_g,

        volume_cm3:
          row.volume_cm3,

        seller_catalog_match:
          row.seller_catalog_match ||
          false,

        marketplace_height_cm:
          row
            .marketplace_height_cm ??
          null,

        marketplace_width_cm:
          row
            .marketplace_width_cm ??
          null,

        marketplace_length_cm:
          row
            .marketplace_length_cm ??
          null,

        marketplace_weight_g:
          row
            .marketplace_weight_g ??
          null
      },

      evidence: {
        source_reference:
          ruleResult
            .source_reference ||
          null,

        source_files:
          row.matched_sources ||
          [
            row.source_file
          ].filter(Boolean),

        reconciliation: {
          method: row.reconciliation_method || "unmatched",
          confidence: row.reconciliation_confidence ?? 0,
          signals: row.reconciliation_signals || [],
          ambiguity: row.reconciliation_ambiguity || false
        }
      }
    });
  }

  const totalRecoverable =
    results.reduce(
      (
        total,
        result
      ) =>
        total +
        (
          safeNumber(
            result
              .recoverable_amount
          ) || 0
        ),
      0
    );

  return json({
    ok: true,

    engine:
      "Recovery Audit Engine",

    version:
      VERSION,

    seller_id:
      sellerId,

    summary: {
      source_count:
        mappedSources.length,

      normalized_rows:
        canonicalRows.length,

      charge_rows:
        reconciliation
          .charge_rows
          .length,

      audited_rows:
        results.length,

      overcharged:
        results.filter(
          item =>
            item.status ===
            "OVERCHARGED"
        ).length,

      ok_rows:
        results.filter(
          item =>
            item.status ===
            "OK"
        ).length,

      no_rule:
        results.filter(
          item =>
            item.status ===
            "NO_RULE"
        ).length,

      rule_ambiguous:
        results.filter(
          item =>
            item.status ===
            "RULE_AMBIGUOUS"
        ).length,

      insufficient_data:
        results.filter(
          item =>
            item.status ===
            "INSUFFICIENT_DATA"
        ).length,

      total_recoverable:
        Number(
          totalRecoverable
            .toFixed(2)
        )
    },

    mappings:
      mappedSources.map(
        item => ({
          filename:
            item.source.filename,

          sheet:
            item.source.sheet,

          mapper:
            item.mapper
        })
      ),

    rule_sets:
      ruleSets,

    ambiguities,

    warnings: [
      ...mappingWarnings,
      ...ruleWarnings
    ],

    results
  });
}

// ============================================================
// MAP FILE ENDPOINT
// ============================================================

async function mapFileEndpoint(
  request,
  env
) {
  const body =
    await request.json();

  const mapped =
    await mapSourceWithAI(
      env,
      {
        filename:
          body.filename,

        sheet:
          body.sheet,

        context:
          body.context ||
          body.column_types ||
          {},

        headers:
          body.headers,

        rows:
          body.sample_rows
      },
      body.seller_id
    );

  return json({
    ok: true,
    ...mapped.mapper
  });
}

// ============================================================
// PARSE RULE ENDPOINT
// ============================================================

async function parseRulesEndpoint(
  request,
  env
) {
  const body =
    await request.json();

  const parsed =
    await parseRuleSourceWithAI(
      env,
      body,
      body.seller_id
    );

  return json({
    ok: true,
    ...parsed
  });
}

// ============================================================
// SIMPLE AUDIT
// ============================================================

async function simpleAuditEndpoint(
  request
) {
  const body =
    await request.json();

  const rows =
    Array.isArray(
      body.rows
    )
      ? body.rows
      : [];

  const ruleSet =
    body.rule_set ||
    {
      rules: []
    };

  const results = [];

  for (
    const row
    of rows
  ) {
    const ruleResult =
      executeRulesForRow(
        row,
        [
          ruleSet
        ]
      );

    const charged =
      safeNumber(
        row.charged_amount
      );

    const expected =
      safeNumber(
        ruleResult
          .expected_amount
      );

    const difference =
      charged !== null &&
      expected !== null
        ? charged - expected
        : null;

    const recoverable =
      difference !== null
        ? Math.max(
            0,
            difference
          )
        : null;

    results.push({
      ...row,

      charged_amount:
        charged,

      expected_amount:
        expected,

      difference,

      recoverable_amount:
        recoverable,

      matched_rule_id:
        ruleResult
          .matched_rule_id,

      status:
        ruleResult.status ===
          "RULE_MATCHED"
          ? difference > 0.009
            ? "OVERCHARGED"
            : "OK"
          : ruleResult.status
    });
  }

  const total =
    results.reduce(
      (
        sum,
        item
      ) =>
        sum +
        (
          safeNumber(
            item
              .recoverable_amount
          ) || 0
        ),
      0
    );

  return json({
    ok: true,

    summary: {
      rows:
        results.length,

      total_recoverable:
        Number(
          total.toFixed(2)
        )
    },

    results
  });
}

// ============================================================
// ROUTER
// ============================================================

export default {
  async fetch(
    request,
    env
  ) {
    if (
      request.method ===
      "OPTIONS"
    ) {
      return new Response(
        null,
        {
          status: 204,
          headers:
            CORS_HEADERS
        }
      );
    }

    const url =
      new URL(
        request.url
      );

    try {

      const v1Response =
        await handleV1Request(
          request,
          env,
          url,
          {
            json,
            auditFull,
            auditFullInput,
            parseRuleSourceWithAI
          }
        );

      if (v1Response) {
        return v1Response;
      }

      if (
        request.method ===
          "GET" &&
        url.pathname ===
          "/api/health" || (url.pathname === "/api/v1/health" && request.method === "GET")
      ) {
        return json({
          ok: true,

          service:
            "Recovery Audit Engine",

          version:
            VERSION,

          features: [
            "AI semantic mapper",
            "AI rule interpreter",
            "multi-source reconciliation",
            "deterministic audit",
            "seller technical catalog",
            "composite dimension parser"
          ],

          endpoints: [
            "/api/health",
            "/api/v1/health",
            "/api/v1/audits",
            "/api/v1/audits/:id",
            "/api/v1/audits/:id/run",
            "/api/v1/audits/:id/findings",
            "/api/v1/audits/:id/evidence",
            "POST /api/v1/audits (multipart CSV/XLS/XLSX)",
            "/api/map-file",
            "/api/parse-rules",
            "/api/audit",
            "/api/audit-full"
          ]
        });
      }

      if (
        request.method ===
          "POST" &&
        url.pathname ===
          "/api/map-file"
      ) {
        return await mapFileEndpoint(
          request,
          env
        );
      }

      if (
        request.method ===
          "POST" &&
        url.pathname ===
          "/api/parse-rules"
      ) {
        return await parseRulesEndpoint(
          request,
          env
        );
      }

      if (
        request.method ===
          "POST" &&
        url.pathname ===
          "/api/audit"
      ) {
        return await simpleAuditEndpoint(
          request
        );
      }

      if (
        request.method ===
          "POST" &&
        url.pathname ===
          "/api/audit-full"
      ) {
        return await auditFull(
          request,
          env
        );
      }

      return json(
        {
          error:
            "Endpoint não encontrado."
        },
        404
      );
    }

    catch (error) {
      return json(
        {
          ok: false,

          error:
            "Erro interno",

          message:
            error?.message ||
            String(error)
        },
        500
      );
    }
  }
};
