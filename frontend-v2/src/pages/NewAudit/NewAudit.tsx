import { FileSpreadsheet, Play, UploadCloud, X } from "lucide-react";
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
  const [files, setFiles] = useState<File[]>([]);
  const [state, setState] = useState<"DRAFT" | "PROCESSING" | "FAILED">(
    "DRAFT",
  );
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const add = (list: FileList | null) =>
    setFiles((old) => [
      ...old,
      ...Array.from(list ?? []).filter(
        (f) => !old.some((x) => x.name === f.name && x.size === f.size),
      ),
    ]);
  const drop = (e: DragEvent) => {
    e.preventDefault();
    add(e.dataTransfer.files);
  };
  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const payload: AuditInput = {
      seller: String(form.get("seller")),
      marketplace: String(form.get("marketplace")),
      operation: String(form.get("operation")),
      carrier: String(form.get("carrier")),
      periodStart: String(form.get("periodStart")),
      periodEnd: String(form.get("periodEnd")),
      files,
    };
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
      <form className="audit-form" onSubmit={submit}>
        <section className="panel form-section">
          <header>
            <div>
              <span className="step">01</span>
              <h3>Contexto da auditoria</h3>
            </div>
          </header>
          <div className="form-grid">
            <label>
              <span>Seller</span>
              <select name="seller" required>
                <option value="">Selecione</option>
                <option>Casa Alva</option>
                <option>Grupo Vitta</option>
              </select>
            </label>
            <label>
              <span>Marketplace</span>
              <select name="marketplace" required>
                <option value="">Selecione</option>
                <option>Mercado Livre</option>
              </select>
            </label>
            <label>
              <span>Operação logística</span>
              <select name="operation" required>
                <option value="">Selecione</option>
                <option>Flex</option>
                <option>Transportadora</option>
              </select>
            </label>
            <label>
              <span>Transportadora</span>
              <input name="carrier" placeholder="Ex.: Flex SP" required />
            </label>
            <label>
              <span>Início do período</span>
              <input name="periodStart" type="date" required />
            </label>
            <label>
              <span>Fim do período</span>
              <input name="periodEnd" type="date" required />
            </label>
          </div>
        </section>
        <section className="panel form-section">
          <header>
            <div>
              <span className="step">02</span>
              <h3>Arquivos de origem</h3>
            </div>
          </header>
          <button
            type="button"
            className="dropzone"
            onClick={() => input.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={drop}
          >
            <UploadCloud />
            <b>Arraste os arquivos ou clique para selecionar</b>
            <span>
              CSV e XLSX · múltiplos arquivos · processados exclusivamente no
              backend
            </span>
          </button>
          <input
            ref={input}
            className="sr-only"
            type="file"
            multiple
            accept=".csv,.xlsx,.xls"
            onChange={(e) => add(e.target.files)}
          />
          <div className="file-list">
            {files.map((file, index) => (
              <div key={file.name + file.size}>
                <FileSpreadsheet />
                <div>
                  <b>{file.name}</b>
                  <small>
                    {(file.size / 1024 / 1024).toLocaleString("pt-BR", {
                      maximumFractionDigits: 2,
                    })}{" "}
                    MB · {file.type || "arquivo"}
                  </small>
                </div>
                <button
                  type="button"
                  className="icon"
                  aria-label={"Remover " + file.name}
                  onClick={() => setFiles(files.filter((_, i) => i !== index))}
                >
                  <X />
                </button>
              </div>
            ))}
          </div>
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
            {files.length
              ? files.length + " arquivo(s) prontos para envio"
              : "Adicione ao menos um arquivo"}
          </span>
          <button
            className="button primary large"
            disabled={!files.length || state === "PROCESSING"}
          >
            <Play />
            Executar auditoria
          </button>
        </div>
      </form>
    </div>
  );
}
