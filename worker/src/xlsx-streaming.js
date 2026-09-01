const textDecoder = new TextDecoder();

const decodeXml = value => String(value)
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/&amp;/g, "&")
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));

const columnIndex = reference => {
  const letters = String(reference).match(/^[A-Z]+/i)?.[0]?.toUpperCase() || "A";
  let value = 0;
  for (const letter of letters) value = value * 26 + letter.charCodeAt(0) - 64;
  return value - 1;
};

const findZipEntries = buffer => {
  const view = new DataView(buffer);
  let end = view.byteLength - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end -= 1;
  if (end < 0) throw new Error("Arquivo XLSX inválido: diretório ZIP não encontrado.");
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const entries = new Map();
  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = textDecoder.decode(new Uint8Array(buffer, offset + 46, nameLength));
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    entries.set(name, {
      method,
      start: localOffset + 30 + localNameLength + localExtraLength,
      compressedSize,
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
};

const entryStream = (buffer, entry) => {
  const compressed = new ReadableStream({
    start(controller) {
      const chunkSize = 256 * 1024;
      for (let offset = 0; offset < entry.compressedSize; offset += chunkSize) {
        controller.enqueue(new Uint8Array(
          buffer,
          entry.start + offset,
          Math.min(chunkSize, entry.compressedSize - offset),
        ));
      }
      controller.close();
    },
  });
  if (entry.method === 0) return compressed;
  if (entry.method === 8) return compressed.pipeThrough(new DecompressionStream("deflate-raw"));
  throw new Error("Método de compactação XLSX não suportado.");
};

const consumeElements = async (stream, tag, consume) => {
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  const close = `</${tag}>`;
  let buffer = "";
  while (true) {
    const { value = "", done } = await reader.read();
    buffer += value;
    let closeAt;
    while ((closeAt = buffer.indexOf(close)) >= 0) {
      const end = closeAt + close.length;
      const element = buffer.slice(0, end);
      const openAt = element.lastIndexOf(`<${tag}`);
      if (openAt >= 0) await consume(element.slice(openAt));
      buffer = buffer.slice(end);
    }
    if (done) break;
    const openAt = buffer.lastIndexOf(`<${tag}`);
    if (openAt > 0) buffer = buffer.slice(openAt);
    if (buffer.length > 1024 * 1024) buffer = buffer.slice(-1024 * 1024);
  }
};

const readSharedStrings = async (buffer, entry) => {
  if (!entry) return [];
  const strings = [];
  await consumeElements(entryStream(buffer, entry), "si", element => {
    const parts = [...element.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)];
    strings.push(decodeXml(parts.map(match => match[1]).join("")));
  });
  return strings;
};

const parseCell = (element, sharedStrings) => {
  const reference = element.match(/\br="([A-Z]+\d+)"/i)?.[1] || "A1";
  const type = element.match(/\bt="([^"]+)"/)?.[1] || "n";
  if (type === "inlineStr") {
    const parts = [...element.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)];
    return [columnIndex(reference), decodeXml(parts.map(match => match[1]).join(""))];
  }
  const raw = element.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/)?.[1];
  if (raw === undefined) return [columnIndex(reference), null];
  if (type === "s") return [columnIndex(reference), sharedStrings[Number(raw)] ?? ""];
  if (type === "str") return [columnIndex(reference), decodeXml(raw)];
  const number = Number(raw);
  return [columnIndex(reference), Number.isFinite(number) ? number : decodeXml(raw)];
};

const usefulHeader = header => {
  const normalized = String(header || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return /(n\.?.? de venda|pedido de compra|pacote de diversos|\bsku\b|\bunidades\b|\bquantidade\b|receita por produtos|tarifas? de envio|custo de envio|custo por diferencas|\btotal\b|numero de rastreamento|transportador|\bpeso\b|\baltura\b|\blargura\b|\bcomprimento\b|\bdimens)/.test(normalized);
};

const parseWorksheet = async (buffer, entry, sharedStrings, filename, sheet) => {
  const initialRows = [];
  const rows = [];
  let headers = null;
  let selected = null;
  const selectHeader = () => {
    const candidate = initialRows.reduce((best, row) => {
      const count = row.filter(value => value !== null && value !== undefined && value !== "").length;
      return count > best.count ? { row, count } : best;
    }, { row: [], count: -1 }).row;
    headers = candidate.map((value, index) => String(value ?? "").trim() || `coluna_${index + 1}`);
    selected = headers.map((header, index) => usefulHeader(header) ? index : -1).filter(index => index >= 0);
    if (selected.length < 2) selected = headers.map((_, index) => index);
    const headerIndex = initialRows.indexOf(candidate);
    for (const row of initialRows.slice(headerIndex + 1)) {
      if (row.some(value => value !== null && value !== undefined && value !== "")) {
        rows.push(selected.map(index => row[index] ?? null));
      }
    }
    headers = selected.map(index => headers[index]);
  };
  await consumeElements(entryStream(buffer, entry), "row", element => {
    const row = [];
    for (const cell of element.matchAll(/<c(?:\s[^>]*)?>[\s\S]*?<\/c>/g)) {
      const [index, value] = parseCell(cell[0], sharedStrings);
      row[index] = value;
    }
    if (!headers) {
      initialRows.push(row);
      if (initialRows.length === 20) selectHeader();
      return;
    }
    if (row.some(value => value !== null && value !== undefined && value !== "")) {
      rows.push(selected.map(index => row[index] ?? null));
      if (rows.length > 50_000) throw new Error(`Aba ${sheet} excede o limite seguro de 50.000 linhas.`);
    }
  });
  if (!headers) selectHeader();
  if (headers.length > 200) throw new Error(`Aba ${sheet} excede o limite seguro de 200 colunas.`);
  return { filename, sheet, headers, rows };
};

export async function parseLargeXlsx(file, context = {}) {
  const buffer = await file.arrayBuffer();
  const entries = findZipEntries(buffer);
  const sharedStrings = await readSharedStrings(buffer, entries.get("xl/sharedStrings.xml"));
  const worksheets = [...entries.entries()]
    .filter(([name]) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }));
  const sources = [];
  for (let index = 0; index < worksheets.length; index += 1) {
    const [, entry] = worksheets[index];
    const source = await parseWorksheet(buffer, entry, sharedStrings, file.name, `Planilha ${index + 1}`);
    if (source.headers.length && source.rows.length) sources.push({ context, ...source });
  }
  return sources;
}
