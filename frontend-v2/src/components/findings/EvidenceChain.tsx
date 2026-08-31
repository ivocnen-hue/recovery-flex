import { ArrowDown, FileSpreadsheet, GitMerge, Scale } from "lucide-react";
import type { Evidence } from "../../contracts/types";
export function EvidenceChain({ items }: { items: Evidence[] }) {
  if (!items.length)
    return <p className="muted">Nenhuma evidência associada foi retornada.</p>;
  return (
    <div className="evidence-chain">
      {items.map((item, index) => (
        <div className="evidence-node" key={item.evidence_id}>
          <div className="evidence-icon">
            <FileSpreadsheet />
          </div>
          <div>
            <small>ORIGEM {index + 1}</small>
            <b>{item.source_file}</b>
            <p>
              {item.sheet ?? "Aba não informada"} · Linha {item.row ?? "—"} ·{" "}
              {item.original_column ?? "Coluna não informada"}
            </p>
            <dl>
              <div>
                <dt>Valor original</dt>
                <dd>{String(item.original_value ?? "—")}</dd>
              </div>
              <div>
                <dt>Campo canônico</dt>
                <dd>
                  {item.canonical_field ?? "—"} →{" "}
                  {String(item.normalized_value ?? "—")}
                </dd>
              </div>
            </dl>
          </div>
          {index < items.length - 1 && <ArrowDown className="chain-arrow" />}
        </div>
      ))}
      <div className="evidence-result">
        <GitMerge />
        <span>Match</span>
        <b>
          {items[0].match_method ?? "—"} ·{" "}
          {items[0].confidence == null
            ? "—"
            : Math.round(items[0].confidence * 100) + "%"}
        </b>
      </div>
      <div className="evidence-result accent">
        <Scale />
        <span>Regra</span>
        <b>{items[0].rule ?? "Não informada"}</b>
      </div>
    </div>
  );
}
