import { BookOpenCheck, FileText, X } from "lucide-react";
import type { Finding } from "../../contracts/types";

const knownRuleSummaries: Record<string, string> = {
  frete_especifico_r12_v1: "Até 3 unidades, peso inferior a 2 kg e dimensão máxima de 80 cm: valor devido de R$ 12,00.",
};

export function RulesDrawer({ findings, open, onClose }: { findings: Finding[]; open: boolean; onClose: () => void }) {
  if (!open) return null;
  const catalog = new Map<string, { id: string; versions: Set<string>; sources: Set<string>; count: number }>();
  for (const finding of findings) {
    const id = finding.rule_id ?? "Sem regra identificada";
    const entry = catalog.get(id) ?? { id, versions: new Set<string>(), sources: new Set<string>(), count: 0 };
    if (finding.rule_version) entry.versions.add(finding.rule_version);
    for (const evidence of finding.evidence) if (evidence.rule) entry.sources.add(evidence.rule);
    entry.count += 1;
    catalog.set(id, entry);
  }

  return <>
    <button className="drawer-scrim" onClick={onClose} aria-label="Fechar regras" />
    <aside className="drawer rules-drawer" role="dialog" aria-modal="true" aria-label="Regras da auditoria">
      <header><div><small>REGRAS DA AUDITORIA</small><h2>Critérios aplicados</h2></div><button className="icon" onClick={onClose} aria-label="Fechar"><X /></button></header>
      <div className="drawer-content">
        <div className="rules-notice"><BookOpenCheck /><div><b>Fonte da verdade: backend</b><span>Este painel explica as regras registradas nas evidências. Os cálculos continuam sendo feitos exclusivamente pelo Worker.</span></div></div>
        <div className="rules-catalog">{[...catalog.values()].map((rule) => <section key={rule.id} className="rule-card">
          <header><div><span>Regra</span><h3>{rule.id}</h3></div><b>{rule.count.toLocaleString("pt-BR")} casos</b></header>
          <p>{knownRuleSummaries[rule.id] ?? "O backend não forneceu uma descrição textual para esta regra."}</p>
          <dl><div><dt>Versão / referência</dt><dd>{[...rule.versions].join(", ") || "Não informada"}</dd></div><div><dt>Documento/evidência</dt><dd>{rule.sources.size ? [...rule.sources].map((source) => <span key={source}><FileText /> {source}</span>) : "Não informado"}</dd></div></dl>
        </section>)}</div>
      </div>
    </aside>
  </>;
}
