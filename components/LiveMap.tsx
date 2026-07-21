"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl, { Map as MLMap, Popup } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import mqtt from "mqtt";
import { fetchData } from "@/lib/data";
import { flagOfMmsi } from "@/lib/mid";
import { typeLabel } from "@/lib/shiptype";
import type { RegionSnapshot, SnapshotVessel } from "@/lib/types";

const STYLE_URL = "https://tiles.openfreemap.org/styles/dark";
const MQTT_URL = "wss://meri.digitraffic.fi:443/mqtt";
const REST_LOCATIONS = "https://meri.digitraffic.fi/api/ais/v1/locations";
const REST_VESSELS = "https://meri.digitraffic.fi/api/ais/v1/vessels";

interface LiveVessel {
  mmsi: string;
  lat: number;
  lon: number;
  sog: number | null;
  cog: number | null;
  heading: number | null;
  ts: number; // epoch seconds
}

interface VesselMeta {
  name?: string;
  shipType?: number;
  destination?: string;
}

type FeedState = "connecting" | "live" | "error";

function shipIcon(color: string): ImageData {
  const size = 28;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.translate(size / 2, size / 2);
  ctx.beginPath();
  ctx.moveTo(0, -9);
  ctx.lineTo(6, 9);
  ctx.lineTo(0, 5.5);
  ctx.lineTo(-6, 9);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.stroke();
  return ctx.getImageData(0, 0, size, size);
}

function toFeature(v: LiveVessel, meta?: VesselMeta) {
  return {
    type: "Feature" as const,
    geometry: { type: "Point" as const, coordinates: [v.lon, v.lat] },
    properties: {
      mmsi: v.mmsi,
      name: meta?.name ?? "",
      shipType: meta?.shipType ?? 0,
      destination: meta?.destination ?? "",
      sog: v.sog ?? -1,
      cog: v.cog ?? 0,
      rotation: v.heading ?? v.cog ?? 0,
      ts: v.ts,
    },
  };
}

function popupHtml(p: Record<string, unknown>, live: boolean): string {
  const mmsi = String(p.mmsi ?? "");
  const name = String(p.name ?? "") || `MMSI ${mmsi}`;
  const sog = Number(p.sog);
  const rows = [
    `${flagOfMmsi(mmsi)} · ${typeLabel(Number(p.shipType) || null)}`,
    sog >= 0 ? `${sog.toFixed(1)} kn` : "speed n/a",
    p.destination ? `→ ${String(p.destination)}` : "",
    `${live ? "live" : "snapshot"} · ${new Date(Number(p.ts) * 1000).toLocaleTimeString()}`,
  ].filter(Boolean);
  return (
    `<div class="popup-name">${name}</div>` +
    rows.map((r) => `<div class="popup-row">${r}</div>`).join("")
  );
}

