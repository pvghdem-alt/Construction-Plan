import type {
  CabinetBaseKind,
  CabinetDoorMode,
  CabinetSpec,
  CustomCabinetTemplate,
  ElementKind,
  FloorplanElement,
  FloorplanProject,
  SolvedFloorplan,
} from '../types/floorplan';
import {
  getDefaultLayerIdForKind,
  getEffectiveLayers,
  sanitizeHexColor,
} from './floorplanGeometry';

export const CABINET_LOCAL_STORAGE_KEY = 'floorplan_custom_cabinets_v1';

export const ALLOWED_CABINET_DOOR_MODES: ReadonlyArray<CabinetDoorMode> = [
  'none',
  'single-left',
  'single-right',
  'double',
];

export const ALLOWED_CABINET_BASE_KINDS: ReadonlyArray<CabinetBaseKind> = [
  'cabinet',
  'wall_cabinet',
  'kitchen_counter',
];

export function isCabinetElementKind(kind: ElementKind): kind is CabinetBaseKind {
  return kind === 'cabinet' || kind === 'wall_cabinet' || kind === 'kitchen_counter';
}

export function resolveCabinetBaseKind(kind: unknown): CabinetBaseKind {
  if (kind === 'wall_cabinet' || kind === 'kitchen_counter' || kind === 'cabinet') {
    return kind;
  }
  return 'cabinet';
}

export function getDefaultCabinetSpec(
  baseKind: CabinetBaseKind = 'cabinet',
  widthCm = 90
): CabinetSpec {
  if (baseKind === 'wall_cabinet') {
    return {
      drawerCount: 0,
      doorMode: widthCm >= 75 ? 'double' : 'single-left',
      shelfCount: 1,
      hasHangingRod: false,
      hasSink: false,
    };
  }
  if (baseKind === 'kitchen_counter') {
    return {
      drawerCount: 1,
      doorMode: widthCm >= 75 ? 'double' : 'single-left',
      shelfCount: 1,
      hasHangingRod: false,
      hasSink: true,
    };
  }
  return {
    drawerCount: 0,
    doorMode: widthCm >= 75 ? 'double' : 'single-left',
    shelfCount: 2,
    hasHangingRod: false,
    hasSink: false,
  };
}

export function sanitizeCabinetSpec(
  raw: unknown,
  fallbackKind: CabinetBaseKind = 'cabinet',
  widthCm = 90
): CabinetSpec {
  const base = getDefaultCabinetSpec(fallbackKind, widthCm);
  if (!raw || typeof raw !== 'object') {
    return base;
  }
  const obj = raw as Record<string, unknown>;
  const drawerRaw =
    typeof obj.drawerCount === 'number' && Number.isFinite(obj.drawerCount)
      ? Math.round(obj.drawerCount)
      : base.drawerCount;
  const shelfRaw =
    typeof obj.shelfCount === 'number' && Number.isFinite(obj.shelfCount)
      ? Math.round(obj.shelfCount)
      : base.shelfCount;
  const doorMode: CabinetDoorMode = ALLOWED_CABINET_DOOR_MODES.includes(
    obj.doorMode as CabinetDoorMode
  )
    ? (obj.doorMode as CabinetDoorMode)
    : base.doorMode;

  return {
    drawerCount: Math.max(0, Math.min(6, drawerRaw)),
    doorMode,
    shelfCount: Math.max(0, Math.min(8, shelfRaw)),
    hasHangingRod:
      typeof obj.hasHangingRod === 'boolean' ? obj.hasHangingRod : base.hasHangingRod,
    hasSink: typeof obj.hasSink === 'boolean' ? obj.hasSink : base.hasSink,
  };
}

export function resolveCabinetSpecForElement(
  element: Pick<FloorplanElement, 'kind' | 'widthCm' | 'cabinetSpec'>
): CabinetSpec {
  const baseKind = resolveCabinetBaseKind(element.kind);
  return sanitizeCabinetSpec(element.cabinetSpec, baseKind, element.widthCm);
}

export function formatCabinetDoorModeLabel(doorMode: CabinetDoorMode): string {
  switch (doorMode) {
    case 'none':
      return '無門扇(開放)';
    case 'single-left':
      return '單開(左開)';
    case 'single-right':
      return '單開(右開)';
    case 'double':
      return '雙開門';
  }
}

