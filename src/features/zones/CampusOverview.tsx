import { useEffect, useMemo, useRef, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  Binoculars,
  Expand,
  Layers,
  LocateFixed,
  MapPin,
  RefreshCw,
  Search,
  Trees,
} from "lucide-react";
import type { Species, Specimen } from "../../../shared/types";
import { poiPoints, zoneTypes, type Poi } from "../../../shared/poi";
import { campusAllPoints, campusAreas } from "../../../shared/campus-reference";
import { useUserLocation } from "../../lib/useUserLocation";
import { api, errorMessage } from "../../lib/api";
import {
  groups,
  speciesGroup,
  type SpeciesGroup,
} from "../../lib/speciesGroups";
import { Badge, ErrorBox, Loading } from "../../components/ui";

interface Sighting {
  id: string;
  latitude: number;
  longitude: number;
  observationType: string | null;
  speciesCommonName: string | null;
  imageUrl: string | null;
  createdAt: string;
}
interface Overview {
  specimens: Specimen[];
  species: Species[];
  pois: Poi[];
  sightings: Sighting[];
}
const health: Record<string, [string, string]> = {
  WELL: ["Buen estado", "#7cc47f"],
  FAIR: ["Estado regular", "#e7c35a"],
  POOR: ["Mal estado", "#e58a5f"],
  DEAD: ["Muerto", "#9a8f86"],
};
const ICON_ZOOM = 18;
const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const plain = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function pin(group: SpeciesGroup, size = 30) {
  const Icon = group.icon;
  return L.divIcon({
    className: "overview-pin",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `<span style="--tone:${group.color}">${renderToStaticMarkup(
      <Icon size={Math.round(size * 0.55)} strokeWidth={2.2} />,
    )}</span>`,
  });
}
const animalIcon = L.divIcon({
  className: "overview-pin animal",
  iconSize: [32, 32],
  iconAnchor: [16, 16],
  html: `<span>${renderToStaticMarkup(<Binoculars size={17} strokeWidth={2.2} />)}</span>`,
});

