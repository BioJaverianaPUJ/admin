import { useEffect, useState } from "react";
import { Camera, MapPin, RefreshCw, Search } from "lucide-react";
import { api, errorMessage } from "../../lib/api";
import {
  Badge,
  ErrorBox,
  Loading,
  Empty,
  Pager,
  Modal,
  Notice,
  Toggle,
} from "../../components/ui";
import { CampusMap } from "../../components/CampusMap";

interface Observation {
  id: string;
  latitude: number;
  longitude: number;
  checked: boolean;
  revisionRequested: boolean;
  speciesCommonName: string | null;
  certainty: number | null;
  similarityScore: number | null;
  observationType: "PLANT" | "ANIMAL" | null;
  specimen?: { id: string } | null;
  imageUrl: string | null;
  createdAt: string;
}
/** ObservationListResponse: { content, pagination: { totalPages, ... } }. */
interface ObservationPage {
  content: Observation[];
  pagination?: { totalPages: number; totalElements: number };
  totalPages?: number;
  totalElements?: number;
}

/** RF-14: similitud ≥ 0,25; las plantas además requieren espécimen cercano. */
function verification(o: Observation): [string, string] {
  if (!o.checked) return ["En proceso", "info"];
  const ok =
    (o.similarityScore ?? 0) >= 0.25 &&
    (o.observationType === "ANIMAL" ||
      (o.observationType === "PLANT" && !!o.specimen));
  return ok ? ["Verificada", "live"] : ["No verificada", "warn"];
}
const percent = (v: number | null) =>
  v === null || v === undefined ? "No disponible" : `${Math.round(v * 100)} %`;
const typeLabel = (t: Observation["observationType"]) =>
  t === "PLANT" ? "Planta" : t === "ANIMAL" ? "Animal" : "Sin resultado";

function Photo({ url, alt }: { url: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);
  return url && !failed ? (
    <img
      src={url}
      alt={alt}
      referrerPolicy="no-referrer"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  ) : (
    <span className="photo-empty" aria-label="Sin fotografía">
      <Camera size={18} />
    </span>
  );
}

/** Lista de revisión de observaciones no verificadas (RF-46). */
export function ObservationReviews() {
  const [page, setPage] = useState(0),
    [onlyRequested, setOnlyRequested] = useState(true);
  const [data, setData] = useState<ObservationPage | null>(null),
    [error, setError] = useState("");
  const [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<Observation | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setData(null);
    api<ObservationPage>(
      `/observations?page=${page}&size=12&revisionRequested=${onlyRequested}`,
      { signal: controller.signal },
    )
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [page, onlyRequested, revision]);
  const rows = data?.content ?? [];
  const totalPages = data?.pagination?.totalPages ?? data?.totalPages ?? 0;
  const totalElements =
    data?.pagination?.totalElements ?? data?.totalElements ?? rows.length;
  return (
    <section className="glass data-panel">
      <div className="panel-title">
        <h2>
          {onlyRequested
            ? "Solicitudes de revisión"
            : "Observaciones de la comunidad"}
        </h2>
        <Badge tone="live">Conectado al backend</Badge>
      </div>
      <div className="toolbar">
        <Toggle
          label="Solo solicitudes de revisión"
          checked={onlyRequested}
          onChange={(v) => {
            setOnlyRequested(v);
            setPage(0);
          }}
        />
        <button onClick={() => setRevision((v) => v + 1)} disabled={loading}>
          <RefreshCw size={16} /> Actualizar
        </button>
      </div>
      <Notice>
        Son observaciones que el modelo no pudo verificar y que el usuario pidió
        revisar. Consultarlas no cambia su estado de verificación.
      </Notice>
      {loading && <Loading />}
      {error && (
        <ErrorBox message={error} retry={() => setRevision((v) => v + 1)} />
      )}
      {data && !rows.length && (
        <Empty
          title={
            onlyRequested
              ? "No hay solicitudes de revisión"
              : "Sin observaciones"
          }
        >
          {onlyRequested
            ? "Cuando un usuario pida revisar una observación no verificada, aparecerá aquí."
            : "No hay resultados para este filtro."}
        </Empty>
      )}
      {rows.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Observación</th>
                <th>Tipo</th>
                <th>Confianza</th>
                <th>Similitud</th>
                <th>Verificación</th>
                <th>Acción</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => {
                const [label, tone] = verification(o);
                return (
                  <tr key={o.id}>
                    <td>
                      <div className="post-cell">
                        <Photo
                          url={o.imageUrl}
                          alt={`Fotografía de ${o.speciesCommonName ?? "la observación"}`}
                        />
                        <span>
                          <strong>
                            {o.speciesCommonName || "Sin identificar"}
                          </strong>
                          <small className="cell-note">
                            {new Date(o.createdAt).toLocaleString("es-CO")}
                          </small>
                        </span>
                      </div>
                    </td>
                    <td>{typeLabel(o.observationType)}</td>
                    <td>{percent(o.certainty)}</td>
                    <td>{percent(o.similarityScore)}</td>
                    <td>
                      <Badge tone={tone}>{label}</Badge>
                    </td>
                    <td>
                      <button className="small" onClick={() => setSelected(o)}>
                        <Search size={15} /> Ver
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {data && (
        <Pager
          page={page}
          total={totalPages}
          count={totalElements}
          onPage={setPage}
        />
      )}
      {selected && (
        <Modal
          title={selected.speciesCommonName || "Observación sin identificar"}
          onClose={() => setSelected(null)}
        >
          <div className="observation-detail">
            <div className="observation-photo-frame">
              <Photo
                url={selected.imageUrl}
                alt={`Fotografía de ${selected.speciesCommonName ?? "la observación"}`}
              />
            </div>
            <dl className="review-facts">
              <dt>Especie identificada</dt>
              <dd>{selected.speciesCommonName || "Sin identificar"}</dd>
              <dt>Tipo</dt>
              <dd>{typeLabel(selected.observationType)}</dd>
              <dt>Nivel de confianza</dt>
              <dd>{percent(selected.certainty)}</dd>
              <dt>Similitud</dt>
              <dd>{percent(selected.similarityScore)}</dd>
              <dt>Verificación</dt>
              <dd>
                <Badge tone={verification(selected)[1]}>
                  {verification(selected)[0]}
                </Badge>
              </dd>
              <dt>Fecha</dt>
              <dd>{new Date(selected.createdAt).toLocaleString("es-CO")}</dd>
              <dt>Ubicación</dt>
              <dd>
                <MapPin size={14} /> {selected.latitude.toFixed(6)},{" "}
                {selected.longitude.toFixed(6)}
              </dd>
            </dl>
          </div>
          <CampusMap points={[[selected.latitude, selected.longitude]]} />
          {selected.imageUrl && (
            <p>
              <a
                href={selected.imageUrl}
                target="_blank"
                rel="noopener noreferrer"
                referrerPolicy="no-referrer"
              >
                Abrir la fotografía en tamaño completo
              </a>
            </p>
          )}
        </Modal>
      )}
    </section>
  );
}
