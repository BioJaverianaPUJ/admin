import { z } from "zod";

/**
 * Condiciones de logros y misiones en el formato de PredicateCodec del
 * backend: bloques { and: [...] }, { or: [...] }, { not: ... } y hojas
 * { metric, op, value }. Se pueden anidar hasta 16 niveles.
 */

export const metrics = {
  observations: {
    label: "Observaciones registradas",
    short: "observaciones",
    windowed: true,
  },
  species_identified: {
    label: "Especies distintas identificadas",
    short: "especies identificadas",
    windowed: true,
  },
  posts: { label: "Publicaciones", short: "publicaciones", windowed: true },
  comments: { label: "Comentarios", short: "comentarios", windowed: true },
  reactions_received: {
    label: "Reacciones recibidas",
    short: "reacciones recibidas",
    windowed: true,
  },
  // Cuenta zonas distintas visitadas desde siempre: no se mide por periodo,
  // por eso el backend no la acepta en misiones.
  poi_visited: {
    label: "Zonas del campus visitadas",
    short: "zonas visitadas",
    windowed: false,
  },
} as const;
export type MetricKey = keyof typeof metrics;
export const metricKeys = Object.keys(metrics) as [MetricKey, ...MetricKey[]];

export const operators = {
  gte: { symbol: "≥", text: "al menos" },
  gt: { symbol: ">", text: "más de" },
  eq: { symbol: "=", text: "exactamente" },
  lte: { symbol: "≤", text: "como máximo" },
  lt: { symbol: "<", text: "menos de" },
} as const;
export type OperatorKey = keyof typeof operators;
const operatorKeys = Object.keys(operators) as [OperatorKey, ...OperatorKey[]];

export const MAX_DEPTH = 16;

export type Predicate =
  | { metric: string; op?: string; value: number }
  | { and: Predicate[] }
  | { or: Predicate[] }
  | { not: Predicate };

export const predicateSchema: z.ZodType<Predicate> = z.lazy(() =>
  z.union([
    z
      .object({
        metric: z.enum(metricKeys),
        op: z.enum(operatorKeys).default("gte"),
        value: z.number().int().min(0).max(1_000_000),
      })
      .strict(),
    z.object({ and: z.array(predicateSchema).min(1).max(20) }).strict(),
    z.object({ or: z.array(predicateSchema).min(1).max(20) }).strict(),
    z.object({ not: predicateSchema }).strict(),
  ]),
);

export function depthOf(p: Predicate): number {
  if ("and" in p) return 1 + Math.max(0, ...p.and.map(depthOf));
  if ("or" in p) return 1 + Math.max(0, ...p.or.map(depthOf));
  if ("not" in p) return 1 + depthOf(p.not);
  return 0;
}

export function metricsIn(p: Predicate): string[] {
  if ("and" in p) return p.and.flatMap(metricsIn);
  if ("or" in p) return p.or.flatMap(metricsIn);
  if ("not" in p) return metricsIn(p.not);
  return [p.metric];
}

/**
 * Valida una condición. Para misiones solo se admiten métricas que se miden
 * por periodo (igual que MissionService.assertMetricsWindowed).
 */
export function checkPredicate(
  input: unknown,
  { forMission = false } = {},
): { ok: true; predicate: Predicate } | { ok: false; error: string } {
  const parsed = predicateSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      error:
        "La condición está incompleta: revisa que cada bloque tenga al menos una regla y que cada regla tenga actividad, comparación y cantidad.",
    };
  if (depthOf(parsed.data) > MAX_DEPTH)
    return {
      ok: false,
      error: `La condición tiene demasiados niveles (máximo ${MAX_DEPTH}).`,
    };
  if (forMission) {
    const bad = metricsIn(parsed.data).filter(
      (m) => !metrics[m as MetricKey]?.windowed,
    );
    if (bad.length)
      return {
        ok: false,
        error: `Las misiones no pueden usar «${metrics[bad[0] as MetricKey]?.label ?? bad[0]}» porque no se mide por periodo.`,
      };
  }
  return { ok: true, predicate: parsed.data };
}

/** Texto legible: «al menos 5 publicaciones y (3 comentarios o …)». */
export function describe(
  p: Predicate | null | undefined,
  nested = false,
): string {
  if (!p) return "Sin condición";
  if ("and" in p || "or" in p) {
    const parts = "and" in p ? p.and : p.or;
    const joiner = "and" in p ? " y " : " o ";
    const text = parts.map((c) => describe(c, true)).join(joiner);
    return nested && parts.length > 1 ? `(${text})` : text;
  }
  if ("not" in p) return `no ${describe(p.not, true)}`;
  const metric = metrics[p.metric as MetricKey];
  const op = operators[(p.op ?? "gte") as OperatorKey];
  return `${op?.text ?? p.op} ${p.value} ${metric?.short ?? p.metric}`;
}

// ---------- Modelo editable del constructor visual ----------

let nextId = 0;
const uid = () => `n${++nextId}`;

export type EditorNode =
  | {
      id: string;
      kind: "rule";
      negated: boolean;
      metric: MetricKey;
      op: OperatorKey;
      value: number;
    }
  | {
      id: string;
      kind: "group";
      negated: boolean;
      mode: "and" | "or";
      children: EditorNode[];
    };

export const newRule = (metric: MetricKey = "observations"): EditorNode => ({
  id: uid(),
  kind: "rule",
  negated: false,
  metric,
  op: "gte",
  value: 1,
});
export const newGroup = (
  mode: "and" | "or" = "and",
  children: EditorNode[] = [newRule()],
): EditorNode => ({ id: uid(), kind: "group", negated: false, mode, children });

/** Convierte la condición del backend en el árbol editable (raíz = grupo). */
export function toEditor(p: Predicate | null | undefined): EditorNode {
  const node = p ? fromPredicate(p) : newGroup();
  return node.kind === "group" && !node.negated
    ? node
    : newGroup("and", [node]);
}
function fromPredicate(p: Predicate, negated = false): EditorNode {
  if ("not" in p) return fromPredicate(p.not, !negated);
  if ("and" in p || "or" in p)
    return {
      id: uid(),
      kind: "group",
      negated,
      mode: "and" in p ? "and" : "or",
      children: ("and" in p ? p.and : p.or).map((c) => fromPredicate(c)),
    };
  return {
    id: uid(),
    kind: "rule",
    negated,
    metric: (p.metric in metrics ? p.metric : "observations") as MetricKey,
    op: (() => {
      const op = (p.op ?? "gte").toLowerCase();
      return (op in operators ? op : "gte") as OperatorKey;
    })(),
    value: p.value,
  };
}

/** Árbol editable → formato del backend (grupos de un solo elemento se simplifican). */
export function toPredicate(node: EditorNode): Predicate {
  let out: Predicate;
  if (node.kind === "rule") {
    out = { metric: node.metric, op: node.op, value: node.value };
  } else if (node.children.length === 1) {
    out = toPredicate({ ...node.children[0] });
    return node.negated ? { not: out } : out;
  } else {
    const children = node.children.map(toPredicate);
    out = node.mode === "and" ? { and: children } : { or: children };
  }
  return node.negated ? { not: out } : out;
}
