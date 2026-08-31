import { AlertTriangle, Inbox, LoaderCircle } from "lucide-react";
import { humanError } from "../../lib/errors";
export const LoadingState = () => (
  <div className="state">
    <LoaderCircle className="spin" />
    <b>Carregando dados...</b>
    <span>Validando a resposta do Worker.</span>
  </div>
);
export const EmptyState = ({
  message = "Nenhum resultado encontrado.",
}: {
  message?: string;
}) => (
  <div className="state">
    <Inbox />
    <b>{message}</b>
    <span>Ajuste os filtros ou inicie uma nova auditoria.</span>
  </div>
);
export const ErrorState = ({ error }: { error: unknown }) => (
  <div className="state error-state">
    <AlertTriangle />
    <b>{humanError(error)}</b>
    <span>Nenhum cálculo local foi executado.</span>
  </div>
);
