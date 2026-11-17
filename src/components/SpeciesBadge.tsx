import type { CSSProperties } from "react";
import { groups, speciesGroup } from "../lib/speciesGroups";

/** Ícono de la especie con el color de su grupo (árbol, palma, ave…). */
export function SpeciesBadge({
  row,
  size = 38,
}: {
  row?: {
    family?: string | null;
    commonName?: string | null;
    scientificName?: string | null;
  };
  size?: number;
}) {
  const group = row ? speciesGroup(row) : groups.plant;
  const Icon = group.icon;
  return (
    <div
      className="record-icon species-badge"
      title={group.label}
      style={
        { "--tone": group.color, width: size, height: size } as CSSProperties
      }
    >
      <Icon size={Math.round(size * 0.5)} aria-hidden />
      <span className="sr-only">{group.label}</span>
    </div>
  );
}
