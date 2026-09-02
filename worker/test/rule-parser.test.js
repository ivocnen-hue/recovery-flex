import { afterEach, describe, expect, it, vi } from "vitest";
import { parseRuleSourceWithAI } from "../src/index.js";

const aiResponse = payload => new Response(JSON.stringify({ output_text: JSON.stringify(payload) }), {
  status: 200,
  headers: { "content-type": "application/json" },
});

describe("PDF rule interpretation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("accepts an explicit tariff table expanded into deterministic ranges", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => aiResponse({
      rule_set: {
        name: "Tabela Mercado Livre",
        marketplace: "Mercado Livre",
        rules: [
          { id: "ate_2kg", priority: 10, conditions: [{ field: "weight_g", op: "lte", value: 2000 }], calculation: { type: "fixed", amount: 12 }, source_reference: "tabela.pdf" },
          { id: "2kg_a_5kg", priority: 10, conditions: [{ field: "weight_g", op: "between", min: 2000.01, max: 5000 }], calculation: { type: "fixed", amount: 18 }, source_reference: "tabela.pdf" },
        ],
      },
      ambiguities: [],
      warnings: [],
    })));
    const parsed = await parseRuleSourceWithAI({ OPENAI_API_KEY: "test" }, { source_name: "tabela.pdf", content: "Tabela de fretes" }, "seller-1");
    expect(parsed.ambiguities).toEqual([]);
    expect(parsed.rule_set.rules).toHaveLength(2);
    expect(parsed.rule_set.seller_id).toBe("seller-1");
  });

  it("rejects malformed or incomplete AI conditions instead of calculating", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => aiResponse({
      rule_set: {
        name: "Tabela ambígua",
        rules: [{ id: "faixa_sem_limite", conditions: [{ field: "weight_g", op: "between", min: null, max: 5000 }], calculation: { type: "fixed", amount: 12 } }],
      },
      ambiguities: [],
      warnings: [],
    })));
    const parsed = await parseRuleSourceWithAI({ OPENAI_API_KEY: "test" }, { source_name: "tabela.pdf", content: "Tabela incompleta" }, "seller-1");
    expect(parsed.rule_set.rules).toEqual([]);
    expect(parsed.ambiguities[0]).toContain("fora do contrato executável seguro");
  });
});
