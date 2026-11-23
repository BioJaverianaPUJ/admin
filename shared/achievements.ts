import { z } from "zod";
import { checkPredicate, describe, type Predicate as Tree } from "./predicate";

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
  // Condición completa (bloques Y/O/NO) o, por compatibilidad, una sola regla.
  predicate: z.unknown().optional(),
  metric: z.enum(metricKeys).optional(),
  target: target.optional(),
});

export const achievementUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    xpReward: xpReward.optional(),
    active: z.boolean().optional(),
    metric: z.enum(metricKeys).optional(),
    target: target.optional(),
    predicate: z.unknown().optional(),
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

/** Valida la condición enviada (árbol o regla simple) y la normaliza. */
export function resolvePredicate(
  v: { predicate?: unknown; metric?: AchievementMetric; target?: number },
  options: { forMission?: boolean } = {},
): Tree | undefined {
  const raw =
    v.predicate !== undefined
      ? v.predicate
      : v.metric && v.target
        ? predicateFor(v.metric, v.target)
        : undefined;
  if (raw === undefined) return undefined;
  const checked = checkPredicate(raw, options);
  if (!checked.ok)
    throw new z.ZodError([
      {
        code: "custom",
        path: ["predicate"],
        message: checked.error,
        input: raw,
      },
    ]);
  return checked.predicate;
}

export function achievementPayload(input: unknown) {
  const v = achievementSchema.parse(input);
  const predicate = resolvePredicate(v);
  if (!predicate)
    throw new z.ZodError([
      {
        code: "custom",
        path: ["predicate"],
        message: "El logro necesita una condición.",
        input: v,
      },
    ]);
  return {
    slug: v.slug,
    name: v.name,
    description: v.description,
    xpReward: v.xpReward,
    predicate,
  };
}

export function achievementUpdatePayload(input: unknown) {
  const { metric, target, predicate, ...rest } =
    achievementUpdateSchema.parse(input);
  const tree = resolvePredicate({ predicate, metric, target });
  return tree ? { ...rest, predicate: tree } : rest;
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

/** Texto legible de una condición, p. ej. «al menos 5 publicaciones y …». */
export function describePredicate(p: Predicate | null | undefined): string {
  if (!p) return "Sin condición";
  const text = describe(p as Tree);
  return text.charAt(0).toUpperCase() + text.slice(1);
}
