import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db, handleFirestoreError, OperationType } from '../firebase';
import type {
  FloorplanElement,
  FloorplanProject,
  InteriorWall,
  SectionLine,
  SolvedFloorplan,
  WallEdge,
} from '../types/floorplan';

export interface CloudFloorplanRecord {
  id: string;
  ownerId: string;
  project: FloorplanProject;
  summary: {
    areaSqMeters: number;
    areaPing: number;
    edgeCount: number;
    elementCount: number;
  };
  updatedAtMs: number;
  createdAtMs: number;
}

function clampString(val: unknown, fallback: string, maxLen: number): string {
  const str = typeof val === 'string' ? val.trim() : '';
  if (!str) return fallback.slice(0, maxLen);
  return str.slice(0, maxLen);
}

function finiteOr(val: unknown, fallback: number): number {
  return typeof val === 'number' && Number.isFinite(val) ? val : fallback;
}

function sanitizeEdge(edge: WallEdge, idx: number): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: clampString(edge.id, `w-${idx + 1}`, 64),
    label: clampString(edge.label, `W${idx + 1}`, 80),
    lengthCm: Math.max(1, finiteOr(edge.lengthCm, 100)),
    angleDeg: ((finiteOr(edge.angleDeg, 0) % 360) + 360) % 360,
    hasWall: Boolean(edge.hasWall),
  };
  if (typeof edge.note === 'string' && edge.note.trim()) {
    out.note = edge.note.trim().slice(0, 200);
  }
  return out;
}

function sanitizeInteriorWall(wall: InteriorWall, idx: number): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: clampString(wall.id, `iw-${idx + 1}`, 64),
    label: clampString(wall.label, `I${idx + 1}`, 80),
    startXCm: Math.round(finiteOr(wall.startXCm, 0) * 10) / 10,
    startYCm: Math.round(finiteOr(wall.startYCm, 0) * 10) / 10,
    lengthCm: Math.max(1, finiteOr(wall.lengthCm, 100)),
    angleDeg: ((finiteOr(wall.angleDeg, 0) % 360) + 360) % 360,
    hasWall: Boolean(wall.hasWall),
  };
  if (typeof wall.note === 'string' && wall.note.trim()) {
    out.note = wall.note.trim().slice(0, 200);
  }
  return out;
}

function sanitizeElement(el: FloorplanElement, idx: number): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: clampString(el.id, `el-${idx + 1}`, 64),
    kind: el.kind,
    name: clampString(el.name, '元件', 60),
    placement: el.placement === 'free' ? 'free' : 'wall',
    edgeId: clampString(el.edgeId, '', 64),
    offsetCm: Math.max(0, finiteOr(el.offsetCm, 0)),
    rotationDeg: ((finiteOr(el.rotationDeg, 0) % 360) + 360) % 360,
    widthCm: Math.max(5, finiteOr(el.widthCm, 90)),
    depthCm: Math.max(5, finiteOr(el.depthCm, 12)),
    heightCm: Math.max(10, finiteOr(el.heightCm, 210)),
    elevationCm: Math.max(0, finiteOr(el.elevationCm, 0)),
    side: el.side === 'outside' ? 'outside' : 'inside',
  };
  if (typeof el.xCm === 'number' && Number.isFinite(el.xCm)) {
    out.xCm = Math.round(el.xCm * 10) / 10;
  }
  if (typeof el.yCm === 'number' && Number.isFinite(el.yCm)) {
    out.yCm = Math.round(el.yCm * 10) / 10;
  }
  if (el.swingDirection) {
    out.swingDirection = el.swingDirection;
  }
  if (typeof el.showClearance === 'boolean') {
    out.showClearance = el.showClearance;
  }
  if (typeof el.showWallDistances === 'boolean') {
    out.showWallDistances = el.showWallDistances;
  }
  return out;
}

function sanitizeSectionLine(sec: SectionLine, idx: number): Record<string, unknown> {
  return {
    id: clampString(sec.id, `sec-${idx + 1}`, 64),
    label: clampString(sec.label, `${String.fromCharCode(65 + (idx % 26))}-${String.fromCharCode(65 + (idx % 26))}`, 40),
    startXCm: Math.round(finiteOr(sec.startXCm, 0) * 10) / 10,
    startYCm: Math.round(finiteOr(sec.startYCm, 0) * 10) / 10,
    endXCm: Math.round(finiteOr(sec.endXCm, 200) * 10) / 10,
    endYCm: Math.round(finiteOr(sec.endYCm, 0) * 10) / 10,
    viewDirection: sec.viewDirection === -1 ? -1 : 1,
  };
}

