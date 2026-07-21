// Minimal AIVDM/AIVDO decoder for the message types the pipeline uses:
// 1/2/3 (Class A position), 18/19 (Class B position), 5 and 24 (statics).
// Handles IEC 61162-1 tag blocks (\s:...,c:ts*hh\) and multipart assembly.

import type { Observation, StaticInfo } from "./aisstream";

class Bits {
  private bytes: Uint8Array;
  readonly length: number;

  constructor(payload: string) {
    this.length = payload.length * 6;
    this.bytes = new Uint8Array(payload.length);
    for (let i = 0; i < payload.length; i++) {
      let v = payload.charCodeAt(i) - 48;
      if (v > 39) v -= 8;
      this.bytes[i] = v & 0x3f;
    }
  }

  uint(start: number, len: number): number {
    let out = 0;
    for (let i = start; i < start + len; i++) {
      out = out * 2 + ((this.bytes[(i / 6) | 0] >> (5 - (i % 6))) & 1);
    }
    return out;
  }

  int(start: number, len: number): number {
    const u = this.uint(start, len);
    return u >= 2 ** (len - 1) ? u - 2 ** len : u;
  }

  text(start: number, len: number): string {
    let out = "";
    for (let i = start; i + 6 <= start + len && i + 6 <= this.length; i += 6) {
      const c = this.uint(i, 6);
      out += String.fromCharCode(c < 32 ? c + 64 : c);
    }
    return out.replace(/@.*$/, "").trim();
  }
}

export interface DecodedPosition {
  kind: "position";
  obs: Observation;
}

export interface DecodedStatic {
  kind: "static";
  info: StaticInfo;
}

export type Decoded = DecodedPosition | DecodedStatic;

function decodePayload(payload: string, ts: number): Decoded | null {
  const b = new Bits(payload);
  if (b.length < 38) return null;
  const type = b.uint(0, 6);
  const mmsi = String(b.uint(8, 30)).padStart(9, "0");

  if (type >= 1 && type <= 3) {
    const lon = b.int(61, 28) / 600000;
    const lat = b.int(89, 27) / 600000;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    const sog = b.uint(50, 10);
    const cog = b.uint(116, 12);
    const hdg = b.uint(128, 9);
    return {
      kind: "position",
      obs: {
        mmsi,
        lat,
        lon,
        sog: sog === 1023 ? null : sog / 10,
        cog: cog === 3600 ? null : cog / 10,
        heading: hdg === 511 ? null : hdg,
        navStatus: b.uint(38, 4),
        ts,
      },
    };
  }

  if (type === 18 || type === 19) {
    if (b.length < 140) return null;
    const lon = b.int(57, 28) / 600000;
    const lat = b.int(85, 27) / 600000;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    const sog = b.uint(46, 10);
    const cog = b.uint(112, 12);
    const hdg = b.uint(124, 9);
    return {
      kind: "position",
      obs: {
        mmsi,
        lat,
        lon,
        sog: sog === 1023 ? null : sog / 10,
        cog: cog === 3600 ? null : cog / 10,
        heading: hdg === 511 ? null : hdg,
        navStatus: null,
        ts,
      },
    };
  }

  if (type === 5) {
    if (b.length < 420) return null;
    const imo = b.uint(40, 30);
    const draught = b.uint(294, 8);
    return {
      kind: "static",
      info: {
        mmsi,
        imo: imo || undefined,
        callsign: b.text(70, 42) || undefined,
        name: b.text(112, 120) || undefined,
        shipType: b.uint(232, 8) || undefined,
        draught: draught ? draught / 10 : undefined,
        dest: b.text(302, 120) || undefined,
      },
    };
  }

  if (type === 24) {
    const part = b.uint(38, 2);
    if (part === 0 && b.length >= 160) {
      const name = b.text(40, 120);
      return name ? { kind: "static", info: { mmsi, name } } : null;
    }
    if (part === 1 && b.length >= 132) {
      return {
        kind: "static",
        info: {
          mmsi,
          shipType: b.uint(40, 8) || undefined,
          callsign: b.text(90, 42) || undefined,
        },
      };
    }
  }

  return null;
}

interface PendingMultipart {
  parts: Map<number, string>;
  total: number;
  ts: number;
  touched: number;
}

export class NmeaDecoder {
  private pending = new Map<string, PendingMultipart>();

  // Accepts one raw line (tag block optional), returns a decoded message or
  // null. `nowSec` is the fallback timestamp when the tag block has no c: field.
  decodeLine(line: string, nowSec: number): Decoded | null {
    let ts = nowSec;
    let sentence = line;

    if (line.startsWith("\\")) {
      const end = line.indexOf("\\", 1);
      if (end < 0) return null;
      const tag = line.slice(1, end);
      const c = /(?:^|,)c:(\d+)/.exec(tag);
      if (c) {
        let t = Number(c[1]);
        if (t > 1e12) t /= 1000;
        ts = t;
      }
      sentence = line.slice(end + 1);
    }

    if (!/^!..VD[MO],/.test(sentence)) return null;
    const star = sentence.indexOf("*");
    const fields = (star >= 0 ? sentence.slice(0, star) : sentence).split(",");
    if (fields.length < 6) return null;
    const total = Number(fields[1]);
    const num = Number(fields[2]);
    const seqId = fields[3];
    const channel = fields[4];
    const payload = fields[5];
    if (!payload || !Number.isFinite(total) || !Number.isFinite(num)) return null;

    if (total === 1) return decodePayload(payload, ts);

    const key = `${seqId}:${channel}:${total}`;
    let p = this.pending.get(key);
    if (!p) {
      p = { parts: new Map(), total, ts, touched: nowSec };
      this.pending.set(key, p);
    }
    p.parts.set(num, payload);
    p.touched = nowSec;
    if (p.parts.size === p.total) {
      this.pending.delete(key);
      let joined = "";
      for (let i = 1; i <= p.total; i++) {
        const part = p.parts.get(i);
        if (part === undefined) return null;
        joined += part;
      }
      return decodePayload(joined, p.ts);
    }
    // GC stale fragments
    if (this.pending.size > 64) {
      for (const [k, v] of this.pending)
        if (nowSec - v.touched > 60) this.pending.delete(k);
    }
    return null;
  }
}
