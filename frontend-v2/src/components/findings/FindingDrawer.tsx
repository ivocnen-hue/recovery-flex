import { X } from "lucide-react";
import type { Finding } from "../../contracts/types";
import { formatCurrency } from "../../lib/currency";
import { formatConfidence } from "../../lib/confidence";
import { findingDimensionsDisplay, findingMeasurementComparison, findingProductDisplay, findingSkuDisplay } from "../../lib/findings";
import { StatusBadge } from "../ui/StatusBadge";
import { EvidenceChain } from "./EvidenceChain";
export function FindingDrawer({
  finding,
  onClose,
}: {
  finding: Finding | null;
  onClose: () => void;
}) {
  if (!finding) return null;
  const technical = findingDimensionsDisplay(finding);
  const comparison = findingMeasurementComparison(finding);
  return (
    <>
      <button
        className="drawer-scrim"
        onClick={onClose}
        aria-label="Fechar detalhe"
      />
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Detalhe do finding"
      >
        <header>
          <div>
            <small>DETALHE DO FINDING</small>
            <h2>{finding.finding_id}</h2>
          </div>
          <button className="icon" onClick={onClose} aria-label="Fechar">
            <X />
          </button>
        </header>
        <div className="drawer-content">
          <StatusBadge status={finding.status} />
          <section>
            <h3>Resumo financeiro</h3>
            <div className="money-grid">
              <div>
                <span>Cobrado</span>
                <b>{formatCurrency(finding.charged_amount)}</b>
              </div>
              <div>
                <span>Esperado</span>
                <b>{formatCurrency(finding.expected_amount)}</b>
              </div>
              <div>
                <span>Diferença</span>
                <b>{formatCurrency(finding.difference)}</b>
              </div>
              <div className="highlight">
                <span>Recuperável</span>
                <b>{formatCurrency(finding.recoverable_amount)}</b>
              </div>
            </div>
          </section>
          {comparison && <section>
            <h3>ERP do seller × marketplace</h3>
            <dl className="detail-list">
              <div><dt>Vínculo com ERP</dt><dd>{comparison.matched ? "SKU exato e cadastro completo" : "Pendente de revisão"}</dd></div>
              <div><dt>Dimensões ERP</dt><dd>{comparison.sellerDimensions}</dd></div>
              <div><dt>Dimensões marketplace</dt><dd>{comparison.marketplaceDimensions}</dd></div>
              <div><dt>Peso ERP</dt><dd>{comparison.sellerWeight}</dd></div>
              <div><dt>Peso marketplace</dt><dd>{comparison.marketplaceWeight}</dd></div>
              <div><dt>Cubagem ERP</dt><dd>{comparison.sellerVolume}</dd></div>
              <div><dt>Cubagem marketplace</dt><dd>{comparison.marketplaceVolume}</dd></div>
              <div><dt>Comparação</dt><dd>{comparison.discrepancy ? "Divergência identificada" : comparison.matched ? "Sem divergência" : "Não comparada"}</dd></div>
              <div><dt>Fonte ERP</dt><dd>{comparison.source ?? "Não vinculada"}</dd></div>
              {comparison.reason && <div><dt>Pendência</dt><dd>{comparison.reason}</dd></div>}
            </dl>
          </section>}
          <section>
            <h3>Identificadores e matching</h3>
            <dl className="detail-list">
              <div>
                <dt>Tracking</dt>
                <dd>{finding.tracking_number ?? "—"}</dd>
              </div>
              <div>
                <dt>Pedido</dt>
                <dd>{finding.order_id ?? "—"}</dd>
              </div>
              <div>
                <dt>Shipment</dt>
                <dd>{finding.shipment_id ?? "—"}</dd>
              </div>
              <div>
                <dt>SKU(s)</dt>
                <dd>{findingSkuDisplay(finding)}</dd>
              </div>
              <div>
                <dt>Produto(s)</dt>
                <dd>{findingProductDisplay(finding) ?? "Não identificado"}</dd>
              </div>
              <div>
                <dt>Dimensões</dt>
                <dd>{technical.dimensions}</dd>
              </div>
              <div>
                <dt>Peso</dt>
                <dd>{technical.weight ?? "Não identificado"}</dd>
              </div>
              <div>
                <dt>Match method</dt>
                <dd>{finding.match_method ?? "—"}</dd>
              </div>
              <div>
                <dt>Confidence</dt>
                <dd>{formatConfidence(finding.confidence)}</dd>
              </div>
              <div>
                <dt>Regra usada</dt>
                <dd>
                  {finding.rule_id ?? "—"} {finding.rule_version ?? ""}
                </dd>
              </div>
            </dl>
          </section>
          <section>
            <h3>Cadeia de evidências</h3>
            <EvidenceChain items={finding.evidence} />
          </section>
        </div>
      </aside>
    </>
  );
}
