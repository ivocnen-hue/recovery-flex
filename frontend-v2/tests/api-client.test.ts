import { afterEach, describe, expect, it, vi } from "vitest";
import audit from "./fixtures/audit-valid.json";
import { request } from "../src/api/client";
import { AuditResponseSchema } from "../src/contracts/schemas";
import { healthApi } from "../src/api/health";
import { auditsApi } from "../src/api/audits";
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
  it("envia arquivos ao Worker sem fazer parsing local", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(audit), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await auditsApi.run({
      seller: "Seller A",
      marketplace: "Mercado Livre",
      operation: "Flex",
      carrier: "Flex SP",
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      files: [new File(["a,b\n1,2"], "charges.csv", { type: "text/csv" })],
    });
    const options = fetchMock.mock.calls[0][1] as RequestInit;
    expect(options.body).toBeInstanceOf(FormData);
    expect(options.credentials).toBe("omit");
  });
});
