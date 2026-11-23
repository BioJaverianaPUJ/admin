import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Ban,
  Braces,
  FlaskConical,
  Layers,
  Plus,
  Search,
  Trash2,
  Wand2,
} from "lucide-react";
import type { Page, User } from "../../../shared/types";
import {
  MAX_DEPTH,
  checkPredicate,
  describe,
  metrics,
  newGroup,
  newRule,
  operators,
  toEditor,
  toPredicate,
  type EditorNode,
  type MetricKey,
  type OperatorKey,
  type Predicate,
} from "../../../shared/predicate";
import { api, errorMessage } from "../../lib/api";

/** Plantillas para empezar rápido. */
const templates: { label: string; predicate: Predicate }[] = [
  {
    label: "Primera observación",
    predicate: { metric: "observations", op: "gte", value: 1 },
  },
  {
    label: "Explorador: 5 observaciones y 3 especies",
    predicate: {
      and: [
        { metric: "observations", op: "gte", value: 5 },
        { metric: "species_identified", op: "gte", value: 3 },
      ],
    },
  },
  {
    label: "Social: 10 publicaciones o 20 comentarios",
    predicate: {
      or: [
        { metric: "posts", op: "gte", value: 10 },
        { metric: "comments", op: "gte", value: 20 },
      ],
    },
  },
  {
    label: "Naturalista: 3 especies y (5 publicaciones o 10 reacciones)",
    predicate: {
      and: [
        { metric: "species_identified", op: "gte", value: 3 },
        {
          or: [
            { metric: "posts", op: "gte", value: 5 },
            { metric: "reactions_received", op: "gte", value: 10 },
          ],
        },
      ],
    },
  },
];

type Patch = (node: EditorNode) => EditorNode;

function update(node: EditorNode, id: string, patch: Patch): EditorNode {
  if (node.id === id) return patch(node);
  if (node.kind === "group")
    return {
      ...node,
      children: node.children.map((c) => update(c, id, patch)),
    };
  return node;
}
function remove(node: EditorNode, id: string): EditorNode {
  if (node.kind !== "group") return node;
  return {
    ...node,
    children: node.children
      .filter((c) => c.id !== id)
      .map((c) => remove(c, id)),
  };
}
function move(node: EditorNode, id: string, delta: -1 | 1): EditorNode {
  if (node.kind !== "group") return node;
  const i = node.children.findIndex((c) => c.id === id);
  if (i >= 0) {
    const j = i + delta;
    if (j < 0 || j >= node.children.length) return node;
    const children = [...node.children];
    [children[i], children[j]] = [children[j], children[i]];
    return { ...node, children };
  }
  return { ...node, children: node.children.map((c) => move(c, id, delta)) };
}

/**
 * Constructor visual de condiciones con bloques Y / O / NO (PredicateCodec).
 * Llama a [onChange] con la condición lista para el backend, o con un error.
 */
