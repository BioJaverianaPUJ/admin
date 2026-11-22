import { useEffect, useRef, useState } from "react";
import maplibregl, { type StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  Building2,
  Compass,
  Layers,
  LocateFixed,
  Navigation,
  RotateCw,
} from "lucide-react";
import { campusAllPoints, campusAreas } from "../../shared/campus-reference";
import { useUserLocation } from "../lib/useUserLocation";

const lngs = campusAllPoints.map(([, lng]) => lng);
const lats = campusAllPoints.map(([lat]) => lat);
const campusBounds: [[number, number], [number, number]] = [
  [Math.min(...lngs), Math.min(...lats)],
  [Math.max(...lngs), Math.max(...lats)],
];
const home = {
  center: [
    (campusBounds[0][0] + campusBounds[1][0]) / 2,
    (campusBounds[0][1] + campusBounds[1][1]) / 2,
  ] as [number, number],
  zoom: 16.15,
  pitch: 55,
  bearing: -18,
};

function tileUrl() {
  const key = import.meta.env.VITE_CARTO_BASEMAP_KEY?.trim();
  return key
    ? `https://basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}.png?key=${encodeURIComponent(key)}`
    : "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
}

function style(): StyleSpecification {
  const rings = campusAreas.map((area) => {
    const ring = area.map(([lat, lng]) => [lng, lat]);
    const [first, last] = [ring[0], ring[ring.length - 1]];
    if (first[0] !== last[0] || first[1] !== last[1]) ring.push(first);
    return [ring];
  });
  const height = ["coalesce", ["get", "height"], 6];
  return {
    version: 8,
    light: {
      anchor: "viewport",
      color: "#fffbe8",
      intensity: 0.42,
      position: [1.3, 200, 40],
    },
    sources: {
      base: {
        type: "raster",
        tiles: [tileUrl()],
        tileSize: 256,
        attribution: "© OpenStreetMap contributors",
      },
      buildings: { type: "geojson", data: "/assets/campus-buildings.geojson" },
      campus: {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: { type: "MultiPolygon", coordinates: rings },
        },
      },
    },
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": "#0f3a33" },
      },
      {
        id: "base",
        type: "raster",
        source: "base",
        paint: {
          "raster-saturation": -0.75,
          "raster-brightness-max": 0.78,
          "raster-brightness-min": 0.12,
          "raster-hue-rotate": 20,
        },
      },
      {
        id: "campus-fill",
        type: "fill",
        source: "campus",
        paint: { "fill-color": "#d4e27e", "fill-opacity": 0.12 },
      },
      {
        id: "campus-line",
        type: "line",
        source: "campus",
        paint: { "line-color": "#d4e27e", "line-width": 3 },
      },
      {
        id: "buildings",
        type: "fill-extrusion",
        source: "buildings",
        paint: {
          "fill-extrusion-color": [
            "interpolate",
            ["linear"],
            height,
            0,
            "#e4ecd8",
            12,
            "#b9cfa6",
            25,
            "#8fb08a",
            45,
            "#5f8c72",
          ],
          "fill-extrusion-height": height,
          "fill-extrusion-opacity": 0.92,
          "fill-extrusion-vertical-gradient": true,
        },
      },
      {
        id: "buildings-selected",
        type: "fill-extrusion",
        source: "buildings",
        filter: ["==", ["get", "osmId"], ""],
        paint: {
          "fill-extrusion-color": "#d4e27e",
          "fill-extrusion-height": ["+", height, 0.4],
          "fill-extrusion-opacity": 0.95,
        },
      },
    ],
  } as StyleSpecification;
}

