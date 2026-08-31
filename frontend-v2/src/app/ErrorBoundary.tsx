import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch() {
    /* Dados sensíveis nunca são registrados. */
  }
  render() {
    if (this.state.error)
      return (
        <main className="fatal">
          <AlertTriangle />
          <h1>Não foi possível abrir esta tela.</h1>
          <p>
            Recarregue a página. Nenhum cálculo financeiro foi executado no
            navegador.
          </p>
          <button className="button primary" onClick={() => location.reload()}>
            Recarregar
          </button>
        </main>
      );
    return this.props.children;
  }
}