function buildFirestorePayload(
  ownerId: string,
  project: FloorplanProject,
  solved: SolvedFloorplan,
  includeCreatedAt: boolean
): Record<string, unknown> {
  const safeEdges = project.edges.slice(0, 60).map(sanitizeEdge);
  const safeInteriorWalls = (project.interiorWalls ?? []).slice(0, 40).map(sanitizeInteriorWall);
  const safeElements = project.elements.slice(0, 120).map(sanitizeElement);
  const safeSectionLines = (project.sectionLines ?? []).slice(0, 20).map(sanitizeSectionLine);

  const payload: Record<string, unknown> = {
    projectName: clampString(project.projectName, '未命名空間平面圖', 100),
    ceilingHeightCm: Math.min(1000, Math.max(100, finiteOr(project.ceilingHeightCm, 250))),
    wallThicknessCm: Math.min(100, Math.max(4, finiteOr(project.wallThicknessCm, 12))),
    unit: project.unit === 'm' || project.unit === 'mm' ? project.unit : 'cm',
    autoSnapAngles: Boolean(project.autoSnapAngles),
    snapToleranceDeg: Math.min(45, Math.max(0, finiteOr(project.snapToleranceDeg, 8))),
    forceClose: Boolean(project.forceClose),
    edges: safeEdges,
    interiorWalls: safeInteriorWalls,
    elements: safeElements,
    sectionLines: safeSectionLines,
    summary: {
      areaSqMeters: Math.max(0, Math.round(solved.areaSqMeters * 100) / 100),
      areaPing: Math.max(0, Math.round(solved.areaPing * 100) / 100),
      edgeCount: safeEdges.length,
      elementCount: safeElements.length,
    },
    updatedAt: serverTimestamp(),
  };

  if (typeof project.analysisNotes === 'string' && project.analysisNotes.trim()) {
    payload.analysisNotes = project.analysisNotes.trim().slice(0, 1000);
  }

  if (includeCreatedAt) {
    payload.ownerId = ownerId;
    payload.createdAt = serverTimestamp();
  }

  return payload;
}

export async function ensureUserProfile(user: User): Promise<void> {
  const path = `users/${user.uid}`;
  try {
    const profilePayload: Record<string, unknown> = {
      uid: user.uid,
      updatedAt: serverTimestamp(),
    };
    if (user.displayName && user.displayName.trim()) {
      profilePayload.displayName = user.displayName.trim().slice(0, 120);
    }
    await setDoc(doc(db, 'users', user.uid), profilePayload, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export function subscribeUserFloorplans(
  userId: string,
  onData: (records: CloudFloorplanRecord[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const colPath = `users/${userId}/floorplans`;
  const q = query(collection(db, 'users', userId, 'floorplans'), where('ownerId', '==', userId));

  return onSnapshot(
    q,
    (snapshot) => {
      const records: CloudFloorplanRecord[] = snapshot.docs.map((docSnap) => {
        const d = docSnap.data();
        const updatedTs = d.updatedAt instanceof Timestamp ? d.updatedAt.toMillis() : Date.now();
        const createdTs = d.createdAt instanceof Timestamp ? d.createdAt.toMillis() : updatedTs;
        const proj: FloorplanProject = {
          projectName: String(d.projectName || '未命名專案'),
          ceilingHeightCm: Number(d.ceilingHeightCm) || 250,
          wallThicknessCm: Number(d.wallThicknessCm) || 12,
          unit: d.unit === 'm' || d.unit === 'mm' ? d.unit : 'cm',
          autoSnapAngles: Boolean(d.autoSnapAngles),
          snapToleranceDeg: Number(d.snapToleranceDeg ?? 8),
          forceClose: Boolean(d.forceClose),
          edges: Array.isArray(d.edges) ? (d.edges as WallEdge[]) : [],
          ...(Array.isArray(d.interiorWalls) && d.interiorWalls.length > 0
            ? { interiorWalls: d.interiorWalls as InteriorWall[] }
            : {}),
          elements: Array.isArray(d.elements) ? (d.elements as FloorplanElement[]) : [],
          ...(Array.isArray(d.sectionLines) && d.sectionLines.length > 0
            ? { sectionLines: d.sectionLines as SectionLine[] }
            : {}),
          ...(typeof d.analysisNotes === 'string' ? { analysisNotes: d.analysisNotes } : {}),
        };
        const sum = (d.summary || {}) as Record<string, unknown>;
        return {
          id: docSnap.id,
          ownerId: String(d.ownerId || userId),
          project: proj,
          summary: {
            areaSqMeters: Number(sum.areaSqMeters) || 0,
            areaPing: Number(sum.areaPing) || 0,
            edgeCount: Number(sum.edgeCount) || proj.edges.length,
            elementCount: Number(sum.elementCount) || proj.elements.length,
          },
          updatedAtMs: updatedTs,
          createdAtMs: createdTs,
        };
      });
      records.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
      onData(records);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, colPath);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export async function saveNewCloudFloorplan(
  userId: string,
  project: FloorplanProject,
  solved: SolvedFloorplan
): Promise<string> {
  const planId = `plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const docPath = `users/${userId}/floorplans/${planId}`;
  try {
    const payload = buildFirestorePayload(userId, project, solved, true);
    await setDoc(doc(db, 'users', userId, 'floorplans', planId), payload);
    return planId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, docPath);
  }
}

export async function updateCloudFloorplan(
  userId: string,
  planId: string,
  project: FloorplanProject,
  solved: SolvedFloorplan
): Promise<void> {
  const docPath = `users/${userId}/floorplans/${planId}`;
  try {
    const payload = buildFirestorePayload(userId, project, solved, false);
    await updateDoc(doc(db, 'users', userId, 'floorplans', planId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, docPath);
  }
}

export async function deleteCloudFloorplan(userId: string, planId: string): Promise<void> {
  const docPath = `users/${userId}/floorplans/${planId}`;
  try {
    await deleteDoc(doc(db, 'users', userId, 'floorplans', planId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, docPath);
  }
}
