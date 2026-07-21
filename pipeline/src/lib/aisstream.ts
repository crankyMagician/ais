import WebSocket from "ws";

const ENDPOINT = "wss://stream.aisstream.io/v0/stream";

export interface Observation {
  mmsi: string;
  lat: number;
  lon: number;
  sog: number | null;
  cog: number | null;
  heading: number | null;
  navStatus: number | null;
  ts: number; // epoch seconds
}

export interface StaticInfo {
  mmsi: string;
  name?: string;
  callsign?: string;
  imo?: number;
  shipType?: number;
  draught?: number;
  dest?: string;
}

export interface CollectResult {
  positions: Map<string, Observation>; // latest per MMSI
  statics: Map<string, StaticInfo>;
  msgCount: number;
  connectedMs: number;
}

interface Envelope {
  MessageType?: string;
  MetaData?: {
    MMSI?: number;
    ShipName?: string;
    latitude?: number;
    longitude?: number;
    time_utc?: string;
  };
  Message?: Record<string, Record<string, unknown>>;
}

function parseTs(timeUtc: string | undefined, fallback: number): number {
  if (!timeUtc) return fallback;
  // e.g. "2026-07-21 20:58:15.905454636 +0000 UTC"
  const m = timeUtc.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})/);
  if (!m) return fallback;
  const t = Date.parse(`${m[1]}T${m[2]}Z`);
  return Number.isFinite(t) ? t / 1000 : fallback;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function cleanStr(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.replace(/@+/g, "").trim();
  return s.length ? s : undefined;
}

export function foldMessage(
  raw: string,
  result: CollectResult,
  nowSec: number,
  onPosition?: (obs: Observation) => void,
): void {
  let env: Envelope;
  try {
    env = JSON.parse(raw) as Envelope;
  } catch {
    return;
  }
  const type = env.MessageType;
  const meta = env.MetaData;
  const body = type ? env.Message?.[type] : undefined;
  if (!type || !meta?.MMSI || !body) return;
  const mmsi = String(meta.MMSI);
  result.msgCount++;

  if (
    type === "PositionReport" ||
    type === "StandardClassBPositionReport" ||
    type === "ExtendedClassBPositionReport"
  ) {
    const lat = num(body.Latitude) ?? num(meta.latitude);
    const lon = num(body.Longitude) ?? num(meta.longitude);
    if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180)
      return;
    const heading = num(body.TrueHeading);
    const obs: Observation = {
      mmsi,
      lat,
      lon,
      sog: num(body.Sog),
      cog: num(body.Cog),
      heading: heading === 511 ? null : heading,
      navStatus: num(body.NavigationalStatus),
      ts: parseTs(meta.time_utc, nowSec),
    };
    result.positions.set(mmsi, obs);
    onPosition?.(obs);
    const name = cleanStr(meta.ShipName);
    if (name && !result.statics.get(mmsi)?.name) {
      const prev = result.statics.get(mmsi) ?? { mmsi };
      result.statics.set(mmsi, { ...prev, name });
    }
  } else if (type === "ShipStaticData") {
    const prev = result.statics.get(mmsi) ?? { mmsi };
    result.statics.set(mmsi, {
      ...prev,
      name: cleanStr(body.Name) ?? prev.name,
      callsign: cleanStr(body.CallSign) ?? prev.callsign,
      imo: num(body.ImoNumber) ?? prev.imo,
      shipType: num(body.Type) ?? prev.shipType,
      draught: num(body.MaximumStaticDraught) ?? prev.draught,
      dest: cleanStr(body.Destination) ?? prev.dest,
    });
  } else if (type === "StaticDataReport") {
    const prev = result.statics.get(mmsi) ?? { mmsi };
    const reportA = body.ReportA as Record<string, unknown> | undefined;
    const reportB = body.ReportB as Record<string, unknown> | undefined;
    result.statics.set(mmsi, {
      ...prev,
      name: cleanStr(reportA?.Name) ?? prev.name,
      shipType: num(reportB?.ShipType) ?? prev.shipType,
      callsign: cleanStr(reportB?.CallSign) ?? prev.callsign,
    });
  }
}

export interface CollectOptions {
  apiKey: string;
  boxes: number[][][];
  windowMs: number;
  log?: (msg: string) => void;
  onPosition?: (obs: Observation) => void;
}

// Streams for windowMs, reconnecting with jitter on drops. Returns the folded
// latest-per-vessel view; per-message work is O(1) map writes so the read
// queue never backs up (aisstream disconnects slow consumers).
export function collectWindow(opts: CollectOptions): Promise<CollectResult> {
  const log = opts.log ?? (() => {});
  const result: CollectResult = {
    positions: new Map(),
    statics: new Map(),
    msgCount: 0,
    connectedMs: 0,
  };

  return new Promise((resolve) => {
    const deadline = Date.now() + opts.windowMs;
    let ws: WebSocket | null = null;
    let connectedSince: number | null = null;
    let settled = false;

    function finish() {
      if (settled) return;
      settled = true;
      if (connectedSince) result.connectedMs += Date.now() - connectedSince;
      try {
        ws?.terminate();
      } catch {
        // already closed
      }
      resolve(result);
    }

    const windowTimer = setTimeout(finish, opts.windowMs);
    windowTimer.unref?.();

    function connect() {
      if (settled || Date.now() >= deadline) return finish();
      ws = new WebSocket(ENDPOINT);

      ws.on("open", () => {
        // must arrive within 3 s of connect or the server closes the socket
        ws!.send(
          JSON.stringify({
            APIKey: opts.apiKey,
            BoundingBoxes: opts.boxes,
            FilterMessageTypes: [
              "PositionReport",
              "StandardClassBPositionReport",
              "ExtendedClassBPositionReport",
              "ShipStaticData",
              "StaticDataReport",
            ],
          }),
        );
        connectedSince = Date.now();
        log("aisstream connected");
      });

      ws.on("message", (data: WebSocket.RawData) => {
        foldMessage(data.toString(), result, Date.now() / 1000, opts.onPosition);
      });

      const onDrop = (why: string) => {
        if (connectedSince) {
          result.connectedMs += Date.now() - connectedSince;
          connectedSince = null;
        }
        if (settled) return;
        const remaining = deadline - Date.now();
        if (remaining < 5000) return finish();
        const delay = 1000 + Math.random() * 3000;
        log(`aisstream dropped (${why}); reconnecting in ${Math.round(delay)}ms`);
        setTimeout(connect, delay);
      };

      ws.on("close", (code: number) => onDrop(`close ${code}`));
      ws.on("error", (err: Error) => {
        log(`aisstream error: ${err.message}`);
        try {
          ws?.terminate();
        } catch {
          // ignore
        }
      });
    }

    connect();
  });
}
