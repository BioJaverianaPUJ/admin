import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  CalendarClock,
  CalendarDays,
  CalendarRange,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { describePredicate, xpOptions } from "../../../shared/achievements";
import {
  missionTypes,
  type Mission,
  type MissionType,
} from "../../../shared/gamification";
import type { Predicate } from "../../../shared/predicate";
import { PredicateBuilder } from "./PredicateBuilder";
import { api, errorMessage } from "../../lib/api";
import {
  Badge,
  Confirm,
  Empty,
  ErrorBox,
  Loading,
  Modal,
  Notice,
  Toggle,
} from "../../components/ui";

const typeIcons = {
  DAILY: CalendarDays,
  WEEKLY: CalendarRange,
  EVENT: CalendarClock,
} as const;

/** Fecha ISO → valor de <input type="datetime-local"> en hora local. */
function toLocal(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}
const fmt = (iso: string) =>
  new Date(iso).toLocaleString("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
  });

function eventState(m: Mission) {
  if (m.type !== "EVENT" || !m.startTime || !m.endTime) return null;
  const now = Date.now();
  if (now < Date.parse(m.startTime)) return "Programada";
  if (now > Date.parse(m.endTime)) return "Finalizada";
  return "En curso";
}

/** Misiones del servidor (RF-49): diarias, semanales y de evento. */
export function Missions() {
  const [rows, setRows] = useState<Mission[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0),
    [filter, setFilter] = useState<"" | MissionType>(""),
    [status, setStatus] = useState<"" | "active" | "inactive">(""),
    [q, setQ] = useState(""),
    [edit, setEdit] = useState<Mission | "new" | null>(null),
    [type, setType] = useState<MissionType>("DAILY"),
    [active, setActive] = useState(true),
    [busy, setBusy] = useState(false),
    [formError, setFormError] = useState(""),
    [removing, setRemoving] = useState<Mission | null>(null);
  const [condition, setCondition] = useState<{
    predicate?: Predicate;
    error?: string;
  }>({});

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<Mission[]>("/missions", { signal: controller.signal })
      .then((r) => {
        if (!Array.isArray(r))
          throw new Error("La respuesta de misiones no es válida.");
        if (!controller.signal.aborted) setRows(r);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [revision]);

  const counts = useMemo(() => {
    const c = { DAILY: 0, WEEKLY: 0, EVENT: 0 } as Record<MissionType, number>;
    for (const m of rows) c[m.type] = (c[m.type] ?? 0) + 1;
    return c;
  }, [rows]);
  const visible = rows.filter((m) => {
    if (filter && m.type !== filter) return false;
    if (status === "active" && !m.active) return false;
    if (status === "inactive" && m.active) return false;
    const text = `${m.name} ${m.slug} ${m.description ?? ""}`.toLowerCase();
    return !q.trim() || text.includes(q.trim().toLowerCase());
  });

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || edit === null) return;
    if (!condition.predicate) {
      setFormError(condition.error ?? "Define la condición antes de guardar.");
      return;
    }
    const data = new FormData(event.currentTarget);
    const kind = edit === "new" ? type : edit.type;
    const start = String(data.get("startTime") ?? ""),
      end = String(data.get("endTime") ?? "");
    const dates =
      kind === "EVENT"
        ? {
            startTime: start ? new Date(start).toISOString() : undefined,
            endTime: end ? new Date(end).toISOString() : undefined,
          }
        : {};
    const body = {
      name: String(data.get("name")),
      description: String(data.get("description") ?? ""),
      xpReward: Number(data.get("xpReward")),
      predicate: condition.predicate,
      ...dates,
    };
    setBusy(true);
    setFormError("");
    try {
      await api(edit === "new" ? "/missions" : `/missions/${edit.id}`, {
        method: edit === "new" ? "POST" : "PUT",
        body: JSON.stringify(
          edit === "new"
            ? { ...body, slug: String(data.get("slug")), type }
            : { ...body, active },
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
  const kind = current?.type ?? type;
  return (
    <section className="glass data-panel" aria-label="Misiones del servidor">
      <div className="panel-title">
        <h2>Misiones</h2>
        <Badge tone="live">Conectado al backend</Badge>
      </div>
      <Notice>
        Las misiones diarias y semanales se reinician cada periodo; las de
        evento solo cuentan entre sus fechas. El servidor otorga la experiencia
        al completarlas.
      </Notice>
      <div className="group-chips">
        {(
          [
            ["", "Todas", rows.length],
            ...Object.entries(missionTypes).map(([k, v]) => [
              k,
              v,
              counts[k as MissionType],
            ]),
          ] as [string, string, number][]
        ).map(([k, label, n]) => (
          <button
            key={k || "all"}
            className={filter === k ? "selected" : ""}
            onClick={() => setFilter(k as "" | MissionType)}
          >
            {label} <span>{n}</span>
          </button>
        ))}
      </div>
      <div className="toolbar">
        <label className="search">
          <Search size={16} />
          <input
            aria-label="Buscar misión"
            placeholder="Buscar por nombre o identificador"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <label>
          Estado
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
          >
            <option value="">Todas</option>
            <option value="active">Activas</option>
            <option value="inactive">Inactivas</option>
          </select>
        </label>
        <button
          disabled={loading || busy}
          onClick={() => setRevision((v) => v + 1)}
        >
          <RefreshCw size={16} /> Actualizar
        </button>
        <button
          className="primary"
          disabled={busy}
          onClick={() => {
            setFormError("");
            setType(filter || "DAILY");
            setEdit("new");
          }}
        >
          <Plus size={16} /> Nueva misión
        </button>
      </div>
      {loading && <Loading />}
      {error && (
        <ErrorBox message={error} retry={() => setRevision((v) => v + 1)} />
      )}
      {!loading && !error && visible.length === 0 && (
        <Empty
          title={
            rows.length
              ? "Ninguna misión coincide con el filtro"
              : "Todavía no hay misiones"
          }
        />
      )}
      {visible.length > 0 && (
        <div className="achievement-grid">
          {visible.map((m) => {
            const Icon = typeIcons[m.type] ?? CalendarDays;
            const state = eventState(m);
            return (
              <article
                className={`achievement-card mission-card ${m.active ? "" : "inactive"}`}
                key={m.id}
              >
                <header>
                  <span
                    className={`achievement-icon mission-${m.type.toLowerCase()}`}
                  >
                    <Icon size={20} />
                  </span>
                  <div>
                    <h3>{m.name}</h3>
                    <small>
                      {missionTypes[m.type] ?? m.type} · {m.slug}
                    </small>
                  </div>
                  <Badge tone={m.active ? "live" : ""}>
                    {m.active ? "Activa" : "Inactiva"}
                  </Badge>
                </header>
                {m.description && <p>{m.description}</p>}
                <p className="achievement-rule">
                  {describePredicate(m.predicate)}
                </p>
                {m.type === "EVENT" && m.startTime && m.endTime && (
                  <p className="cell-note">
                    {fmt(m.startTime)} → {fmt(m.endTime)}
                    {state && ` · ${state}`}
                  </p>
                )}
                <footer>
                  <strong>+{m.xpReward} XP</strong>
                  <div className="text-actions">
                    <button
                      disabled={busy}
                      onClick={() => {
                        setFormError("");
                        setActive(m.active);
                        setEdit(m);
                      }}
                    >
                      <Pencil size={14} /> Editar
                    </button>
                    <button
                      className="danger-soft"
                      disabled={busy}
                      onClick={() => {
                        setError("");
                        setRemoving(m);
                      }}
                    >
                      <Trash2 size={14} /> Eliminar
                    </button>
                  </div>
                </footer>
              </article>
            );
          })}
        </div>
      )}
      {edit && (
        <Modal
          title={edit === "new" ? "Nueva misión" : "Editar misión"}
          onClose={() => !busy && setEdit(null)}
        >
          <form onSubmit={save} className="form-grid">
            {edit === "new" ? (
              <>
                <label>
                  Identificador único
                  <input
                    name="slug"
                    required
                    pattern="[a-z0-9-]+"
                    maxLength={100}
                    placeholder="observa-3-especies"
                    title="Minúsculas, números y guiones"
                  />
                </label>
                <label>
                  Tipo de misión
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value as MissionType)}
                  >
                    {Object.entries(missionTypes).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : (
              <p className="cell-note form-span">
                Tipo: <strong>{missionTypes[edit.type]}</strong> (no se puede
                cambiar después de crearla).
              </p>
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
              Experiencia otorgada
              <select
                name="xpReward"
                defaultValue={
                  (xpOptions as readonly number[]).includes(
                    current?.xpReward ?? 0,
                  )
                    ? current!.xpReward
                    : 10
                }
              >
                {xpOptions.map((xp) => (
                  <option key={xp} value={xp}>
                    {xp} XP
                  </option>
                ))}
              </select>
            </label>
            <label className="form-span">
              Descripción
              <textarea
                name="description"
                maxLength={2000}
                defaultValue={current?.description ?? ""}
              />
            </label>
            <div className="form-span pb-field">
              <span className="pb-label">
                Condición para completar la misión
              </span>
              <PredicateBuilder
                key={current?.id ?? "new"}
                initial={current?.predicate as Predicate | null | undefined}
                forMission
                onChange={setCondition}
              />
            </div>
            {kind === "EVENT" && (
              <>
                <label>
                  Inicio del evento
                  <input
                    name="startTime"
                    type="datetime-local"
                    required
                    defaultValue={toLocal(current?.startTime)}
                  />
                </label>
                <label>
                  Fin del evento
                  <input
                    name="endTime"
                    type="datetime-local"
                    required
                    defaultValue={toLocal(current?.endTime)}
                  />
                </label>
              </>
            )}
            {edit !== "new" && (
              <Toggle
                label="Activa"
                checked={active}
                onChange={setActive}
                disabled={busy}
              />
            )}
            {formError && <ErrorBox message={formError} />}
            <button type="submit" className="primary" disabled={busy}>
              {busy
                ? "Guardando…"
                : edit === "new"
                  ? "Crear misión"
                  : "Guardar cambios"}
            </button>
          </form>
        </Modal>
      )}
      {removing && (
        <Confirm
          title={`Eliminar la misión «${removing.name}»`}
          description="La experiencia que ya se otorgó por esta misión se conserva."
          busy={busy}
          error={error}
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            setBusy(true);
            setError("");
            try {
              await api(`/missions/${removing.id}`, { method: "DELETE" });
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
