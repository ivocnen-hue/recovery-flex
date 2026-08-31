import { afterEach, describe, expect, it, vi } from "vitest";
import audit from "./fixtures/audit-valid.json";
import { request } from "../src/api/client";
import { AuditResponseSchema } from "../src/contracts/schemas";
afterEach(() => vi.unstubAllGlobals());
describe("API client", () => {
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
});
