import { useState } from "react";
import { Lightbulb, Target, Trophy } from "lucide-react";
import { Heading } from "../../components/ui";
import { Achievements } from "./Achievements";
import { Missions } from "./Missions";
import { FunFacts } from "./FunFacts";

const tabs = [
  ["missions", "Misiones", Target],
  ["achievements", "Logros", Trophy],
  ["funfacts", "Datos curiosos", Lightbulb],
] as const;
type Tab = (typeof tabs)[number][0];

/** Gamificación conectada al servidor: misiones, logros y datos curiosos. */
export function Gamification() {
  const [tab, setTab] = useState<Tab>("missions");
  return (
    <>
      <Heading
        eyebrow="APRENDER EXPLORANDO"
        title="Pequeños retos."
        accent="Grandes descubrimientos."
        description="Crea misiones, logros y datos curiosos que la comunidad ve en la aplicación. Todo se guarda directamente en el servidor."
      />
      <div className="tabs" role="tablist">
        {tabs.map(([id, label, Icon]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "selected" : ""}
            onClick={() => setTab(id)}
          >
            <Icon size={16} /> {label}
          </button>
        ))}
      </div>
      {tab === "missions" && <Missions />}
      {tab === "achievements" && <Achievements />}
      {tab === "funfacts" && <FunFacts />}
    </>
  );
}
