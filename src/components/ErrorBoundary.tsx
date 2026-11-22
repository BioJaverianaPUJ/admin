import { Component, type ReactNode } from "react";
import { AlertCircle } from "lucide-react";

/**
 * Evita que un error al dibujar una sección deje la pantalla vacía: muestra
 * un aviso con la opción de reintentar y conserva el resto del módulo.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error("Error en la sección del módulo web:", error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="error" role="alert">
        <AlertCircle />
        <span>
          Esta sección no se pudo mostrar. Puede que el servidor haya devuelto
          datos en un formato inesperado.
          <small className="cell-note">{this.state.error.message}</small>
        </span>
        <button onClick={() => this.setState({ error: null })}>
          Reintentar
        </button>
      </div>
    );
  }
}
