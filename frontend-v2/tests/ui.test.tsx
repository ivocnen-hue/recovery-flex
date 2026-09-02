import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { Dashboard } from "../src/pages/Dashboard/Dashboard";
import { Audits } from "../src/pages/Audits/Audits";
import { Findings } from "../src/pages/Findings/Findings";
import { NewAudit } from "../src/pages/NewAudit/NewAudit";
import { AuditTable } from "../src/components/audits/AuditTable";
import { demoAudits } from "../src/mocks/demoData";
const renderPage = (node: React.ReactNode) =>
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
describe("Fase 1", () => {
  it("renderiza dashboard e summary", async () => {
    renderPage(<Dashboard />);
    expect((await screen.findAllByText("R$ 81.736,00")).length).toBeGreaterThan(
      0,
    );
    expect(screen.getByText("Linhas processadas")).toBeInTheDocument();
  });
  it("filtra auditorias", async () => {
    const user = userEvent.setup();
    renderPage(<Audits />);
    await screen.findByText("AUD-024");
    await user.type(screen.getByLabelText("Buscar auditorias"), "Grupo Vitta");
    expect(screen.queryByText("AUD-024")).not.toBeInTheDocument();
    expect(screen.getByText("AUD-022")).toBeInTheDocument();
  });
  it("renderiza upload e lista arquivo", async () => {
    const user = userEvent.setup();
    const { container } = renderPage(<NewAudit />);
    const input = container.querySelector(
      "input[type=file]",
    ) as HTMLInputElement;
    await user.upload(input, new File(["a"], "flex.csv", { type: "text/csv" }));
    expect(screen.getByText("flex.csv")).toBeInTheDocument();
  });
  it("escolhe auditoria, exibe totais e abre um caso do dossiê", async () => {
    const user = userEvent.setup();
    renderPage(<Findings />);
    expect(await screen.findByText("Selecione a auditoria acima")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Escolher auditoria"), demoAudits[0].audit_id);
    await screen.findByText("MEL245987310BR");
    expect(screen.getByText("Valor total cobrado")).toBeInTheDocument();
    expect(screen.getByText("Valor total devido")).toBeInTheDocument();
    expect(screen.getByText("Valor recuperável")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Canal" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "SKU / produto" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Dimensões / peso" })).toBeInTheDocument();
    expect(screen.getByText("Período auditado")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Exportar Excel" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: /Ver regras/ }));
    expect(screen.getByRole("dialog", { name: "Regras da auditoria" })).toBeInTheDocument();
    expect(screen.getByText("Regras interpretadas do PDF pelo Worker")).toBeInTheDocument();
    expect(screen.getByText("Quantidade de unidades menor ou igual a 3")).toBeInTheDocument();
    expect(screen.getByText("Peso menor que 2 kg")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Baixar PDF original" })).toBeInTheDocument();
    await user.click(screen.getByLabelText("Fechar"));
    await user.click(screen.getByText("MEL245987310BR"));
    expect(
      screen.getByRole("dialog", { name: "Detalhe do finding" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Cadeia de evidências")).toBeInTheDocument();
    await user.click(screen.getByLabelText("Fechar"));
    await user.selectOptions(screen.getByLabelText("Status"), "PENDING");
    expect(screen.getByText("MEL245985019BR")).toBeInTheDocument();
  });
  it("abre a auditoria selecionada pela rota de detalhe", () => {
    renderPage(<AuditTable items={[demoAudits[0]]} />);
    expect(screen.getByLabelText("Abrir " + demoAudits[0].audit_id)).toHaveAttribute(
      "href",
      "/audits/" + demoAudits[0].audit_id,
    );
  });
  it("permite escolher múltiplas origens e atalhos de data", async () => {
    const user = userEvent.setup();
    renderPage(<NewAudit />);
    await user.click(screen.getByLabelText("Mercado Livre"));
    await user.click(screen.getByLabelText("Shopee"));
    await user.selectOptions(screen.getByDisplayValue("Escolher datas"), "30d");
    expect(screen.getByLabelText("Mercado Livre")).toBeChecked();
    expect(screen.getByLabelText("Shopee")).toBeChecked();
    expect(screen.getByLabelText("Início do período")).not.toHaveValue("");
  });
});
