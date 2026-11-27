import {
  collection,
  deleteDoc,
  doc,
  getDoc,
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
  DoorSwing,
  FloorplanElement,
  FloorplanLayer,
  FloorplanProject,
  InteriorWall,
  QuoteAreaUnit,
  QuoteLineItem,
  QuoteSurfaceTarget,
  SectionLine,
  SolvedFloorplan,
  WallEdge,
} from '../types/floorplan';
import { ALL_DOOR_SWINGS, sanitizeHexColor } from '../utils/floorplanGeometry';
import {
  isCabinetElementKind,
  resolveCabinetBaseKind,
  sanitizeCabinetSpec,
} from '../utils/cabinetDesigner';
import {
  buildShareDocId,
  mergeShareEmailLists,
  normalizeEmailAddress,
  normalizeShareAccessLevel,
  removeShareEmail,
  resolveLatestFloorplanForOwner,
  type ShareAccessLevel,
} from '../utils/cloudShareHelpers';

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

export interface SharedCloudFloorplanRecord extends CloudFloorplanRecord {
  ownerDisplayName: string;
  sourcePlanId: string;
  sharedWithEmails: string[];
  accessLevel: ShareAccessLevel;
  lastEditedByEmail?: string;
  lastEditedByName?: string;
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
    depthCm: Math.max(2, finiteOr(el.depthCm, 12)),
    heightCm: Math.max(4, finiteOr(el.heightCm, 210)),
    elevationCm: Math.max(0, finiteOr(el.elevationCm, 0)),
    side: el.side === 'outside' ? 'outside' : 'inside',
  };
  if (typeof el.xCm === 'number' && Number.isFinite(el.xCm)) {
    out.xCm = Math.round(el.xCm * 10) / 10;
  }
  if (typeof el.yCm === 'number' && Number.isFinite(el.yCm)) {
    out.yCm = Math.round(el.yCm * 10) / 10;
  }
  if (el.swingDirection && ALL_DOOR_SWINGS.includes(el.swingDirection as DoorSwing)) {
    out.swingDirection = el.swingDirection;
  }
  if (typeof el.showClearance === 'boolean') {
    out.showClearance = el.showClearance;
  }
  if (typeof el.showWallDistances === 'boolean') {
    out.showWallDistances = el.showWallDistances;
  }
  if (typeof el.lightOn === 'boolean') {
    out.lightOn = el.lightOn;
  }
  const cleanColor = sanitizeHexColor(el.color);
  if (cleanColor) {
    out.color = cleanColor;
  }
  if (typeof el.layerId === 'string' && el.layerId.trim()) {
    out.layerId = el.layerId.trim().slice(0, 64);
  }
  if (isCabinetElementKind(el.kind) && el.cabinetSpec && typeof el.cabinetSpec === 'object') {
    out.cabinetSpec = sanitizeCabinetSpec(
      el.cabinetSpec,
      resolveCabinetBaseKind(el.kind),
      Math.max(5, finiteOr(el.widthCm, 90))
    );
  }
  if (typeof el.customCabinetId === 'string' && el.customCabinetId.trim()) {
    out.customCabinetId = el.customCabinetId.trim().slice(0, 80);
  }
  return out;
}

function sanitizeLayer(layer: FloorplanLayer, idx: number): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: clampString(layer.id, `layer-${idx + 1}`, 64),
    name: clampString(layer.name, `圖層 ${idx + 1}`, 60),
    visible: layer.visible !== false,
  };
  const cleanColor = sanitizeHexColor(layer.color);
  if (cleanColor) {
    out.color = cleanColor;
  }
  return out;
}

const VALID_QUOTE_TARGETS = new Set<QuoteSurfaceTarget>([
  'ceiling',
  'wall',
  'floor',
  'element',
  'custom',
]);
const VALID_QUOTE_UNITS = new Set<QuoteAreaUnit>(['m2', 'ping', 'm', 'pcs']);

