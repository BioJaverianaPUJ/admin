import { useState } from "react";
import type { User } from "../../../shared/types";
import { useResource } from "../../lib/useResource";
import { api, errorMessage } from "../../lib/api";
import {
  Heading,
  Badge,
  Loading,
  ErrorBox,
  Empty,
  Pager,
  Modal,
  Confirm,
} from "../../components/ui";
import { Moderation } from "./Moderation";
import {
  UserProfile,
  banSummary,
  roleLabel,
  type ManagedUser,
} from "./UserProfile";
/** Fecha local en formato de <input type="datetime-local">, desplazada N días. */
function localInput(days: number) {
  const d = new Date(Date.now() + days * 86_400_000);
  d.setSeconds(0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}
export function Community({ user }: { user: User }) {
  const [tab, setTab] = useState("users"),
    [q, setQ] = useState(""),
    [role, setRole] = useState(""),
    [state, setState] = useState(""),
    [view, setView] = useState<ManagedUser | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [action, setAction] = useState<{
      path: string;
      method: string;
      body?: string;
      label: string;
    } | null>(null),
    [suspend, setSuspend] = useState<User | null>(null),
    [reason, setReason] = useState(""),
    [until, setUntil] = useState("");
  const r = useResource<ManagedUser>("users", {
    q,
    role,
    state,
  });
  const protectedUser = (u: User) =>
    u.role === "SUPERADMIN" || u.username === "superadmin" || u.id === user.id;
  const request = (
    path: string,
    method: string,
    label: string,
    body?: object,
  ) =>
    setAction({
      path,
      method,
      label,
      body: body ? JSON.stringify(body) : undefined,
    });
  return (
    <>
      <Heading
        eyebrow="GESTIÓN COMUNITARIA"
        title="Una comunidad"
        accent="que cuidamos."
        description="Gestiona personas, publicaciones y denuncias con las herramientas del servidor."
      />
      <div className="tabs">
        {[
          ["users", "Usuarios"],
          ["posts", "Publicaciones"],
          ["reports", "Denuncias"],
        ].map(([v, t]) => (
          <button
            key={v}
            className={tab === v ? "selected" : ""}
            onClick={() => setTab(v)}
          >
            {t}
          </button>
        ))}
      </div>
      {message && (
        <p role="status" className="success">
          {message}
        </p>
      )}
      {tab !== "users" ? (
        <Moderation kind={tab as "posts" | "reports"} />
      ) : (
        <section className="glass data-panel">
          <div className="panel-title">
            <h2>Cuentas de BioJaveriana</h2>
            <Badge tone="live">Conectado al backend</Badge>
          </div>
          <div className="toolbar">
            <label>
              Buscar usuario
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Usuario o correo"
              />
            </label>
            <label>
              Rol
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="">Todos</option>
                <option value="USER">Usuario</option>
                <option value="ADMIN">Administrador</option>
                <option value="SUPERADMIN">Administrador inicial</option>
              </select>
            </label>
            <label>
              Estado
              <select value={state} onChange={(e) => setState(e.target.value)}>
                <option value="">Todos</option>
                <option value="ACTIVE">Activa</option>
                <option value="SUSPENDED">Suspendida</option>
              </select>
            </label>
          </div>
          {r.error && <ErrorBox message={r.error} retry={r.reload} />}{" "}
          {r.busy ? (
            <Loading />
          ) : r.data?.content.length ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Usuario</th>
                    <th>Nombre</th>
                    <th>Correo</th>
                    <th>Rol</th>
                    <th>Estado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {r.data.content.map((u) => (
                    <tr key={u.id}>
                      <td>@{u.username}</td>
                      <td>
                        {u.firstName} {u.lastName}
                      </td>
                      <td>{u.email}</td>
                      <td>
                        <Badge tone={u.role === "USER" ? "" : "live"}>
                          {roleLabel[u.role] ?? u.role}
                        </Badge>
                      </td>
                      <td>
                        {u.status === "SUSPENDED" ? (
                          <span className="ban-cell">
                            <Badge tone="danger">Suspendida</Badge>
                            {u.ban && (
                              <small className="cell-note">
                                {banSummary(u.ban)}
                              </small>
                            )}
                          </span>
                        ) : u.status === "ACTIVE" ? (
                          <Badge>Activa</Badge>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        <div className="text-actions">
                          <button onClick={() => setView(u)}>Ver perfil</button>
                          {!protectedUser(u) && (
                            <>
                              <button
                                onClick={() =>
                                  request(
                                    `/resources/users/${u.id}`,
                                    "PATCH",
                                    u.role === "USER"
                                      ? "Asignar rol de administrador"
                                      : "Retirar rol de administrador",
                                    {
                                      role:
                                        u.role === "USER" ? "ADMIN" : "USER",
                                    },
                                  )
                                }
                              >
                                {u.role === "USER"
                                  ? "Asignar administrador"
                                  : "Retirar administrador"}
                              </button>
                              {u.status === "SUSPENDED" ? (
                                <button
                                  onClick={() =>
                                    request(
                                      `/social/users/${u.id}/reactivate`,
                                      "POST",
                                      `Quitar la suspensión de @${u.username}`,
                                    )
                                  }
                                >
                                  Quitar suspensión
                                </button>
                              ) : (
                                <button
                                  onClick={() => {
                                    setReason("");
                                    setUntil("");
                                    setSuspend(u);
                                  }}
                                >
                                  Suspender
                                </button>
                              )}
                              <button
                                className="danger-soft"
                                onClick={() =>
                                  request(
                                    `/resources/users/${u.id}`,
                                    "DELETE",
                                    "Eliminar cuenta y contenido asociado",
                                  )
                                }
                              >
                                Eliminar
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="No hay usuarios para este filtro" />
          )}
          {r.data && (
            <Pager
              page={r.page}
              total={r.data.pagination.totalPages}
              count={r.data.pagination.totalElements}
              onPage={r.setPage}
            />
          )}
        </section>
      )}
      {view && !action && (
        <UserProfile
          user={view}
          locked={protectedUser(view)}
          onClose={() => setView(null)}
          onRequest={(path, method, label) => request(path, method, label)}
        />
      )}
      {suspend && (
        <Modal
          title={`Suspender a @${suspend.username}`}
          onClose={() => !busy && setSuspend(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              request("/social/bans", "POST", "Aplicar suspensión", {
                userId: suspend.id,
                reason,
                banType: until ? "TEMPORAL" : "PERMANENT",
                ...(until ? { expiresAt: new Date(until).toISOString() } : {}),
              });
            }}
          >
            <label>
              Motivo *
              <textarea
                required
                maxLength={2000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <fieldset className="duration-picker">
              <legend>Duración</legend>
              {(
                [
                  ["1 día", 1],
                  ["3 días", 3],
                  ["7 días", 7],
                  ["30 días", 30],
                  ["Indefinida", 0],
                ] as const
              ).map(([label, days]) => {
                const value = days ? localInput(days) : "";
                const selected = days
                  ? until !== "" &&
                    Math.abs(Date.parse(until) - Date.parse(value)) < 90_000
                  : until === "";
                return (
                  <button
                    type="button"
                    key={label}
                    className={selected ? "chip selected" : "chip"}
                    onClick={() => setUntil(value)}
                  >
                    {label}
                  </button>
                );
              })}
            </fieldset>
            <label>
              Fecha y hora de finalización (vacío: indefinida)
              <input
                type="datetime-local"
                min={localInput(0)}
                value={until}
                onChange={(e) => setUntil(e.target.value)}
              />
            </label>
            <p className="cell-note">
              {until
                ? `La cuenta se reactivará sola el ${new Date(until).toLocaleString("es-CO", { dateStyle: "long", timeStyle: "short" })}.`
                : "La cuenta quedará suspendida hasta que un administrador quite la suspensión."}
            </p>
            <button className="primary">Revisar suspensión</button>
          </form>
        </Modal>
      )}
      {action && (
        <Confirm
          title={action.label}
          description="Confirma esta operación sobre el servidor. La eliminación no se puede deshacer."
          busy={busy}
          error={error}
          onClose={() => setAction(null)}
          onConfirm={async () => {
            setBusy(true);
            setError("");
            try {
              await api(action.path, {
                method: action.method,
                body: action.body,
              });
              setAction(null);
              setView(null);
              setSuspend(null);
              setMessage("El servidor confirmó el cambio.");
              r.reload();
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </>
  );
}
