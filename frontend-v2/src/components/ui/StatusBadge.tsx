const labels: Record<string, string> = {
  COMPLETED: "Concluída",
  REVIEW_REQUIRED: "Revisão",
  FAILED: "Falhou",
  PROCESSING: "Processando",
  UPLOADING: "Enviando",
  DRAFT: "Rascunho",
  OVERCHARGED: "Recuperável",
  OK: "Correto",
  PENDING: "Pendente",
};
export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={"status status-" + status.toLowerCase()}>
      <i />
      {labels[status] ?? status}
    </span>
  );
}
