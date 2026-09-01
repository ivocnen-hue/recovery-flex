import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseAuditUpload, parseCsv, parseSingleAuditSource } from "../src/ingestion.js";

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
});
