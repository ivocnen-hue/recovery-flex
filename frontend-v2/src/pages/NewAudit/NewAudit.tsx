import { CalendarRange, FileCheck2, FileSpreadsheet, FileText, Play, Plus, Store, Truck, UploadCloud, X } from "lucide-react";
import { DragEvent, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { AuditInput } from "../../contracts/types";
import { auditsApi } from "../../api/audits";
import { humanError } from "../../lib/errors";
const stages = [
  "Processando arquivos...",
  "Identificando layouts...",
  "Normalizando dados...",
  "Conciliando pedidos...",
  "Aplicando regras...",
  "Gerando evidências...",
];
export function NewAudit() {
  const navigate = useNavigate();
  const [dataFiles, setDataFiles] = useState<File[]>([]);
  const [ruleFiles, setRuleFiles] = useState<File[]>([]);
  const [channels, setChannels] = useState<string[]>([]);
  const [customChannel, setCustomChannel] = useState("");
  const [state, setState] = useState<"DRAFT" | "PROCESSING" | "FAILED">(
    "DRAFT",
  );
  const [error, setError] = useState("");
  const [periodPreset, setPeriodPreset] = useState("custom");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const dataInput = useRef<HTMLInputElement>(null);
  const ruleInput = useRef<HTMLInputElement>(null);
  const add = (kind: "data" | "rule", list: FileList | File[] | null) => {
    const setter = kind === "data" ? setDataFiles : setRuleFiles;
    setter((old) => [
      ...old,
      ...Array.from(list ?? []).filter(
        (f) => !old.some((x) => x.name === f.name && x.size === f.size),
      ),
    ]);
  };
  const dropMixed = (e: DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    const data = files.filter((file) => !file.name.toLowerCase().endsWith(".pdf"));
    const rules = files.filter((file) => file.name.toLowerCase().endsWith(".pdf"));
    if (data.length) add("data", data);
    if (rules.length) add("rule", rules);
  };
  const knownChannels = ["Mercado Livre", "Shopee", "Amazon", "Magalu", "B2B / atacado", "Transporte avulso"];
  const toggleChannel = (channel: string) => setChannels((current) => current.includes(channel) ? current.filter((value) => value !== channel) : [...current, channel]);
  const addCustomChannel = () => {
    const value = customChannel.trim();
    if (value && !channels.includes(value)) setChannels((current) => [...current, value]);
    setCustomChannel("");
  };
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const payload: AuditInput = {
      seller: String(form.get("seller")),
      channels,
      operation: String(form.get("operation")),
      carrier: String(form.get("carrier")),
      periodStart: String(form.get("periodStart")),
      periodEnd: String(form.get("periodEnd")),
      files: [...dataFiles, ...ruleFiles],
    };
    if (!payload.channels?.length) {
      setState("FAILED");
      setError("Selecione ao menos uma origem da operação.");
      return;
    }
    if (!dataFiles.length) {
      setState("FAILED");
      setError("Adicione ao menos uma planilha ou CSV para conciliar.");
      return;
    }
    setState("PROCESSING");
    setError("");
    try {
      await auditsApi.run(payload);
      navigate("/audits");
    } catch (err) {
      setState("FAILED");
      setError(humanError(err));
    }
  };
  const applyPeriodPreset = (value: string) => {
    setPeriodPreset(value);
    if (value === "custom") return;
    const today = new Date();
    const end = today.toISOString().slice(0, 10);
    let start = new Date(today);
    if (value === "30d") start.setDate(start.getDate() - 29);
    if (value === "month") start = new Date(today.getFullYear(), today.getMonth(), 1);
    if (value === "year") start = new Date(today.getFullYear(), 0, 1);
    setPeriodStart(start.toISOString().slice(0, 10));
    setPeriodEnd(end);
  };
  return (
    <div className="page">
      <section className="page-intro">
        <div>
          <h2>Nova auditoria</h2>
          <p>
            Envie as fontes ao Worker. O navegador não lê nem calcula as
            planilhas.
          </p>
        </div>
        <span className={"status status-" + state.toLowerCase()}>
          <i />
          {state}
        </span>
      </section>
      <form className="audit-form new-audit-form" onSubmit={submit}>
        <section className="panel form-section">
          <header>
            <div>
              <span className="step">01</span>
              <h3>Contexto da auditoria</h3>
            </div>
          </header>
          <div className="form-grid audit-context-grid">
            <label>
              <span>Seller</span>
              <input name="seller" list="seller-options" placeholder="Empresa ou conta auditada" required />
              <datalist id="seller-options"><option value="Casa Alva" /><option value="Grupo Vitta" /></datalist>
            </label>
            <label>
              <span>Tipo de operação</span>
              <select name="operation" required>
                <option value="">Selecione</option>
                <option>Flex</option>
                <option>Transportadora</option>
                <option>B2B / atacado</option>
                <option>Fulfillment</option>
                <option>Transferência entre unidades</option>
                <option>Operação própria</option>
              </select>
            </label>
            <label>
              <span>Transportadora / parceiro logístico</span>
              <input name="carrier" placeholder="Ex.: GT2, Jadlog, operação própria" />
            </label>
          </div>

          <div className="audit-scope-row">
            <label className="scope-field origin-field"><span>Origens da conciliação</span><details className="origin-select"><summary><Store /><span>{channels.length ? `${channels.length} origem(ns) selecionada(s)` : "Selecionar marketplaces e operações"}</span></summary><div className="origin-menu"><div className="origin-options">{knownChannels.map((channel) => <label key={channel} className={channels.includes(channel) ? "selected" : ""}><input aria-label={channel} type="checkbox" checked={channels.includes(channel)} onChange={() => toggleChannel(channel)} /><span>{channel === "Transporte avulso" ? <Truck /> : <Store />}{channel}</span></label>)}</div><div className="custom-origin"><input aria-label="Outra origem" value={customChannel} onChange={(event) => setCustomChannel(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addCustomChannel(); } }} placeholder="Outra origem ou marketplace..." /><button type="button" className="button" onClick={addCustomChannel}><Plus /> Adicionar</button></div></div></details>{!!channels.length && <div className="selected-origins">{channels.map((channel) => <span key={channel}>{channel}<button type="button" aria-label={`Remover origem ${channel}`} onClick={() => toggleChannel(channel)}><X /></button></span>)}</div>}</label>
            <label className="scope-field"><span>Período</span><select value={periodPreset} onChange={(e) => applyPeriodPreset(e.target.value)}><option value="custom">Datas personalizadas</option><option value="30d">Últimos 30 dias</option><option value="month">Este mês</option><option value="year">Este ano</option></select></label>
            <label className="scope-field"><span>Data inicial</span><div className="date-control"><CalendarRange /><input aria-label="Início do período" name="periodStart" type="date" value={periodStart} onChange={(e) => { setPeriodPreset("custom"); setPeriodStart(e.target.value); }} required /></div></label>
            <label className="scope-field"><span>Data final</span><div className="date-control"><CalendarRange /><input aria-label="Fim do período" name="periodEnd" type="date" value={periodEnd} onChange={(e) => { setPeriodPreset("custom"); setPeriodEnd(e.target.value); }} required /></div></label>
          </div>
        </section>
        <section className="panel form-section">
          <header>
            <div>
              <span className="step">02</span>
              <h3>Arquivos da auditoria</h3>
            </div>
            <span className="upload-header-note"><FileCheck2 /> Enviados juntos ao mesmo dossiê</span>
          </header>
          <div className="unified-upload"><div className="dropzone unified" onDragOver={(e) => e.preventDefault()} onDrop={dropMixed}><UploadCloud /><b>Arraste todos os arquivos da auditoria aqui</b><span>Planilhas de pedidos, vendas, cobranças e envios — CSV, XLS ou XLSX</span><div className="upload-actions"><button type="button" onClick={() => dataInput.current?.click()}><FileSpreadsheet /> Selecionar planilhas</button><button type="button" onClick={() => ruleInput.current?.click()}><FileText /> Adicionar regras em PDF</button></div></div><input ref={dataInput} className="sr-only" type="file" multiple accept=".csv,.xlsx,.xls" onChange={(e) => add("data", e.target.files)} /><input ref={ruleInput} className="sr-only" type="file" multiple accept=".pdf" onChange={(e) => add("rule", e.target.files)} /><div className="unified-file-lists">{dataFiles.map((file, index) => <div key={file.name + file.size} className="file-chip"><FileSpreadsheet /><div><b>{file.name}</b><small>Planilha · {(file.size / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} MB</small></div><button type="button" className="icon" aria-label={"Remover " + file.name} onClick={() => setDataFiles(dataFiles.filter((_, i) => i !== index))}><X /></button></div>)}{ruleFiles.map((file, index) => <div key={file.name + file.size} className="file-chip rule"><FileText /><div><b>{file.name}</b><small>Regra / contrato · {(file.size / 1024 / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} MB</small></div><button type="button" className="icon" aria-label={"Remover " + file.name} onClick={() => setRuleFiles(ruleFiles.filter((_, i) => i !== index))}><X /></button></div>)}</div></div>
        </section>
        {state === "PROCESSING" && (
          <section className="panel processing">
            <span className="loader" />
            <div>
              <h3>Processando arquivos e conciliando evidências...</h3>
              {stages.map((stage) => (
                <p key={stage}>{stage}</p>
              ))}
            </div>
          </section>
        )}
        {error && (
          <div className="form-error">
            {error}
            <small>Nenhum fallback financeiro local foi executado.</small>
          </div>
        )}
        <div className="submit-row">
          <span>
            {dataFiles.length || ruleFiles.length
              ? `${dataFiles.length} fonte(s) · ${ruleFiles.length} regra(s) prontas para envio`
              : "Adicione ao menos uma planilha"}
          </span>
          <button
            className="button primary large"
            disabled={!dataFiles.length || state === "PROCESSING"}
          >
            <Play />
            Executar auditoria
          </button>
        </div>
      </form>
    </div>
  );
}
