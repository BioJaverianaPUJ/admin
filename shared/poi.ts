import { z } from "zod";
import type { Coordinate } from "./types";
import { contained, inside, validPolygon } from "./geometry";
import { campusReference } from "./campus-reference";
export const poiSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    description: z.string().max(2000).default(""),
    geometryType: z.enum(["POINT", "POLYGON"]),
    visibility: z.enum(["PUBLIC", "PRIVATE"]),
    active: z.boolean().optional(),
    polygonCoordinates: z
      .array(
        z.object({
          latitude: z.number().min(-90).max(90),
          longitude: z.number().min(-180).max(180),
        }),
      )
      .max(1000)
      .optional(),
    centerLatitude: z.number().min(-90).max(90).optional(),
    centerLongitude: z.number().min(-180).max(180).optional(),
    radiusMeters: z.number().positive().max(1000).optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    let valid = false;
    if (p.geometryType === "POLYGON") {
      const points = (p.polygonCoordinates ?? []).map(
        (v) => [v.latitude, v.longitude] as Coordinate,
      );
      if (
        points.length > 3 &&
        points[0][0] === points.at(-1)![0] &&
        points[0][1] === points.at(-1)![1]
      )
        points.pop();
      valid = validPolygon(points) && contained(points, campusReference);
    } else if (
      p.centerLatitude !== undefined &&
      p.centerLongitude !== undefined &&
      p.radiusMeters
    ) {
      const center: Coordinate = [p.centerLatitude, p.centerLongitude];
      const ring = Array.from({ length: 72 }, (_, i) => {
        const a = (i * Math.PI) / 36;
        return [
          center[0] + (Math.sin(a) * p.radiusMeters!) / 111320,
          center[1] +
            (Math.cos(a) * p.radiusMeters!) /
              (111320 * Math.cos((center[0] * Math.PI) / 180)),
        ] as Coordinate;
      });
      valid =
        inside(center, campusReference) && contained(ring, campusReference);
    }
    if (!valid)
      ctx.addIssue({
        code: "custom",
        message:
          "La geometría debe ser válida y estar dentro del perímetro de referencia del campus.",
      });
  });
export interface Poi {
  id: string;
  name: string;
  description: string;
  geometryType: "POINT" | "POLYGON";
  polygonCoordinatesWkt: string | null;
  centerLatitude: number | null;
  centerLongitude: number | null;
  radiusMeters: number | null;
  visibility: "PUBLIC" | "PRIVATE";
  active: boolean;
}
export function poiPoints(p: Poi): Coordinate[] {
  if (p.geometryType === "POINT")
    return [[p.centerLatitude!, p.centerLongitude!]];
  const ring = /\(\(([^()]+)\)\)/.exec(p.polygonCoordinatesWkt ?? "");
  if (!ring) return [];
  const points = ring[1].split(",").map((pair) => {
    const [x, y] = pair.trim().split(/\s+/).map(Number);
    return [y, x] as Coordinate;
  });
  if (points.length > 1 && points[0].join() === points.at(-1)!.join())
    points.pop();
  return points;
}
