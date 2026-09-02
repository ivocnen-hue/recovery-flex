import { afterEach, describe, expect, it, vi } from "vitest";
import audit from "./fixtures/audit-valid.json";
import { request } from "../src/api/client";
import { AuditResponseSchema } from "../src/contracts/schemas";
import { healthApi } from "../src/api/health";
import { auditsApi } from "../src/api/audits";
import { RecoveryError } from "../src/lib/errors";
import { z } from "zod";
afterEach(() => vi.unstubAllGlobals());
describe("API client", () => {
  it("consulta e valida o health check canônico", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: true,
            service: "Recovery Audit Engine",
            version: "0.5.1",
            features: ["deterministic audit"],
            endpoints: ["/api/v1/health"],
          }),
          { status: 200 },
        ),
      ),
    );
    await expect(healthApi.get()).resolves.toMatchObject({ version: "0.5.1" });
  });
  it("valida resposta antes de entregá-la à UI", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify(audit), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        ),
    );
    await expect(
      request("/api/v1/audits/a", AuditResponseSchema),
    ).resolves.toMatchObject({ audit_id: "audit_123" });
  });
  it("classifica falha de rede", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(
      request("/api/v1/audits/a", AuditResponseSchema),
    ).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  });
  it("explica quando o processamento excede o tempo", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError")));
    await expect(
      request("/api/v1/audits", AuditResponseSchema),
    ).rejects.toMatchObject({
      message: "O processamento excedeu o tempo de espera. Tente novamente com menos arquivos.",
    });
  });
  it("classifica erro HTTP", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({
              ok: false,
              error: { code: "FAILED", message: "Falha controlada" },
            }),
            { status: 422 },
          ),
        ),
    );
    await expect(
      request("/api/v1/audits/a", AuditResponseSchema),
    ).rejects.toMatchObject({ code: "API_ERROR", message: "Falha controlada" });
  });
  it("preserva perguntas de esclarecimento retornadas pelo Worker", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: false,
      error: {
        code: "RULE_CLARIFICATION_REQUIRED",
        message: "Precisamos de uma resposta.",
        details: { required_inputs: [{ id: "validity", title: "Vigência", question: "Qual é a vigência?", answer_type: "date_range", options: [], help: "Informe as datas." }] },
      },
    }), { status: 422 })));
    try {
      await request("/test", z.object({ ok: z.literal(true) }));
      throw new Error("expected request to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(RecoveryError);
      expect((error as RecoveryError).debug?.required_inputs).toEqual([
        expect.objectContaining({ id: "validity", question: "Qual é a vigência?" }),
      ]);
    }
  });
  it("preserva perguntas mesmo quando uma resposta de erro futura não passa no contrato completo", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: false,
      schema_version: "1.0",
      error: {
        code: "RULE_CLARIFICATION_REQUIRED",
        message: "Precisamos de respostas para interpretar o PDF com segurança.",
        details: {
          filename: "tabela.pdf",
          required_inputs: [{
            id: "seller_reputation",
            title: "Reputação",
            question: "Qual era a reputação?",
            answer_type: "single_choice",
            options: ["Verde"],
            // Simula uma evolução parcial do Worker sem o campo help antigo.
          }],
        },
      },
    }), { status: 422 })));

    try {
      await request("/test", z.object({ ok: z.literal(true) }));
      throw new Error("expected request to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(RecoveryError);
      expect(error).toMatchObject({
        message: "Precisamos de respostas para interpretar o PDF com segurança.",
        debug: {
          filename: "tabela.pdf",
          required_inputs: [expect.objectContaining({ id: "seller_reputation" })],
        },
      });
    }
  });
  it("interrompe resposta incompatível", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ ...audit, schema_version: "2.0" }), {
            status: 200,
          }),
        ),
    );
    await expect(
      request("/api/v1/audits/a", AuditResponseSchema),
    ).rejects.toMatchObject({
      code: "SCHEMA_MISMATCH",
      message: "Resposta incompatível com a versão atual da API.",
    });
  });
  it("envia um arquivo por vez ao Worker sem fazer parsing local", async () => {
    const draft = { ok: true, schema_version: "1.0", audit_id: "audit-staged", status: "UPLOADING" };
    const source = (name: string, id: string) => ({
      ok: true,
      schema_version: "1.0",
      audit_id: "audit-staged",
      source_id: id,
      filename: name,
      source_rows: 1,
      sheets: 1,
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(draft), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(source("charges.csv", "s1")), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(source("orders.csv", "s2")), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(audit), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await auditsApi.run({
      seller: "Seller A",
      marketplace: "Mercado Livre",
      operation: "Flex",
      carrier: "Flex SP",
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      files: [
        new File(["a,b\n1,2"], "charges.csv", { type: "text/csv" }),
        new File(["a,b\n3,4"], "orders.csv", { type: "text/csv" }),
      ],
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual([
      expect.stringContaining("/api/v1/audits/drafts"),
      expect.stringContaining("/api/v1/audits/audit-staged/sources"),
      expect.stringContaining("/api/v1/audits/audit-staged/sources"),
      expect.stringContaining("/api/v1/audits/audit-staged/run"),
    ]);
    for (const index of [1, 2]) {
      const options = fetchMock.mock.calls[index][1] as RequestInit;
      expect(options.body).toBeInstanceOf(FormData);
      expect((options.body as FormData).getAll("file")).toHaveLength(1);
      expect(options.credentials).toBe("omit");
    }
  });
});
