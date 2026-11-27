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
import { db, handleFirestoreError, OperationType } from '../firebase';
import type { CustomCabinetTemplate } from '../types/floorplan';
import {
  resolveCabinetBaseKind,
  sanitizeCabinetSpec,
  sanitizeCustomCabinetTemplate,
} from '../utils/cabinetDesigner';
import { sanitizeHexColor } from '../utils/floorplanGeometry';

function sanitizeTemplateId(rawId: string): string {
  const cleaned = rawId.trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
  return cleaned || `cab_${Date.now().toString(36)}`;
}

function buildCustomCabinetPayload(
  userId: string,
  template: CustomCabinetTemplate,
  includeCreateFields: boolean
): Record<string, unknown> {
  const safeId = sanitizeTemplateId(template.id);
  const baseKind = resolveCabinetBaseKind(template.baseKind);
  const widthCm = Math.max(20, Math.min(600, Math.round(template.widthCm * 10) / 10));
  const depthCm = Math.max(15, Math.min(200, Math.round(template.depthCm * 10) / 10));
  const heightCm = Math.max(20, Math.min(350, Math.round(template.heightCm * 10) / 10));
  const elevationCm = Math.max(0, Math.min(300, Math.round(template.elevationCm * 10) / 10));
  const cleanColor = sanitizeHexColor(template.color);

  const payload: Record<string, unknown> = {
    name: (template.name.trim() || '自訂櫃體').slice(0, 60),
    baseKind,
    widthCm,
    depthCm,
    heightCm,
    elevationCm,
    defaultPlacement: template.defaultPlacement === 'free' ? 'free' : 'wall',
    cabinetSpec: sanitizeCabinetSpec(template.cabinetSpec, baseKind, widthCm),
    updatedAt: serverTimestamp(),
  };

  if (cleanColor) {
    payload.color = cleanColor;
  }

  if (includeCreateFields) {
    payload.id = safeId;
    payload.ownerId = userId;
    payload.createdAt = serverTimestamp();
  }

  return payload;
}

export function subscribeUserCustomCabinets(
  userId: string,
  onData: (templates: CustomCabinetTemplate[]) => void,
  onError: (err: Error) => void
): Unsubscribe {
  const colPath = `users/${userId}/custom_cabinets`;
  const q = query(
    collection(db, 'users', userId, 'custom_cabinets'),
    where('ownerId', '==', userId)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const list: CustomCabinetTemplate[] = [];
      snapshot.docs.forEach((docSnap) => {
        const d = docSnap.data() as Record<string, unknown>;
        const updatedMs =
          d.updatedAt instanceof Timestamp ? d.updatedAt.toMillis() : Date.now();
        const createdMs =
          d.createdAt instanceof Timestamp ? d.createdAt.toMillis() : updatedMs;
        const parsed = sanitizeCustomCabinetTemplate(
          {
            ...d,
            id: typeof d.id === 'string' && d.id ? d.id : docSnap.id,
            createdAtMs: createdMs,
            updatedAtMs: updatedMs,
          },
          docSnap.id
        );
        if (parsed) {
          list.push(parsed);
        }
      });
      list.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
      onData(list);
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

export async function upsertCloudCustomCabinet(
  userId: string,
  template: CustomCabinetTemplate,
  isNew: boolean
): Promise<void> {
  const safeId = sanitizeTemplateId(template.id);
  const docPath = `users/${userId}/custom_cabinets/${safeId}`;
  const ref = doc(db, 'users', userId, 'custom_cabinets', safeId);

  if (isNew) {
    try {
      await setDoc(ref, buildCustomCabinetPayload(userId, template, true));
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, docPath);
    }
    return;
  }

  try {
    await updateDoc(ref, buildCustomCabinetPayload(userId, template, false));
  } catch {
    // If document didn't exist yet in cloud (e.g. created offline / locally), create it cleanly
    try {
      await setDoc(ref, buildCustomCabinetPayload(userId, template, true));
    } catch (createErr) {
      handleFirestoreError(createErr, OperationType.WRITE, docPath);
    }
  }
}

export async function deleteCloudCustomCabinet(
  userId: string,
  cabinetId: string
): Promise<void> {
  const safeId = sanitizeTemplateId(cabinetId);
  const docPath = `users/${userId}/custom_cabinets/${safeId}`;
  try {
    await deleteDoc(doc(db, 'users', userId, 'custom_cabinets', safeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, docPath);
  }
}
