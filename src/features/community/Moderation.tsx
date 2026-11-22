import { useCallback, useEffect, useState } from "react";
import {
  Ban,
  CheckCircle2,
  Clock3,
  EyeOff,
  FileText,
  Flag,
  Lock,
  MessageSquare,
  Search,
  Trash2,
  Undo2,
  XCircle,
} from "lucide-react";
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
  Toggle,
  Notice,
} from "../../components/ui";
import {
  CommentPreview,
  PostPreview,
  formatDate,
  type CommentContent,
  type PostContent,
} from "./ContentPreview";

interface ReportRow {
  id: string;
  reportType: "POST" | "COMMENT";
  reportedUserUsername?: string;
  reportedUserDisplayName?: string;
  reporterUsername?: string;
  reportedPostId?: string;
  reportedCommentId?: string | null;
  reason: string;
  status: Status;
  createdAt: string;
  updatedAt?: string;
}
type Status = "PENDING" | "UNDER_REVIEW" | "RESOLVED" | "REJECTED";

/** Estados de denuncia con los nombres del SRS (RF-53). */
export const statuses: Record<Status, string> = {
  PENDING: "No revisada",
  UNDER_REVIEW: "En revisión",
  RESOLVED: "Revisada",
  REJECTED: "Descartada",
};
const statusTone: Record<Status, string> = {
  PENDING: "warn",
  UNDER_REVIEW: "info",
  RESOLVED: "live",
  REJECTED: "",
};

/** La app móvil envía «Motivo: descripción» en el único campo del backend. */
export function splitReason(raw = "") {
  const i = raw.indexOf(": ");
  return i > 0
    ? { reason: raw.slice(0, i), detail: raw.slice(i + 2) }
    : { reason: raw, detail: "" };
}

interface Step {
  path: string;
  method: string;
  body?: unknown;
}
interface Plan {
  title: string;
  description: string;
  steps: Step[];
  success: string;
}

async function runSteps(steps: Step[]) {
  for (const s of steps)
    await api(s.path, {
      method: s.method,
      body: s.body === undefined ? undefined : JSON.stringify(s.body),
    });
}

async function allPages<T>(path: string) {
  const out: T[] = [];
  for (let p = 0; ; p++) {
    const r = await api<Page<T>>(
      `${path}${path.includes("?") ? "&" : "?"}page=${p}&size=100`,
    );
    out.push(...r.content);
    if (p + 1 >= r.pagination.totalPages) return out;
  }
}