function sanitizeQuoteItem(item: QuoteLineItem, idx: number): Record<string, unknown> {
  const target: QuoteSurfaceTarget = VALID_QUOTE_TARGETS.has(item.target) ? item.target : 'custom';
  const unit: QuoteAreaUnit = VALID_QUOTE_UNITS.has(item.unit) ? item.unit : 'pcs';
  const out: Record<string, unknown> = {
    id: clampString(item.id, `q-${idx + 1}`, 64),
    target,
    itemName: typeof item.itemName === 'string' ? item.itemName.trim().slice(0, 120) : '',
    unit,
    quantity: Math.max(0, finiteOr(item.quantity, 0)),
    manualQuantity: Boolean(item.manualQuantity),
    unitPrice: Math.max(0, finiteOr(item.unitPrice, 0)),
  };
  if (typeof item.linkedElementId === 'string' && item.linkedElementId.trim()) {
    out.linkedElementId = item.linkedElementId.trim().slice(0, 64);
  }
  if (typeof item.specNote === 'string' && item.specNote.trim()) {
    out.specNote = item.specNote.trim().slice(0, 200);
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

function buildFloorplanBodyPayload(
  project: FloorplanProject,
  summaryInput: {
    areaSqMeters: number;
    areaPing: number;
  }
): Record<string, unknown> {
  const safeEdges = project.edges.slice(0, 60).map(sanitizeEdge);
  const safeInteriorWalls = (project.interiorWalls ?? []).slice(0, 40).map(sanitizeInteriorWall);
  const safeElements = project.elements.slice(0, 120).map(sanitizeElement);
  const safeSectionLines = (project.sectionLines ?? []).slice(0, 20).map(sanitizeSectionLine);
  const safeLayers = (project.layers ?? []).slice(0, 30).map(sanitizeLayer);
  const safeQuoteItems = (project.quoteItems ?? []).slice(0, 200).map(sanitizeQuoteItem);
  const safeWallColor = sanitizeHexColor(project.wallColor);
  const safeFloorColor = sanitizeHexColor(project.floorColor);

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
    layers: safeLayers,
    quoteItems: safeQuoteItems,
    summary: {
      areaSqMeters: Math.max(0, Math.round(summaryInput.areaSqMeters * 100) / 100),
      areaPing: Math.max(0, Math.round(summaryInput.areaPing * 100) / 100),
      edgeCount: safeEdges.length,
      elementCount: safeElements.length,
    },
    updatedAt: serverTimestamp(),
  };

  if (safeWallColor) {
    payload.wallColor = safeWallColor;
  }
  if (safeFloorColor) {
    payload.floorColor = safeFloorColor;
  }
  if (typeof project.analysisNotes === 'string' && project.analysisNotes.trim()) {
    payload.analysisNotes = project.analysisNotes.trim().slice(0, 1000);
  }

  return payload;
}

function buildFirestorePayload(
  ownerId: string,
  project: FloorplanProject,
  solved: SolvedFloorplan,
  includeCreatedAt: boolean
): Record<string, unknown> {
  const payload = buildFloorplanBodyPayload(project, solved);
  if (includeCreatedAt) {
    payload.ownerId = ownerId;
    payload.createdAt = serverTimestamp();
  }
  return payload;
}

function parseFloorplanDocData(
  d: Record<string, unknown>,
  fallbackOwnerId: string
): {
  project: FloorplanProject;
  summary: CloudFloorplanRecord['summary'];
  updatedAtMs: number;
  createdAtMs: number;
  ownerId: string;
} {
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
    ...(sanitizeHexColor(d.wallColor) ? { wallColor: sanitizeHexColor(d.wallColor) } : {}),
    ...(sanitizeHexColor(d.floorColor) ? { floorColor: sanitizeHexColor(d.floorColor) } : {}),
    ...(Array.isArray(d.layers) && d.layers.length > 0
      ? { layers: d.layers as FloorplanLayer[] }
      : {}),
    ...(Array.isArray(d.quoteItems) && d.quoteItems.length > 0
      ? { quoteItems: d.quoteItems as QuoteLineItem[] }
      : {}),
    ...(typeof d.analysisNotes === 'string' ? { analysisNotes: d.analysisNotes } : {}),
  };
  const sum = (d.summary || {}) as Record<string, unknown>;
  return {
    ownerId: String(d.ownerId || fallbackOwnerId),
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
        const parsed = parseFloorplanDocData(docSnap.data() as Record<string, unknown>, userId);
        return {
          id: docSnap.id,
          ...parsed,
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

export function subscribeMySharedFloorplans(
  userId: string,
  onData: (records: SharedCloudFloorplanRecord[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const colPath = 'shared_floorplans';
  const q = query(collection(db, 'shared_floorplans'), where('ownerId', '==', userId));

  return onSnapshot(
    q,
    (snapshot) => {
      const records: SharedCloudFloorplanRecord[] = snapshot.docs.map((docSnap) => {
        const d = docSnap.data() as Record<string, unknown>;
        const parsed = parseFloorplanDocData(d, userId);
        return {
          id: docSnap.id,
          ...parsed,
          ownerDisplayName: typeof d.ownerDisplayName === 'string' ? d.ownerDisplayName : '',
          sourcePlanId: typeof d.sourcePlanId === 'string' ? d.sourcePlanId : docSnap.id,
          sharedWithEmails: Array.isArray(d.sharedWithEmails)
            ? d.sharedWithEmails.filter((e): e is string => typeof e === 'string')
            : [],
          accessLevel: normalizeShareAccessLevel(d.accessLevel),
          ...(typeof d.lastEditedByEmail === 'string' ? { lastEditedByEmail: d.lastEditedByEmail } : {}),
          ...(typeof d.lastEditedByName === 'string' ? { lastEditedByName: d.lastEditedByName } : {}),
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

export function subscribeSharedWithMeFloorplans(
  userEmail: string,
  onData: (records: SharedCloudFloorplanRecord[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const normalizedEmail = normalizeEmailAddress(userEmail);
  const colPath = 'shared_floorplans';
  const q = query(
    collection(db, 'shared_floorplans'),
    where('sharedWithEmails', 'array-contains', normalizedEmail)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const records: SharedCloudFloorplanRecord[] = snapshot.docs.map((docSnap) => {
        const d = docSnap.data() as Record<string, unknown>;
        const parsed = parseFloorplanDocData(d, '');
        return {
          id: docSnap.id,
          ...parsed,
          ownerDisplayName: typeof d.ownerDisplayName === 'string' ? d.ownerDisplayName : '共用團隊成員',
          sourcePlanId: typeof d.sourcePlanId === 'string' ? d.sourcePlanId : docSnap.id,
          sharedWithEmails: Array.isArray(d.sharedWithEmails)
            ? d.sharedWithEmails.filter((e): e is string => typeof e === 'string')
            : [],
          accessLevel: normalizeShareAccessLevel(d.accessLevel),
          ...(typeof d.lastEditedByEmail === 'string' ? { lastEditedByEmail: d.lastEditedByEmail } : {}),
          ...(typeof d.lastEditedByName === 'string' ? { lastEditedByName: d.lastEditedByName } : {}),
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
  solved: SolvedFloorplan,
  ownerDisplayName?: string | null,
  hasActiveShare?: boolean,
  ownerEmail?: string | null
): Promise<void> {
  const docPath = `users/${userId}/floorplans/${planId}`;
  try {
    const payload = buildFirestorePayload(userId, project, solved, false);
    await updateDoc(doc(db, 'users', userId, 'floorplans', planId), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, docPath);
  }

  if (!hasActiveShare) return;

  // Keep active shared document in sync when the owner updates the source plan
  const shareId = buildShareDocId(userId, planId);
  const sharePath = `shared_floorplans/${shareId}`;
  try {
    const shareRef = doc(db, 'shared_floorplans', shareId);
    const updateBody = buildFloorplanBodyPayload(project, solved);
    if (ownerDisplayName && ownerDisplayName.trim()) {
      updateBody.ownerDisplayName = ownerDisplayName.trim().slice(0, 120);
      updateBody.lastEditedByName = ownerDisplayName.trim().slice(0, 120);
    }
    if (ownerEmail && ownerEmail.trim()) {
      updateBody.lastEditedByEmail = normalizeEmailAddress(ownerEmail).slice(0, 120);
    }
    await updateDoc(shareRef, updateBody);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, sharePath);
  }
}

export async function updateSharedFloorplanByCollaborator(
  user: User,
  shareRecord: SharedCloudFloorplanRecord,
  project: FloorplanProject,
  solved: SolvedFloorplan
): Promise<void> {
  const sharePath = `shared_floorplans/${shareRecord.id}`;
  const shareRef = doc(db, 'shared_floorplans', shareRecord.id);
  const editorEmail = normalizeEmailAddress(user.email || '');
  if (!editorEmail) {
    throw new Error('需要已驗證的 Email 帳號才能同步更新共用專案。');
  }
  const editorName = clampString(
    user.displayName || editorEmail,
    editorEmail,
    120
  );

  try {
    const payload: Record<string, unknown> = {
      ...buildFloorplanBodyPayload(project, solved),
      lastEditedByEmail: editorEmail.slice(0, 120),
      lastEditedByName: editorName,
    };
    await updateDoc(shareRef, payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, sharePath);
  }
}

export async function updateSharedAccessLevel(
  shareRecord: SharedCloudFloorplanRecord,
  accessLevel: ShareAccessLevel
): Promise<void> {
  const sharePath = `shared_floorplans/${shareRecord.id}`;
  const shareRef = doc(db, 'shared_floorplans', shareRecord.id);
  try {
    await updateDoc(shareRef, {
      accessLevel,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, sharePath);
  }
}

export async function deleteCloudFloorplan(
  userId: string,
  planId: string,
  hasActiveShare?: boolean
): Promise<void> {
  const docPath = `users/${userId}/floorplans/${planId}`;
  try {
    await deleteDoc(doc(db, 'users', userId, 'floorplans', planId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, docPath);
  }

  if (!hasActiveShare) return;

  // Clean up active shared snapshot for this deleted project
  const shareId = buildShareDocId(userId, planId);
  const sharePath = `shared_floorplans/${shareId}`;
  try {
    const shareRef = doc(db, 'shared_floorplans', shareId);
    await deleteDoc(shareRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, sharePath);
  }
}

export async function shareCloudFloorplanWithEmails(
  user: User,
  record: CloudFloorplanRecord,
  recipientEmails: string[],
  existingShare?: SharedCloudFloorplanRecord,
  accessLevel: ShareAccessLevel = 'editor'
): Promise<void> {
  const shareId = buildShareDocId(user.uid, record.id);
  const sharePath = `shared_floorplans/${shareId}`;
  const shareRef = doc(db, 'shared_floorplans', shareId);
  const ownerDisplay = (user.displayName || user.email || '雲端空間擁有者').trim().slice(0, 120);
  const ownerEmail = user.email ? normalizeEmailAddress(user.email).slice(0, 120) : '';

  const latest = resolveLatestFloorplanForOwner(record, existingShare);

  try {
    if (existingShare) {
      const mergedEmails = mergeShareEmailLists(existingShare.sharedWithEmails, recipientEmails);
      if (mergedEmails.length === 0) return;

      const updatePayload: Record<string, unknown> = {
        ...buildFloorplanBodyPayload(latest.project, latest.summary),
        sharedWithEmails: mergedEmails,
        accessLevel,
        ownerDisplayName: ownerDisplay,
      };
      await updateDoc(shareRef, updatePayload);
      return;
    }

    const initialEmails = mergeShareEmailLists([], recipientEmails);
    if (initialEmails.length === 0) return;

    const createPayload: Record<string, unknown> = {
      ...buildFloorplanBodyPayload(record.project, record.summary),
      ownerId: user.uid,
      ownerDisplayName: ownerDisplay,
      sourcePlanId: record.id,
      sharedWithEmails: initialEmails,
      accessLevel,
      ...(ownerEmail ? { lastEditedByEmail: ownerEmail, lastEditedByName: ownerDisplay } : {}),
      createdAt: serverTimestamp(),
    };

    try {
      await setDoc(shareRef, createPayload);
    } catch (createErr) {
      // Handle multi-tab race where share doc was created concurrently
      const existingSnap = await getDoc(shareRef);
      if (!existingSnap.exists()) {
        throw createErr;
      }
      const existingData = existingSnap.data() as Record<string, unknown>;
      const existingList = Array.isArray(existingData.sharedWithEmails)
        ? existingData.sharedWithEmails.filter((e): e is string => typeof e === 'string')
        : [];
      const mergedEmails = mergeShareEmailLists(existingList, recipientEmails);
      if (mergedEmails.length === 0) return;

      const updatePayload: Record<string, unknown> = {
        ...buildFloorplanBodyPayload(record.project, record.summary),
        sharedWithEmails: mergedEmails,
        accessLevel,
        ownerDisplayName: ownerDisplay,
      };
      await updateDoc(shareRef, updatePayload);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, sharePath);
  }
}

export async function revokeCloudFloorplanShareEmail(
  shareRecord: SharedCloudFloorplanRecord,
  emailToRemove: string
): Promise<void> {
  const sharePath = `shared_floorplans/${shareRecord.id}`;
  const shareRef = doc(db, 'shared_floorplans', shareRecord.id);
  const nextEmails = removeShareEmail(shareRecord.sharedWithEmails, emailToRemove);

  try {
    if (nextEmails.length === 0) {
      await deleteDoc(shareRef);
    } else {
      await updateDoc(shareRef, {
        sharedWithEmails: nextEmails,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, sharePath);
  }
}
