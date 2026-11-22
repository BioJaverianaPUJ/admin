import { useEffect, useState, type FormEvent } from "react";
import { Pencil, RefreshCw, Trash2, Trophy, Plus } from "lucide-react";
import {
  achievementMetrics,
  describePredicate,
  xpOptions,
  type Achievement,
  type AchievementMetric,
} from "../../../shared/achievements";
import { api, ApiError, errorMessage } from "../../lib/api";
import {
  Badge,
  Confirm,
  ErrorBox,
  Loading,
  Modal,
  Notice,
  Toggle,
} from "../../components/ui";

/** Logros del servidor (RF-50): condición, experiencia y estado. */
export function Achievements() {
  const [rows, setRows] = useState<Achievement[]>([]);
  const [loading, setLoading] = useState(true),
    [available, setAvailable] = useState(false);
  const [error, setError] = useState(""),
    [revision, setRevision] = useState(0);
  const [edit, setEdit] = useState<Achievement | "new" | null>(null);
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false),
    [formError, setFormError] = useState("");
  const [removing, setRemoving] = useState<Achievement | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setAvailable(false);
    api<Achievement[]>("/achievements", { signal: controller.signal })
      .then((r) => {
        if (!Array.isArray(r))
          throw new Error("La respuesta de logros no es válida.");
        if (!controller.signal.aborted) {
          setRows(r);
          setAvailable(true);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(
            e instanceof ApiError && e.status === 501
              ? "El servicio de logros no está disponible en el backend desplegado."
              : errorMessage(e),
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || edit === null) return;
    const data = new FormData(event.currentTarget);
    const common = {
      name: String(data.get("name")),
      description: String(data.get("description")),
      xpReward: Number(data.get("xpReward")),
      ...(data.has("metric")
        ? {
            metric: String(data.get("metric")),
            target: Number(data.get("target")),
          }
        : {}),
    };
    setBusy(true);
    setFormError("");
    try {
      await api(edit === "new" ? "/achievements" : `/achievements/${edit.id}`, {
        method: edit === "new" ? "POST" : "PUT",
        body: JSON.stringify(
          edit === "new"
            ? { ...common, slug: String(data.get("slug")) }
            : { ...common, active },
        ),
      });
      setEdit(null);
      setRevision((v) => v + 1);
    } catch (e) {
      setFormError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const current = edit && edit !== "new" ? edit : null;
  // Una condición compuesta (y/o) creada en el servidor no se edita aquí.
  const simple = !current?.predicate || !!current.predicate.metric;
  const currentMetric = (current?.predicate?.metric ??
    "observations") as AchievementMetric;
  const currentXp = (xpOptions as readonly number[]).includes(
    current?.xpReward ?? 0,
  )
    ? current!.xpReward
    : 10;
  return (
    <section className="glass data-panel" aria-label="Logros del servidor">
      <div className="panel-title">
        <h2>Logros del servidor</h2>
        <Badge tone={available ? "live" : ""}>
          {available ? "Conectado al backend" : "Por conectar"}
        </Badge>
      </div>
      <Notice>
        El servidor calcula el progreso y otorga la experiencia. Editar o
        eliminar un logro no se lo quita a quienes ya lo obtuvieron.
      </Notice>
      <div className="toolbar">
        <button
          disabled={loading || busy}
          onClick={() => setRevision((v) => v + 1)}
        >
          <RefreshCw size={16} /> Actualizar
        </button>
        <button
          className="primary"
          disabled={!available || busy}
          onClick={() => {
            setFormError("");
            setEdit("new");
          }}
        >
          <Plus size={16} /> Nuevo logro
        </button>
      </div>
      {loading && <Loading />}
      {error && <ErrorBox message={error} />}
      {available && !loading && rows.length === 0 && (
        <p className="lede">No hay logros registrados.</p>
      )}
      {available && rows.length > 0 && (
        <div className="achievement-grid">
          {rows.map((row) => (
            <article
              className={`achievement-card ${row.active ? "" : "inactive"}`}
              key={row.id}
            >
              <header>
                <span className="achievement-icon">
                  <Trophy size={20} />
                </span>
                <div>
                  <h3>{row.name}</h3>
                  <small>{row.slug}</small>
                </div>
                <Badge tone={row.active ? "live" : ""}>
                  {row.active ? "Activo" : "Inactivo"}
                </Badge>
              </header>
              {row.description && <p>{row.description}</p>}
              <p className="achievement-rule">
                {describePredicate(row.predicate)}
              </p>
              <footer>
                <strong>+{row.xpReward} XP</strong>
                <div className="text-actions">
                  <button
                    disabled={busy}
                    onClick={() => {
                      setFormError("");
                      setActive(row.active);
                      setEdit(row);
                    }}
                  >
                    <Pencil size={14} /> Editar
                  </button>
                  <button
                    className="danger-soft"
                    disabled={busy}
                    onClick={() => {
                      setError("");
                      setRemoving(row);
                    }}
                  >
                    <Trash2 size={14} /> Eliminar
                  </button>
                </div>
              </footer>
            </article>
          ))}
        </div>
      )}
      {edit && (
        <Modal
          title={edit === "new" ? "Nuevo logro" : "Editar logro"}
          onClose={() => {
            if (!busy) setEdit(null);
          }}
        >
          <form onSubmit={save} className="form-grid">
            {edit === "new" && (
              <label>
                Identificador único
                <input
                  name="slug"
                  required
                  pattern="[a-z0-9-]+"
                  maxLength={100}
                  placeholder="primeras-observaciones"
                />
              </label>
            )}
            <label>
              Nombre
              <input
                name="name"
                required
                maxLength={200}
                defaultValue={current?.name}
              />
            </label>
            <label>
              Descripción
              <textarea
                name="description"
                maxLength={2000}
                defaultValue={current?.description ?? ""}
              />
            </label>
            <label>
              Experiencia otorgada
              <select name="xpReward" defaultValue={currentXp}>
                {xpOptions.map((xp) => (
                  <option key={xp} value={xp}>
                    {xp} XP
                  </option>
                ))}
              </select>
            </label>
            {!simple && (
              <Notice>
                Condición actual: {describePredicate(current?.predicate)}. Es
                compuesta y se conserva sin cambios.
              </Notice>
            )}
            {simple && (
              <label>
                Actividad
                <select name="metric" defaultValue={currentMetric}>
                  {Object.entries(achievementMetrics).map(([v, text]) => (
                    <option key={v} value={v}>
                      {text}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {simple && (
              <label>
                Cantidad necesaria
                <input
                  name="target"
                  type="number"
                  required
                  min={1}
                  max={100000}
                  defaultValue={current?.predicate?.value ?? 1}
                />
              </label>
            )}
            {edit !== "new" && (
              <Toggle
                label="Activo"
                checked={active}
                onChange={setActive}
                disabled={busy}
              />
            )}
            {formError && <ErrorBox message={formError} />}
            <button type="submit" className="primary" disabled={busy}>
              {busy ? "Guardando…" : "Guardar en el servidor"}
            </button>
          </form>
        </Modal>
      )}
      {removing && (
        <Confirm
          title={`Eliminar el logro «${removing.name}»`}
          description="Quienes ya lo obtuvieron lo conservan con su experiencia (RF-50)."
          busy={busy}
          error={error}
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            setBusy(true);
            setError("");
            try {
              await api(`/achievements/${removing.id}`, { method: "DELETE" });
              setRemoving(null);
              setRevision((v) => v + 1);
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
