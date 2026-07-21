"use client";

import { useEffect, useRef } from "react";
import maplibregl, { Popup } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { DarkEvent } from "@/lib/types";
import { flagName } from "@/lib/mid";
import { typeLabel } from "@/lib/shiptype";
import { CLASS_LABELS } from "./charts";

const STYLE_URL = "https://tiles.openfreemap.org/styles/dark";
const OPEN_COLOR = "#c98500";
const CLOSED_COLOR = "#7a8aa5";

function toFC(events: DarkEvent[]) {
  return {
    type: "FeatureCollection" as const,
    features: events.map((e) => ({
      type: "Feature" as const,
      geometry: {
        type: "Point" as const,
        coordinates: [e.lastPos.lon, e.lastPos.lat],
      },
      properties: {
        name: e.name || `MMSI ${e.mmsi}`,
        flag: flagName(e.flagMid),
        type: typeLabel(e.shipType),
        cls: CLASS_LABELS[e.class],
        gap: e.gapMin ?? null,
      },
    })),
  };
}

export default function EventsMap({
  open,
  closed,
}: {
  open: DarkEvent[];
  closed: DarkEvent[];
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const map = new maplibregl.Map({
      container: ref.current,
      style: STYLE_URL,
      center: [25, 45],
      zoom: 2.4,
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");

    map.on("load", () => {
      // 2px surface ring so overlapping markers stay separable
      for (const [id, events, color, r] of [
        ["closed-events", closed, CLOSED_COLOR, 4],
        ["open-events", open, OPEN_COLOR, 6],
      ] as const) {
        map.addSource(id, { type: "geojson", data: toFC(events) });
        map.addLayer({
          id,
          type: "circle",
          source: id,
          paint: {
            "circle-radius": r,
            "circle-color": color,
            "circle-stroke-width": 2,
            "circle-stroke-color": "#111a2c",
          },
        });
        map.on("click", id, (e) => {
          const p = e.features?.[0]?.properties;
          if (!p) return;
          new Popup({ closeButton: false, maxWidth: "240px" })
            .setLngLat(e.lngLat)
            .setHTML(
              `<div class="popup-name">${p.name}</div>` +
                `<div class="popup-row">${p.flag} · ${p.type}</div>` +
                `<div class="popup-row">${p.cls}${p.gap ? ` · gap ${p.gap} min` : ""}</div>`,
            )
            .addTo(map);
        });
        map.on("mouseenter", id, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", id, () => {
          map.getCanvas().style.cursor = "";
        });
      }
    });

    return () => map.remove();
  }, [open, closed]);

  return (
    <div>
      <div ref={ref} className="events-map" />
      <div className="legend">
        <span className="legend-item">
          <span className="swatch" style={{ background: OPEN_COLOR }} />
          open event (last known position)
        </span>
        <span className="legend-item">
          <span className="swatch" style={{ background: CLOSED_COLOR }} />
          recently closed
        </span>
      </div>
    </div>
  );
}
