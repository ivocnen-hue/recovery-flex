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

  it("recognizes a structured PDF rule as audit-scoped", async () => {
    const rule = {
      id: "frete_especifico_r12_v1",
      version: "1.0",
      scope: "attached_audit_only",
      conditions: [
        { field: "quantity", op: "lte", value: 3 },
        { field: "weight_g", op: "lt", value: 2000 },
        { field: "max_dimension_cm", op: "lte", value: 80 },
      ],
      calculation: { type: "fixed", amount: 12, currency: "BRL" },
    };
    const marker = `RECOVERY_RULE_B64_${btoa(JSON.stringify(rule))}`;
    const form = new FormData();
    form.append("file", new File([`%PDF-1.4\n/Keywords (${marker})`], "regra.pdf", { type: "application/pdf" }));
    const parsed = await parseSingleAuditSource(new Request("https://example.test/api/v1/audits/a/sources", {
      method: "POST",
      body: form,
    }));
    expect(parsed).toMatchObject({
      kind: "rule",
      sources: [],
      ruleSets: [{ rules: [{ id: "frete_especifico_r12_v1", calculation: { type: "fixed", amount: 12 } }] }],
    });
  });

  it("extracts searchable text from an ordinary PDF for interpretation", async () => {
    const encoded = "JVBERi0xLjMKJZOMi54gUmVwb3J0TGFiIEdlbmVyYXRlZCBQREYgZG9jdW1lbnQgKG9wZW5zb3VyY2UpCjEgMCBvYmoKPDwKL0YxIDIgMCBSCj4+CmVuZG9iagoyIDAgb2JqCjw8Ci9CYXNlRm9udCAvSGVsdmV0aWNhIC9FbmNvZGluZyAvV2luQW5zaUVuY29kaW5nIC9OYW1lIC9GMSAvU3VidHlwZSAvVHlwZTEgL1R5cGUgL0ZvbnQKPj4KZW5kb2JqCjMgMCBvYmoKPDwKL0NvbnRlbnRzIDcgMCBSIC9NZWRpYUJveCBbIDAgMCA1OTUuMjc1NiA4NDEuODg5OCBdIC9QYXJlbnQgNiAwIFIgL1Jlc291cmNlcyA8PAovRm9udCAxIDAgUiAvUHJvY1NldCBbIC9QREYgL1RleHQgL0ltYWdlQiAvSW1hZ2VDIC9JbWFnZUkgXQo+PiAvUm90YXRlIDAgL1RyYW5zIDw8Cgo+PiAKICAvVHlwZSAvUGFnZQo+PgplbmRvYmoKNCAwIG9iago8PAovUGFnZU1vZGUgL1VzZU5vbmUgL1BhZ2VzIDYgMCBSIC9UeXBlIC9DYXRhbG9nCj4+CmVuZG9iago1IDAgb2JqCjw8Ci9BdXRob3IgKGFub255bW91cykgL0NyZWF0aW9uRGF0ZSAoRDoyMDI2MDkwMjE5MjkyNy0wMycwMCcpIC9DcmVhdG9yIChhbm9ueW1vdXMpIC9LZXl3b3JkcyAoKSAvTW9kRGF0ZSAoRDoyMDI2MDkwMjE5MjkyNy0wMycwMCcpIC9Qcm9kdWNlciAoUmVwb3J0TGFiIFBERiBMaWJyYXJ5IC0gXChvcGVuc291cmNlXCkpIAogIC9TdWJqZWN0ICh1bnNwZWNpZmllZCkgL1RpdGxlICh1bnRpdGxlZCkgL1RyYXBwZWQgL0ZhbHNlCj4+CmVuZG9iago2IDAgb2JqCjw8Ci9Db3VudCAxIC9LaWRzIFsgMyAwIFIgXSAvVHlwZSAvUGFnZXMKPj4KZW5kb2JqCjcgMCBvYmoKPDwKL0ZpbHRlciBbIC9BU0NJSTg1RGVjb2RlIC9GbGF0ZURlY29kZSBdIC9MZW5ndGggMTM1Cj4+CnN0cmVhbQpHYXBRaDBFPUYsMFVcSDNUXHBOWVReUUtrP3RjPklQLDtXI1UxXjIzaWhQRU1fP0NXNEtJU2k8IVs3YCNPQl9xdWhwZUNdYDA+V1FUP09VODwvJExSVTxLdTRLdUItUiJYQWBmRj1XJWYncWRpUiJwVU0nK14jLXE9cy5sI1wsYTdNKVZifj5lbmRzdHJlYW0KZW5kb2JqCnhyZWYKMCA4CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDA2MSAwMDAwMCBuIAowMDAwMDAwMDkyIDAwMDAwIG4gCjAwMDAwMDAxOTkgMDAwMDAgbiAKMDAwMDAwMDQwMiAwMDAwMCBuIAowMDAwMDAwNDcwIDAwMDAwIG4gCjAwMDAwMDA3MzEgMDAwMDAgbiAKMDAwMDAwMDc5MCAwMDAwMCBuIAp0cmFpbGVyCjw8Ci9JRCAKWzw3MjBmZDk0OTIzMjkzZTZjNmU1OWEzNjExZDY3MGFhND48NzIwZmQ5NDkyMzI5M2U2YzZlNTlhMzYxMWQ2NzBhYTQ+XQolIFJlcG9ydExhYiBnZW5lcmF0ZWQgUERGIGRvY3VtZW50IC0tIGRpZ2VzdCAob3BlbnNvdXJjZSkKCi9JbmZvIDUgMCBSCi9Sb290IDQgMCBSCi9TaXplIDgKPj4Kc3RhcnR4cmVmCjEwMTUKJSVFT0YK";
    const form = new FormData();
    form.append("marketplace", "Mercado Livre");
    form.append("file", new File([Uint8Array.from(atob(encoded), c => c.charCodeAt(0))], "tabela-ml.pdf", { type: "application/pdf" }));
    const parsed = await parseSingleAuditSource(new Request("https://example.test/api/v1/audits/a/sources", { method: "POST", body: form }));
    expect(parsed.ruleSets).toEqual([]);
    expect(parsed.ruleSources[0]).toMatchObject({ source_name: "tabela-ml.pdf", source_type: "pdf", total_pages: 1 });
    expect(parsed.ruleSources[0].content).toContain("Mercado Livre tarifa ate 2 kg: R$ 12,00");
  });
});
