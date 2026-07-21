"use client";

import dynamic from "next/dynamic";

// maplibre-gl touches window at import time, so the map only loads client-side.
const LiveMap = dynamic(() => import("./LiveMap"), {
  ssr: false,
  loading: () => (
    <div className="mapwrap">
      <div className="map-status">Loading map…</div>
    </div>
  ),
});

export default function MapClient() {
  return <LiveMap />;
}
