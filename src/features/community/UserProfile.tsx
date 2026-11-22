import { useEffect, useState } from "react";
import { AtSign, ImageOff, Mail, ShieldAlert, UserRound } from "lucide-react";
import type { Page, User } from "../../../shared/types";
import { api, errorMessage } from "../../lib/api";
import { Badge, ErrorBox, Modal } from "../../components/ui";
import { splitReason, statuses } from "./Moderation";
import { formatDate } from "./ContentPreview";

export interface ActiveBan {
  id: string;
  ids: string[];
  reason: string;
  banType: "TEMPORAL" | "PERMANENT" | string;
  expiresAt: string | null;
  createdAt?: string;
}
export type ManagedUser = User & {
  status?: "ACTIVE" | "SUSPENDED";
  ban?: ActiveBan;
};
interface Ban {
  id: string;
  reason: string;
  status: string;
  banType: string;
  expiresAt: string | null;
  createdAt?: string;
}
interface ReceivedReport {
  id: string;
  reportType: "POST" | "COMMENT";
  reason: string;
  status: keyof typeof statuses;
  createdAt: string;
}
interface PostSummary {
  id: string;
  title: string;
  firstImageUrl?: string | null;
  totalLikes?: number;
  banned?: boolean;
  createdAt: string;
}

export const roleLabel: Record<string, string> = {
  USER: "Usuario",
  ADMIN: "Administrador",
  SUPERADMIN: "Admin. inicial",
};
const banStatus: Record<string, string> = {
  ACTIVE: "Activa",
  EXPIRED: "Vencida",
  CANCELLED: "Cancelada",
};

/** "3 d 4 h", "5 h 12 min", "8 min"… tiempo que falta para una fecha. */
export function remaining(iso: string, now = Date.now()) {
  const ms = Date.parse(iso) - now;
  if (!Number.isFinite(ms) || ms <= 0) return "0 min";
  const min = Math.ceil(ms / 60000),
    d = Math.floor(min / 1440),
    h = Math.floor((min % 1440) / 60),
    m = min % 60;
  if (d) return `${d} d${h ? ` ${h} h` : ""}`;
  if (h) return `${h} h${m ? ` ${m} min` : ""}`;
  return `${m} min`;
}

/** Texto corto de la suspensión vigente: "Hasta 24 nov., 3:00 p. m. · quedan 2 d 4 h". */
export function banSummary(ban: Pick<ActiveBan, "expiresAt">) {
  if (!ban.expiresAt) return "Indefinida";
  if (Date.parse(ban.expiresAt) <= Date.now())
    return `Terminó el ${formatDate(ban.expiresAt)}`;
  return `Hasta ${formatDate(ban.expiresAt)} · quedan ${remaining(ban.expiresAt)}`;
}

async function allPages<T>(path: string) {
  const items: T[] = [];
  for (let p = 0; p < 50; p++) {
    const r = await api<Page<T>>(`${path}?page=${p}&size=100`);
    items.push(...r.content);
    if (p + 1 >= r.pagination.totalPages) break;
  }
  return items;
}

function initials(u: User) {
  return (
    `${u.firstName?.[0] ?? ""}${u.lastName?.[0] ?? ""}`.toUpperCase() ||
    u.username[0]?.toUpperCase()
  );
}