export function PredicateBuilder({
  initial,
  forMission = false,
  onChange,
}: {
  initial: Predicate | null | undefined;
  forMission?: boolean;
  onChange: (
    result: { predicate: Predicate; error?: undefined } | { error: string },
  ) => void;
}) {
  const [root, setRoot] = useState<EditorNode>(() => toEditor(initial));
  const [showJson, setShowJson] = useState(false);
  const [json, setJson] = useState("");
  const [jsonError, setJsonError] = useState("");

  const predicate = useMemo(() => toPredicate(root), [root]);
  const checked = useMemo(
    () => checkPredicate(predicate, { forMission }),
    [predicate, forMission],
  );
  useEffect(() => {
    onChange(
      checked.ok ? { predicate: checked.predicate } : { error: checked.error },
    );
    // onChange es estable en los formularios que lo usan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checked]);

  const patch = (id: string, p: Patch) => setRoot((r) => update(r, id, p));

  function node(n: EditorNode, depth: number, siblings: number, index: number) {
    const isRoot = depth === 0;
    const tools = (
      <div className="pb-tools">
        <button
          type="button"
          className={n.negated ? "pb-chip on danger" : "pb-chip"}
          title="Invierte la regla o el bloque: se cumple cuando NO pasa"
          onClick={() => patch(n.id, (x) => ({ ...x, negated: !x.negated }))}
        >
          <Ban size={13} /> NO
        </button>
        {!isRoot && (
          <>
            <button
              type="button"
              className="pb-icon"
              aria-label="Subir"
              disabled={index === 0}
              onClick={() => setRoot((r) => move(r, n.id, -1))}
            >
              <ArrowUp size={14} />
            </button>
            <button
              type="button"
              className="pb-icon"
              aria-label="Bajar"
              disabled={index === siblings - 1}
              onClick={() => setRoot((r) => move(r, n.id, 1))}
            >
              <ArrowDown size={14} />
            </button>
            <button
              type="button"
              className="pb-icon danger"
              aria-label="Eliminar"
              onClick={() => setRoot((r) => remove(r, n.id))}
            >
              <Trash2 size={14} />
            </button>
          </>
        )}
      </div>
    );

    if (n.kind === "rule") {
      return (
        <div className={`pb-rule ${n.negated ? "negated" : ""}`} key={n.id}>
          {n.negated && <span className="pb-not">NO</span>}
          <select
            aria-label="Actividad"
            value={n.metric}
            onChange={(e) =>
              patch(n.id, (x) => ({
                ...x,
                metric: e.target.value as MetricKey,
              }))
            }
          >
            {Object.entries(metrics).map(([key, m]) => (
              <option
                key={key}
                value={key}
                disabled={forMission && !m.windowed}
              >
                {m.label}
                {forMission && !m.windowed ? " (no aplica a misiones)" : ""}
              </option>
            ))}
          </select>
          <select
            aria-label="Comparación"
            className="pb-op"
            value={n.op}
            onChange={(e) =>
              patch(n.id, (x) => ({ ...x, op: e.target.value as OperatorKey }))
            }
          >
            {Object.entries(operators).map(([key, o]) => (
              <option key={key} value={key}>
                {o.symbol} {o.text}
              </option>
            ))}
          </select>
          <input
            aria-label="Cantidad"
            type="number"
            min={0}
            max={1000000}
            value={n.value}
            onChange={(e) =>
              patch(n.id, (x) => ({
                ...x,
                value: Math.max(0, Math.round(Number(e.target.value) || 0)),
              }))
            }
          />
          {tools}
        </div>
      );
    }

    return (
      <div
        className={`pb-group depth-${Math.min(depth, 4)} ${n.negated ? "negated" : ""}`}
        key={n.id}
      >
        <div className="pb-group-head">
          {n.negated && <span className="pb-not">NO</span>}
          <div className="pb-mode" role="group" aria-label="Tipo de bloque">
            <button
              type="button"
              className={n.mode === "and" ? "on" : ""}
              onClick={() =>
                patch(n.id, (x) => ({ ...x, mode: "and" }) as EditorNode)
              }
            >
              Se cumplen todas (Y)
            </button>
            <button
              type="button"
              className={n.mode === "or" ? "on" : ""}
              onClick={() =>
                patch(n.id, (x) => ({ ...x, mode: "or" }) as EditorNode)
              }
            >
              Se cumple alguna (O)
            </button>
          </div>
          {tools}
        </div>
        <div className="pb-children">
          {n.children.length === 0 && (
            <p className="pb-empty">
              Este bloque está vacío: agrega una regla.
            </p>
          )}
          {n.children.map((c, i) => (
            <div className="pb-child" key={c.id}>
              {i > 0 && (
                <span className={`pb-join ${n.mode}`}>
                  {n.mode === "and" ? "Y" : "O"}
                </span>
              )}
              {node(c, depth + 1, n.children.length, i)}
            </div>
          ))}
        </div>
        <div className="pb-add">
          <button
            type="button"
            onClick={() =>
              patch(n.id, (x) =>
                x.kind === "group"
                  ? { ...x, children: [...x.children, newRule()] }
                  : x,
              )
            }
          >
            <Plus size={14} /> Regla
          </button>
          <button
            type="button"
            disabled={depth + 1 >= MAX_DEPTH - 1}
            onClick={() =>
              patch(n.id, (x) =>
                x.kind === "group"
                  ? {
                      ...x,
                      children: [
                        ...x.children,
                        newGroup(x.mode === "and" ? "or" : "and", [
                          newRule(),
                          newRule("posts"),
                        ]),
                      ],
                    }
                  : x,
              )
            }
          >
            <Layers size={14} /> Bloque
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="predicate-builder">
      <div className="pb-top">
        <div className="pb-template">
          <Wand2 size={15} />
          <select
            aria-label="Usar una plantilla"
            value=""
            onChange={(e) => {
              const t = templates[Number(e.target.value)];
              if (t) setRoot(toEditor(t.predicate));
            }}
          >
            <option value="">Usar una plantilla…</option>
            {templates.map((t, i) => (
              <option key={t.label} value={i}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="pb-chip"
          aria-expanded={showJson}
          onClick={() => {
            setJson(JSON.stringify(predicate, null, 2));
            setJsonError("");
            setShowJson(!showJson);
          }}
        >
          <Braces size={14} /> JSON
        </button>
      </div>

      {node(root, 0, 1, 0)}

      <p className={`pb-summary ${checked.ok ? "" : "invalid"}`}>
        {checked.ok ? (
          <>
            <strong>Se cumple cuando:</strong> {describe(checked.predicate)}.
          </>
        ) : (
          checked.error
        )}
      </p>

      {showJson && (
        <div className="pb-json">
          <textarea
            aria-label="Condición en JSON"
            rows={8}
            value={json}
            onChange={(e) => setJson(e.target.value)}
            spellCheck={false}
          />
          <div className="pb-json-actions">
            {jsonError && <span className="pb-json-error">{jsonError}</span>}
            <button
              type="button"
              onClick={() => {
                try {
                  const parsed = checkPredicate(JSON.parse(json), {
                    forMission,
                  });
                  if (!parsed.ok) return setJsonError(parsed.error);
                  setRoot(toEditor(parsed.predicate));
                  setJsonError("");
                } catch {
                  setJsonError("El JSON no es válido.");
                }
              }}
            >
              Aplicar JSON
            </button>
          </div>
        </div>
      )}

      {checked.ok && <PreviewWithUser predicate={checked.predicate} />}
    </div>
  );
}

/** Evalúa la condición contra una cuenta real (POST /achievements/preview). */
function PreviewWithUser({ predicate }: { predicate: Predicate }) {
  const [q, setQ] = useState(""),
    [users, setUsers] = useState<User[]>([]),
    [picked, setPicked] = useState<User | null>(null),
    [result, setResult] = useState<{
      satisfied: boolean;
      metricValues: Record<string, number>;
    } | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!q.trim() || picked) return setUsers([]);
    const t = setTimeout(() => {
      api<Page<User>>(
        `/resources/users?q=${encodeURIComponent(q.trim())}&size=5`,
      )
        .then((r) => setUsers(r.content))
        .catch(() => setUsers([]));
    }, 300);
    return () => clearTimeout(t);
  }, [q, picked]);

  async function run(user: User) {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      setResult(
        await api("/achievements/preview", {
          method: "POST",
          body: JSON.stringify({ userId: user.id, predicate }),
        }),
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="pb-preview">
      <summary>
        <FlaskConical size={15} /> Probar con una cuenta
      </summary>
      <p className="pb-note">
        Evalúa la condición con la actividad total de una persona, sin guardar
        nada. En misiones el servidor solo cuenta la actividad del periodo.
      </p>
      <div className="pb-search">
        <Search size={14} />
        <input
          placeholder="Buscar usuario o correo"
          value={picked ? `@${picked.username}` : q}
          onChange={(e) => {
            setPicked(null);
            setResult(null);
            setQ(e.target.value);
          }}
        />
      </div>
      {users.length > 0 && !picked && (
        <ul className="pb-users">
          {users.map((u) => (
            <li key={u.id}>
              <button
                type="button"
                onClick={() => {
                  setPicked(u);
                  setUsers([]);
                  void run(u);
                }}
              >
                @{u.username}
                <small>
                  {u.firstName} {u.lastName}
                </small>
              </button>
            </li>
          ))}
        </ul>
      )}
      {picked && (
        <button type="button" disabled={busy} onClick={() => run(picked)}>
          {busy ? "Evaluando…" : "Volver a evaluar"}
        </button>
      )}
      {error && <p className="pb-json-error">{error}</p>}
      {result && (
        <div className={`pb-result ${result.satisfied ? "ok" : "no"}`}>
          <strong>
            {result.satisfied
              ? `@${picked?.username} cumple la condición`
              : `@${picked?.username} todavía no la cumple`}
          </strong>
          <ul>
            {Object.entries(result.metricValues ?? {}).map(([k, v]) => (
              <li key={k}>
                {metrics[k as MetricKey]?.label ?? k}: <b>{v}</b>
              </li>
            ))}
          </ul>
        </div>
      )}
    </details>
  );
}