export function formatCabinetSpecSummary(spec: CabinetSpec): string {
  const parts: string[] = [formatCabinetDoorModeLabel(spec.doorMode)];
  if (spec.drawerCount > 0) parts.push(`${spec.drawerCount}抽屜`);
  if (spec.shelfCount > 0) parts.push(`${spec.shelfCount}隔層`);
  if (spec.hasHangingRod) parts.push('掛衣桿');
  if (spec.hasSink) parts.push('含水槽');
  return parts.join(' · ');
}

export function sanitizeCustomCabinetTemplate(
  raw: unknown,
  fallbackId = `cab-${Date.now().toString(36)}`
): CustomCabinetTemplate | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const idRaw = typeof obj.id === 'string' ? obj.id.trim() : '';
  const id = (idRaw || fallbackId).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || fallbackId;
  const baseKind = resolveCabinetBaseKind(obj.baseKind);
  const nameRaw = typeof obj.name === 'string' ? obj.name.trim() : '';
  const name = (nameRaw || '自訂櫃體').slice(0, 60);

  const finiteClamp = (val: unknown, fb: number, min: number, max: number) =>
    typeof val === 'number' && Number.isFinite(val)
      ? Math.max(min, Math.min(max, Math.round(val * 10) / 10))
      : fb;

  const widthCm = finiteClamp(
    obj.widthCm,
    baseKind === 'kitchen_counter' ? 180 : 90,
    20,
    600
  );
  const depthCm = finiteClamp(
    obj.depthCm,
    baseKind === 'wall_cabinet' ? 35 : 60,
    15,
    200
  );
  const heightCm = finiteClamp(
    obj.heightCm,
    baseKind === 'wall_cabinet' ? 70 : baseKind === 'kitchen_counter' ? 85 : 210,
    20,
    350
  );
  const elevationCm = finiteClamp(
    obj.elevationCm,
    baseKind === 'wall_cabinet' ? 145 : 0,
    0,
    300
  );
  const defaultPlacement = obj.defaultPlacement === 'free' ? 'free' : 'wall';
  const cleanColor = sanitizeHexColor(obj.color);
  const cabinetSpec = sanitizeCabinetSpec(obj.cabinetSpec, baseKind, widthCm);
  const now = Date.now();
  const createdAtMs =
    typeof obj.createdAtMs === 'number' && Number.isFinite(obj.createdAtMs)
      ? obj.createdAtMs
      : now;
  const updatedAtMs =
    typeof obj.updatedAtMs === 'number' && Number.isFinite(obj.updatedAtMs)
      ? obj.updatedAtMs
      : createdAtMs;

  return {
    id,
    name,
    baseKind,
    widthCm,
    depthCm,
    heightCm,
    elevationCm,
    defaultPlacement,
    ...(cleanColor ? { color: cleanColor } : {}),
    cabinetSpec,
    createdAtMs,
    updatedAtMs,
  };
}

export interface CabinetDrawerLayoutItem {
  index: number;
  yCenterM: number;
  heightM: number;
  boxDepthM: number;
  openSlideZM: number;
}

export interface CabinetDoorLeafLayoutItem {
  partId: 'door-left' | 'door-right';
  label: string;
  hingeXM: number;
  leafCenterOffsetXM: number;
  leafWidthM: number;
  leafHeightM: number;
  centerYM: number;
  handleOffsetXM: number;
  closedAngleRad: number;
  openAngleRad: number;
}

export interface CabinetCompartmentLayout {
  wM: number;
  dM: number;
  hM: number;
  panelTM: number;
  plinthHM: number;
  topTrimHM: number;
  cavBottomYM: number;
  cavTopYM: number;
  cavHeightM: number;
  interiorWM: number;
  interiorDM: number;
  sinkRecessHM: number;
  drawers: CabinetDrawerLayoutItem[];
  upperBottomYM: number;
  upperTopYM: number;
  upperHeightM: number;
  doors: CabinetDoorLeafLayoutItem[];
  shelfYMs: number[];
  hangingRodYM: number | null;
}

const CM_TO_M = 0.01;

/**
 * Pure deterministic layout math (meters) for cabinet carcass, bottom drawers,
 * hinged left/right/double doors, interior shelves, clothes hanging rod, and sink clearance.
 */