export default function LiveMap() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [feed, setFeed] = useState<FeedState>("connecting");
  const [liveCount, setLiveCount] = useState(0);
  const [snapshotInfo, setSnapshotInfo] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const map: MLMap = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      center: [15, 35],
      zoom: 2,
    });
    map.addControl(new maplibregl.NavigationControl(), "top-right");

    const vessels = new Map<string, LiveVessel>();
    const meta = new Map<string, VesselMeta>();
    let dirty = false;
    let disposed = false;
    let client: ReturnType<typeof mqtt.connect> | null = null;
    let flushTimer: ReturnType<typeof setInterval> | null = null;
    let snapshotTimer: ReturnType<typeof setInterval> | null = null;

    function flush() {
      if (!dirty || !map.getSource("live")) return;
      dirty = false;
      const features = [...vessels.values()].map((v) =>
        toFeature(v, meta.get(v.mmsi)),
      );
      (map.getSource("live") as maplibregl.GeoJSONSource).setData({
        type: "FeatureCollection",
        features,
      });
      setLiveCount(features.length);
    }

    async function bootstrapRest() {
      try {
        const [locRes, vesRes] = await Promise.all([
          fetch(REST_LOCATIONS),
          fetch(REST_VESSELS),
        ]);
        if (vesRes.ok) {
          const list = (await vesRes.json()) as Array<Record<string, unknown>>;
          for (const v of list) {
            meta.set(String(v.mmsi), {
              name: (v.name as string) ?? undefined,
              shipType: (v.shipType as number) ?? undefined,
              destination: (v.destination as string) ?? undefined,
            });
          }
        }
        if (locRes.ok) {
          const fc = (await locRes.json()) as {
            features?: Array<{
              geometry: { coordinates: [number, number] };
              properties: Record<string, unknown>;
            }>;
          };
          const now = Date.now() / 1000;
          for (const f of fc.features ?? []) {
            const p = f.properties;
            const mmsi = String(p.mmsi);
            const tsRaw = Number(p.timestampExternal ?? p.timestamp ?? 0);
            vessels.set(mmsi, {
              mmsi,
              lon: f.geometry.coordinates[0],
              lat: f.geometry.coordinates[1],
              sog: typeof p.sog === "number" ? p.sog : null,
              cog: typeof p.cog === "number" ? p.cog : null,
              heading:
                typeof p.heading === "number" && p.heading !== 511
                  ? p.heading
                  : null,
              ts: tsRaw > 1e12 ? tsRaw / 1000 : tsRaw || now,
            });
          }
          dirty = true;
          flush();
        }
      } catch {
        // REST bootstrap is best-effort; MQTT fills in live traffic.
      }
    }

    function connectMqtt() {
      client = mqtt.connect(MQTT_URL, {
        clientId: `ais-dark-tracker-${Math.random().toString(16).slice(2, 10)}`,
        keepalive: 30,
        reconnectPeriod: 15000,
        connectTimeout: 10000,
      });
      client.on("connect", () => {
        setFeed("live");
        client!.subscribe(
          ["vessels-v2/+/location", "vessels-v2/+/locations", "vessels-v2/status"],
          { qos: 0 },
        );
      });
      client.on("error", () => setFeed("error"));
      client.on("offline", () => setFeed("connecting"));
      client.on("message", (topic: string, payload: Uint8Array) => {
        const parts = topic.split("/");
        if (parts.length < 3 || !parts[2].startsWith("location")) return;
        try {
          const msg = JSON.parse(new TextDecoder().decode(payload)) as {
            time?: number;
            sog?: number;
            cog?: number;
            heading?: number;
            lon?: number;
            lat?: number;
          };
          if (typeof msg.lat !== "number" || typeof msg.lon !== "number") return;
          const mmsi = parts[1];
          vessels.set(mmsi, {
            mmsi,
            lat: msg.lat,
            lon: msg.lon,
            sog: msg.sog ?? null,
            cog: msg.cog ?? null,
            heading:
              typeof msg.heading === "number" && msg.heading !== 511
                ? msg.heading
                : null,
            ts: msg.time ?? Date.now() / 1000,
          });
          dirty = true;
        } catch {
          // skip malformed frame
        }
      });
    }

    async function loadSnapshot() {
      const snap = await fetchData<RegionSnapshot>("live/snapshot-all.json");
      if (!snap || disposed || !map.getSource("snapshot")) return;
      const features = snap.vessels.map((v: SnapshotVessel) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [v.lon, v.lat] },
        properties: {
          mmsi: v.mmsi,
          name: v.name ?? "",
          shipType: v.shipType ?? 0,
          destination: "",
          sog: v.sog ?? -1,
          rotation: v.heading ?? v.cog ?? 0,
          ts: v.ts,
        },
      }));
      (map.getSource("snapshot") as maplibregl.GeoJSONSource).setData({
        type: "FeatureCollection",
        features,
      });
      setSnapshotInfo(
        `${features.length} vessels as of ${new Date(
          snap.generatedAt * 1000,
        ).toLocaleTimeString()}`,
      );
    }

    map.on("load", () => {
      map.addImage("ship-live", shipIcon("#4ecf8d"));
      map.addImage("ship-snap", shipIcon("#7a8aa5"));

      map.addSource("snapshot", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addSource("live", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      for (const [id, src, icon, opacity] of [
        ["snapshot-layer", "snapshot", "ship-snap", 0.75],
        ["live-layer", "live", "ship-live", 1],
      ] as const) {
        map.addLayer({
          id,
          type: "symbol",
          source: src,
          layout: {
            "icon-image": icon,
            "icon-size": ["interpolate", ["linear"], ["zoom"], 1, 0.3, 4, 0.45, 9, 0.9],
            "icon-rotate": ["get", "rotation"],
            "icon-rotation-alignment": "map",
            "icon-allow-overlap": true,
          },
          paint: { "icon-opacity": opacity },
        });

        map.on("click", id, (e) => {
          const f = e.features?.[0];
          if (!f) return;
          new Popup({ closeButton: false, maxWidth: "260px" })
            .setLngLat(e.lngLat)
            .setHTML(popupHtml(f.properties, id === "live-layer"))
            .addTo(map);
        });
        map.on("mouseenter", id, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", id, () => {
          map.getCanvas().style.cursor = "";
        });
      }

      bootstrapRest();
      connectMqtt();
      loadSnapshot();
      flushTimer = setInterval(flush, 1000);
      snapshotTimer = setInterval(loadSnapshot, 5 * 60 * 1000);
    });

    return () => {
      disposed = true;
      if (flushTimer) clearInterval(flushTimer);
      if (snapshotTimer) clearInterval(snapshotTimer);
      client?.end(true);
      map.remove();
    };
  }, []);

  return (
    <div className="mapwrap">
      <div ref={containerRef} className="map" />
      <div className="map-status">
        <span
          className={`dot ${feed === "live" ? "live" : feed === "error" ? "err" : ""}`}
        />
        {feed === "live"
          ? `Baltic live feed · ${liveCount} vessels (Digitraffic)`
          : feed === "error"
            ? "Live feed unavailable"
            : "Connecting to live feed…"}
        {snapshotInfo ? (
          <>
            <br />
            <span>Snapshot (gray): {snapshotInfo}</span>
          </>
        ) : null}
      </div>
    </div>
  );
}
