import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  ImagePlus,
  Lightbulb,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type { Page } from "../../../shared/types";
import {
  MAX_FUN_FACT_IMAGES,
  type FunFact,
} from "../../../shared/gamification";
import { api, errorMessage } from "../../lib/api";
import {
  Badge,
  Confirm,
  Empty,
  ErrorBox,
  Loading,
  Modal,
  Notice,
} from "../../components/ui";

interface PoiOption {
  id: string;
  name: string;
}
interface Today {
  displayDate: string;
  funFact: FunFact | null;
}
const imageTypes = ["image/jpeg", "image/png", "image/webp"];
const MAX_BYTES = 5 * 1024 * 1024;

/** Datos curiosos del servidor (RF-51) con imágenes y zona del campus. */
export function FunFacts() {
  const [rows, setRows] = useState<FunFact[]>([]),
    [today, setToday] = useState<Today | null>(null),
    [pois, setPois] = useState<PoiOption[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0),
    [q, setQ] = useState(""),
    [visibility, setVisibility] = useState<"" | "visible" | "hidden">(""),
    [zone, setZone] = useState(""),
    [edit, setEdit] = useState<FunFact | "new" | null>(null),
    [files, setFiles] = useState<File[]>([]),
    [busy, setBusy] = useState(""),
    [formError, setFormError] = useState(""),
    [removing, setRemoving] = useState<FunFact | null>(null),
    [viewing, setViewing] = useState<FunFact | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<FunFact[]>("/funfacts", { signal: controller.signal })
      .then((r) => {
        if (!Array.isArray(r))
          throw new Error("La respuesta de datos curiosos no es válida.");
        if (!controller.signal.aborted) setRows(r);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(errorMessage(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    api<Today>("/funfacts/today", { signal: controller.signal })
      .then((t) => !controller.signal.aborted && setToday(t))
      .catch(() => !controller.signal.aborted && setToday(null));
    return () => controller.abort();
  }, [revision]);

  useEffect(() => {
    void (async () => {
      const all: PoiOption[] = [];
      try {
        for (let p = 0; p < 20; p++) {
          const r = await api<Page<PoiOption>>(
            `/social/pois?page=${p}&size=100`,
          );
          all.push(...r.content);
          if (p + 1 >= r.pagination.totalPages) break;
        }
      } catch {
        /* sin zonas se puede crear el dato igual */
      }
      setPois(all.sort((a, b) => a.name.localeCompare(b.name, "es")));
    })();
  }, []);

  const previews = useMemo(
    () => files.map((f) => URL.createObjectURL(f)),
    [files],
  );
  useEffect(
    () => () => previews.forEach((u) => URL.revokeObjectURL(u)),
    [previews],
  );

  const visible = rows.filter((f) => {
    if (visibility === "visible" && f.hidden) return false;
    if (visibility === "hidden" && !f.hidden) return false;
    if (zone === "none" && f.poi) return false;
    if (zone && zone !== "none" && f.poi?.id !== zone) return false;
    const text =
      `${f.title} ${f.description ?? ""} ${f.poi?.name ?? ""}`.toLowerCase();
    return !q.trim() || text.includes(q.trim().toLowerCase());
  });
  const hiddenCount = rows.filter((f) => f.hidden).length;

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFormError("");
    const next = [...files];
    for (const f of Array.from(list)) {
      if (!imageTypes.includes(f.type)) {
        setFormError("Solo se admiten imágenes JPG, PNG o WebP.");
        continue;
      }
      if (f.size > MAX_BYTES) {
        setFormError(`«${f.name}» supera 5 MB.`);
        continue;
      }
      if (next.length >= MAX_FUN_FACT_IMAGES) {
        setFormError(
          `Máximo ${MAX_FUN_FACT_IMAGES} imágenes por dato curioso.`,
        );
        break;
      }
      next.push(f);
    }
    setFiles(next);
  }
  function move(i: number, d: -1 | 1) {
    const j = i + d;
    if (j < 0 || j >= files.length) return;
    const next = [...files];
    [next[i], next[j]] = [next[j], next[i]];
    setFiles(next);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || edit === null) return;
    const data = new FormData(event.currentTarget);
    const poiId = String(data.get("poiId") ?? "");
    const base = {
      title: String(data.get("title")).trim(),
      description: String(data.get("description")).trim(),
      ...(poiId ? { poiId } : {}),
    };
    setFormError("");
    try {
      if (edit === "new") {
        const imageKeys: string[] = [];
        for (const [i, f] of files.entries()) {
          setBusy(`Subiendo imagen ${i + 1} de ${files.length}…`);
          const { key } = await api<{ key: string }>("/funfacts/images", {
            method: "POST",
            headers: { "Content-Type": f.type },
            body: f,
          });
          imageKeys.push(key);
        }
        setBusy("Guardando…");
        await api("/funfacts", {
          method: "POST",
          body: JSON.stringify({ ...base, imageKeys }),
        });
      } else {
        setBusy("Guardando…");
        await api(`/funfacts/${edit.id}`, {
          method: "PUT",
          body: JSON.stringify(base),
        });
      }
      setEdit(null);
      setFiles([]);
      setRevision((v) => v + 1);
    } catch (e) {
      setFormError(errorMessage(e));
    } finally {
      setBusy("");
    }
  }

  async function toggle(f: FunFact) {
    setBusy("Actualizando…");
    setError("");
    try {
      await api(`/funfacts/${f.id}/toggle-hidden`, { method: "PUT" });
      setRevision((v) => v + 1);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy("");
    }
  }

  const current = edit && edit !== "new" ? edit : null;
  const cover = (f: FunFact) => f.images?.[0]?.url ?? f.firstImageUrl ?? null;
  return (
    <section
      className="glass data-panel"
      aria-label="Datos curiosos del servidor"
    >
      <div className="panel-title">
        <h2>Datos curiosos</h2>
        <Badge tone="live">Conectado al backend</Badge>
      </div>
      {today?.funFact && (
        <div className="motd-today">
          <Sparkles size={20} />
          <div>
            <small>Dato del día · {today.displayDate}</small>
            <strong>{today.funFact.title}</strong>
          </div>
        </div>
      )}
      <Notice>
        Cada día la aplicación muestra un dato curioso visible al azar. Los
        datos ocultos no se muestran a la comunidad. Las imágenes se definen al
        crearlo (máximo {MAX_FUN_FACT_IMAGES}).
      </Notice>
      <div className="toolbar">
        <label className="search">
          <Search size={16} />
          <input
            aria-label="Buscar dato curioso"
            placeholder="Buscar por título, texto o zona"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <label>
          Visibilidad
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as typeof visibility)}
          >
            <option value="">Todos ({rows.length})</option>
            <option value="visible">
              Visibles ({rows.length - hiddenCount})
            </option>
            <option value="hidden">Ocultos ({hiddenCount})</option>
          </select>
        </label>
        <label>
          Zona
          <select value={zone} onChange={(e) => setZone(e.target.value)}>
            <option value="">Todas</option>
            <option value="none">Sin zona</option>
            {pois.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <button
          disabled={loading || !!busy}
          onClick={() => setRevision((v) => v + 1)}
        >
          <RefreshCw size={16} /> Actualizar
        </button>
        <button
          className="primary"
          disabled={!!busy}
          onClick={() => {
            setFormError("");
            setFiles([]);
            setEdit("new");
          }}
        >
          <Plus size={16} /> Nuevo dato curioso
        </button>
      </div>
      {loading && <Loading />}
      {error && (
        <ErrorBox message={error} retry={() => setRevision((v) => v + 1)} />
      )}
      {!loading && !error && visible.length === 0 && (
        <Empty
          title={
            rows.length
              ? "Ningún dato coincide con el filtro"
              : "Todavía no hay datos curiosos"
          }
        />
      )}
      {visible.length > 0 && (
        <div className="funfact-grid">
          {visible.map((f) => (
            <article
              key={f.id}
              className={`funfact-card ${f.hidden ? "inactive" : ""}`}
            >
              <button
                className="funfact-cover"
                onClick={() => setViewing(f)}
                aria-label={`Ver «${f.title}»`}
              >
                {cover(f) ? (
                  <img src={cover(f)!} alt="" loading="lazy" />
                ) : (
                  <span>
                    <Lightbulb size={30} />
                  </span>
                )}
                {(f.images?.length ?? 0) > 1 && (
                  <em>{f.images!.length} fotos</em>
                )}
              </button>
              <div className="funfact-body">
                <header>
                  <h3>{f.title}</h3>
                  <Badge tone={f.hidden ? "" : "live"}>
                    {f.hidden ? "Oculto" : "Visible"}
                  </Badge>
                </header>
                {f.description && <p>{f.description}</p>}
                {f.poi && (
                  <small className="cell-note">
                    <MapPin size={12} /> {f.poi.name}
                  </small>
                )}
                <footer className="text-actions">
                  <button disabled={!!busy} onClick={() => toggle(f)}>
                    {f.hidden ? <Eye size={14} /> : <EyeOff size={14} />}
                    {f.hidden ? "Mostrar" : "Ocultar"}
                  </button>
                  <button
                    disabled={!!busy}
                    onClick={() => {
                      setFormError("");
                      setEdit(f);
                    }}
                  >
                    <Pencil size={14} /> Editar
                  </button>
                  <button
                    className="danger-soft"
                    disabled={!!busy}
                    onClick={() => {
                      setError("");
                      setRemoving(f);
                    }}
                  >
                    <Trash2 size={14} /> Eliminar
                  </button>
                </footer>
              </div>
            </article>
          ))}
        </div>
      )}
      {viewing && (
        <Modal title={viewing.title} onClose={() => setViewing(null)}>
          {viewing.images && viewing.images.length > 0 && (
            <div className="funfact-gallery">
              {viewing.images.map((img) => (
                <img key={img.url} src={img.url} alt="" />
              ))}
            </div>
          )}
          <p className="funfact-text">{viewing.description}</p>
          {viewing.poi && (
            <p className="cell-note">
              <MapPin size={13} /> {viewing.poi.name}
            </p>
          )}
        </Modal>
      )}
      {edit && (
        <Modal
          title={edit === "new" ? "Nuevo dato curioso" : "Editar dato curioso"}
          onClose={() => !busy && setEdit(null)}
        >
          <form onSubmit={save} className="form-grid">
            <label className="form-span">
              Título
              <input
                name="title"
                required
                maxLength={200}
                defaultValue={current?.title}
              />
            </label>
            <label className="form-span">
              Descripción
              <textarea
                name="description"
                required
                rows={6}
                maxLength={5000}
                defaultValue={current?.description ?? ""}
              />
            </label>
            <label className="form-span">
              Zona del campus (opcional)
              <select name="poiId" defaultValue={current?.poi?.id ?? ""}>
                <option value="">
                  {current?.poi ? "Conservar la zona actual" : "Sin zona"}
                </option>
                {pois.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            {edit === "new" ? (
              <div className="form-span">
                <p className="field-label">
                  Imágenes ({files.length}/{MAX_FUN_FACT_IMAGES}) · la primera
                  será la portada
                </p>
                <div className="upload-grid">
                  {previews.map((url, i) => (
                    <figure key={url}>
                      <img src={url} alt={`Imagen ${i + 1}`} />
                      <div>
                        <button
                          type="button"
                          aria-label="Mover a la izquierda"
                          disabled={i === 0}
                          onClick={() => move(i, -1)}
                        >
                          <ArrowLeft size={14} />
                        </button>
                        <button
                          type="button"
                          aria-label="Quitar imagen"
                          onClick={() =>
                            setFiles(files.filter((_, j) => j !== i))
                          }
                        >
                          <X size={14} />
                        </button>
                        <button
                          type="button"
                          aria-label="Mover a la derecha"
                          disabled={i === files.length - 1}
                          onClick={() => move(i, 1)}
                        >
                          <ArrowRight size={14} />
                        </button>
                      </div>
                    </figure>
                  ))}
                  {files.length < MAX_FUN_FACT_IMAGES && (
                    <label className="upload-add">
                      <ImagePlus size={22} />
                      <span>Agregar</span>
                      <input
                        type="file"
                        accept={imageTypes.join(",")}
                        multiple
                        hidden
                        onChange={(e) => {
                          addFiles(e.target.files);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  )}
                </div>
              </div>
            ) : (
              current?.images &&
              current.images.length > 0 && (
                <div className="form-span">
                  <p className="field-label">Imágenes (no se pueden cambiar)</p>
                  <div className="upload-grid">
                    {current.images.map((img) => (
                      <figure key={img.url}>
                        <img src={img.url} alt="" />
                      </figure>
                    ))}
                  </div>
                </div>
              )
            )}
            {formError && <ErrorBox message={formError} />}
            <button type="submit" className="primary" disabled={!!busy}>
              {busy ||
                (edit === "new" ? "Publicar dato curioso" : "Guardar cambios")}
            </button>
          </form>
        </Modal>
      )}
      {removing && (
        <Confirm
          title={`Eliminar «${removing.title}»`}
          description="Se elimina el dato curioso y sus imágenes. No se puede deshacer."
          busy={!!busy}
          error={error}
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            setBusy("Eliminando…");
            setError("");
            try {
              await api(`/funfacts/${removing.id}`, { method: "DELETE" });
              setRemoving(null);
              setRevision((v) => v + 1);
            } catch (e) {
              setError(errorMessage(e));
            } finally {
              setBusy("");
            }
          }}
        />
      )}
    </section>
  );
}