export function UserProfile({
  user,
  locked,
  onClose,
  onRequest,
}: {
  user: ManagedUser;
  /** Cuenta protegida (inicial o la propia): sin acciones. */
  locked: boolean;
  onClose: () => void;
  onRequest: (path: string, method: string, label: string) => void;
}) {
  const [full, setFull] = useState<User>(user),
    [bans, setBans] = useState<Ban[] | null>(null),
    [received, setReceived] = useState<ReceivedReport[] | null>(null),
    [posts, setPosts] = useState<Page<PostSummary> | null>(null),
    [error, setError] = useState(""),
    [broken, setBroken] = useState({ avatar: false, banner: false });
  useEffect(() => {
    let live = true;
    // El listado de usuarios no trae las URLs de imagen; el detalle sí.
    api<User>(`/social/users/${user.id}`)
      .then((u) => live && setFull({ ...user, ...u }))
      .catch(() => undefined);
    allPages<Ban>(`/social/users/${user.id}/bans`)
      .then((b) => live && setBans(b))
      .catch((e) => {
        if (!live) return;
        setBans([]);
        setError(errorMessage(e));
      });
    allPages<ReceivedReport>(`/social/reports/by-user/${user.id}`)
      .then((r) => live && setReceived(r))
      .catch(() => live && setReceived([]));
    api<Page<PostSummary>>(`/social/users/${user.id}/posts?page=0&size=12`)
      .then((p) => live && setPosts(p))
      .catch(() => live && setPosts(null));
    return () => {
      live = false;
    };
  }, [user]);

  const active = (bans ?? []).filter(
    (b) =>
      b.status === "ACTIVE" &&
      (!b.expiresAt || Date.parse(b.expiresAt) > Date.now()),
  );
  // El listado puede traer una suspensión que ya venció mientras se miraba.
  const listed =
    user.ban &&
    (!user.ban.expiresAt || Date.parse(user.ban.expiresAt) > Date.now())
      ? user.ban
      : undefined;
  const current = bans ? active[0] : listed;
  const pending = (received ?? []).filter((r) => r.status === "PENDING").length;

  return (
    <Modal title={`Perfil de @${full.username}`} onClose={onClose}>
      <div className="profile-sheet">
        <div className="profile-cover">
          {full.bannerUrl && !broken.banner ? (
            <img
              src={full.bannerUrl}
              alt="Banner del perfil"
              onError={() => setBroken((b) => ({ ...b, banner: true }))}
            />
          ) : (
            <span className="profile-cover-empty" aria-hidden />
          )}
        </div>
        <div className="profile-head">
          <div className="profile-avatar">
            {full.profilePictureUrl && !broken.avatar ? (
              <img
                src={full.profilePictureUrl}
                alt="Foto de perfil"
                onError={() => setBroken((b) => ({ ...b, avatar: true }))}
              />
            ) : (
              <span>{initials(full)}</span>
            )}
          </div>
          <div className="profile-id">
            <h3>
              {full.firstName} {full.lastName}
            </h3>
            <p>
              <span className="profile-handle">
                <AtSign size={13} />
                {full.username}
              </span>
              <span className="profile-mail">
                <Mail size={13} /> {full.email}
              </span>
            </p>
            <div className="profile-badges">
              <Badge tone={full.role === "USER" ? "" : "live"}>
                <UserRound size={12} /> {roleLabel[full.role] ?? full.role}
              </Badge>
              {current ? (
                <Badge tone="danger">Suspendida</Badge>
              ) : bans ? (
                <Badge>Activa</Badge>
              ) : null}
            </div>
          </div>
        </div>

        <div className="profile-stats">
          <div>
            <strong>{posts?.pagination.totalElements ?? "—"}</strong>
            <span>Publicaciones</span>
          </div>
          <div>
            <strong>{received?.length ?? "—"}</strong>
            <span>Denuncias recibidas</span>
          </div>
          <div>
            <strong>{pending}</strong>
            <span>Sin revisar</span>
          </div>
          <div>
            <strong>{bans?.length ?? "—"}</strong>
            <span>Suspensiones</span>
          </div>
        </div>

        {current && (
          <div className="ban-callout">
            <ShieldAlert size={20} />
            <div>
              <strong>
                Cuenta suspendida{" "}
                {current.banType === "PERMANENT" || !current.expiresAt
                  ? "de forma indefinida"
                  : "temporalmente"}
              </strong>
              <p>{splitReason(current.reason).reason}</p>
              <small>{banSummary(current)}</small>
            </div>
            {!locked && (
              <button
                className="primary"
                onClick={() =>
                  onRequest(
                    `/social/users/${full.id}/reactivate`,
                    "POST",
                    `Quitar la suspensión de @${full.username}`,
                  )
                }
              >
                Quitar suspensión
              </button>
            )}
          </div>
        )}

        {!locked && (full.profilePictureUrl || full.bannerUrl) && (
          <div className="toolbar profile-media-actions">
            {full.profilePictureUrl && (
              <button
                onClick={() =>
                  onRequest(
                    `/social/users/${full.id}/media/profile-picture`,
                    "DELETE",
                    "Eliminar foto de perfil",
                  )
                }
              >
                Eliminar foto
              </button>
            )}
            {full.bannerUrl && (
              <button
                onClick={() =>
                  onRequest(
                    `/social/users/${full.id}/media/banner`,
                    "DELETE",
                    "Eliminar banner",
                  )
                }
              >
                Eliminar banner
              </button>
            )}
          </div>
        )}

        <h4>Publicaciones</h4>
        {posts === null ? (
          <p className="cell-note">No se pudieron cargar las publicaciones.</p>
        ) : posts.content.length === 0 ? (
          <p className="cell-note">Todavía no ha publicado nada.</p>
        ) : (
          <div className="profile-posts">
            {posts.content.map((p) => (
              <figure key={p.id} title={p.title}>
                {p.firstImageUrl ? (
                  <img src={p.firstImageUrl} alt={p.title} loading="lazy" />
                ) : (
                  <span className="post-thumb-empty">
                    <ImageOff size={18} />
                  </span>
                )}
                <figcaption>
                  {p.title}
                  {p.banned && <Badge tone="danger">Retirada</Badge>}
                </figcaption>
              </figure>
            ))}
          </div>
        )}

        <h4>Denuncias recibidas</h4>
        {received === null ? (
          <p className="cell-note">Cargando denuncias…</p>
        ) : received.length === 0 ? (
          <p className="cell-note">Esta cuenta no tiene denuncias.</p>
        ) : (
          <ul className="user-reports">
            {received.map((d) => (
              <li key={d.id}>
                <span>
                  <strong>{splitReason(d.reason).reason}</strong>
                  <small className="cell-note">
                    {d.reportType === "COMMENT" ? "Comentario" : "Publicación"}{" "}
                    · {formatDate(d.createdAt)}
                  </small>
                </span>
                <Badge tone={d.status === "PENDING" ? "warn" : ""}>
                  {statuses[d.status] ?? d.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}

        <h4>Historial de suspensiones</h4>
        {bans === null ? (
          <p className="cell-note">Cargando suspensiones…</p>
        ) : bans.length === 0 ? (
          <p className="cell-note">Nunca ha sido suspendida.</p>
        ) : (
          <ul className="user-reports">
            {bans.map((b) => {
              const live =
                b.status === "ACTIVE" &&
                (!b.expiresAt || Date.parse(b.expiresAt) > Date.now());
              return (
                <li key={b.id}>
                  <span>
                    <strong>{splitReason(b.reason).reason}</strong>
                    <small className="cell-note">
                      {b.banType === "PERMANENT" ? "Indefinida" : "Temporal"}
                      {b.createdAt && ` · desde ${formatDate(b.createdAt)}`}
                      {b.expiresAt && ` · hasta ${formatDate(b.expiresAt)}`}
                      {live &&
                        b.expiresAt &&
                        ` · quedan ${remaining(b.expiresAt)}`}
                    </small>
                  </span>
                  <Badge tone={live ? "danger" : ""}>
                    {live
                      ? "Vigente"
                      : b.status === "ACTIVE"
                        ? "Vencida"
                        : (banStatus[b.status] ?? b.status)}
                  </Badge>
                </li>
              );
            })}
          </ul>
        )}
        {error && <ErrorBox message={error} />}
      </div>
    </Modal>
  );
}