export function computeCabinetCompartmentLayout(params: {
  widthCm: number;
  depthCm: number;
  heightCm: number;
  baseKind: CabinetBaseKind;
  spec: CabinetSpec;
}): CabinetCompartmentLayout {
  const wM = Math.max(0.2, params.widthCm * CM_TO_M);
  const dM = Math.max(0.15, params.depthCm * CM_TO_M);
  const hM = Math.max(0.2, params.heightCm * CM_TO_M);
  const spec = sanitizeCabinetSpec(params.spec, params.baseKind, params.widthCm);

  const panelTM = Math.min(0.022, wM * 0.06, dM * 0.08);
  const plinthHM =
    params.baseKind === 'wall_cabinet' ? 0 : Math.min(0.085, hM * 0.11);
  const topTrimHM =
    spec.hasSink || params.baseKind === 'kitchen_counter'
      ? Math.min(0.036, hM * 0.08)
      : Math.min(0.024, hM * 0.06);

  const cavBottomYM = plinthHM + panelTM;
  const cavTopYM = Math.max(cavBottomYM + 0.08, hM - topTrimHM);
  const cavHeightM = Math.max(0.08, cavTopYM - cavBottomYM);

  const interiorWM = Math.max(0.08, wM - panelTM * 2);
  const interiorDM = Math.max(0.08, dM - panelTM * 2.2);

  const sinkRecessHM = spec.hasSink ? Math.min(0.16, cavHeightM * 0.34) : 0;

  // 1. Drawer stack (bottom compartment)
  const drawers: CabinetDrawerLayoutItem[] = [];
  let drawerZoneHM = 0;

  if (spec.drawerCount > 0) {
    const hasUpperFeatures =
      spec.doorMode !== 'none' || spec.shelfCount > 0 || spec.hasHangingRod;
    const maxDrawerRatio = hasUpperFeatures ? 0.56 : 0.94;
    const idealPerDrawer = Math.min(0.22, Math.max(0.11, cavHeightM * 0.16));
    const maxAllowedTotal = Math.max(0.1, (cavHeightM - sinkRecessHM * 0.4) * maxDrawerRatio);
    drawerZoneHM = Math.min(maxAllowedTotal, idealPerDrawer * spec.drawerCount);
    const gapM = 0.008;
    const perDrawerH = Math.max(
      0.045,
      (drawerZoneHM - gapM * (spec.drawerCount + 1)) / spec.drawerCount
    );
    const boxDepthM = Math.max(0.08, interiorDM - 0.02);
    const openSlideZM = Math.max(0.07, Math.min(dM * 0.62, 0.38));

    for (let i = 0; i < spec.drawerCount; i++) {
      const yCenterM =
        cavBottomYM + gapM + perDrawerH * 0.5 + i * (perDrawerH + gapM);
      drawers.push({
        index: i,
        yCenterM,
        heightM: perDrawerH,
        boxDepthM,
        openSlideZM,
      });
    }
  }

  // 2. Upper compartment (above drawers)
  const upperBottomYM = cavBottomYM + drawerZoneHM;
  const upperTopYM = cavTopYM;
  const upperHeightM = Math.max(0, upperTopYM - upperBottomYM);

  // 3. Hinged Doors across upper compartment (front faces +Z)
  const doors: CabinetDoorLeafLayoutItem[] = [];
  if (spec.doorMode !== 'none' && upperHeightM >= 0.09) {
    const doorGap = 0.01;
    const doorH = Math.max(0.07, upperHeightM - 0.014);
    const centerYM = upperBottomYM + upperHeightM * 0.5;
    const swingAngleRad = 1.78; // ~102 deg outward toward +Z

    if (spec.doorMode === 'single-left' || spec.doorMode === 'single-right') {
      const leafW = Math.max(0.1, wM - doorGap * 2);
      if (spec.doorMode === 'single-left') {
        // Left-hinged: hinge on -X, panel extends +X, negative rotation swings outward (+Z) to the left
        doors.push({
          partId: 'door-left',
          label: '左開門',
          hingeXM: -wM * 0.5 + doorGap,
          leafCenterOffsetXM: leafW * 0.5,
          leafWidthM: leafW,
          leafHeightM: doorH,
          centerYM,
          handleOffsetXM: leafW * 0.36,
          closedAngleRad: 0,
          openAngleRad: -swingAngleRad,
        });
      } else {
        // Right-hinged: hinge on +X, panel extends -X, positive rotation swings outward (+Z) to the right
        doors.push({
          partId: 'door-right',
          label: '右開門',
          hingeXM: wM * 0.5 - doorGap,
          leafCenterOffsetXM: -leafW * 0.5,
          leafWidthM: leafW,
          leafHeightM: doorH,
          centerYM,
          handleOffsetXM: -leafW * 0.36,
          closedAngleRad: 0,
          openAngleRad: swingAngleRad,
        });
      }
    } else if (spec.doorMode === 'double') {
      const leafW = Math.max(0.07, (wM - doorGap * 3) * 0.5);
      doors.push({
        partId: 'door-left',
        label: '左門片',
        hingeXM: -wM * 0.5 + doorGap,
        leafCenterOffsetXM: leafW * 0.5,
        leafWidthM: leafW,
        leafHeightM: doorH,
        centerYM,
        handleOffsetXM: leafW * 0.36,
        closedAngleRad: 0,
        openAngleRad: -swingAngleRad,
      });
      doors.push({
        partId: 'door-right',
        label: '右門片',
        hingeXM: wM * 0.5 - doorGap,
        leafCenterOffsetXM: -leafW * 0.5,
        leafWidthM: leafW,
        leafHeightM: doorH,
        centerYM,
        handleOffsetXM: -leafW * 0.36,
        closedAngleRad: 0,
        openAngleRad: swingAngleRad,
      });
    }
  }

  // 4. Hanging rod near top of upper compartment
  const rodClearTopYM = upperTopYM - sinkRecessHM;
  let hangingRodYM: number | null = null;
  if (spec.hasHangingRod && rodClearTopYM - upperBottomYM >= 0.32) {
    hangingRodYM = rodClearTopYM - 0.085;
  }

  // 5. Interior shelves inside usable upper compartment
  const shelfYMs: number[] = [];
  const shelfTopLimitYM =
    hangingRodYM !== null ? Math.min(rodClearTopYM, hangingRodYM - 0.16) : rodClearTopYM;
  const shelfSpanHM = shelfTopLimitYM - upperBottomYM;
  if (spec.shelfCount > 0 && shelfSpanHM >= 0.12) {
    for (let s = 1; s <= spec.shelfCount; s++) {
      const y = upperBottomYM + (shelfSpanHM * s) / (spec.shelfCount + 1);
      shelfYMs.push(y);
    }
  }

  return {
    wM,
    dM,
    hM,
    panelTM,
    plinthHM,
    topTrimHM,
    cavBottomYM,
    cavTopYM,
    cavHeightM,
    interiorWM,
    interiorDM,
    sinkRecessHM,
    drawers,
    upperBottomYM,
    upperTopYM,
    upperHeightM,
    doors,
    shelfYMs,
    hangingRodYM,
  };
}

