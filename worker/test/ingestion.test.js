import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseAuditUpload, parseCsv, parseSingleAuditSource } from "../src/ingestion.js";
import { parseLargeXlsx } from "../src/xlsx-streaming.js";

describe("backend file ingestion", () => {
  it("parses quoted CSV and Brazilian delimiter without changing missing values", () => {
    expect(parseCsv('tracking;charged_amount;note\nABC;;"texto; seguro"')).toEqual({
      headers: ["tracking", "charged_amount", "note"],
      rows: [["ABC", "", "texto; seguro"]],
    });
  });

  it("turns a CSV upload into a backend source", async () => {
    const form = new FormData();
    form.set("seller", "Seller A");
    form.set("marketplace", "Mercado Livre");
    form.append("files", new File(["tracking,charged_amount\nABC,12.50"], "charges.csv"));
    const input = await parseAuditUpload(new Request("https://example.test/api/v1/audits", {
      method: "POST",
      body: form,
    }));
    expect(input.sources[0]).toMatchObject({
      filename: "charges.csv",
      headers: ["tracking", "charged_amount"],
      rows: [["ABC", "12.50"]],
    });
  });

  it("reads XLSX sheets only in the Worker", async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([["tracking", "charged_amount"], ["ABC", 12.5]]),
      "Cobranças",
    );
    const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
    const form = new FormData();
    form.append("files", new File([bytes], "charges.xlsx"));
    const input = await parseAuditUpload(new Request("https://example.test/api/v1/audits", {
      method: "POST",
      body: form,
    }));
    expect(input.sources[0]).toMatchObject({
      filename: "charges.xlsx",
      sheet: "Cobranças",
      rows: [["ABC", 12.5]],
    });
  });

  it("rejects unsupported formats", async () => {
    const form = new FormData();
    form.append("files", new File(["x"], "unsafe.exe"));
    await expect(parseAuditUpload(new Request("https://example.test/api/v1/audits", {
      method: "POST",
      body: form,
    }))).rejects.toThrow("Formato não aceito");
  });

  it("accepts exactly one staged file and preserves backend provenance", async () => {
    const form = new FormData();
    form.set("marketplace", "Mercado Livre");
    form.set("operation", "Flex");
    form.append("file", new File(["tracking,charged_amount\nABC,"], "charges.csv"));
    const parsed = await parseSingleAuditSource(new Request("https://example.test/api/v1/audits/a/sources", {
      method: "POST",
      body: form,
    }));
    expect(parsed.file.name).toBe("charges.csv");
    expect(parsed.sources[0]).toMatchObject({
      filename: "charges.csv",
      context: { marketplace: "Mercado Livre", logistics_mode: "Flex" },
      rows: [["ABC", ""]],
    });
  });

  it("rejects batches on the staged source endpoint", async () => {
    const form = new FormData();
    form.append("file", new File(["a"], "a.csv"));
    form.append("file", new File(["b"], "b.csv"));
    await expect(parseSingleAuditSource(new Request("https://example.test/api/v1/audits/a/sources", {
      method: "POST",
      body: form,
    }))).rejects.toThrow("exatamente um arquivo");
  });

  it("allows a staged spreadsheet larger than 10 MB up to the 25 MB limit", async () => {
    const form = new FormData();
    const csv = `tracking,charged_amount\nABC,12.50\n${" ".repeat(11 * 1024 * 1024)}`;
    form.append("file", new File([csv], "large.csv"));
    const parsed = await parseSingleAuditSource(new Request("https://example.test/api/v1/audits/a/sources", {
      method: "POST",
      body: form,
    }));
    expect(parsed.file.size).toBeGreaterThan(10 * 1024 * 1024);
    expect(parsed.sources[0].rows[0]).toEqual(["ABC", "12.50"]);
  });

  it("streams XLSX XML with preamble and keeps only audit-relevant columns", async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
      ["Relatório de vendas"],
      ["N.º de venda", "SKU", "Número de rastreamento", "Nome do comprador"],
      ["ORDER-1", "SKU-1", "TRACK-1", "Pessoa sensível"],
    ]), "Vendas");
    const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx", compression: true });
    const sources = await parseLargeXlsx(new File([bytes], "large.xlsx"), { marketplace: "Mercado Livre" });
    expect(sources[0]).toMatchObject({
      headers: ["N.º de venda", "SKU", "Número de rastreamento"],
      rows: [["ORDER-1", "SKU-1", "TRACK-1"]],
      context: { marketplace: "Mercado Livre" },
    });
  });
});
