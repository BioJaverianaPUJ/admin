import { Heading } from "../../components/ui";
import { PointsOfInterest } from "./PointsOfInterest";
import { CampusOverview } from "./CampusOverview";
import { Campus3DPanel } from "./Campus3DPanel";

/** Zonas del campus: mapa general, zonas del servidor y vista 3D. */
export function Zones() {
  return (
    <>
      <Heading
        eyebrow="TERRITORIO JAVERIANO"
        title="Dale forma al"
        accent="campus."
        description="Mira la biodiversidad del campus como en la app y administra las zonas verdes y de interés directamente en el servidor."
      />
      <div className="zones-stack">
        <CampusOverview />
        <PointsOfInterest />
        <Campus3DPanel />
      </div>
    </>
  );
}
