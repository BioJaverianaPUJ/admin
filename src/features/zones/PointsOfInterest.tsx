import { useEffect, useState } from "react";
import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import type { Coordinate, Page } from "../../../shared/types";
import { poiPoints, zoneTypes, type Poi } from "../../../shared/poi";
import { api, errorMessage } from "../../lib/api";
import { CampusMap } from "../../components/CampusMap";
import {
  Badge,
  Loading,
  ErrorBox,
  Empty,
  Pager,
  Modal,
  Confirm,
  Notice,
  Toggle,
} from "../../components/ui";
export function PointsOfInterest() {
  const [data, setData] = useState<Page<Poi> | null>(null),
    [page, setPage] = useState(0),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [editing, setEditing] = useState<Poi | null | undefined>(),
    [deleting, setDeleting] = useState<Poi | null>(null),
    [busy, setBusy] = useState(false);
  async function load() {
    setLoading(true);
    setError("");
    try {
      setData(await api<Page<Poi>>(`/social/pois?page=${page}&size=12`));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [page]);
  return (
    <section className="glass data-panel">
      <div className="panel-title">
        <div>
          <p className="eyebrow">LUGARES DEL CAMPUS</p>
          <h2>Puntos de interés</h2>
        </div>
        <div className="panel-actions">
          <Badge tone="live">Conectado al backend</Badge>
          <button
            onClick={() => void load()}
            disabled={loading}
            title="Actualizar puntos de interés"
            aria-label="Actualizar puntos de interés"
          >
            <RefreshCw size={16} className={loading ? "spin" : undefined} />
          </button>
          <button className="primary" onClick={() => setEditing(null)}>
            <Plus size={17} /> Crear punto de interés
          </button>
        </div>
      </div>
      <Notice>
        Las zonas verdes y de interés se guardan en el servidor y aparecen en el
        mapa de la aplicación móvil. El límite del campus se comprueba antes del
        envío.
      </Notice>
      {error && <ErrorBox message={error} retry={load} />}{" "}
      {loading ? (
        <Loading />
      ) : data?.content.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Tipo</th>
                <th>Geometría</th>
                <th>Visibilidad</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {data.content.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>
                    <Badge
                      tone={
                        p.type === "GREEN_ZONE" ? "live" : p.type ? "info" : ""
                      }
                    >
                      {p.type ? zoneTypes[p.type] : "Sin tipo"}
                    </Badge>
                  </td>
                  <td>
                    {p.geometryType === "POINT" ? "Punto y radio" : "Polígono"}
                  </td>
                  <td>{p.visibility === "PUBLIC" ? "Público" : "Privado"}</td>
                  <td>
                    <Badge>{p.active ? "Activo" : "Inactivo"}</Badge>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button
                        title="Editar"
                        aria-label={`Editar ${p.name}`}
                        onClick={() => setEditing(p)}
                      >
                        <Pencil size={17} />
                      </button>
                      <button
                        title="Eliminar"
                        aria-label={`Eliminar ${p.name}`}
                        onClick={() => setDeleting(p)}
                      >
                        <Trash2 size={17} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : !error ? (
        <Empty title="Aún no hay puntos de interés" />
      ) : null}
      {data && (
        <Pager
          page={page}
          total={data.pagination.totalPages}
          count={data.pagination.totalElements}
          onPage={setPage}
        />
      )}
      {editing !== undefined && (
        <PoiEditor
          poi={editing}
          close={() => setEditing(undefined)}
          saved={() => {
            setEditing(undefined);
            void load();
          }}
        />
      )}
      {deleting && (
        <Confirm
          title="Eliminar punto de interés"
          description={`Se eliminará ${deleting.name} del servidor. Esta acción no se puede deshacer.`}
          busy={busy}
          error={error}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            setBusy(true);
            try {
              await api(`/social/pois/${deleting.id}`, { method: "DELETE" });
              setDeleting(null);
              await load();
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </section>
  );
}
function PoiEditor({
  poi,
  close,
  saved,
}: {
  poi: Poi | null;
  close: () => void;
  saved: () => void;
}) {
  const [name, setName] = useState(poi?.name ?? ""),
    [description, setDescription] = useState(poi?.description ?? ""),
    [type, setType] = useState<"POINT" | "POLYGON">(
      poi?.geometryType ?? "POINT",
    ),
    [points, setPoints] = useState<Coordinate[]>(poi ? poiPoints(poi) : []),
    [radius, setRadius] = useState(poi?.radiusMeters ?? 20),
    [visibility, setVisibility] = useState(poi?.visibility ?? "PUBLIC"),
    [zone, setZone] = useState<"GREEN_ZONE" | "INTEREST_ZONE">(
      poi?.type ?? "INTEREST_ZONE",
    ),
    [active, setActive] = useState(poi?.active ?? true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const coordinates =
        type === "POLYGON" && points.length
          ? [...points, points[0]].map(([latitude, longitude]) => ({
              latitude,
              longitude,
            }))
          : undefined;
      await api(poi ? `/social/pois/${poi.id}` : "/social/pois", {
        method: poi ? "PUT" : "POST",
        body: JSON.stringify({
          name,
          description,
          geometryType: type,
          type: zone,
          visibility,
          active,
          ...(type === "POINT"
            ? {
                centerLatitude: points[0]?.[0],
                centerLongitude: points[0]?.[1],
                radiusMeters: radius,
              }
            : { polygonCoordinates: coordinates }),
        }),
      });
      saved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={poi ? "Editar punto de interés" : "Nuevo punto de interés"}
      onClose={() => !busy && close()}
    >
      <form onSubmit={save}>
        <div className="form-grid">
          <label>
            Nombre *
            <input
              required
              maxLength={200}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            Tipo de zona
            <select
              value={zone}
              onChange={(e) =>
                setZone(e.target.value as "GREEN_ZONE" | "INTEREST_ZONE")
              }
            >
              <option value="INTEREST_ZONE">Zona de interés</option>
              <option value="GREEN_ZONE">Zona verde</option>
            </select>
          </label>
          <label>
            Visibilidad
            <select
              value={visibility}
              onChange={(e) =>
                setVisibility(e.target.value as "PUBLIC" | "PRIVATE")
              }
            >
              <option value="PUBLIC">Público</option>
              <option value="PRIVATE">Solo administradores</option>
            </select>
          </label>
          <label>
            Geometría
            <select
              value={type}
              onChange={(e) => {
                setType(e.target.value as "POINT" | "POLYGON");
                setPoints([]);
              }}
            >
              <option value="POINT">Punto con radio</option>
              <option value="POLYGON">Polígono</option>
            </select>
          </label>
          {type === "POINT" && (
            <label>
              Radio (metros)
              <input
                required
                type="number"
                min={1}
                max={1000}
                value={radius}
                onChange={(e) => setRadius(Number(e.target.value))}
              />
            </label>
          )}
        </div>
        <label>
          Descripción
          <textarea
            maxLength={2000}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <p>
          Selecciona {type === "POINT" ? "el centro" : "los vértices"} en el
          mapa. También puedes ajustar las coordenadas.
        </p>
        <CampusMap
          mode={type === "POINT" ? "circle" : "polygon"}
          points={points}
          radius={radius}
          onChange={setPoints}
        />
        <button type="button" onClick={() => setPoints([])}>
          Limpiar geometría
        </button>
        {points.map((p, i) => (
          <div className="form-grid" key={i}>
            <label>
              Latitud {i + 1}
              <input
                type="number"
                step="any"
                value={p[0]}
                onChange={(e) =>
                  setPoints(
                    points.map((v, j) =>
                      j === i ? [Number(e.target.value), v[1]] : v,
                    ),
                  )
                }
              />
            </label>
            <label>
              Longitud {i + 1}
              <input
                type="number"
                step="any"
                value={p[1]}
                onChange={(e) =>
                  setPoints(
                    points.map((v, j) =>
                      j === i ? [v[0], Number(e.target.value)] : v,
                    ),
                  )
                }
              />
            </label>
          </div>
        ))}
        <Toggle
          label="Activo"
          disabled={!poi}
          checked={active}
          onChange={setActive}
        />
        {error && <ErrorBox message={error} />}
        <footer className="form-actions">
          <button type="button" disabled={busy} onClick={close}>
            Cancelar
          </button>
          <button className="primary" disabled={busy || !points.length}>
            {busy ? "Guardando…" : "Guardar en el servidor"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
