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
      20000
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

function normalizeSource(
  source = {}
) {
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
      Array.isArray(
        source.headers
      )
        ? source.headers
        : [],

    rows:
      Array.isArray(
        source.rows
      )
        ? source.rows
        : []
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
      "dimensions"
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

async function parseRuleSourceWithAI(
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
como uma matriz ainda não executável,
NÃO invente cálculo.

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

  parsed.ambiguities =
    Array.isArray(
      parsed.ambiguities
    )
      ? parsed.ambiguities
      : [];

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

// ============================================================
// CANONICAL ROW
// ============================================================

function canonicalRowFromSource(
  rawRow,
  mappedSource,
  sellerId
) {
  const mapping =
    mappedSource.mapper.mapping ||
    {};

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

  row.volume_cm3 =
    calculateVolumeCm3(
      row.height_cm,
      row.width_cm,
      row.length_cm
    );

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

function reconcileSources(
  canonicalRows
) {
  const index =
    new Map();

  for (
    const row
    of canonicalRows
  ) {
    for (
      const key
      of identifierKeys(row)
    ) {
      if (!index.has(key)) {
        index.set(
          key,
          []
        );
      }

      index
        .get(key)
        .push(row);
    }
  }

  const chargeRows =
    canonicalRows.filter(
      row =>
        row.charged_amount !==
        null
    );

  const reconciled = [];

  for (
    const charge
    of chargeRows
  ) {
    let merged = {
      ...charge,

      matched_sources:
        charge.source_file
          ? [
              charge.source_file
            ]
          : []
    };

    const used =
      new Set();

    for (
      const key
      of identifierKeys(charge)
    ) {
      for (
        const candidate
        of index.get(key) || []
      ) {
        const id =
          `${candidate.source_file}|${candidate.source_sheet}`;

        if (used.has(id)) {
          continue;
        }

        used.add(id);

        merged =
          mergeRows(
            merged,
            candidate
          );
      }
    }

    reconciled.push(
      merged
    );
  }

  return {
    all_rows:
      canonicalRows,

    charge_rows:
      chargeRows,

    reconciled_rows:
      reconciled
  };
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

  return out;
}

// ============================================================
// RULE CONDITION ENGINE
// ============================================================

function ruleConditionMatches(
  row,
  condition
) {
  const value =
    row?.[
      condition?.field
    ];

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
      return (
        safeNumber(value) >
        safeNumber(target)
      );

    case "gte":
      return (
        safeNumber(value) >=
        safeNumber(target)
      );

    case "lt":
      return (
        safeNumber(value) <
        safeNumber(target)
      );

    case "lte":
      return (
        safeNumber(value) <=
        safeNumber(target)
      );

    case "between": {
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

    const cachedMapper =
      mapperCache.get(
        cacheKey
      );

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
    for (
      const rawRow
      of mappedSource
        .source.rows
    ) {
      const canonical =
        canonicalRowFromSource(
          rawRow,
          mappedSource,
          sellerId
        );

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
          ].filter(Boolean)
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
            auditFullInput
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
