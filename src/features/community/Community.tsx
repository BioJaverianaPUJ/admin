import { useState } from "react";
import type { User, Page } from "../../../shared/types";
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
interface Ban {
  id: string;
  reason: string;
  status: string;
  banType: string;
  expiresAt: string | null;
}
const roleLabel: Record<string, string> = {
  USER: "Usuario",
  ADMIN: "Administrador",
  SUPERADMIN: "Admin. inicial",
};
export function Community({ user }: { user: User }) {
  const [tab, setTab] = useState("users"),
    [q, setQ] = useState(""),
    [role, setRole] = useState(""),
    [view, setView] = useState<User | null>(null),
    [bans, setBans] = useState<Ban[]>([]),
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
  const r = useResource<User>("users", { q, role });
  const protectedUser = (u: User) =>
    u.role === "SUPERADMIN" || u.username === "superadmin" || u.id === user.id;
  async function show(u: User) {
    setError("");
    setView(u);
    setBans([]);
    try {
      let page = 0;
      const all: Ban[] = [];
      while (true) {
        const b = await api<Page<Ban>>(
          `/social/users/${u.id}/bans?page=${page}&size=100`,
        );
        all.push(...b.content);
        if (++page >= b.pagination.totalPages) break;
      }
      setBans(all);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
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
                placeholder="Nombre de usuario"
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
                        <div className="text-actions">
                          <button onClick={() => show(u)}>Ver perfil</button>
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
                              <button
                                onClick={() => {
                                  setReason("");
                                  setUntil("");
                                  setSuspend(u);
                                }}
                              >
                                Suspender
                              </button>
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
      {view && (
        <Modal
          title={`Perfil de @${view.username}`}
          onClose={() => setView(null)}
        >
          <p>
            {view.firstName} {view.lastName}
          </p>
          <p>
            {view.email} · {view.role}
          </p>
          {view.profilePictureUrl && (
            <img
              src={view.profilePictureUrl}
              alt="Foto de perfil"
              width={100}
            />
          )}{" "}
          {view.bannerUrl && (
            <img
              src={view.bannerUrl}
              alt="Banner"
              style={{ maxWidth: "100%" }}
            />
          )}
          {!protectedUser(view) && (
            <div className="toolbar">
              <button
                onClick={() =>
                  request(
                    `/social/users/${view.id}/media/profile-picture`,
                    "DELETE",
                    "Eliminar foto de perfil",
                  )
                }
              >
                Eliminar foto
              </button>
              <button
                onClick={() =>
                  request(
                    `/social/users/${view.id}/media/banner`,
                    "DELETE",
                    "Eliminar banner",
                  )
                }
              >
                Eliminar banner
              </button>
            </div>
          )}
          <h3>Suspensiones</h3>
          {bans.length === 0 ? (
            <p>No hay suspensiones cargadas.</p>
          ) : (
            bans.map((b) => (
              <article key={b.id}>
                <p>
                  {b.reason} · {b.status}{" "}
                  {b.expiresAt &&
                    `· Hasta ${new Date(b.expiresAt).toLocaleString("es-CO")}`}
                </p>
                {b.status === "ACTIVE" && !protectedUser(view) && (
                  <button
                    onClick={() =>
                      request(
                        `/social/bans/${b.id}/cancel`,
                        "PATCH",
                        "Cancelar suspensión y reactivar cuenta",
                      )
                    }
                  >
                    Reactivar cuenta
                  </button>
                )}
              </article>
            ))
          )}
          {error && <ErrorBox message={error} />}
        </Modal>
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
            <label>
              Fecha de finalización (vacío: indefinida)
              <input
                type="datetime-local"
                value={until}
                onChange={(e) => setUntil(e.target.value)}
              />
            </label>
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
