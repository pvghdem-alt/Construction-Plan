import type {
  DoorSwing,
  ElementKind,
  FloorplanElement,
  FloorplanProject,
  InteriorWall,
  SectionLine,
  UnitType,
  WallEdge,
} from '../types/floorplan';
import { ALL_DOOR_SWINGS } from './floorplanGeometry';

const ALLOWED_KINDS = new Set<ElementKind>([
  'door',
  'cabinet',
  'window',
  'table',
  'chair',
  'bed',
]);
const ALLOWED_SWING_SET = new Set<DoorSwing>(ALL_DOOR_SWINGS);

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(b64u: string): Uint8Array {
  const padLen = (4 - (b64u.length % 4)) % 4;
  const b64 = b64u.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padLen);
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function compressDeflateRaw(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined' || typeof Blob === 'undefined') return null;
  try {
    const copy = new Uint8Array(bytes);
    const stream = new Blob([copy]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    const out = await new Response(stream).arrayBuffer();
    return new Uint8Array(out);
  } catch {
    return null;
  }
}

async function decompressDeflateRaw(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof DecompressionStream === 'undefined' || typeof Blob === 'undefined') return null;
  try {
    const copy = new Uint8Array(bytes);
    const stream = new Blob([copy]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const out = await new Response(stream).arrayBuffer();
    return new Uint8Array(out);
  } catch {
    return null;
  }
}

function finiteOr(val: unknown, fallback: number): number {
  return typeof val === 'number' && Number.isFinite(val) ? val : fallback;
}

function clampString(val: unknown, fallback: string, maxLen: number): string {
  const s = typeof val === 'string' ? val.trim() : '';
  return (s || fallback).slice(0, maxLen);
}

/**
 * Strictly validates and sanitizes a decoded shared project payload.
 * Returns null if the data lacks valid room geometry (< 3 perimeter walls).
 */
export function sanitizeSharedProject(raw: unknown): FloorplanProject | null {
  if (!raw || typeof raw !== 'object') return null;
  const rec = raw as Record<string, unknown>;
  if (!Array.isArray(rec.edges) || rec.edges.length < 3) return null;

  const edges: WallEdge[] = rec.edges
    .slice(0, 60)
    .filter((e): e is Record<string, unknown> => Boolean(e) && typeof e === 'object')
    .map((e, idx) => ({
      id: clampString(e.id, `w-${idx + 1}`, 64),
      label: clampString(e.label, `W${idx + 1}`, 80),
      lengthCm: Math.max(1, Math.min(50000, finiteOr(e.lengthCm, 100))),
      angleDeg: ((finiteOr(e.angleDeg, 0) % 360) + 360) % 360,
      hasWall: e.hasWall !== false,
      ...(typeof e.note === 'string' && e.note.trim()
        ? { note: e.note.trim().slice(0, 200) }
        : {}),
    }));

  if (edges.length < 3) return null;

  const interiorWalls: InteriorWall[] = Array.isArray(rec.interiorWalls)
    ? rec.interiorWalls
        .slice(0, 40)
        .filter((w): w is Record<string, unknown> => Boolean(w) && typeof w === 'object')
        .map((w, idx) => ({
          id: clampString(w.id, `iw-${idx + 1}`, 64),
          label: clampString(w.label, `I${idx + 1}`, 80),
          startXCm: Math.round(finiteOr(w.startXCm, 0) * 10) / 10,
          startYCm: Math.round(finiteOr(w.startYCm, 0) * 10) / 10,
          lengthCm: Math.max(1, Math.min(50000, finiteOr(w.lengthCm, 100))),
          angleDeg: ((finiteOr(w.angleDeg, 0) % 360) + 360) % 360,
          hasWall: w.hasWall !== false,
          ...(typeof w.note === 'string' && w.note.trim()
            ? { note: w.note.trim().slice(0, 200) }
            : {}),
        }))
    : [];

  const elements: FloorplanElement[] = Array.isArray(rec.elements)
    ? rec.elements
        .slice(0, 120)
        .filter((el): el is Record<string, unknown> => Boolean(el) && typeof el === 'object')
        .map((el, idx) => {
          const kindRaw = String(el.kind || '') as ElementKind;
          const kind: ElementKind = ALLOWED_KINDS.has(kindRaw) ? kindRaw : 'cabinet';
          const swingRaw = String(el.swingDirection || '') as DoorSwing;
          const swingDirection =
            kind === 'door'
              ? ALLOWED_SWING_SET.has(swingRaw)
                ? swingRaw
                : 'inward-right'
              : undefined;
          const placement = el.placement === 'free' ? 'free' : 'wall';
          return {
            id: clampString(el.id, `el-${idx + 1}`, 64),
            kind,
            name: clampString(el.name, '元件', 60),
            placement,
            edgeId: clampString(el.edgeId, edges[0].id, 64),
            offsetCm: Math.max(0, finiteOr(el.offsetCm, 0)),
            ...(typeof el.xCm === 'number' && Number.isFinite(el.xCm)
              ? { xCm: Math.round(el.xCm * 10) / 10 }
              : {}),
            ...(typeof el.yCm === 'number' && Number.isFinite(el.yCm)
              ? { yCm: Math.round(el.yCm * 10) / 10 }
              : {}),
            ...(typeof el.rotationDeg === 'number' && Number.isFinite(el.rotationDeg)
              ? { rotationDeg: ((el.rotationDeg % 360) + 360) % 360 }
              : {}),
            widthCm: Math.max(5, Math.min(5000, finiteOr(el.widthCm, 90))),
            depthCm: Math.max(2, Math.min(5000, finiteOr(el.depthCm, 12))),
            heightCm: Math.max(5, Math.min(1000, finiteOr(el.heightCm, 210))),
            elevationCm: Math.max(0, Math.min(1000, finiteOr(el.elevationCm, 0))),
            side: el.side === 'outside' ? 'outside' : 'inside',
            ...(swingDirection ? { swingDirection } : {}),
            ...(typeof el.showClearance === 'boolean'
              ? { showClearance: el.showClearance }
              : {}),
            ...(typeof el.showWallDistances === 'boolean'
              ? { showWallDistances: el.showWallDistances }
              : {}),
          };
        })
    : [];

  const sectionLines: SectionLine[] = Array.isArray(rec.sectionLines)
    ? rec.sectionLines
        .slice(0, 20)
        .filter((s): s is Record<string, unknown> => Boolean(s) && typeof s === 'object')
        .map((s, idx) => ({
          id: clampString(s.id, `sec-${idx + 1}`, 64),
          label: clampString(
            s.label,
            `${String.fromCharCode(65 + (idx % 26))}-${String.fromCharCode(65 + (idx % 26))}`,
            40
          ),
          startXCm: Math.round(finiteOr(s.startXCm, 0) * 10) / 10,
          startYCm: Math.round(finiteOr(s.startYCm, 0) * 10) / 10,
          endXCm: Math.round(finiteOr(s.endXCm, 200) * 10) / 10,
          endYCm: Math.round(finiteOr(s.endYCm, 0) * 10) / 10,
          viewDirection: s.viewDirection === -1 ? -1 : 1,
        }))
    : [];

  const unit: UnitType = rec.unit === 'm' || rec.unit === 'mm' ? rec.unit : 'cm';

  return {
    projectName: clampString(rec.projectName, '分享空間平面圖', 100),
    ceilingHeightCm: Math.min(1000, Math.max(100, finiteOr(rec.ceilingHeightCm, 250))),
    wallThicknessCm: Math.min(100, Math.max(4, finiteOr(rec.wallThicknessCm, 12))),
    unit,
    autoSnapAngles: rec.autoSnapAngles !== false,
    snapToleranceDeg: Math.min(45, Math.max(0, finiteOr(rec.snapToleranceDeg, 8))),
    forceClose: Boolean(rec.forceClose),
    edges,
    ...(interiorWalls.length > 0 ? { interiorWalls } : {}),
    elements,
    ...(sectionLines.length > 0 ? { sectionLines } : {}),
    ...(typeof rec.analysisNotes === 'string' && rec.analysisNotes.trim()
      ? { analysisNotes: rec.analysisNotes.trim().slice(0, 1000) }
      : {}),
  };
}

/**
 * Synchronous base64url encoder (`u:` prefix) for immediate share URL generation.
 */
export function encodeShareTokenSync(project: FloorplanProject): string {
  const json = JSON.stringify(project);
  const bytes = new TextEncoder().encode(json);
  return `u:${bytesToBase64Url(bytes)}`;
}

/**
 * Async compressed encoder (`z:` deflate-raw prefix when smaller & supported, else `u:`).
 */
export async function encodeShareToken(project: FloorplanProject): Promise<string> {
  const json = JSON.stringify(project);
  const bytes = new TextEncoder().encode(json);
  const compressed = await compressDeflateRaw(bytes);
  if (compressed && compressed.length < bytes.length) {
    return `z:${bytesToBase64Url(compressed)}`;
  }
  return `u:${bytesToBase64Url(bytes)}`;
}

export function decodeShareTokenSync(token: string): FloorplanProject | null {
  try {
    const trimmed = token.trim();
    if (!trimmed) return null;
    const raw = trimmed.startsWith('u:') ? trimmed.slice(2) : trimmed;
    if (trimmed.startsWith('z:')) return null;
    const bytes = base64UrlToBytes(raw);
    const json = new TextDecoder().decode(bytes);
    return sanitizeSharedProject(JSON.parse(json));
  } catch {
    return null;
  }
}

export async function decodeShareToken(token: string): Promise<FloorplanProject | null> {
  try {
    const trimmed = token.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('z:')) {
      const compressed = base64UrlToBytes(trimmed.slice(2));
      const decompressed = await decompressDeflateRaw(compressed);
      if (!decompressed) return null;
      const json = new TextDecoder().decode(decompressed);
      return sanitizeSharedProject(JSON.parse(json));
    }
    return decodeShareTokenSync(trimmed);
  } catch {
    return null;
  }
}

export function extractShareTokenFromLocation(
  hash: string,
  search: string
): string | null {
  if (hash) {
    const cleanHash = hash.startsWith('#') ? hash.slice(1) : hash;
    const params = new URLSearchParams(cleanHash);
    const fromHash = params.get('share');
    if (fromHash && fromHash.trim()) {
      return fromHash.trim();
    }
  }
  if (search) {
    const cleanSearch = search.startsWith('?') ? search.slice(1) : search;
    const params = new URLSearchParams(cleanSearch);
    const fromSearch = params.get('share');
    if (fromSearch && fromSearch.trim()) {
      return fromSearch.trim();
    }
  }
  return null;
}

export function buildGitHubPagesShareUrl(baseHref: string, token: string): string {
  const url = new URL(baseHref);
  url.search = '';
  url.hash = `share=${encodeURIComponent(token)}`;
  return url.toString();
}
