import * as net from "node:net";
import type { CollectResult, Observation } from "./aisstream";
import { NmeaDecoder } from "./nmea";

const HOST = "153.44.253.27";
const PORT = 5631;

export interface KystverketOptions {
  windowMs: number;
  result: CollectResult;
  onPosition?: (obs: Observation) => void;
  log?: (msg: string) => void;
  host?: string;
  port?: number;
}

// Streams the Norwegian Coastal Administration's open TCP AIS feed for the
// window, folding into the shared result. Resolves this source's connected ms.
export function collectKystverket(opts: KystverketOptions): Promise<number> {
  const log = opts.log ?? (() => {});
  const decoder = new NmeaDecoder();

  return new Promise((resolve) => {
    const deadline = Date.now() + opts.windowMs;
    let connectedMs = 0;
    let connectedSince: number | null = null;
    let socket: net.Socket | null = null;
    let settled = false;
    let buf = "";

    function finish() {
      if (settled) return;
      settled = true;
      if (connectedSince) connectedMs += Date.now() - connectedSince;
      socket?.destroy();
      resolve(connectedMs);
    }

    const windowTimer = setTimeout(finish, opts.windowMs);
    windowTimer.unref?.();

    function handleLine(line: string) {
      const nowSec = Date.now() / 1000;
      const decoded = decoder.decodeLine(line, nowSec);
      if (!decoded) return;
      opts.result.msgCount++;
      if (decoded.kind === "position") {
        opts.result.positions.set(decoded.obs.mmsi, decoded.obs);
        opts.onPosition?.(decoded.obs);
      } else {
        const prev = opts.result.statics.get(decoded.info.mmsi) ?? {
          mmsi: decoded.info.mmsi,
        };
        opts.result.statics.set(decoded.info.mmsi, {
          ...prev,
          ...Object.fromEntries(
            Object.entries(decoded.info).filter(([, v]) => v !== undefined),
          ),
        });
      }
    }

    function connect() {
      if (settled || Date.now() >= deadline) return finish();
      buf = "";
      let dropped = false; // error and close both fire; reconnect once
      socket = net.createConnection({ host: opts.host ?? HOST, port: opts.port ?? PORT });
      socket.setTimeout(60000);

      socket.on("connect", () => {
        connectedSince = Date.now();
        log("kystverket connected");
      });

      socket.on("data", (d) => {
        buf += d.toString("utf8");
        const lines = buf.split(/\r?\n/);
        buf = lines.pop() ?? "";
        if (buf.length > 65536) buf = ""; // runaway line guard
        for (const line of lines) if (line) handleLine(line);
      });

      const onDrop = (why: string) => {
        if (dropped) return;
        dropped = true;
        if (connectedSince) {
          connectedMs += Date.now() - connectedSince;
          connectedSince = null;
        }
        socket?.destroy();
        if (settled) return;
        const remaining = deadline - Date.now();
        if (remaining < 5000) return finish();
        const delay = 1000 + Math.random() * 3000;
        log(`kystverket dropped (${why}); reconnecting in ${Math.round(delay)}ms`);
        setTimeout(connect, delay);
      };

      socket.on("timeout", () => onDrop("idle timeout"));
      socket.on("error", (e) => onDrop(e.message));
      socket.on("close", () => onDrop("close"));
    }

    connect();
  });
}