/** Vista 3D ilustrativa del campus (edificios de OpenStreetMap). */
export default function Campus3D() {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [flat, setFlat] = useState(false);
  const [bearing, setBearing] = useState(home.bearing);
  const [selected, setSelected] = useState<{
    name: string;
    detail: string;
  } | null>(null);
  const [failed, setFailed] = useState(false);
  const [locating, setLocating] = useState(false);
  const { location, error: locationError } = useUserLocation(locating);
  const marker = useRef<maplibregl.Marker | null>(null);
  const centered = useRef(false);

  // Punto de la persona sobre el mapa 3D.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    if (!locating || !location) {
      marker.current?.remove();
      marker.current = null;
      return;
    }
    if (!marker.current) {
      const el = document.createElement("div");
      el.className = "user-dot";
      el.innerHTML = "<span></span>";
      el.title = "Estás aquí";
      marker.current = new maplibregl.Marker({ element: el });
    }
    marker.current.setLngLat([location.lng, location.lat]).addTo(m);
    if (!centered.current) {
      centered.current = true;
      m.easeTo({
        center: [location.lng, location.lat],
        zoom: 17.5,
        duration: 800,
      });
    }
  }, [location, locating]);

  useEffect(() => {
    if (!box.current) return;
    let m: maplibregl.Map;
    try {
      m = new maplibregl.Map({
        container: box.current,
        style: style(),
        ...home,
        minZoom: 14,
        maxZoom: 20,
        attributionControl: { compact: true },
      });
    } catch {
      setFailed(true);
      return;
    }
    map.current = m;
    m.on("rotate", () => setBearing(m.getBearing()));
    m.on("click", (e) => {
      const f = m.queryRenderedFeatures(e.point, { layers: ["buildings"] })[0];
      const p = (f?.properties ?? null) as Record<string, unknown> | null;
      m.setFilter("buildings-selected", [
        "==",
        ["get", "osmId"],
        p ? String(p.osmId ?? "") : "",
      ]);
      if (!p) return setSelected(null);
      const h = Number(p.height);
      setSelected({
        name: String(p.name ?? "").trim() || "Edificio sin nombre",
        detail: [
          Number.isFinite(h) ? `${h.toFixed(1)} m de altura` : "",
          p.heightSource ? String(p.heightSource) : "",
        ]
          .filter(Boolean)
          .join(" · "),
      });
    });
    m.on("mousemove", "buildings", () => {
      m.getCanvas().style.cursor = "pointer";
    });
    m.on("mouseleave", "buildings", () => {
      m.getCanvas().style.cursor = "";
    });
    return () => {
      marker.current?.remove();
      marker.current = null;
      m.remove();
      map.current = null;
    };
  }, []);

  const ease = (o: Partial<typeof home>) =>
    map.current?.easeTo({ ...o, duration: 650 });

  if (failed)
    return (
      <p className="lede">
        Tu navegador no permite mostrar la vista 3D (WebGL desactivado).
      </p>
    );

  return (
    <div className="campus-3d">
      <div className="campus-3d-map" ref={box} />
      <div
        className="campus-3d-controls"
        role="group"
        aria-label="Controles 3D"
      >
        <button
          title="Orientar al norte"
          aria-label="Orientar al norte"
          onClick={() => ease({ bearing: 0 })}
        >
          <Compass size={18} style={{ transform: `rotate(${-bearing}deg)` }} />
        </button>
        <button
          title="Girar"
          aria-label="Girar 45 grados"
          onClick={() => ease({ bearing: bearing + 45 })}
        >
          <RotateCw size={18} />
        </button>
        <button
          title={flat ? "Ver en 3D" : "Vista superior"}
          aria-label={flat ? "Ver en 3D" : "Vista superior"}
          onClick={() => {
            setFlat(!flat);
            ease({ pitch: flat ? home.pitch : 0 });
          }}
        >
          <Layers size={18} />
        </button>
        <button
          title="Centrar campus"
          aria-label="Centrar campus"
          onClick={() => {
            setFlat(false);
            map.current?.easeTo({ ...home, duration: 800 });
          }}
        >
          <LocateFixed size={18} />
        </button>
        <button
          title="Mi ubicación"
          aria-label="Mi ubicación"
          aria-pressed={locating}
          className={locating ? "on" : ""}
          onClick={() => {
            centered.current = false;
            if (locating && location)
              map.current?.easeTo({
                center: [location.lng, location.lat],
                zoom: 17.5,
                duration: 700,
              });
            else setLocating(true);
          }}
        >
          <Navigation size={18} />
        </button>
      </div>
      <div className="campus-3d-info" aria-live="polite">
        <Building2 size={18} />
        {locating && locationError ? (
          <span>{locationError}</span>
        ) : selected ? (
          <div>
            <strong>{selected.name}</strong>
            {selected.detail && <small>{selected.detail}</small>}
          </div>
        ) : (
          <span>
            Haz clic en un edificio para ver su nombre. Arrastra con clic
            derecho para girar e inclinar.
          </span>
        )}
      </div>
    </div>
  );
}
