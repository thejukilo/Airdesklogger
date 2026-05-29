import { useEffect, useRef, useState } from "react";

/**
 * Flight track map. Loads Leaflet and its CSS from unpkg at first use, cached
 * by the browser thereafter, so the rest of the SPA bundle stays small for
 * pilots who never open an imported flight. If Leaflet fails to load (offline,
 * blocked by CSP, etc.) we fall back to a self-contained SVG polyline so the
 * shape of the flight still renders.
 *
 * The polyline is drawn from the GeoJSON LineString lon/lat pairs the school
 * pushed; green and red dots mark takeoff and landing. OSM tiles are used as
 * the basemap (free, no key needed); on production we would swap in a
 * tile-provider with attribution and a rate-limit budget.
 */

interface TrackProps {
  track: {
    type: "LineString";
    coordinates: Array<[number, number] | [number, number, number]>;
  };
  height?: number;
}

const LEAFLET_JS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
const LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";

// Window-attached Leaflet API, typed loosely (we don't import @types/leaflet
// since the runtime is loaded by URL, not as a module).
interface LeafletGlobal {
  map: (el: HTMLElement, opts?: object) => LeafletMap;
  tileLayer: (urlTemplate: string, opts?: object) => LeafletLayer;
  polyline: (latlngs: Array<[number, number]>, opts?: object) => LeafletLayer;
  circleMarker: (latlng: [number, number], opts?: object) => LeafletLayer;
  latLngBounds: (latlngs: Array<[number, number]>) => LeafletBounds;
}
interface LeafletMap {
  fitBounds: (bounds: LeafletBounds, opts?: object) => LeafletMap;
  remove: () => void;
}
interface LeafletLayer {
  addTo: (m: LeafletMap) => LeafletLayer;
}
interface LeafletBounds {
  pad: (n: number) => LeafletBounds;
}

declare global {
  interface Window {
    L?: LeafletGlobal;
  }
}

let leafletLoading: Promise<LeafletGlobal> | null = null;

function ensureLeaflet(): Promise<LeafletGlobal> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.L) return Promise.resolve(window.L);
  if (leafletLoading) return leafletLoading;

  leafletLoading = new Promise<LeafletGlobal>((resolve, reject) => {
    if (!document.querySelector(`link[data-leaflet="1"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = LEAFLET_CSS;
      link.setAttribute("data-leaflet", "1");
      document.head.appendChild(link);
    }
    const existing = document.querySelector<HTMLScriptElement>(`script[data-leaflet="1"]`);
    if (existing) {
      existing.addEventListener("load", () => (window.L ? resolve(window.L) : reject(new Error("L missing"))));
      existing.addEventListener("error", () => reject(new Error("Leaflet failed to load")));
      return;
    }
    const script = document.createElement("script");
    script.src = LEAFLET_JS;
    script.async = true;
    script.setAttribute("data-leaflet", "1");
    script.onload = () => (window.L ? resolve(window.L) : reject(new Error("L missing")));
    script.onerror = () => {
      leafletLoading = null;
      reject(new Error("Leaflet failed to load"));
    };
    document.head.appendChild(script);
  });
  return leafletLoading;
}

export function TrackMap({ track, height = 280 }: TrackProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [fallback, setFallback] = useState(false);
  const pts = track.coordinates;

  useEffect(() => {
    if (!pts || pts.length < 2) return;
    let map: LeafletMap | null = null;
    let cancelled = false;

    ensureLeaflet()
      .then((L) => {
        if (cancelled || !containerRef.current) return;
        const latlngs: Array<[number, number]> = pts.map(([lon, lat]) => [lat, lon]);
        map = L.map(containerRef.current, {
          scrollWheelZoom: false,
          attributionControl: true,
        });
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 18,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        }).addTo(map);
        L.polyline(latlngs, { color: "#0369a1", weight: 3, opacity: 0.9, lineJoin: "round" }).addTo(map);
        L.circleMarker(latlngs[0]!, {
          radius: 6, color: "#fff", weight: 2, fillColor: "#10b981", fillOpacity: 1,
        }).addTo(map);
        L.circleMarker(latlngs[latlngs.length - 1]!, {
          radius: 6, color: "#fff", weight: 2, fillColor: "#ef4444", fillOpacity: 1,
        }).addTo(map);
        map.fitBounds(L.latLngBounds(latlngs).pad(0.1));
      })
      .catch(() => {
        if (!cancelled) setFallback(true);
      });

    return () => {
      cancelled = true;
      if (map) map.remove();
    };
  }, [pts]);

  if (!pts || pts.length < 2) return null;

  if (fallback) return <SvgPolylineFallback pts={pts} height={height} />;

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label="Flight track"
      className="overflow-hidden rounded border border-slate-200 bg-slate-50"
      style={{ height }}
    />
  );
}

/** Pure-SVG fallback used when the Leaflet CDN can't be reached. */
function SvgPolylineFallback({
  pts,
  height,
}: {
  pts: Array<[number, number] | [number, number, number]>;
  height: number;
}) {
  const mercatorY = (lat: number) => {
    const clamped = Math.max(-85.05, Math.min(85.05, lat));
    const rad = (clamped * Math.PI) / 180;
    return (Math.log(Math.tan(Math.PI / 4 + rad / 2)) * 180) / Math.PI;
  };
  const projected = pts.map(([lon, lat]) => ({ x: lon, y: mercatorY(lat) }));
  const xs = projected.map((p) => p.x);
  const ys = projected.map((p) => p.y);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const xSpan = Math.max(xMax - xMin, 1e-6);
  const ySpan = Math.max(yMax - yMin, 1e-6);
  const padX = xSpan * 0.1, padY = ySpan * 0.1;
  const aspect = (xSpan + 2 * padX) / (ySpan + 2 * padY);
  const vbHeight = 1000;
  const vbWidth = Math.round(vbHeight * aspect);
  const sx = (x: number) => ((x - (xMin - padX)) / (xSpan + 2 * padX)) * vbWidth;
  const sy = (y: number) => vbHeight - ((y - (yMin - padY)) / (ySpan + 2 * padY)) * vbHeight;
  const path = projected.map((p, i) => `${i === 0 ? "M" : "L"} ${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`).join(" ");
  const start = projected[0]!;
  const end = projected[projected.length - 1]!;
  return (
    <div className="overflow-hidden rounded border border-slate-200 bg-slate-50" style={{ height }}>
      <svg viewBox={`0 0 ${vbWidth} ${vbHeight}`} preserveAspectRatio="xMidYMid meet" className="h-full w-full" role="img" aria-label="Flight track">
        <path d={path} fill="none" stroke="#0369a1" strokeWidth={Math.max(vbWidth, vbHeight) * 0.004} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={sx(start.x)} cy={sy(start.y)} r={Math.max(vbWidth, vbHeight) * 0.012} fill="#10b981" stroke="#fff" strokeWidth={Math.max(vbWidth, vbHeight) * 0.004} />
        <circle cx={sx(end.x)} cy={sy(end.y)} r={Math.max(vbWidth, vbHeight) * 0.012} fill="#ef4444" stroke="#fff" strokeWidth={Math.max(vbWidth, vbHeight) * 0.004} />
      </svg>
    </div>
  );
}
