import { useEffect, useState } from "react";

export interface UserLocation {
  lat: number;
  lng: number;
  accuracy: number;
}

/**
 * Ubicación del navegador mientras `enabled` es verdadero. Solo funciona en
 * HTTPS o localhost y con el permiso de ubicación concedido.
 */
export function useUserLocation(enabled: boolean) {
  const [location, setLocation] = useState<UserLocation | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    if (!enabled) return;
    if (!("geolocation" in navigator)) {
      setError("Este navegador no permite conocer tu ubicación.");
      return;
    }
    setError("");
    const id = navigator.geolocation.watchPosition(
      (p) =>
        setLocation({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracy: p.coords.accuracy,
        }),
      (e) =>
        setError(
          e.code === e.PERMISSION_DENIED
            ? "Permite el acceso a la ubicación en el navegador para ver tu punto."
            : "No pudimos obtener tu ubicación.",
        ),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled]);
  return { location, error };
}
