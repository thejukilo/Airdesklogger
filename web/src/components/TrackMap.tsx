/**
 * Flight track map. Self-contained SVG renderer: no tile library, no CDN,
 * no bundle bloat. Projects WGS84 lon/lat through Web Mercator and autofits
 * the path to the viewport, with green/red markers for takeoff and landing.
 *
 * The flight school's track ships as GeoJSON LineString lon/lat pairs, which
 * is what we accept on the Import API and what we render here. For a tile-
 * backed map (street/terrain context) we would upgrade to Leaflet later;
 * for the typical 0.5–2-hour flight the polyline is the information that
 * matters — a pilot wants to see the shape, not zoom in on streets.
 */

interface TrackProps {
  track: {
    type: "LineString";
    coordinates: Array<[number, number] | [number, number, number]>;
  };
  height?: number;
}

/** Web Mercator y in degrees (the x is just lon). Latitudes are clamped near the poles. */
function mercatorY(lat: number): number {
  const clamped = Math.max(-85.05, Math.min(85.05, lat));
  const rad = (clamped * Math.PI) / 180;
  return (Math.log(Math.tan(Math.PI / 4 + rad / 2)) * 180) / Math.PI;
}

export function TrackMap({ track, height = 240 }: TrackProps) {
  const pts = track.coordinates;
  if (!pts || pts.length < 2) return null;

  // Project to Web Mercator (x = lon, y = mercator(lat)) and find the bounding box.
  const projected = pts.map(([lon, lat]) => ({ x: lon, y: mercatorY(lat) }));
  const xs = projected.map((p) => p.x);
  const ys = projected.map((p) => p.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);

  // 10% padding so the markers don't sit on the edge; tiny epsilon avoids a
  // divide-by-zero when start and end are the same point.
  const xSpan = Math.max(xMax - xMin, 1e-6);
  const ySpan = Math.max(yMax - yMin, 1e-6);
  const padX = xSpan * 0.1;
  const padY = ySpan * 0.1;

  // Width is fluid (set by container); pick a viewBox that preserves the
  // geographic aspect ratio of the bounding box, so the polyline doesn't
  // squash on landscape vs portrait flights.
  const aspect = (xSpan + 2 * padX) / (ySpan + 2 * padY);
  const vbHeight = 1000;
  const vbWidth = Math.round(vbHeight * aspect);

  const sx = (x: number) => ((x - (xMin - padX)) / (xSpan + 2 * padX)) * vbWidth;
  // SVG y axis grows downward; flip mercator y to match.
  const sy = (y: number) => vbHeight - ((y - (yMin - padY)) / (ySpan + 2 * padY)) * vbHeight;

  const path = projected
    .map((p, i) => `${i === 0 ? "M" : "L"} ${sx(p.x).toFixed(1)} ${sy(p.y).toFixed(1)}`)
    .join(" ");

  const start = projected[0]!;
  const end = projected[projected.length - 1]!;

  return (
    <div className="overflow-hidden rounded border border-slate-200 bg-slate-50" style={{ height }}>
      <svg
        viewBox={`0 0 ${vbWidth} ${vbHeight}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-full w-full"
        role="img"
        aria-label="Flight track"
      >
        <path
          d={path}
          fill="none"
          stroke="#0369a1"
          strokeWidth={Math.max(vbWidth, vbHeight) * 0.004}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <circle
          cx={sx(start.x)}
          cy={sy(start.y)}
          r={Math.max(vbWidth, vbHeight) * 0.012}
          fill="#10b981"
          stroke="#fff"
          strokeWidth={Math.max(vbWidth, vbHeight) * 0.004}
        />
        <circle
          cx={sx(end.x)}
          cy={sy(end.y)}
          r={Math.max(vbWidth, vbHeight) * 0.012}
          fill="#ef4444"
          stroke="#fff"
          strokeWidth={Math.max(vbWidth, vbHeight) * 0.004}
        />
      </svg>
    </div>
  );
}
