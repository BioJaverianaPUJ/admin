import { lazy, Suspense, useState } from "react";
import { Box } from "lucide-react";
import { Loading } from "../../components/ui";
const Campus3D = lazy(() => import("../../components/Campus3D"));

/** Panel con la vista 3D del campus; se carga solo cuando se abre. */
export function Campus3DPanel() {
  const [open, setOpen] = useState(false);
  return (
    <section className="glass data-panel campus-3d-panel">
      <div className="panel-title">
        <div>
          <p className="eyebrow">VISTA DEL CAMPUS</p>
          <h2>Campus en 3D</h2>
        </div>
        <button
          className={open ? "" : "primary"}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <Box size={17} />
          {open ? "Ocultar vista 3D" : "Abrir vista 3D"}
        </button>
      </div>
      {open ? (
        <Suspense fallback={<Loading />}>
          <Campus3D />
        </Suspense>
      ) : (
        <p className="campus-3d-teaser">
          Recorre los edificios del campus en volumen para ubicar mejor las
          zonas verdes y los puntos de interés. Datos ilustrativos de
          OpenStreetMap.
        </p>
      )}
    </section>
  );
}
