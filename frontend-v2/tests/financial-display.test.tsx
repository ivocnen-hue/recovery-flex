import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import findingFixture from "./fixtures/finding-valid.json";
import { FindingDrawer } from "../src/components/findings/FindingDrawer";
import { formatCurrency } from "../src/lib/currency";
import { FindingSchema } from "../src/contracts/schemas";
describe("display financeiro sem engine local", () => {
  it("exibe o total 12876 exatamente como recebido", () =>
    expect(formatCurrency(12876)).toBe("R$ 12.876,00"));
  it("exibe os quatro campos do finding sem derivação", () => {
    const finding = FindingSchema.parse(findingFixture);
    const { container } = render(
      <FindingDrawer finding={finding} onClose={() => undefined} />,
    );
    const grid = container.querySelector(".money-grid")!;
    expect(grid.children[0]).toHaveTextContent("CobradoR$ 24,00");
    expect(grid.children[1]).toHaveTextContent("EsperadoR$ 12,00");
    expect(grid.children[2]).toHaveTextContent("DiferençaR$ 12,00");
    expect(grid.children[3]).toHaveTextContent("RecuperávelR$ 12,00");
  });
  it("não transforma valor ausente em zero", () =>
    expect(formatCurrency(null)).toBe("—"));
});
