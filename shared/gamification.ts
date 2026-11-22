import { z } from "zod";
import {
  achievementMetrics,
  predicateFor,
  xpOptions,
  type AchievementMetric,
  type Predicate,
} from "./achievements";

const metricKeys = Object.keys(achievementMetrics) as [
  AchievementMetric,
  ...AchievementMetric[],
];
const xpReward = z
  .number()
  .int()
  .refine((v) => (xpOptions as readonly number[]).includes(v), {
    message: "La experiencia debe ser 5, 10, 15 o 20.",
  });

/** RF-49: misiones diarias, semanales o de evento (MissionType del backend). */
export const missionTypes = {
  DAILY: "Diaria",
  WEEKLY: "Semanal",
  EVENT: "De evento",
} as const;
export type MissionType = keyof typeof missionTypes;

export const missionSchema = z
  .object({
    slug: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[a-z0-9-]+$/),
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).default(""),
    xpReward,
    type: z.enum(["DAILY", "WEEKLY", "EVENT"]),
    startTime: z.iso.datetime().optional(),
    endTime: z.iso.datetime().optional(),
    metric: z.enum(metricKeys),
    target: z.number().int().positive().max(100000),
  })
  .strict()
  .superRefine((m, ctx) => {
    if (m.type === "EVENT") {
      if (!m.startTime || !m.endTime)
        ctx.addIssue({
          code: "custom",
          message: "Una misión de evento necesita fecha de inicio y de fin.",
        });
      else if (Date.parse(m.startTime) >= Date.parse(m.endTime))
        ctx.addIssue({
          code: "custom",
          message: "La fecha de inicio debe ser anterior a la de fin.",
        });
    } else if (m.startTime || m.endTime)
      ctx.addIssue({
        code: "custom",
        message: "Solo las misiones de evento tienen fechas.",
      });
  });

export const missionUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    xpReward: xpReward.optional(),
    startTime: z.iso.datetime().optional(),
    endTime: z.iso.datetime().optional(),
    metric: z.enum(metricKeys).optional(),
    target: z.number().int().positive().max(100000).optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((v) => (v.metric === undefined) === (v.target === undefined), {
    message: "La condición necesita la actividad y la cantidad.",
  });

export function missionPayload(input: unknown) {
  const { metric, target, ...rest } = missionSchema.parse(input);
  return { ...rest, predicate: predicateFor(metric, target) };
}
export function missionUpdatePayload(input: unknown) {
  const { metric, target, ...rest } = missionUpdateSchema.parse(input);
  return metric && target
    ? { ...rest, predicate: predicateFor(metric, target) }
    : rest;
}

export interface Mission {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  xpReward: number;
  type: MissionType;
  startTime: string | null;
  endTime: string | null;
  predicate: Predicate | null;
  active: boolean;
}

/** RF-51: datos curiosos con título, descripción, zona y hasta 5 imágenes. */
export const MAX_FUN_FACT_IMAGES = 5;
export const funFactSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().min(1).max(5000),
    poiId: z.uuid().optional(),
    imageKeys: z
      .array(z.string().min(1).max(500))
      .max(MAX_FUN_FACT_IMAGES)
      .optional(),
  })
  .strict();
export const funFactUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().min(1).max(5000).optional(),
    poiId: z.uuid().optional(),
  })
  .strict();

export interface FunFact {
  id: string;
  title: string;
  description?: string;
  firstImageUrl?: string | null;
  images?: { url: string; orderIndex: number }[];
  poi?: { id: string; name: string } | null;
  hidden?: boolean;
  createdAt: string;
}