/** Mapa general del campus, como en la app: especímenes, zonas y fauna. */
export function CampusOverview() {
  const el = useRef<HTMLDivElement>(null),
    map = useRef<L.Map | null>(null),
    layers = useRef<{
      specimens: L.LayerGroup;
      zones: L.LayerGroup;
      animals: L.LayerGroup;
    } | null>(null),
    [zoom, setZoom] = useState(17),
    [data, setData] = useState<Overview | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0),
    [group, setGroup] = useState(""),
    [q, setQ] = useState(""),
    [show, setShow] = useState({ specimens: true, zones: true, animals: true }),
    [legend, setLegend] = useState(false),
    [locating, setLocating] = useState(false),
    me = useRef<L.LayerGroup | null>(null),
    centered = useRef(false);
  const { location, error: locationError } = useUserLocation(locating);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<Overview>("/campus/overview", { signal: controller.signal })
      .then((d) => !controller.signal.aborted && setData(d))
      .catch((e) => !controller.signal.aborted && setError(errorMessage(e)))
      .finally(() => !controller.signal.aborted && setLoading(false));
    return () => controller.abort();
  }, [revision]);

  // Mapa base: se crea una sola vez.
  useEffect(() => {
    const m = L.map(el.current!, {
      zoom: 17,
      center: [4.6282, -74.0644],
      minZoom: 15,
      maxZoom: 20,
      preferCanvas: true,
      zoomControl: false,
    });
    L.control.zoom({ position: "bottomright" }).addTo(m);
    map.current = m;
    const cartoKey = import.meta.env.VITE_CARTO_BASEMAP_KEY?.trim();
    L.tileLayer(
      cartoKey
        ? `https://basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}.png?key=${encodeURIComponent(cartoKey)}`
        : "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        maxZoom: 20,
        maxNativeZoom: 19,
        referrerPolicy: "strict-origin-when-cross-origin",
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>' +
          (cartoKey
            ? ' · &copy; <a href="https://carto.com/attributions">CARTO</a>'
            : ""),
      },
    ).addTo(m);
    m.attributionControl.setPrefix(false);
    // Fuera del campus se atenúa, igual que en la app móvil.
    L.polygon(
      [
        [
          [5, -75],
          [5, -73],
          [4, -73],
          [4, -75],
        ],
        ...campusAreas,
      ],
      {
        stroke: false,
        fillColor: "#0b3a30",
        fillOpacity: 0.28,
        interactive: false,
      },
    ).addTo(m);
    for (const area of campusAreas)
      L.polygon(area, {
        color: "#2c6b50",
        weight: 2.5,
        dashArray: "6 6",
        fillOpacity: 0,
        interactive: false,
      }).addTo(m);
    layers.current = {
      zones: L.layerGroup().addTo(m),
      specimens: L.layerGroup().addTo(m),
      animals: L.layerGroup().addTo(m),
    };
    me.current = L.layerGroup().addTo(m);
    m.on("zoomend", () => setZoom(m.getZoom()));
    let fitted = false;
    const observer = new ResizeObserver(() => {
      m.invalidateSize();
      if (!fitted && el.current!.clientHeight > 0) {
        m.fitBounds(L.latLngBounds(campusAllPoints), {
          padding: [20, 20],
          animate: false,
        });
        fitted = true;
      }
    });
    observer.observe(el.current!);
    return () => {
      observer.disconnect();
      m.remove();
      map.current = null;
    };
  }, []);

  const speciesById = useMemo(
    () => new Map((data?.species ?? []).map((s) => [s.id, s])),
    [data],
  );
  const groupOf = useMemo(() => {
    const cache = new Map<string, SpeciesGroup>();
    return (s?: Species) => {
      if (!s) return groups.plant;
      let g = cache.get(s.id);
      if (!g) cache.set(s.id, (g = speciesGroup(s)));
      return g;
    };
  }, []);
  const counts = useMemo(() => {
    const c = new Map<string, { group: SpeciesGroup; n: number }>();
    for (const sp of data?.specimens ?? []) {
      const g = groupOf(speciesById.get(sp.speciesId));
      const entry = c.get(g.label) ?? { group: g, n: 0 };
      entry.n++;
      c.set(g.label, entry);
    }
    return [...c.values()].sort((a, b) => b.n - a.n);
  }, [data, speciesById, groupOf]);
  const query = plain(q.trim());
  const shown = useMemo(
    () =>
      (data?.specimens ?? []).filter((sp) => {
        const s = speciesById.get(sp.speciesId);
        if (group && groupOf(s).label !== group) return false;
        if (!query) return true;
        return plain(
          `${s?.commonName ?? ""} ${s?.scientificName ?? ""} ${s?.family ?? ""}`,
        ).includes(query);
      }),
    [data, speciesById, groupOf, group, query],
  );

  // Especímenes: puntos de color al alejarse, íconos del grupo al acercarse.
  useEffect(() => {
    const layer = layers.current?.specimens;
    if (!layer) return;
    layer.clearLayers();
    if (!show.specimens) return;
    const icons = zoom >= ICON_ZOOM;
    const iconCache = new Map<string, L.DivIcon>();
    for (const sp of shown) {
      const s = speciesById.get(sp.speciesId),
        g = groupOf(s),
        state = sp.healthStatus ? health[sp.healthStatus] : null;
      const popup = `<div class="overview-popup">
          <strong>${esc(s?.commonName || "Especie sin nombre")}</strong>
          <em>${esc(s?.scientificName ?? "")}</em>
          <small>${esc(g.label)}${s?.family ? ` · ${esc(s.family)}` : ""}</small>
          ${state ? `<span class="health-dot" style="--tone:${state[1]}">${state[0]}</span>` : ""}
          ${sp.height ? `<small>Altura: ${sp.height} m</small>` : ""}
          ${sp.circumference ? `<small>Circunferencia: ${sp.circumference} cm</small>` : ""}
        </div>`;
      let marker: L.Layer;
      if (icons) {
        let icon = iconCache.get(g.label);
        if (!icon) iconCache.set(g.label, (icon = pin(g)));
        marker = L.marker([sp.latitude, sp.longitude], { icon });
      } else {
        marker = L.circleMarker([sp.latitude, sp.longitude], {
          radius: zoom >= 17 ? 5 : 3.5,
          color: "#ffffff",
          weight: 1,
          fillColor: g.color,
          fillOpacity: 0.95,
        });
      }
      (marker as L.Marker).bindPopup(popup).addTo(layer);
    }
  }, [shown, zoom, show.specimens, speciesById, groupOf]);

  // Zonas verdes y de interés.
  useEffect(() => {
    const layer = layers.current?.zones;
    if (!layer) return;
    layer.clearLayers();
    if (!show.zones) return;
    for (const poi of data?.pois ?? []) {
      if (poi.active === false) continue;
      const green = poi.type === "GREEN_ZONE";
      const color = green ? "#3f9a5a" : "#d58b3c";
      const style = { color, weight: 2, fillColor: color, fillOpacity: 0.16 };
      const popup = `<div class="overview-popup"><strong>${esc(poi.name)}</strong>
        <small>${zoneTypes[poi.type ?? "INTEREST_ZONE"]}${poi.visibility === "PRIVATE" ? " · Privada" : ""}</small>
        ${poi.description ? `<p>${esc(poi.description)}</p>` : ""}</div>`;
      const pts = poiPoints(poi);
      if (poi.geometryType === "POLYGON" && pts.length >= 3)
        L.polygon(pts, style).bindPopup(popup).addTo(layer);
      else if (pts[0] && Number.isFinite(pts[0][0]))
        L.circle(pts[0], { ...style, radius: poi.radiusMeters ?? 20 })
          .bindPopup(popup)
          .addTo(layer);
    }
  }, [data, show.zones]);

  // Fauna y hongos identificados por la comunidad.
  useEffect(() => {
    const layer = layers.current?.animals;
    if (!layer) return;
    layer.clearLayers();
    if (!show.animals) return;
    for (const o of data?.sightings ?? []) {
      const name = o.speciesCommonName || "Sin identificar";
      if (query && !plain(name).includes(query)) continue;
      L.marker([o.latitude, o.longitude], { icon: animalIcon })
        .bindPopup(
          `<div class="overview-popup">${o.imageUrl ? `<img src="${esc(o.imageUrl)}" alt="" />` : ""}
          <strong>${esc(name)}</strong>
          <small>${o.observationType === "FUNGI" ? "Hongo" : "Animal"} · ${new Date(o.createdAt).toLocaleDateString("es-CO")}</small></div>`,
          { maxWidth: 220 },
        )
        .addTo(layer);
    }
  }, [data, show.animals, query]);

  // Punto de la persona (como en la app): círculo de precisión y punto azul.
  useEffect(() => {
    const layer = me.current;
    if (!layer) return;
    layer.clearLayers();
    if (!locating || !location) return;
    const at: L.LatLngTuple = [location.lat, location.lng];
    L.circle(at, {
      radius: location.accuracy,
      color: "#2f7de1",
      weight: 1,
      fillColor: "#2f7de1",
      fillOpacity: 0.12,
      interactive: false,
    }).addTo(layer);
    L.marker(at, {
      icon: L.divIcon({
        className: "user-dot",
        html: "<span></span>",
        iconSize: [22, 22],
      }),
      zIndexOffset: 1000,
      keyboard: false,
    })
      .bindTooltip("Estás aquí")
      .addTo(layer);
    if (!centered.current) {
      centered.current = true;
      map.current?.setView(at, Math.max(map.current.getZoom(), 17));
    }
  }, [location, locating]);

  const zonesCount = data?.pois.filter((p) => p.active !== false).length ?? 0;
  const greens =
    data?.pois.filter((p) => p.active !== false && p.type === "GREEN_ZONE")
      .length ?? 0;
  return (
    <section
      className="glass data-panel overview-panel"
      aria-label="Mapa general del campus"
    >
      <div className="panel-title">
        <div>
          <p className="eyebrow">MAPA GENERAL</p>
          <h2>Biodiversidad del campus</h2>
        </div>
        <div className="panel-actions">
          <Badge tone="live">Conectado al backend</Badge>
          <button
            onClick={() => setRevision((v) => v + 1)}
            disabled={loading}
            aria-label="Actualizar mapa"
            title="Actualizar mapa"
          >
            <RefreshCw size={16} className={loading ? "spin" : undefined} />
          </button>
        </div>
      </div>
      {data && (
        <div className="overview-stats">
          <div>
            <Trees size={18} />
            <strong>{data.specimens.length.toLocaleString("es-CO")}</strong>
            <span>Especímenes</span>
          </div>
          <div>
            <Layers size={18} />
            <strong>{data.species.length.toLocaleString("es-CO")}</strong>
            <span>Especies</span>
          </div>
          <div>
            <MapPin size={18} />
            <strong>{zonesCount}</strong>
            <span>Zonas ({greens} verdes)</span>
          </div>
          <div>
            <Binoculars size={18} />
            <strong>{data.sightings.length}</strong>
            <span>Fauna observada</span>
          </div>
        </div>
      )}
      {error && (
        <ErrorBox message={error} retry={() => setRevision((v) => v + 1)} />
      )}
      {locating && locationError && (
        <p className="cell-note overview-note" role="status">
          {locationError}
        </p>
      )}
      <div className="overview-map">
        <div ref={el} className="overview-canvas" />
        {loading && (
          <div className="overview-loading">
            <Loading />
          </div>
        )}
        <div className="overview-top">
          <label className="overview-search">
            <Search size={15} />
            <input
              aria-label="Buscar especie en el mapa"
              placeholder="Buscar especie…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </label>
          <div
            className="overview-toggles"
            role="group"
            aria-label="Capas del mapa"
          >
            {(
              [
                ["specimens", "Especímenes"],
                ["zones", "Zonas"],
                ["animals", "Fauna"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                aria-pressed={show[k]}
                className={show[k] ? "on" : ""}
                onClick={() => setShow({ ...show, [k]: !show[k] })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="overview-bottom-left">
          <button
            type="button"
            onClick={() =>
              map.current?.fitBounds(L.latLngBounds(campusAllPoints), {
                padding: [20, 20],
              })
            }
          >
            <Expand size={15} /> Centrar campus
          </button>
          <button
            type="button"
            aria-pressed={locating}
            className={locating ? "on" : ""}
            onClick={() => {
              centered.current = false;
              if (locating && location)
                map.current?.setView([location.lat, location.lng], 18);
              else setLocating(true);
            }}
          >
            <LocateFixed size={15} />{" "}
            {locating ? "Ir a mi ubicación" : "Mi ubicación"}
          </button>
          <button
            type="button"
            aria-expanded={legend}
            onClick={() => setLegend(!legend)}
          >
            <Layers size={15} /> Leyenda
          </button>
        </div>
        {legend && (
          <div className="overview-legend">
            <strong>Leyenda</strong>
            <span>
              <i style={{ background: "#3f9a5a" }} /> Zona verde
            </span>
            <span>
              <i style={{ background: "#d58b3c" }} /> Zona de interés
            </span>
            <span>
              <i className="ring" /> Límite del campus
            </span>
            <span>
              <i style={{ background: "#5b7fa8" }} /> Fauna u hongo observado
            </span>
            <span>
              <i className="me" /> Tu ubicación
            </span>
            <small>
              Acerca el mapa para ver el ícono de cada grupo. Toca un punto para
              ver su detalle.
            </small>
          </div>
        )}
      </div>
      {counts.length > 0 && (
        <div className="group-chips overview-chips">
          <button
            className={group === "" ? "selected" : ""}
            onClick={() => setGroup("")}
          >
            Todos <span>{data?.specimens.length}</span>
          </button>
          {counts.map(({ group: g, n }) => {
            const Icon = g.icon;
            return (
              <button
                key={g.label}
                className={group === g.label ? "selected" : ""}
                onClick={() => setGroup(group === g.label ? "" : g.label)}
              >
                <i className="chip-dot" style={{ background: g.color }}>
                  <Icon size={13} />
                </i>
                {g.label} <span>{n}</span>
              </button>
            );
          })}
        </div>
      )}
      {(group || query) && data && (
        <p className="cell-note overview-note">
          Mostrando {shown.length.toLocaleString("es-CO")} de{" "}
          {data.specimens.length.toLocaleString("es-CO")} especímenes.
        </p>
      )}
    </section>
  );
}