export function createElementFromCabinetTemplate(
  template: CustomCabinetTemplate,
  project: FloorplanProject,
  solved: SolvedFloorplan,
  options: {
    selectedEdgeId?: string | null;
    layerFilter?: string;
    instanceSeq?: number;
  } = {}
): FloorplanElement | null {
  const targetEdgeId =
    options.selectedEdgeId ||
    project.edges[0]?.id ||
    project.interiorWalls?.[0]?.id ||
    '';
  if (!targetEdgeId && template.defaultPlacement === 'wall') {
    return null;
  }

  const baseLayers = getEffectiveLayers(project.layers);
  const assignedLayerId =
    options.layerFilter &&
    options.layerFilter !== 'all' &&
    baseLayers.some((l) => l.id === options.layerFilter)
      ? options.layerFilter
      : getDefaultLayerIdForKind(template.baseKind, baseLayers);

  const countSameTemplate = project.elements.filter(
    (e) => e.customCabinetId === template.id
  ).length;
  const seq = options.instanceSeq ?? countSameTemplate;
  const freeCount = project.elements.filter((e) => e.placement === 'free').length;
  const staggerX = ((freeCount % 3) - 1) * 65;
  const staggerY = ((Math.floor(freeCount / 3) % 3) - 1) * 65;

  const newId = `el-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const cleanColor = sanitizeHexColor(template.color);

  return {
    id: newId,
    kind: template.baseKind,
    name: template.name,
    placement: template.defaultPlacement,
    edgeId: targetEdgeId,
    offsetCm: Math.min(180, 20 + seq * 25),
    xCm: Math.round(solved.bounds.centerX) + staggerX,
    yCm: Math.round(solved.bounds.centerY) + staggerY,
    rotationDeg: 0,
    widthCm: template.widthCm,
    depthCm: template.depthCm,
    heightCm: template.heightCm,
    elevationCm: template.elevationCm,
    side: 'inside',
    layerId: assignedLayerId,
    ...(cleanColor ? { color: cleanColor } : {}),
    cabinetSpec: sanitizeCabinetSpec(
      template.cabinetSpec,
      template.baseKind,
      template.widthCm
    ),
    customCabinetId: template.id,
  };
}

export function buildStarterCabinetPresets(): CustomCabinetTemplate[] {
  const now = 1700000000000;
  return [
    {
      id: 'preset-wardrobe-rod',
      name: '雙開掛衣收納櫃',
      baseKind: 'cabinet',
      widthCm: 100,
      depthCm: 60,
      heightCm: 210,
      elevationCm: 0,
      defaultPlacement: 'wall',
      color: '#d9b382',
      cabinetSpec: {
        drawerCount: 2,
        doorMode: 'double',
        shelfCount: 1,
        hasHangingRod: true,
        hasSink: false,
      },
      createdAtMs: now,
      updatedAtMs: now,
    },
    {
      id: 'preset-vanity-sink',
      name: '浴櫃洗手台（雙抽+水槽）',
      baseKind: 'cabinet',
      widthCm: 90,
      depthCm: 52,
      heightCm: 82,
      elevationCm: 0,
      defaultPlacement: 'wall',
      color: '#f8fafc',
      cabinetSpec: {
        drawerCount: 2,
        doorMode: 'double',
        shelfCount: 1,
        hasHangingRod: false,
        hasSink: true,
      },
      createdAtMs: now,
      updatedAtMs: now,
    },
    {
      id: 'preset-chest-drawers',
      name: '四抽矮櫃（無門扇）',
      baseKind: 'cabinet',
      widthCm: 80,
      depthCm: 48,
      heightCm: 95,
      elevationCm: 0,
      defaultPlacement: 'wall',
      color: '#f3e8d2',
      cabinetSpec: {
        drawerCount: 4,
        doorMode: 'none',
        shelfCount: 0,
        hasHangingRod: false,
        hasSink: false,
      },
      createdAtMs: now,
      updatedAtMs: now,
    },
    {
      id: 'preset-single-right-tall',
      name: '單門右開儲物高櫃',
      baseKind: 'cabinet',
      widthCm: 55,
      depthCm: 58,
      heightCm: 210,
      elevationCm: 0,
      defaultPlacement: 'wall',
      color: '#d9b382',
      cabinetSpec: {
        drawerCount: 1,
        doorMode: 'single-right',
        shelfCount: 4,
        hasHangingRod: false,
        hasSink: false,
      },
      createdAtMs: now,
      updatedAtMs: now,
    },
  ];
}

export function loadLocalCustomCabinets(): CustomCabinetTemplate[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(CABINET_LOCAL_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const list: CustomCabinetTemplate[] = [];
    parsed.forEach((item, idx) => {
      const sanitized = sanitizeCustomCabinetTemplate(item, `cab-local-${idx + 1}`);
      if (sanitized) list.push(sanitized);
    });
    return list;
  } catch {
    return [];
  }
}

export function saveLocalCustomCabinets(templates: ReadonlyArray<CustomCabinetTemplate>): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    const clean = templates
      .slice(0, 60)
      .map((t, idx) => sanitizeCustomCabinetTemplate(t, `cab-${idx + 1}`))
      .filter((t): t is CustomCabinetTemplate => Boolean(t));
    window.localStorage.setItem(CABINET_LOCAL_STORAGE_KEY, JSON.stringify(clean));
  } catch {
    // Ignore storage quota / private mode failures
  }
}

export function mergeCustomCabinetLibraries(
  localList: ReadonlyArray<CustomCabinetTemplate>,
  cloudList: ReadonlyArray<CustomCabinetTemplate>
): CustomCabinetTemplate[] {
  const byId = new Map<string, CustomCabinetTemplate>();
  for (const item of localList) {
    byId.set(item.id, item);
  }
  for (const item of cloudList) {
    const prev = byId.get(item.id);
    if (!prev || item.updatedAtMs >= prev.updatedAtMs) {
      byId.set(item.id, item);
    }
  }
  return Array.from(byId.values()).sort((a, b) => b.updatedAtMs - a.updatedAtMs);
}
