import { describe, it, expect } from "vitest";
import {
  checkPredicate,
  describe as describePredicate,
  newGroup,
  newRule,
  toEditor,
  toPredicate,
  type Predicate,
} from "../../shared/predicate";
import { achievementPayload } from "../../shared/achievements";
import { missionPayload } from "../../shared/gamification";

const complex: Predicate = {
  and: [
    { metric: "species_identified", op: "gte", value: 3 },
    {
      or: [
        { metric: "posts", op: "gte", value: 5 },
        { not: { metric: "comments", op: "lt", value: 2 } },
      ],
    },
  ],
};

describe("Condiciones con bloques Y / O / NO", () => {
  it("acepta árboles anidados en el formato de PredicateCodec", () => {
    const r = checkPredicate(complex);
    expect(r.ok).toBe(true);
  });

  it("rechaza bloques vacíos, métricas desconocidas y demasiada profundidad", () => {
    expect(checkPredicate({ and: [] }).ok).toBe(false);
    expect(checkPredicate({ metric: "likes", op: "gte", value: 1 }).ok).toBe(
      false,
    );
    expect(checkPredicate({ metric: "posts", op: "~", value: 1 }).ok).toBe(
      false,
    );
    let deep: Predicate = { metric: "posts", op: "gte", value: 1 };
    for (let i = 0; i < 17; i++) deep = { not: deep };
    const r = checkPredicate(deep);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("16");
  });

  it("las misiones no aceptan métricas que no se miden por periodo", () => {
    const poi = { or: [{ metric: "poi_visited", op: "gte", value: 1 }] };
    expect(checkPredicate(poi).ok).toBe(true);
    const r = checkPredicate(poi, { forMission: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("Zonas del campus visitadas");
  });

  it("describe la condición en lenguaje natural", () => {
    expect(describePredicate(complex)).toBe(
      "al menos 3 especies identificadas y (al menos 5 publicaciones o no menos de 2 comentarios)",
    );
  });

  it("ida y vuelta entre el editor visual y el backend", () => {
    expect(toPredicate(toEditor(complex))).toEqual(complex);
    const simple = { metric: "posts", op: "gte", value: 4 };
    const editor = toEditor(simple);
    expect(editor.kind).toBe("group");
    expect(toPredicate(editor)).toEqual(simple);
    expect(
      toPredicate(toEditor({ metric: "posts", op: "GT", value: 1 })),
    ).toEqual({ metric: "posts", op: "gt", value: 1 });
    const negated = newGroup("or", [newRule("posts"), newRule("comments")]);
    expect(toPredicate({ ...negated, negated: true })).toEqual({
      not: {
        or: [
          { metric: "posts", op: "gte", value: 1 },
          { metric: "comments", op: "gte", value: 1 },
        ],
      },
    });
  });

  it("los payloads envían el árbol y validan según el tipo", () => {
    const base = { name: "N", description: "", xpReward: 10 };
    expect(
      achievementPayload({ ...base, slug: "n", predicate: complex }).predicate,
    ).toEqual(complex);
    const poi = { metric: "poi_visited", op: "gte", value: 2 };
    expect(
      achievementPayload({ ...base, slug: "z", predicate: poi }).predicate,
    ).toEqual(poi);
    expect(() =>
      missionPayload({ ...base, slug: "m", type: "DAILY", predicate: poi }),
    ).toThrow();
    expect(
      missionPayload({ ...base, slug: "m", type: "WEEKLY", predicate: complex })
        .predicate,
    ).toEqual(complex);
  });
});