export function Moderation({ kind }: { kind: "posts" | "reports" }) {
  const [data, setData] = useState<Page<ReportRow & PostContent> | null>(null),
    [page, setPage] = useState(0),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false),
    [openId, setOpenId] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(
        await api<Page<ReportRow & PostContent>>(
          `/social/${kind}?page=${page}&size=12&pending=${pending}`,
        ),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [kind, page, pending]);
  useEffect(() => {
    setPage(0);
    setOpenId(null);
  }, [kind]);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <section className="glass data-panel">
      <div className="panel-title">
        <h2>
          {kind === "posts"
            ? "Publicaciones de la comunidad"
            : "Denuncias de contenido"}
        </h2>
        <div className="panel-actions">
          {kind === "reports" && (
            <Toggle
              label="Solo no revisadas"
              checked={pending}
              onChange={(v) => {
                setPending(v);
                setPage(0);
              }}
            />
          )}
          <Badge tone="live">Conectado al backend</Badge>
        </div>
      </div>
      {error && <ErrorBox message={error} retry={load} />}
      {loading ? (
        <Loading />
      ) : data?.content.length ? (
        <div className="table-scroll">
          {kind === "reports" ? (
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Contenido</th>
                  <th>Motivo</th>
                  <th>Cuenta denunciada</th>
                  <th>Estado</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                {data.content.map((r) => {
                  const { reason, detail } = splitReason(r.reason);
                  return (
                    <tr key={r.id}>
                      <td>{formatDate(r.createdAt)}</td>
                      <td>
                        <span className="type-chip">
                          {r.reportType === "COMMENT" ? (
                            <MessageSquare size={14} />
                          ) : (
                            <FileText size={14} />
                          )}
                          {r.reportType === "COMMENT"
                            ? "Comentario"
                            : "Publicación"}
                        </span>
                      </td>
                      <td>
                        <strong>{reason}</strong>
                        {detail && (
                          <small className="cell-note">{detail}</small>
                        )}
                      </td>
                      <td>@{r.reportedUserUsername ?? "—"}</td>
                      <td>
                        <Badge tone={statusTone[r.status]}>
                          {statuses[r.status] ?? r.status}
                        </Badge>
                      </td>
                      <td>
                        <button
                          className={
                            r.status === "PENDING" ? "primary small" : "small"
                          }
                          onClick={() => setOpenId(r.id)}
                        >
                          <Search size={15} /> Revisar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Publicación</th>
                  <th>Autor</th>
                  <th>Votos</th>
                  <th>Estado</th>
                  <th>Acción</th>
                </tr>
              </thead>
              <tbody>
                {data.content.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <div className="post-cell">
                        {p.firstImageUrl ? (
                          <img src={p.firstImageUrl} alt="" />
                        ) : (
                          <span className="post-thumb-empty">
                            <FileText size={16} />
                          </span>
                        )}
                        <span>
                          <strong>{p.title}</strong>
                          <small className="cell-note">
                            {formatDate(p.createdAt)}
                          </small>
                        </span>
                      </div>
                    </td>
                    <td>@{p.author?.username}</td>
                    <td>
                      👍 {p.totalLikes ?? 0} · 👎 {p.totalDislikes ?? 0}
                    </td>
                    <td>
                      {p.banned ? (
                        <Badge tone="danger">Bloqueada</Badge>
                      ) : (
                        <Badge>Visible o por consultar</Badge>
                      )}
                    </td>
                    <td>
                      <button className="small" onClick={() => setOpenId(p.id)}>
                        <Search size={15} /> Consultar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : (
        <Empty
          title={
            kind === "reports"
              ? pending
                ? "No hay denuncias sin revisar"
                : "No hay denuncias"
              : "No hay publicaciones"
          }
        />
      )}
      {data && (
        <Pager
          page={page}
          total={data.pagination.totalPages}
          count={data.pagination.totalElements}
          onPage={setPage}
        />
      )}
      {openId &&
        (kind === "reports" ? (
          <ReportReview
            id={openId}
            onClose={() => setOpenId(null)}
            onChanged={load}
          />
        ) : (
          <PostModeration
            id={openId}
            onClose={() => setOpenId(null)}
            onChanged={load}
          />
        ))}
    </section>
  );
}

/** Ejecuta un plan de pasos tras confirmación y muestra el resultado. */
function usePlan(after: () => Promise<void> | void) {
  const [plan, setPlan] = useState<Plan | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [done, setDone] = useState("");
  const confirm = plan && (
    <Confirm
      title={plan.title}
      description={plan.description}
      busy={busy}
      error={error}
      onClose={() => {
        setPlan(null);
        setError("");
      }}
      onConfirm={async () => {
        setBusy(true);
        setError("");
        try {
          await runSteps(plan.steps);
          setDone(plan.success);
          setPlan(null);
          await after();
        } catch (e) {
          setError(errorMessage(e));
          await after();
        } finally {
          setBusy(false);
        }
      }}
    />
  );
  return { setPlan, confirm, busy, done, setDone };
}

function ReportReview({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [report, setReport] = useState<ReportRow | null>(null),
    [post, setPost] = useState<PostContent | null>(null),
    [comment, setComment] = useState<CommentContent | null>(null),
    [missing, setMissing] = useState(""),
    [history, setHistory] = useState<ReportRow[] | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [suspending, setSuspending] = useState(false),
    [banReason, setBanReason] = useState(""),
    [until, setUntil] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    setMissing("");
    try {
      const r = await api<ReportRow>(`/social/reports/${id}`);
      setReport(r);
      let p: PostContent | null = null,
        c: CommentContent | null = null;
      const problems: string[] = [];
      if (r.reportType === "COMMENT" && r.reportedCommentId) {
        try {
          c = await api<CommentContent>(
            `/social/comments/${r.reportedCommentId}`,
          );
        } catch {
          problems.push(
            "El comentario ya no se puede consultar: fue eliminado, ocultado o bloqueado. El backend no muestra comentarios ocultos ni bloqueados, ni siquiera al administrador.",
          );
        }
      }
      const postId = c?.postId ?? r.reportedPostId;
      if (postId) {
        try {
          p = await api<PostContent>(`/social/posts/${postId}`);
        } catch {
          problems.push(
            r.reportType === "POST"
              ? "La publicación ya no existe en el servidor."
              : "La publicación del comentario ya no existe en el servidor.",
          );
        }
      }
      setPost(p);
      setComment(c);
      setMissing(problems.join(" "));
      const authorId = (r.reportType === "COMMENT" ? c : p)?.author?.id;
      if (authorId) {
        allPages<ReportRow>(`/social/reports/by-user/${authorId}`)
          .then(setHistory)
          .catch(() => setHistory(null));
      }
      setBanReason(
        `Denuncia por ${splitReason(r.reason).reason.toLowerCase()}`,
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  const { setPlan, confirm, done, setDone } = usePlan(async () => {
    setSuspending(false);
    await load();
    onChanged();
  });

  const target = report?.reportType === "COMMENT" ? comment : post;
  const resource = report?.reportType === "COMMENT" ? "comments" : "posts";
  const label =
    report?.reportType === "COMMENT" ? "el comentario" : "la publicación";
  const open =
    report?.status === "PENDING" || report?.status === "UNDER_REVIEW";
  const resolve: Step = {
    path: `/social/reports/${id}/status`,
    method: "PUT",
    body: { status: "RESOLVED" },
  };
  const authorId = target?.author?.id;
  const authorName = target?.author?.username ?? report?.reportedUserUsername;
  const { reason, detail } = splitReason(report?.reason);
  const otherReports = history?.filter((h) => h.id !== id) ?? [];

  function sanction(op: "toggle-hidden" | "toggle-banned" | "delete") {
    if (!target) return;
    const names = {
      "toggle-hidden": "Ocultar",
      "toggle-banned": "Bloquear",
      delete: "Eliminar",
    };
    const effect = {
      "toggle-hidden": `${label} dejará de mostrarse a los usuarios; solo lo verá el administrador.`,
      "toggle-banned": `${label} solo lo verán su autor y el administrador.`,
      delete: `${label} se eliminará de forma permanente con sus elementos asociados.`,
    };
    const step: Step = {
      path: `/social/${resource}/${target.id}${op === "delete" ? "" : `/${op}`}`,
      method: op === "delete" ? "DELETE" : "PUT",
    };
    setDone("");
    setPlan({
      title: `${names[op]} ${label} y marcar la denuncia como revisada`,
      description: `${effect[op]} La denuncia pasará a «Revisada».`,
      // Al eliminar, la denuncia se marca antes para conservarla (RF-53).
      steps: op === "delete" ? [resolve, step] : [step, resolve],
      success: `Sanción aplicada: ${names[op].toLowerCase()} ${label}. La denuncia quedó como revisada.`,
    });
  }

  return (
    <Modal title="Revisar denuncia" onClose={onClose}>
      <div className="review-modal">
        {loading && !report ? (
          <Loading />
        ) : error ? (
          <ErrorBox message={error} retry={load} />
        ) : report ? (
          <div className="review-grid">
            <section
              className="review-content"
              aria-label="Contenido denunciado"
            >
              <p className="eyebrow">CONTENIDO DENUNCIADO</p>
              {missing && <Notice>{missing}</Notice>}
              {report.reportType === "COMMENT" && comment && (
                <CommentPreview comment={comment} highlight />
              )}
              {report.reportType === "COMMENT" && post && (
                <p className="review-context">En esta publicación:</p>
              )}
              {post && (
                <PostPreview
                  post={post}
                  highlight={report.reportType === "POST"}
                />
              )}
            </section>
            <aside className="review-side">
              <div className="review-status">
                <Badge tone={statusTone[report.status]}>
                  {statuses[report.status]}
                </Badge>
                <ol className="status-track" aria-label="Avance de la denuncia">
                  {(["PENDING", "UNDER_REVIEW"] as Status[]).map((s) => (
                    <li
                      key={s}
                      className={
                        s === report.status
                          ? "current"
                          : report.status !== "PENDING"
                            ? "passed"
                            : ""
                      }
                    >
                      {statuses[s]}
                    </li>
                  ))}
                  <li className={open ? "" : "current"}>
                    {open ? "Revisada o descartada" : statuses[report.status]}
                  </li>
                </ol>
              </div>
              <dl className="review-facts">
                <dt>Motivo</dt>
                <dd>
                  <Flag size={14} /> {reason}
                </dd>
                {detail && (
                  <>
                    <dt>Descripción</dt>
                    <dd>{detail}</dd>
                  </>
                )}
                <dt>Cuenta involucrada</dt>
                <dd>@{authorName ?? "—"}</dd>
                <dt>Denunciada por</dt>
                <dd>@{report.reporterUsername ?? "—"}</dd>
                <dt>Fecha</dt>
                <dd>{formatDate(report.createdAt)}</dd>
                {history && (
                  <>
                    <dt>Historial de la cuenta</dt>
                    <dd>
                      {otherReports.length === 0
                        ? "Sin otras denuncias"
                        : `${otherReports.length} denuncia${otherReports.length === 1 ? "" : "s"} más · ${
                            otherReports.filter((h) => h.status === "RESOLVED")
                              .length
                          } con sanción`}
                    </dd>
                  </>
                )}
              </dl>
              {done && (
                <p role="status" className="success">
                  <CheckCircle2 size={16} /> {done}
                </p>
              )}
              {open ? (
                <div className="decision">
                  <h3>Decisión</h3>
                  {report.status === "PENDING" && (
                    <button
                      onClick={() =>
                        setPlan({
                          title: "Marcar la denuncia en revisión",
                          description:
                            "Indica que estás analizando esta denuncia. Después podrás sancionar o descartarla.",
                          steps: [
                            {
                              path: `/social/reports/${id}/status`,
                              method: "PUT",
                              body: { status: "UNDER_REVIEW" },
                            },
                          ],
                          success: "La denuncia quedó en revisión.",
                        })
                      }
                    >
                      <Clock3 size={16} /> Marcar en revisión
                    </button>
                  )}
                  <p className="decision-label">
                    Aplicar sanción (la denuncia pasa a «Revisada»)
                  </p>
                  <div className="decision-grid">
                    <button
                      disabled={!target || target.hidden}
                      onClick={() => sanction("toggle-hidden")}
                    >
                      <EyeOff size={16} /> Ocultar
                    </button>
                    <button
                      disabled={!target || target.banned}
                      onClick={() => sanction("toggle-banned")}
                    >
                      <Lock size={16} /> Bloquear
                    </button>
                    <button
                      className="danger-soft"
                      disabled={!target}
                      onClick={() => sanction("delete")}
                    >
                      <Trash2 size={16} /> Eliminar
                    </button>
                    <button
                      className="danger-soft"
                      disabled={!authorId}
                      onClick={() => setSuspending((v) => !v)}
                    >
                      <Ban size={16} /> Suspender cuenta
                    </button>
                  </div>
                  {suspending && authorId && (
                    <form
                      className="suspend-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        setDone("");
                        setPlan({
                          title: `Suspender a @${authorName} y marcar la denuncia como revisada`,
                          description: until
                            ? `La cuenta quedará suspendida hasta ${new Date(until).toLocaleString("es-CO")}.`
                            : "La cuenta quedará suspendida de forma indefinida hasta que la reactives.",
                          steps: [
                            {
                              path: "/social/bans",
                              method: "POST",
                              body: {
                                userId: authorId,
                                reason: banReason.trim(),
                                banType: until ? "TEMPORAL" : "PERMANENT",
                                ...(until
                                  ? { expiresAt: new Date(until).toISOString() }
                                  : {}),
                              },
                            },
                            resolve,
                          ],
                          success: `Cuenta @${authorName} suspendida. La denuncia quedó como revisada.`,
                        });
                      }}
                    >
                      <label>
                        Motivo de la suspensión *
                        <textarea
                          required
                          maxLength={2000}
                          value={banReason}
                          onChange={(e) => setBanReason(e.target.value)}
                        />
                      </label>
                      <label>
                        Hasta (vacío: indefinida)
                        <input
                          type="datetime-local"
                          value={until}
                          onChange={(e) => setUntil(e.target.value)}
                        />
                      </label>
                      <button className="primary" disabled={!banReason.trim()}>
                        Revisar suspensión
                      </button>
                    </form>
                  )}
                  <button
                    className="discard"
                    onClick={() =>
                      setPlan({
                        title: "Descartar la denuncia",
                        description:
                          "El contenido no se sanciona y la denuncia pasa a «Descartada».",
                        steps: [
                          {
                            path: `/social/reports/${id}/status`,
                            method: "PUT",
                            body: { status: "REJECTED" },
                          },
                        ],
                        success: "La denuncia quedó descartada.",
                      })
                    }
                  >
                    <XCircle size={16} /> Descartar sin sanción
                  </button>
                </div>
              ) : (
                <Notice>
                  Esta denuncia ya está {statuses[report.status].toLowerCase()}.
                </Notice>
              )}
              {target && (target.hidden || target.banned) && (
                <div className="decision">
                  <h3>Revertir sanción</h3>
                  <p className="decision-label">
                    Revertir no cambia el estado de la denuncia (RF-61).
                  </p>
                  <div className="decision-grid">
                    {target.hidden && (
                      <button
                        onClick={() =>
                          setPlan({
                            title: `Volver a mostrar ${label}`,
                            description:
                              "El contenido volverá a ser visible para la comunidad.",
                            steps: [
                              {
                                path: `/social/${resource}/${target.id}/toggle-hidden`,
                                method: "PUT",
                              },
                            ],
                            success: "El contenido vuelve a ser visible.",
                          })
                        }
                      >
                        <Undo2 size={16} /> Mostrar
                      </button>
                    )}
                    {target.banned && (
                      <button
                        onClick={() =>
                          setPlan({
                            title: `Retirar el bloqueo de ${label}`,
                            description:
                              "El contenido volverá a ser visible para la comunidad.",
                            steps: [
                              {
                                path: `/social/${resource}/${target.id}/toggle-banned`,
                                method: "PUT",
                              },
                            ],
                            success: "Se retiró el bloqueo del contenido.",
                          })
                        }
                      >
                        <Undo2 size={16} /> Desbloquear
                      </button>
                    )}
                  </div>
                </div>
              )}
            </aside>
          </div>
        ) : null}
      </div>
      {confirm}
    </Modal>
  );
}

function PostModeration({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [post, setPost] = useState<PostContent | null>(null),
    [comments, setComments] = useState<CommentContent[]>([]),
    [replies, setReplies] = useState<Record<string, CommentContent[]>>({}),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setPost(await api<PostContent>(`/social/posts/${id}`));
      setComments(
        await allPages<CommentContent>(`/social/posts/${id}/comments`),
      );
      setReplies({});
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);
  const [closing, setClosing] = useState(false);
  const { setPlan, confirm, done, setDone } = usePlan(async () => {
    onChanged();
    if (closing) onClose();
    else await load();
  });
  const act = (
    resource: "posts" | "comments",
    target: { id: string; hidden?: boolean; banned?: boolean },
    op: "toggle-hidden" | "toggle-banned" | "delete",
  ) => {
    const what = resource === "posts" ? "la publicación" : "el comentario";
    const title =
      op === "delete"
        ? `Eliminar ${what}`
        : op === "toggle-hidden"
          ? target.hidden
            ? `Volver a mostrar ${what}`
            : `Ocultar ${what}`
          : target.banned
            ? `Retirar el bloqueo de ${what}`
            : `Bloquear ${what}`;
    setDone("");
    setClosing(op === "delete" && resource === "posts");
    setPlan({
      title,
      description:
        op === "delete"
          ? "Se eliminará de forma permanente junto con sus elementos asociados."
          : "El cambio se aplicará en el servidor y se puede revertir.",
      steps: [
        {
          path: `/social/${resource}/${target.id}${op === "delete" ? "" : `/${op}`}`,
          method: op === "delete" ? "DELETE" : "PUT",
        },
      ],
      success: `${title}: listo.`,
    });
  };
  const tools = (
    resource: "posts" | "comments",
    t: { id: string; hidden?: boolean; banned?: boolean },
  ) => (
    <div className="text-actions">
      <button onClick={() => act(resource, t, "toggle-hidden")}>
        <EyeOff size={14} /> {t.hidden ? "Mostrar" : "Ocultar"}
      </button>
      <button onClick={() => act(resource, t, "toggle-banned")}>
        <Lock size={14} /> {t.banned ? "Desbloquear" : "Bloquear"}
      </button>
      <button
        className="danger-soft"
        onClick={() => act(resource, t, "delete")}
      >
        <Trash2 size={14} /> Eliminar
      </button>
    </div>
  );
  return (
    <Modal title="Publicación" onClose={onClose}>
      {loading && !post ? (
        <Loading />
      ) : error && !post ? (
        <ErrorBox message={error} retry={load} />
      ) : post ? (
        <div className="review-grid">
          <section className="review-content">
            <PostPreview post={post} commentCount={comments.length} />
            {tools("posts", post)}
          </section>
          <aside className="review-side">
            {done && (
              <p role="status" className="success">
                <CheckCircle2 size={16} /> {done}
              </p>
            )}
            {error && <ErrorBox message={error} />}
            <h3>Comentarios ({comments.length})</h3>
            {comments.length === 0 && (
              <p className="lede">Esta publicación no tiene comentarios.</p>
            )}
            <div className="comment-list">
              {comments.map((c) => (
                <div key={c.id} className="comment-block">
                  <CommentPreview comment={c} />
                  {tools("comments", c)}
                  {replies[c.id] ? (
                    replies[c.id].map((r) => (
                      <div key={r.id}>
                        <CommentPreview comment={r} reply />
                        <div className="reply-tools">
                          {tools("comments", r)}
                        </div>
                      </div>
                    ))
                  ) : (
                    <button
                      className="link-button"
                      onClick={async () => {
                        try {
                          const list = await allPages<CommentContent>(
                            `/social/comments/${c.id}/replies`,
                          );
                          setReplies((v) => ({ ...v, [c.id]: list }));
                        } catch (e) {
                          setError(errorMessage(e));
                        }
                      }}
                    >
                      Ver respuestas
                    </button>
                  )}
                </div>
              ))}
            </div>
          </aside>
        </div>
      ) : null}
      {confirm}
    </Modal>
  );
}
