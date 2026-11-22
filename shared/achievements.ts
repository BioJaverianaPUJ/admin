import { z } from "zod";

/**
 * Métricas que el backend evalúa en las condiciones de los logros
 * (gamification/metric/impl, campo TYPE de cada métrica).
 */
export const achievementMetrics = {
  observations: "Registrar observaciones",
  species_identified: "Identificar especies distintas",
  posts: "Publicar en el feed",
  comments: "Escribir comentarios",
  reactions_received: "Recibir reacciones en sus comentarios",
  poi_visited: "Visitar zonas del campus",
} as const;
export type AchievementMetric = keyof typeof achievementMetrics;
const metricKeys = Object.keys(achievementMetrics) as [
  AchievementMetric,
  ...AchievementMetric[],
];

/** RF-50: la experiencia otorgada solo puede ser 5, 10, 15 o 20. */
export const xpOptions = [5, 10, 15, 20] as const;
const xpReward = z
  .number()
  .int()
  .refine((v) => (xpOptions as readonly number[]).includes(v), {
    message: "La experiencia debe ser 5, 10, 15 o 20.",
  });
const target = z.number().int().positive().max(100000);

export const achievementSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-]+$/),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000),
  xpReward,
  metric: z.enum(metricKeys),
  target,
});

export const achievementUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    xpReward: xpReward.optional(),
    active: z.boolean().optional(),
    metric: z.enum(metricKeys).optional(),
    target: target.optional(),
  })
  .strict()
  .refine((v) => (v.metric === undefined) === (v.target === undefined), {
    message: "La condición necesita la actividad y la cantidad.",
  })
  .refine((v) => Object.keys(v).length > 0);

/** Condición en el formato de PredicateCodec: { metric, op, value }. */
export function predicateFor(metric: AchievementMetric, value: number) {
  return { metric, op: "gte", value };
}

export function achievementPayload(input: unknown) {
  const v = achievementSchema.parse(input);
  return {
    slug: v.slug,
    name: v.name,
    description: v.description,
    xpReward: v.xpReward,
    predicate: predicateFor(v.metric, v.target),
  };
}

export function achievementUpdatePayload(input: unknown) {
  const {
    metric,
    target: value,
    ...rest
  } = achievementUpdateSchema.parse(input);
  return metric && value
    ? { ...rest, predicate: predicateFor(metric, value) }
    : rest;
}

export interface Predicate {
  metric?: string;
  op?: string;
  value?: number;
  and?: Predicate[];
  or?: Predicate[];
  not?: Predicate;
}
export interface Achievement {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  xpReward: number;
  predicate: Predicate | null;
  active: boolean;
}

const opText: Record<string, string> = {
  gte: "al menos",
  gt: "más de",
  eq: "exactamente",
  lte: "como máximo",
  lt: "menos de",
};
/** Texto legible de una condición, p. ej. «Publicar en el feed: al menos 5». */
export function describePredicate(p: Predicate | null | undefined): string {
  if (!p) return "Sin condición";
  if (p.and) return p.and.map(describePredicate).join(" y ");
  if (p.or) return p.or.map(describePredicate).join(" o ");
  if (p.not) return `No (${describePredicate(p.not)})`;
  const label =
    achievementMetrics[p.metric as AchievementMetric] ?? p.metric ?? "—";
  return `${label}: ${opText[p.op ?? "gte"] ?? p.op} ${p.value ?? 0}`;
}
