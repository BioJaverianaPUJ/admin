import { useEffect, useState } from "react";
import type { Page } from "../../../shared/types";
import { api, errorMessage } from "../../lib/api";
import {
  Badge,
  Loading,
  ErrorBox,
  Empty,
  Pager,
  Modal,
  Confirm,
} from "../../components/ui";
interface Content {
  id: string;
  title?: string;
  description?: string;
  content?: string;
  reason?: string;
  status?: string;
  reportType?: string;
  reportedPostId?: string;
  reportedCommentId?: string;
  reportedUserUsername?: string;
  reporterUsername?: string;
  author?: { id: string; username: string };
  images?: { url: string }[];
  hidden?: boolean;
  banned?: boolean;
  createdAt: string;
}
const statuses: Record<string, string> = {
  PENDING: "Pendiente",
  UNDER_REVIEW: "En revisión",
  RESOLVED: "Resuelta",
  REJECTED: "Descartada",
};
export function Moderation({ kind }: { kind: "posts" | "reports" }) {
  const [data, setData] = useState<Page<Content> | null>(null),
    [page, setPage] = useState(0),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [detail, setDetail] = useState<Content | null>(null),
    [content, setContent] = useState<Content | null>(null),
    [comments, setComments] = useState<Content[]>([]),
    [action, setAction] = useState<{
      path: string;
      method: string;
      body?: string;
      label: string;
    } | null>(null),
    [busy, setBusy] = useState(false);
  async function load() {
    setLoading(true);
    setError("");
    try {
      setData(
        await api<Page<Content>>(
          `/social/${kind}?page=${page}&size=12&pending=${pending}`,
        ),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    setPage(0);
    setDetail(null);
    setContent(null);
  }, [kind]);
  useEffect(() => {
    void load();
  }, [kind, page, pending]);
  async function open(row: Content) {
    setError("");
    setContent(null);
    setComments([]);
    try {
      const d = await api<Content>(`/social/${kind}/${row.id}`);
      setDetail(d);
      const resource =
        kind === "posts"
          ? "posts"
          : d.reportType === "COMMENT"
            ? "comments"
            : "posts";
      const id =
        kind === "posts" ? d.id : d.reportedCommentId || d.reportedPostId;
      if (id) {
        const c =
          kind === "posts"
            ? d
            : await api<Content>(`/social/${resource}/${id}`);
        setContent(c);
        if (resource === "posts") {
          let p = 0;
          const all: Content[] = [];
          while (true) {
            const r = await api<Page<Content>>(
              `/social/posts/${id}/comments?page=${p}&size=100`,
            );
            all.push(...r.content);
            if (++p >= r.pagination.totalPages) break;
          }
          setComments(all);
        }
      }
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  const moderate = (resource: string, id: string, op: string, label: string) =>
    setAction({
      path: `/social/${resource}/${id}${op === "delete" ? "" : "/" + op}`,
      method: op === "delete" ? "DELETE" : "PUT",
      label,
    });
  const actions = (c: Content, resource: string) => (
    <div className="toolbar">
      <button
        disabled={busy}
        onClick={() =>
          moderate(
            resource,
            c.id,
            "toggle-hidden",
            "Cambiar visibilidad del contenido",
          )
        }
      >
        {c.hidden === undefined
          ? "Ocultar / mostrar"
          : c.hidden
            ? "Volver a mostrar"
            : "Ocultar"}
      </button>
      <button
        disabled={busy}
        onClick={() =>
          moderate(
            resource,
            c.id,
            "toggle-banned",
            c.banned ? "Retirar bloqueo" : "Bloquear contenido",
          )
        }
      >
        {c.banned ? "Retirar bloqueo" : "Bloquear"}
      </button>
      <button
        disabled={busy}
        onClick={() =>
          moderate(
            resource,
            c.id,
            "delete",
            "Eliminar contenido y sus elementos asociados",
          )
        }
      >
        Eliminar
      </button>
    </div>
  );
  return (
    <section className="glass data-panel">
      <div className="panel-title">
        <h2>
          {kind === "posts"
            ? "Publicaciones de la comunidad"
            : "Denuncias de contenido"}
        </h2>
        <Badge tone="live">Conectado al backend</Badge>
        {kind === "reports" && (
          <label>
            <input
              type="checkbox"
              checked={pending}
              onChange={(e) => {
                setPending(e.target.checked);
                setPage(0);
              }}
            />{" "}
            Solo pendientes
          </label>
        )}
      </div>
      {error && <ErrorBox message={error} retry={load} />}{" "}
      {loading ? (
        <Loading />
      ) : data?.content.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Contenido</th>
                <th>Usuario</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {data.content.map((r) => (
                <tr key={r.id}>
                  <td>{r.title || r.reason}</td>
                  <td>{r.author?.username || r.reportedUserUsername}</td>
                  <td>
                    {r.status
                      ? statuses[r.status]
                      : r.banned
                        ? "Bloqueado"
                        : "Consultar detalle"}
                  </td>
                  <td>
                    <button onClick={() => open(r)}>Consultar</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="No hay registros para este filtro" />
      )}
      {data && (
        <Pager
          page={page}
          total={data.pagination.totalPages}
          count={data.pagination.totalElements}
          onPage={setPage}
        />
      )}
      {detail && (
        <Modal
          title={kind === "reports" ? "Revisar denuncia" : "Publicación"}
          onClose={() => !busy && setDetail(null)}
        >
          {kind === "reports" && (
            <>
              <p>
                <strong>Motivo:</strong> {detail.reason}
              </p>
              <p>
                Reportada por @{detail.reporterUsername} · Cuenta involucrada @
                {detail.reportedUserUsername}
              </p>
              <label>
                Estado
                <select
                  aria-label="Estado"
                  value={detail.status}
                  disabled={busy}
                  onChange={(e) =>
                    setAction({
                      path: `/social/reports/${detail.id}/status`,
                      method: "PUT",
                      body: JSON.stringify({ status: e.target.value }),
                      label: `Cambiar denuncia a ${statuses[e.target.value]}`,
                    })
                  }
                >
                  {Object.entries(statuses).map(([v, label]) => (
                    <option key={v} value={v}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <p>
                Una sanción no cambia automáticamente el estado de esta
                denuncia.
              </p>
            </>
          )}
          {content && (
            <>
              <h3>{content.title || "Comentario"}</h3>
              <p>@{content.author?.username}</p>
              <p>{content.description || content.content}</p>
              {content.images?.map((im, i) => (
                <img
                  key={i}
                  src={im.url}
                  alt={`Imagen ${i + 1} de la publicación`}
                  style={{
                    maxWidth: "100%",
                    maxHeight: 300,
                    objectFit: "contain",
                  }}
                />
              ))}
              {actions(
                content,
                kind === "reports" && detail.reportType === "COMMENT"
                  ? "comments"
                  : "posts",
              )}
            </>
          )}
          {comments.length > 0 && (
            <>
              <h3>Comentarios</h3>
              {comments.map((c) => (
                <article className="glass" key={c.id}>
                  <p>
                    @{c.author?.username}: {c.content}
                  </p>
                  {actions(c, "comments")}
                  <button
                    onClick={async () => {
                      try {
                        const r = await api<Page<Content>>(
                          `/social/comments/${c.id}/replies?size=100`,
                        );
                        setComments((v) => [
                          ...v.filter(
                            (x) => !r.content.some((y) => y.id === x.id),
                          ),
                          ...r.content,
                        ]);
                      } catch (e) {
                        setError(errorMessage(e));
                      }
                    }}
                  >
                    Ver respuestas
                  </button>
                </article>
              ))}
            </>
          )}
          {error && <ErrorBox message={error} />}
        </Modal>
      )}
      {action && (
        <Confirm
          title={action.label}
          description="La operación se aplicará al contenido del servidor. Confirma para continuar."
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
              setDetail(null);
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
