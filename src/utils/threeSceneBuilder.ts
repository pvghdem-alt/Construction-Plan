import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type {
  FloorplanProject,
  SolvedElementPlacement,
  SolvedFloorplan,
  SolvedWallSegment,
} from '../types/floorplan';
import {
  darkenHexColor,
  DEFAULT_FLOOR_COLOR,
  DEFAULT_WALL_COLOR,
  formatDimension,
  parseDoorSwing,
  sanitizeHexColor,
} from './floorplanGeometry';
import {
  computeCeilingRulerPosition,
  computeOpeningBadgePosition,
  computeWallDimensionLayout,
} from './threeDimensionLayout';
import {
  applyCabinetPartProgress,
  buildInteractiveCabinetMesh,
  type CabinetInteractivePartHandle,
} from './cabinet3DBuilder';
import { resolveCabinetSpecForElement } from './cabinetDesigner';

export { applyCabinetPartProgress, type CabinetInteractivePartHandle };

export const CM_TO_M = 0.01;

export function detectSoftwareGl(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

export function createWoodFloorTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);

  const plankRows = 8;
  const plankH = size / plankRows;
  for (let r = 0; r < plankRows; r++) {
    const y = r * plankH;
    const tint = (r % 3) * 5 - 5;
    ctx.fillStyle = `rgb(${245 + tint}, ${244 + tint}, ${242 + tint})`;
    ctx.fillRect(0, y, size, plankH - 1);

    ctx.strokeStyle = 'rgba(90, 90, 90, 0.12)';
    ctx.lineWidth = 1;
    for (let g = 0; g < 6; g++) {
      const gy = y + 6 + g * ((plankH - 12) / 6);
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(size, gy + ((g % 2) * 2 - 1) * 1.5);
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(70, 70, 70, 0.22)';
    ctx.fillRect(0, y + plankH - 1.5, size, 1.5);

    const seamX = ((r * 173 + 64) % (size - 40)) + 20;
    ctx.fillRect(seamX, y, 1.5, plankH);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 2);
  texture.anisotropy = maxAnisotropy;
  return texture;
}

export function disposeGroupContents(
  group: THREE.Group,
  preservedTexture?: THREE.Texture | null
) {
  const disposedGeos = new Set<THREE.BufferGeometry>();
  const disposedMats = new Set<THREE.Material>();
  const disposedTex = new Set<THREE.Texture>();

  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh | THREE.LineSegments | THREE.Line | THREE.Sprite;
    if ('geometry' in mesh && mesh.geometry && !disposedGeos.has(mesh.geometry)) {
      disposedGeos.add(mesh.geometry);
      mesh.geometry.dispose();
    }
    const mat = mesh.material;
    const handleMat = (m: THREE.Material) => {
      const spriteOrStd = m as THREE.SpriteMaterial & THREE.MeshStandardMaterial;
      if (
        spriteOrStd.map &&
        spriteOrStd.map !== preservedTexture &&
        !disposedTex.has(spriteOrStd.map)
      ) {
        disposedTex.add(spriteOrStd.map);
        spriteOrStd.map.dispose();
      }
      if (!disposedMats.has(m)) {
        disposedMats.add(m);
        m.dispose();
      }
    };
    if (Array.isArray(mat)) {
      mat.forEach(handleMat);
    } else if (mat) {
      handleMat(mat);
    }
  });
  group.clear();
}

function createDimensionBadgeSprite(
  text: string,
  options: {
    bg?: string;
    border?: string;
    color?: string;
    heightMeters?: number;
    depthTest?: boolean;
  } = {}
): THREE.Sprite {
  const bg = options.bg ?? 'rgba(255, 255, 255, 0.94)';
  const border = options.border ?? '#94a3b8';
  const color = options.color ?? '#0f172a';
  const heightM = options.heightMeters ?? 0.34;
  const depthTest = options.depthTest ?? true;

  const fontPx = 30;
  const padX = 20;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = `700 ${fontPx}px "Noto Sans TC", ui-monospace, SFMono-Regular, Menlo, monospace`;
  const textW = Math.ceil(ctx.measureText(text).width);

  canvas.width = Math.max(128, textW + padX * 2);
  canvas.height = 54;

  const ctx2 = canvas.getContext('2d')!;
  ctx2.font = `700 ${fontPx}px "Noto Sans TC", ui-monospace, SFMono-Regular, Menlo, monospace`;
  ctx2.textAlign = 'center';
  ctx2.textBaseline = 'middle';

  const r = 10;
  const w = canvas.width - 4;
  const h = canvas.height - 4;
  ctx2.beginPath();
  ctx2.roundRect(2, 2, w, h, r);
  ctx2.fillStyle = bg;
  ctx2.fill();
  ctx2.lineWidth = 3;
  ctx2.strokeStyle = border;
  ctx2.stroke();

  ctx2.fillStyle = color;
  ctx2.fillText(text, canvas.width / 2, canvas.height / 2 + 1);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    alphaTest: 0.08,
    depthTest,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.renderOrder = depthTest ? 10 : 30;
  const aspect = canvas.width / canvas.height;
  sprite.scale.set(heightM * aspect, heightM, 1);
  return sprite;
}

export interface DoorSceneHandle {
  elementId: string;
  mode: 'swing' | 'sliding';
  pivot?: THREE.Group;
  closedAngleRad?: number;
  openAngleRad?: number;
  slidingPanel?: THREE.Mesh;
  pullHandle?: THREE.Mesh;
  hangers?: Array<{ mesh: THREE.Mesh; offsetX: number }>;
  closedPanelX?: number;
  openPanelX?: number;
  handleOffsetX?: number;
  currentProgress: number;
}

export interface CurtainSceneHandle {
  elementId: string;
  leftGroup: THREE.Group;
  frontGroup: THREE.Group;
  currentProgress: number;
}

export interface RoomSceneHandles {
  doors: DoorSceneHandle[];
  curtains: CurtainSceneHandle[];
  cabinetParts: CabinetInteractivePartHandle[];
  interactableMeshes: THREE.Object3D[];
  ceilingMesh?: THREE.Mesh;
  activeDynamicLightCount: number;
  hasAnyLightFixture: boolean;
}

export function applyRoomCeilingVisibility(
  handles: RoomSceneHandles,
  showCeiling: boolean,
  solidCeiling: boolean,
  isSoftwareGl: boolean,
  enableLightingRender: boolean
): void {
  const ceilMesh = handles.ceilingMesh;
  if (!ceilMesh) return;
  if (!showCeiling && !solidCeiling) {
    ceilMesh.visible = false;
    return;
  }
  ceilMesh.visible = true;
  ceilMesh.receiveShadow = !isSoftwareGl && enableLightingRender;
  ceilMesh.renderOrder = solidCeiling ? 0 : 3;
  const mat = ceilMesh.material as THREE.MeshStandardMaterial;
  mat.color.setHex(solidCeiling ? 0xf8fafc : 0xf1f5f9);
  const nextTransparent = !solidCeiling;
  if (mat.transparent !== nextTransparent) {
    mat.transparent = nextTransparent;
    mat.needsUpdate = true;
  }
  mat.opacity = solidCeiling ? 1.0 : 0.34;
  mat.depthWrite = solidCeiling;
}

export function applyDoorOpenProgress(handle: DoorSceneHandle, progress: number): void {
  const p = Math.max(0, Math.min(1, progress));
  handle.currentProgress = p;
  if (handle.mode === 'swing' && handle.pivot) {
    handle.pivot.rotation.y = THREE.MathUtils.lerp(
      handle.closedAngleRad ?? 0,
      handle.openAngleRad ?? 0,
      p
    );
  } else if (handle.mode === 'sliding' && handle.slidingPanel) {
    const panelX = THREE.MathUtils.lerp(handle.closedPanelX ?? 0, handle.openPanelX ?? 0, p);
    handle.slidingPanel.position.x = panelX;
    if (handle.pullHandle && handle.handleOffsetX !== undefined) {
      handle.pullHandle.position.x = panelX + handle.handleOffsetX;
    }
    if (handle.hangers) {
      for (const h of handle.hangers) {
        h.mesh.position.x = panelX + h.offsetX;
      }
    }
  }
}

export function applyCurtainOpenProgress(handle: CurtainSceneHandle, progress: number): void {
  const p = Math.max(0, Math.min(1, progress));
  handle.currentProgress = p;
  const scaleSpan = THREE.MathUtils.lerp(1.0, 0.14, p);
  handle.leftGroup.scale.z = scaleSpan;
  handle.frontGroup.scale.x = scaleSpan;
}

export interface BuildRoomSceneOptions {
  project: FloorplanProject;
  solved: SolvedFloorplan;
  placements: SolvedElementPlacement[];
  selectedEdgeId: string | null;
  selectedElementId: string | null;
  wallTransparent: boolean;
  showCeiling: boolean;
  solidCeiling?: boolean;
  showWireframe: boolean;
  showDimensions: boolean;
  enableLightingRender?: boolean;
  openElementIds?: Record<string, boolean>;
  openCabinetParts?: Record<string, boolean>;
  isSoftwareGl: boolean;
  floorTexture: THREE.Texture | null;
}

export function buildRoomSceneGroup(
  roomGroup: THREE.Group,
  options: BuildRoomSceneOptions
): RoomSceneHandles {
  const {
    project,
    solved,
    placements,
    selectedEdgeId,
    selectedElementId,
    wallTransparent,
    showCeiling,
    solidCeiling = false,
    showWireframe,
    showDimensions,
    enableLightingRender = true,
    openElementIds = {},
    openCabinetParts = {},
    isSoftwareGl,
    floorTexture,
  } = options;

  disposeGroupContents(roomGroup, floorTexture);

  const handles: RoomSceneHandles = {
    doors: [],
    curtains: [],
    cabinetParts: [],
    interactableMeshes: [],
    activeDynamicLightCount: 0,
    hasAnyLightFixture: false,
  };

  const ceilingM = Math.max(1.2, project.ceilingHeightCm * CM_TO_M);
  const wallThickM = Math.max(0.06, project.wallThicknessCm * CM_TO_M);

  const resolvedWallColor = sanitizeHexColor(project.wallColor) || DEFAULT_WALL_COLOR;
  const resolvedFloorColor = sanitizeHexColor(project.floorColor) || DEFAULT_FLOOR_COLOR;

  const wallMat = new THREE.MeshStandardMaterial({
    color: resolvedWallColor,
    roughness: 0.86,
    metalness: 0.02,
    transparent: wallTransparent,
    opacity: wallTransparent ? 0.42 : 1.0,
    depthWrite: !wallTransparent,
  });
  const selectedWallMat = new THREE.MeshStandardMaterial({
    color: 0xdbeafe,
    roughness: 0.72,
    metalness: 0.04,
    transparent: wallTransparent,
    opacity: wallTransparent ? 0.65 : 1.0,
    depthWrite: !wallTransparent,
  });
  const wallEdgeLineMat = new THREE.LineBasicMaterial({
    color: 0x94a3b8,
    transparent: true,
    opacity: wallTransparent ? 0.45 : 0.75,
    depthWrite: !wallTransparent,
  });

  // 1. Floor Slab
  if (solved.polygonPoints.length >= 3) {
    const shape = new THREE.Shape();
    solved.polygonPoints.forEach((pt, idx) => {
      const sx = pt.x * CM_TO_M;
      const sy = -pt.y * CM_TO_M;
      if (idx === 0) shape.moveTo(sx, sy);
      else shape.lineTo(sx, sy);
    });
    shape.closePath();

    const floorGeo = new THREE.ShapeGeometry(shape);
    const posAttr = floorGeo.attributes.position;
    const uvArr = new Float32Array(posAttr.count * 2);
    for (let i = 0; i < posAttr.count; i++) {
      uvArr[i * 2] = posAttr.getX(i) * 0.45;
      uvArr[i * 2 + 1] = posAttr.getY(i) * 0.45;
    }
    floorGeo.setAttribute('uv', new THREE.BufferAttribute(uvArr, 2));

    const floorMat = new THREE.MeshStandardMaterial({
      map: floorTexture,
      color: resolvedFloorColor,
      roughness: 0.68,
      metalness: 0.03,
      side: THREE.DoubleSide,
    });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.y = 0.0;
    floorMesh.receiveShadow = !isSoftwareGl;
    roomGroup.add(floorMesh);

    const ceilGeo = new THREE.ShapeGeometry(shape);
    const ceilMat = new THREE.MeshStandardMaterial({
      color: solidCeiling ? 0xf8fafc : 0xf1f5f9,
      roughness: 0.9,
      metalness: 0.0,
      transparent: !solidCeiling,
      opacity: solidCeiling ? 1.0 : 0.34,
      side: THREE.DoubleSide,
      depthWrite: solidCeiling,
    });
    const ceilMesh = new THREE.Mesh(ceilGeo, ceilMat);
    ceilMesh.rotation.x = -Math.PI / 2;
    ceilMesh.position.y = ceilingM + 0.004;
    roomGroup.add(ceilMesh);
    handles.ceilingMesh = ceilMesh;
    applyRoomCeilingVisibility(
      handles,
      showCeiling,
      solidCeiling,
      isSoftwareGl,
      enableLightingRender
    );
  }

  // Group openings per wall segment
  const openingsByEdge = new Map<
    string,
    Array<{ startM: number; endM: number; elevM: number; topM: number }>
  >();
  for (const pl of placements) {
    if ((pl.element.kind === 'door' || pl.element.kind === 'window') && pl.edge) {
      const startM = pl.clampedOffsetCm * CM_TO_M;
      const endM = (pl.clampedOffsetCm + pl.clampedWidthCm) * CM_TO_M;
      const elevM = Math.max(0, pl.element.elevationCm * CM_TO_M);
      const topM = Math.min(ceilingM, (pl.element.elevationCm + pl.element.heightCm) * CM_TO_M);
      const list = openingsByEdge.get(pl.edge.id) || [];
      list.push({ startM, endM, elevM, topM });
      openingsByEdge.set(pl.edge.id, list);
    }
  }

  const addWallSegmentBox = (
    se: SolvedWallSegment,
    segStartM: number,
    segEndM: number,
    yBottomM: number,
    yTopM: number,
    isSelected: boolean
  ) => {
    const lenM = segEndM - segStartM;
    const hM = yTopM - yBottomM;
    if (lenM <= 0.01 || hM <= 0.01) return;

    const geo = new THREE.BoxGeometry(lenM, hM, wallThickM);
    const mesh = new THREE.Mesh(geo, isSelected ? selectedWallMat : wallMat);

    const midDistM = (segStartM + segEndM) * 0.5;
    const normalShiftM = se.isInterior ? 0 : wallThickM * 0.5;
    const cx =
      se.start.x * CM_TO_M +
      se.tangent.x * midDistM +
      se.outwardNormal.x * normalShiftM;
    const cz =
      se.start.y * CM_TO_M +
      se.tangent.y * midDistM +
      se.outwardNormal.y * normalShiftM;

    mesh.position.set(cx, yBottomM + hM * 0.5, cz);
    mesh.rotation.y = -Math.atan2(se.tangent.y, se.tangent.x);
    mesh.castShadow = !isSoftwareGl && !wallTransparent;
    mesh.receiveShadow = !isSoftwareGl;
    if (wallTransparent) mesh.renderOrder = 2;
    roomGroup.add(mesh);

    if (showWireframe) {
      const edgesGeo = new THREE.EdgesGeometry(geo, 20);
      const line = new THREE.LineSegments(edgesGeo, wallEdgeLineMat);
      line.position.copy(mesh.position);
      line.rotation.copy(mesh.rotation);
      if (wallTransparent) line.renderOrder = 2;
      roomGroup.add(line);
    }
  };

  // 2. Extrude Outer & Interior Partition Walls
  for (const se of [...solved.solvedEdges, ...solved.solvedInteriorWalls]) {
    if (!se.hasWall) continue;
    const wallLenM = se.lengthCm * CM_TO_M;
    const isSelected = selectedEdgeId === se.id;
    const openings = (openingsByEdge.get(se.id) || []).sort(
      (a, b) => a.startM - b.startM
    );

    let cursor = 0;
    for (const op of openings) {
      if (op.startM > cursor + 0.01) {
        addWallSegmentBox(se, cursor, op.startM, 0, ceilingM, isSelected);
      }
      if (op.elevM > 0.02) {
        addWallSegmentBox(se, op.startM, op.endM, 0, op.elevM, isSelected);
      }
      if (op.topM < ceilingM - 0.02) {
        addWallSegmentBox(se, op.startM, op.endM, op.topM, ceilingM, isSelected);
      }
      cursor = Math.max(cursor, op.endM);
    }
    if (cursor < wallLenM - 0.01) {
      addWallSegmentBox(se, cursor, wallLenM, 0, ceilingM, isSelected);
    }
  }

  // 3. Composite Multi-Part 3D Elements
  const frameWoodMat = new THREE.MeshStandardMaterial({
    color: 0x5c3a21,
    roughness: 0.45,
    metalness: 0.05,
  });
  const doorLeafMat = new THREE.MeshStandardMaterial({
    color: 0xc2854c,
    roughness: 0.52,
    metalness: 0.04,
  });
  const metalMat = new THREE.MeshStandardMaterial({
    color: 0xd1d5db,
    roughness: 0.22,
    metalness: 0.88,
  });
  const windowAlumMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.35,
    metalness: 0.55,
  });
  const windowGlassMat = new THREE.MeshPhysicalMaterial({
    color: 0xbae6fd,
    roughness: 0.08,
    metalness: 0.0,
    transmission: isSoftwareGl ? 0 : 0.65,
    transparent: true,
    opacity: isSoftwareGl ? 0.4 : 0.5,
    ior: 1.5,
    depthWrite: false,
  });
  const cabPlinthMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.72,
    metalness: 0.05,
  });
  const cabBodyMat = new THREE.MeshStandardMaterial({
    color: 0xf4efe6,
    roughness: 0.62,
    metalness: 0.02,
  });
  const cabDoorMat = new THREE.MeshStandardMaterial({
    color: 0xe6decb,
    roughness: 0.42,
    metalness: 0.03,
  });
  const tableTopMat = new THREE.MeshStandardMaterial({
    color: 0xd9b382,
    roughness: 0.45,
    metalness: 0.04,
  });
  const darkLegMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.48,
    metalness: 0.55,
  });
  const chairFabricMat = new THREE.MeshStandardMaterial({
    color: 0x475569,
    roughness: 0.78,
    metalness: 0.02,
  });
  const bedFrameMat = new THREE.MeshStandardMaterial({
    color: 0x0f766e,
    roughness: 0.48,
    metalness: 0.12,
  });
  const mattressMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    roughness: 0.85,
    metalness: 0.0,
  });
  const blanketMat = new THREE.MeshStandardMaterial({
    color: 0xbae6fd,
    roughness: 0.82,
    metalness: 0.0,
  });
  const ceramicMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.16,
    metalness: 0.04,
  });
  const waterAccentMat = new THREE.MeshStandardMaterial({
    color: 0x7dd3fc,
    roughness: 0.15,
    metalness: 0.05,
    transparent: true,
    opacity: 0.65,
  });
  const curtainFabricMat = new THREE.MeshStandardMaterial({
    color: 0xa7f3d0,
    roughness: 0.85,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });
  const curtainMeshTopMat = new THREE.MeshStandardMaterial({
    color: 0xecfdf5,
    roughness: 0.78,
    metalness: 0.0,
    transparent: true,
    opacity: 0.74,
    side: THREE.DoubleSide,
  });
  const sofaFabricMat = new THREE.MeshStandardMaterial({
    color: 0x64748b,
    roughness: 0.88,
    metalness: 0.02,
  });
  const sofaCushionTrimMat = new THREE.MeshStandardMaterial({
    color: 0x475569,
    roughness: 0.82,
    metalness: 0.03,
  });
  const countertopStoneMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    roughness: 0.25,
    metalness: 0.04,
  });
  const cooktopGlassMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.14,
    metalness: 0.2,
  });
  const selectedAccentMat = new THREE.MeshStandardMaterial({
    color: 0x3b82f6,
    roughness: 0.4,
    metalness: 0.1,
  });
  const selectionEdgeMat = new THREE.LineBasicMaterial({
    color: 0x2563eb,
  });

  for (const pl of placements) {
    const { element, edge: se } = pl;
    const isSelected = selectedElementId === element.id;
    const customHex = sanitizeHexColor(element.color);
    const useSelectTint = isSelected && !customHex;
    const customMat = customHex
      ? new THREE.MeshStandardMaterial({
          color: customHex,
          roughness:
            element.kind === 'toilet' || element.kind === 'urinal' || element.kind === 'sink'
              ? 0.22
              : element.kind === 'sofa' || element.kind === 'chair' || element.kind === 'bed_curtain'
                ? 0.82
                : 0.52,
          metalness: element.kind === 'shower' ? 0.65 : 0.04,
          ...(element.kind === 'bed_curtain' ? { side: THREE.DoubleSide } : {}),
        })
      : null;
    const customDarkMat = customHex
      ? new THREE.MeshStandardMaterial({
          color: darkenHexColor(customHex, 0.72),
          roughness: 0.56,
          metalness: 0.05,
        })
      : null;
    const wM = pl.clampedWidthCm * CM_TO_M;
    const dM = Math.max(0.02, element.depthCm * CM_TO_M);
    const hM = Math.min(ceilingM, Math.max(0.04, element.heightCm * CM_TO_M));
    const elevM = Math.max(0, element.elevationCm * CM_TO_M);

    if (element.kind === 'door') {
      if (!se) continue;
      const wallYaw = -Math.atan2(se.tangent.y, se.tangent.x);
      const doorGroup = new THREE.Group();
      const normalShiftM = se.isInterior ? 0 : wallThickM * 0.5;
      const cx = pl.center.x * CM_TO_M + se.outwardNormal.x * normalShiftM;
      const cz = pl.center.y * CM_TO_M + se.outwardNormal.y * normalShiftM;
      doorGroup.position.set(cx, elevM, cz);
      doorGroup.rotation.y = wallYaw;

      const jambT = 0.045;
      const jambDepth = wallThickM + 0.02;
      const activeFrameMat = useSelectTint ? selectedAccentMat : customDarkMat ?? frameWoodMat;

      const leftJamb = new THREE.Mesh(
        new THREE.BoxGeometry(jambT, hM, jambDepth),
        activeFrameMat
      );
      leftJamb.position.set(-wM * 0.5 + jambT * 0.5, hM * 0.5, 0);
      doorGroup.add(leftJamb);

      const rightJamb = new THREE.Mesh(
        new THREE.BoxGeometry(jambT, hM, jambDepth),
        activeFrameMat
      );
      rightJamb.position.set(wM * 0.5 - jambT * 0.5, hM * 0.5, 0);
      doorGroup.add(rightJamb);

      const header = new THREE.Mesh(
        new THREE.BoxGeometry(wM, jambT, jambDepth),
        activeFrameMat
      );
      header.position.set(0, hM - jambT * 0.5, 0);
      doorGroup.add(header);

      const threshold = new THREE.Mesh(
        new THREE.BoxGeometry(wM - jambT * 2, 0.015, jambDepth),
        metalMat
      );
      threshold.position.set(0, 0.0075, 0);
      doorGroup.add(threshold);

      const { mode: doorMode, side: doorSide, dir: doorDir } = parseDoorSwing(
        element.swingDirection
      );
      const isOutward = doorSide === 'outward';
      const isRight = doorDir === 'right';
      const targetNormal = isOutward ? se.outwardNormal : se.inwardNormal;
      // Local +Z in 2D world coordinates is (-se.tangent.y, se.tangent.x)
      const swingDirLocalZ =
        targetNormal.x * -se.tangent.y + targetNormal.y * se.tangent.x >= 0 ? 1 : -1;
      const leafW = Math.max(0.2, wM - jambT * 2);
      const leafH = Math.max(0.4, hM - jambT - 0.02);

      const initProgress = openElementIds[element.id] ? 1 : 0;

      if (doorMode === 'sliding') {
        // Architectural Sliding Door (內橫拉 / 外橫拉): rail & rollers mounted on target face + animatable door panel
        const slideSign = isRight ? 1 : -1;
        const trackOffsetZ = swingDirLocalZ * (jambDepth * 0.5 + 0.036);
        const railLen = wM * 1.9;
        const railCenterX = slideSign * wM * 0.45;
        const railY = hM + 0.045;

        const railBar = new THREE.Mesh(
          new THREE.BoxGeometry(railLen, 0.036, 0.032),
          metalMat
        );
        railBar.position.set(railCenterX, railY, trackOffsetZ * 0.92);
        doorGroup.add(railBar);

        const panelW = wM + 0.04;
        const closedPanelX = 0;
        const openPanelX = slideSign * (wM * 0.92);

        const hangers: Array<{ mesh: THREE.Mesh; offsetX: number }> = [];
        for (const rxOff of [-panelW * 0.32, panelW * 0.32]) {
          const hanger = new THREE.Mesh(
            new THREE.BoxGeometry(0.032, 0.075, 0.026),
            metalMat
          );
          hanger.position.set(closedPanelX + rxOff, hM + 0.015, trackOffsetZ);
          doorGroup.add(hanger);
          hangers.push({ mesh: hanger, offsetX: rxOff });
        }

        const slidingPanel = new THREE.Mesh(
          new THREE.BoxGeometry(panelW, leafH + 0.02, 0.042),
          useSelectTint ? selectedAccentMat : customMat ?? doorLeafMat
        );
        slidingPanel.position.set(closedPanelX, (leafH + 0.02) * 0.5 + 0.01, trackOffsetZ);
        slidingPanel.castShadow = !isSoftwareGl;
        slidingPanel.userData.spaceInteractElementId = element.id;
        doorGroup.add(slidingPanel);
        handles.interactableMeshes.push(slidingPanel);

        const handleOffsetX = -slideSign * (panelW * 0.5 - 0.08);
        const pullHandle = new THREE.Mesh(
          new THREE.BoxGeometry(0.026, 0.22, 0.056),
          metalMat
        );
        pullHandle.position.set(
          closedPanelX + handleOffsetX,
          Math.min(1.05, leafH * 0.48),
          trackOffsetZ
        );
        pullHandle.userData.spaceInteractElementId = element.id;
        doorGroup.add(pullHandle);
        handles.interactableMeshes.push(pullHandle);

        const doorHandle: DoorSceneHandle = {
          elementId: element.id,
          mode: 'sliding',
          slidingPanel,
          pullHandle,
          hangers,
          closedPanelX,
          openPanelX,
          handleOffsetX,
          currentProgress: initProgress,
        };
        applyDoorOpenProgress(doorHandle, initProgress);
        handles.doors.push(doorHandle);
      } else {
        const pivot = new THREE.Group();
        const hingeX = isRight ? wM * 0.5 - jambT : -wM * 0.5 + jambT;
        pivot.position.set(hingeX, 0.015, 0);
        const closedAngleRad = 0;
        const openAngleRad = (isRight ? 1 : -1) * swingDirLocalZ * 1.48;

        const leafMesh = new THREE.Mesh(
          new THREE.BoxGeometry(leafW, leafH, 0.042),
          useSelectTint ? selectedAccentMat : customMat ?? doorLeafMat
        );
        leafMesh.position.set(isRight ? -leafW * 0.5 : leafW * 0.5, leafH * 0.5, 0);
        leafMesh.castShadow = !isSoftwareGl;
        leafMesh.userData.spaceInteractElementId = element.id;
        pivot.add(leafMesh);
        handles.interactableMeshes.push(leafMesh);

        const handle = new THREE.Mesh(
          new THREE.BoxGeometry(0.11, 0.024, 0.085),
          metalMat
        );
        handle.position.set(
          isRight ? -leafW + 0.09 : leafW - 0.09,
          Math.min(1.02, leafH * 0.48),
          0
        );
        handle.userData.spaceInteractElementId = element.id;
        pivot.add(handle);
        handles.interactableMeshes.push(handle);

        doorGroup.add(pivot);

        // Subtle architectural floor swing arc indicator
        const arcPts: THREE.Vector3[] = [];
        const arcSegs = 16;
        for (let i = 0; i <= arcSegs; i++) {
          const theta = (i / arcSegs) * (Math.PI * 0.5);
          const lx = hingeX + (isRight ? -leafW * Math.cos(theta) : leafW * Math.cos(theta));
          const lz = swingDirLocalZ * leafW * Math.sin(theta);
          arcPts.push(new THREE.Vector3(lx, 0.008, lz));
        }
        const arcGeo = new THREE.BufferGeometry().setFromPoints(arcPts);
        const arcLine = new THREE.Line(
          arcGeo,
          new THREE.LineBasicMaterial({ color: 0x3b82f6, transparent: true, opacity: 0.45 })
        );
        doorGroup.add(arcLine);

        const doorHandle: DoorSceneHandle = {
          elementId: element.id,
          mode: 'swing',
          pivot,
          closedAngleRad,
          openAngleRad,
          currentProgress: initProgress,
        };
        applyDoorOpenProgress(doorHandle, initProgress);
        handles.doors.push(doorHandle);
      }
      roomGroup.add(doorGroup);
    } else if (element.kind === 'window') {
      if (!se) continue;
      const wallYaw = -Math.atan2(se.tangent.y, se.tangent.x);
      const winGroup = new THREE.Group();
      const normalShiftM = se.isInterior ? 0 : wallThickM * 0.5;
      const cx = pl.center.x * CM_TO_M + se.outwardNormal.x * normalShiftM;
      const cz = pl.center.y * CM_TO_M + se.outwardNormal.y * normalShiftM;
      winGroup.position.set(cx, elevM, cz);
      winGroup.rotation.y = wallYaw;

      const frameT = 0.045;
      const frameD = wallThickM + 0.015;
      const activeAlum = useSelectTint ? selectedAccentMat : customMat ?? windowAlumMat;

      const sill = new THREE.Mesh(
        new THREE.BoxGeometry(wM + 0.06, 0.03, frameD + 0.06),
        cabBodyMat
      );
      sill.position.set(0, 0.015, 0);
      winGroup.add(sill);

      const topBar = new THREE.Mesh(new THREE.BoxGeometry(wM, frameT, frameD), activeAlum);
      topBar.position.set(0, hM - frameT * 0.5, 0);
      winGroup.add(topBar);

      const leftBar = new THREE.Mesh(new THREE.BoxGeometry(frameT, hM, frameD), activeAlum);
      leftBar.position.set(-wM * 0.5 + frameT * 0.5, hM * 0.5, 0);
      winGroup.add(leftBar);

      const rightBar = new THREE.Mesh(new THREE.BoxGeometry(frameT, hM, frameD), activeAlum);
      rightBar.position.set(wM * 0.5 - frameT * 0.5, hM * 0.5, 0);
      winGroup.add(rightBar);

      const mullion = new THREE.Mesh(
        new THREE.BoxGeometry(0.035, hM - frameT * 2, frameD * 0.7),
        activeAlum
      );
      mullion.position.set(0, hM * 0.5, 0);
      winGroup.add(mullion);

      const glass = new THREE.Mesh(
        new THREE.BoxGeometry(wM - frameT * 2, hM - frameT * 2, 0.016),
        windowGlassMat
      );
      glass.position.set(0, hM * 0.5, 0);
      glass.renderOrder = 1;
      winGroup.add(glass);

      roomGroup.add(winGroup);
    } else if (element.kind === 'table') {
      const tableGroup = new THREE.Group();
      const normalDir = pl.facingNormal;
      tableGroup.position.set(pl.boxCenter.x * CM_TO_M, elevM, pl.boxCenter.y * CM_TO_M);
      tableGroup.rotation.y = Math.atan2(normalDir.x, normalDir.y);

      const topT = Math.min(0.042, hM * 0.1);
      const legH = Math.max(0.1, hM - topT);
      const legT = Math.min(0.048, Math.min(wM, dM) * 0.12);

      const topMesh = new THREE.Mesh(
        new THREE.BoxGeometry(wM, topT, dM),
        useSelectTint ? selectedAccentMat : customMat ?? tableTopMat
      );
      topMesh.position.set(0, hM - topT * 0.5, 0);
      topMesh.castShadow = !isSoftwareGl;
      topMesh.receiveShadow = !isSoftwareGl;
      tableGroup.add(topMesh);

      const apron = new THREE.Mesh(
        new THREE.BoxGeometry(Math.max(0.05, wM - legT * 2.2), 0.045, Math.max(0.05, dM - legT * 2.2)),
        darkLegMat
      );
      apron.position.set(0, legH - 0.0225, 0);
      tableGroup.add(apron);

      const insetX = Math.max(0.02, wM * 0.5 - legT * 0.9);
      const insetZ = Math.max(0.02, dM * 0.5 - legT * 0.9);
      const legGeo = new THREE.BoxGeometry(legT, legH, legT);
      for (const [lx, lz] of [
        [-insetX, -insetZ],
        [insetX, -insetZ],
        [-insetX, insetZ],
        [insetX, insetZ],
      ]) {
        const leg = new THREE.Mesh(legGeo, darkLegMat);
        leg.position.set(lx, legH * 0.5, lz);
        leg.castShadow = !isSoftwareGl;
        tableGroup.add(leg);
      }

      if (showWireframe) {
        const outline = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.BoxGeometry(wM, topT, dM), 20),
          wallEdgeLineMat
        );
        outline.position.copy(topMesh.position);
        tableGroup.add(outline);
      }

      if (isSelected && customHex) {
        const selOutline = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.BoxGeometry(wM + 0.03, hM + 0.03, dM + 0.03)),
          selectionEdgeMat
        );
        selOutline.position.set(0, hM * 0.5, 0);
        tableGroup.add(selOutline);
      }

      roomGroup.add(tableGroup);
    } else if (element.kind === 'round_table') {
      const rtGroup = new THREE.Group();
      const normalDir = pl.facingNormal;
      rtGroup.position.set(pl.boxCenter.x * CM_TO_M, elevM, pl.boxCenter.y * CM_TO_M);
      rtGroup.rotation.y = Math.atan2(normalDir.x, normalDir.y);

      const topT = Math.min(0.045, hM * 0.1);
      const baseH = 0.028;
      const colH = Math.max(0.12, hM - topT - baseH);
      const activeTopMat = useSelectTint ? selectedAccentMat : customMat ?? tableTopMat;

      const discGeo = new THREE.CylinderGeometry(0.5, 0.5, topT, 28);
      const tabletop = new THREE.Mesh(discGeo, activeTopMat);
      tabletop.scale.set(wM, 1, dM);
      tabletop.position.set(0, hM - topT * 0.5, 0);
      tabletop.castShadow = !isSoftwareGl;
      tabletop.receiveShadow = !isSoftwareGl;
      rtGroup.add(tabletop);

      const collarR = Math.min(wM, dM) * 0.2;
      const collar = new THREE.Mesh(
        new THREE.CylinderGeometry(collarR, collarR * 0.65, 0.035, 18),
        darkLegMat
      );
      collar.position.set(0, hM - topT - 0.0175, 0);
      rtGroup.add(collar);

      const column = new THREE.Mesh(
        new THREE.CylinderGeometry(0.048, 0.068, colH, 16),
        darkLegMat
      );
      column.position.set(0, baseH + colH * 0.5, 0);
      column.castShadow = !isSoftwareGl;
      rtGroup.add(column);

      const baseR = Math.min(0.32, Math.min(wM, dM) * 0.28);
      const basePlate = new THREE.Mesh(
        new THREE.CylinderGeometry(baseR * 0.85, baseR, baseH, 24),
        darkLegMat
      );
      basePlate.position.set(0, baseH * 0.5, 0);
      basePlate.receiveShadow = !isSoftwareGl;
      rtGroup.add(basePlate);

      if (isSelected && customHex) {
        const selOutline = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.BoxGeometry(wM + 0.03, hM + 0.03, dM + 0.03)),
          selectionEdgeMat
        );
        selOutline.position.set(0, hM * 0.5, 0);
        rtGroup.add(selOutline);
      }

      roomGroup.add(rtGroup);
    } else if (element.kind === 'sofa') {
      const sofaGroup = new THREE.Group();
      const normalDir = pl.facingNormal;
      sofaGroup.position.set(pl.boxCenter.x * CM_TO_M, elevM, pl.boxCenter.y * CM_TO_M);
      sofaGroup.rotation.y = Math.atan2(normalDir.x, normalDir.y);

      const activeUpholstery = useSelectTint ? selectedAccentMat : customMat ?? sofaFabricMat;
      const activeTrim = useSelectTint ? selectedAccentMat : customDarkMat ?? sofaCushionTrimMat;

      const legH = 0.1;
      const basePlinthH = 0.12;
      const seatH = Math.min(0.43, hM * 0.52);
      const cushionH = Math.max(0.08, seatH - legH - basePlinthH);
      const armW = Math.min(0.18, wM * 0.11);
      const armH = Math.max(seatH + 0.12, hM * 0.72) - legH;
      const backD = Math.min(0.2, dM * 0.24);
      const backH = Math.max(seatH + 0.2, hM - legH);

      const legGeo = new THREE.CylinderGeometry(0.024, 0.016, legH, 10);
      const lxOff = Math.max(0.08, wM * 0.5 - 0.08);
      const lzOff = Math.max(0.08, dM * 0.5 - 0.08);
      for (const [lx, lz] of [
        [-lxOff, -lzOff],
        [lxOff, -lzOff],
        [-lxOff, lzOff],
        [lxOff, lzOff],
      ]) {
        const leg = new THREE.Mesh(legGeo, darkLegMat);
        leg.position.set(lx, legH * 0.5, lz);
        sofaGroup.add(leg);
      }

      const lowerDeck = new THREE.Mesh(
        new THREE.BoxGeometry(wM - 0.02, basePlinthH, dM - 0.02),
        activeTrim
      );
      lowerDeck.position.set(0, legH + basePlinthH * 0.5, 0);
      lowerDeck.castShadow = !isSoftwareGl;
      sofaGroup.add(lowerDeck);

      const backrest = new THREE.Mesh(
        new THREE.BoxGeometry(wM, backH, backD),
        activeTrim
      );
      backrest.position.set(0, legH + backH * 0.5, -dM * 0.5 + backD * 0.5);
      backrest.castShadow = !isSoftwareGl;
      sofaGroup.add(backrest);

      for (const sideSign of [-1, 1]) {
        const armrest = new THREE.Mesh(
          new THREE.BoxGeometry(armW, armH, dM - 0.02),
          activeTrim
        );
        armrest.position.set(sideSign * (wM * 0.5 - armW * 0.5), legH + armH * 0.5, 0);
        armrest.castShadow = !isSoftwareGl;
        sofaGroup.add(armrest);
      }

      const innerW = Math.max(0.3, wM - armW * 2 - 0.02);
      const seatD = Math.max(0.25, dM - backD - 0.02);
      const cushionCount = wM >= 1.7 ? 3 : wM >= 1.05 ? 2 : 1;
      const gap = 0.015;
      const singleW = (innerW - gap * (cushionCount - 1)) / cushionCount;
      const pillowH = Math.max(0.16, hM - seatH - 0.04);

      for (let i = 0; i < cushionCount; i++) {
        const cx = -innerW * 0.5 + singleW * 0.5 + i * (singleW + gap);
        const seatCushion = new THREE.Mesh(
          new THREE.BoxGeometry(singleW, cushionH, seatD),
          activeUpholstery
        );
        seatCushion.position.set(cx, legH + basePlinthH + cushionH * 0.5, backD * 0.5);
        seatCushion.castShadow = !isSoftwareGl;
        seatCushion.receiveShadow = !isSoftwareGl;
        sofaGroup.add(seatCushion);

        const backPillow = new THREE.Mesh(
          new THREE.BoxGeometry(singleW * 0.96, pillowH, 0.13),
          activeUpholstery
        );
        backPillow.position.set(cx, seatH + pillowH * 0.5 - 0.02, -dM * 0.5 + backD + 0.065);
        backPillow.rotation.x = -0.1;
        sofaGroup.add(backPillow);
      }

      if (isSelected && customHex) {
        const selOutline = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.BoxGeometry(wM + 0.03, hM + 0.03, dM + 0.03)),
          selectionEdgeMat
        );
        selOutline.position.set(0, hM * 0.5, 0);
        sofaGroup.add(selOutline);
      }

      roomGroup.add(sofaGroup);
    } else if (element.kind === 'chair') {
      const chairGroup = new THREE.Group();
      const normalDir = pl.facingNormal;
      chairGroup.position.set(pl.boxCenter.x * CM_TO_M, elevM, pl.boxCenter.y * CM_TO_M);
      chairGroup.rotation.y = Math.atan2(normalDir.x, normalDir.y);

      const seatH = Math.min(0.45, hM * 0.54);
      const seatT = 0.045;
      const legH = Math.max(0.08, seatH - seatT);
      const legT = 0.03;

      const seat = new THREE.Mesh(
        new THREE.BoxGeometry(wM, seatT, dM),
        useSelectTint ? selectedAccentMat : customMat ?? chairFabricMat
      );
      seat.position.set(0, seatH - seatT * 0.5, 0);
      seat.castShadow = !isSoftwareGl;
      seat.receiveShadow = !isSoftwareGl;
      chairGroup.add(seat);

      const insetX = Math.max(0.02, wM * 0.5 - legT * 0.9);
      const insetZ = Math.max(0.02, dM * 0.5 - legT * 0.9);
      const legGeo = new THREE.BoxGeometry(legT, legH, legT);
      for (const [lx, lz] of [
        [-insetX, -insetZ],
        [insetX, -insetZ],
        [-insetX, insetZ],
        [insetX, insetZ],
      ]) {
        const leg = new THREE.Mesh(legGeo, darkLegMat);
        leg.position.set(lx, legH * 0.5, lz);
        leg.castShadow = !isSoftwareGl;
        chairGroup.add(leg);
      }

      const backH = Math.max(0.18, hM - seatH);
      const postGeo = new THREE.BoxGeometry(legT, backH, legT);
      for (const lx of [-insetX, insetX]) {
        const post = new THREE.Mesh(postGeo, darkLegMat);
        post.position.set(lx, seatH + backH * 0.5, -insetZ);
        chairGroup.add(post);
      }

      const backPanelH = backH * 0.68;
      const backPanel = new THREE.Mesh(
        new THREE.BoxGeometry(wM * 0.94, backPanelH, 0.04),
        useSelectTint ? selectedAccentMat : customMat ?? chairFabricMat
      );
      backPanel.position.set(0, hM - backPanelH * 0.5 - 0.02, -dM * 0.5 + 0.03);
      backPanel.castShadow = !isSoftwareGl;
      chairGroup.add(backPanel);

      if (isSelected && customHex) {
        const selOutline = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.BoxGeometry(wM + 0.03, hM + 0.03, dM + 0.03)),
          selectionEdgeMat
        );
        selOutline.position.set(0, hM * 0.5, 0);
        chairGroup.add(selOutline);
      }

      roomGroup.add(chairGroup);
    } else if (element.kind === 'bed') {
      const bedGroup = new THREE.Group();
      const normalDir = pl.facingNormal;
      bedGroup.position.set(pl.boxCenter.x * CM_TO_M, elevM, pl.boxCenter.y * CM_TO_M);
      bedGroup.rotation.y = Math.atan2(normalDir.x, normalDir.y);

      const casterH = 0.07;
      const frameH = 0.08;
      const mattressTop = Math.max(0.35, hM);
      const mattressH = Math.max(0.14, mattressTop - casterH - frameH);

      const casterGeo = new THREE.CylinderGeometry(0.035, 0.035, casterH, 10);
      const cOffX = Math.max(0.1, wM * 0.5 - 0.08);
      const cOffZ = Math.max(0.2, dM * 0.5 - 0.14);
      for (const [cx, cz] of [
        [-cOffX, -cOffZ],
        [cOffX, -cOffZ],
        [-cOffX, cOffZ],
        [cOffX, cOffZ],
      ]) {
        const wheel = new THREE.Mesh(casterGeo, darkLegMat);
        wheel.position.set(cx, casterH * 0.5, cz);
        bedGroup.add(wheel);
      }

      const baseFrame = new THREE.Mesh(
        new THREE.BoxGeometry(wM - 0.06, frameH, dM - 0.12),
        cabPlinthMat
      );
      baseFrame.position.set(0, casterH + frameH * 0.5, 0);
      baseFrame.castShadow = !isSoftwareGl;
      bedGroup.add(baseFrame);

      const mattress = new THREE.Mesh(
        new THREE.BoxGeometry(wM - 0.05, mattressH, dM - 0.09),
        useSelectTint ? selectedAccentMat : mattressMat
      );
      mattress.position.set(0, casterH + frameH + mattressH * 0.5, 0);
      mattress.castShadow = !isSoftwareGl;
      mattress.receiveShadow = !isSoftwareGl;
      bedGroup.add(mattress);

      const activeBoardMat = useSelectTint ? selectedAccentMat : customDarkMat ?? bedFrameMat;
      const hbH = Math.min(ceilingM - 0.1, Math.max(mattressTop + 0.34, 0.94));
      const hb = new THREE.Mesh(new THREE.BoxGeometry(wM, hbH - casterH, 0.045), activeBoardMat);
      hb.position.set(0, casterH + (hbH - casterH) * 0.5, -dM * 0.5 + 0.0225);
      hb.castShadow = !isSoftwareGl;
      bedGroup.add(hb);

      const fbH = Math.min(ceilingM - 0.1, Math.max(mattressTop + 0.16, 0.72));
      const fb = new THREE.Mesh(new THREE.BoxGeometry(wM, fbH - casterH, 0.04), activeBoardMat);
      fb.position.set(0, casterH + (fbH - casterH) * 0.5, dM * 0.5 - 0.02);
      fb.castShadow = !isSoftwareGl;
      bedGroup.add(fb);

      const pillowD = Math.min(0.38, dM * 0.18);
      const pillow = new THREE.Mesh(
        new THREE.BoxGeometry(wM * 0.68, 0.08, pillowD),
        mattressMat
      );
      pillow.position.set(0, mattressTop + 0.04, -dM * 0.5 + 0.09 + pillowD * 0.5);
      bedGroup.add(pillow);

      const blanketD = dM * 0.58;
      const blanket = new THREE.Mesh(
        new THREE.BoxGeometry(wM - 0.025, 0.045, blanketD),
        useSelectTint ? selectedAccentMat : customMat ?? blanketMat
      );
      blanket.position.set(0, mattressTop + 0.015, dM * 0.5 - 0.06 - blanketD * 0.5);
      bedGroup.add(blanket);

      const railLen = dM * 0.52;
      const railTopY = mattressTop + 0.21;
      const railGeo = new THREE.BoxGeometry(0.026, 0.032, railLen);
      const railPostGeo = new THREE.BoxGeometry(0.022, 0.23, 0.022);
      for (const sideSign of [-1, 1]) {
        const rx = sideSign * (wM * 0.5 - 0.014);
        const topRail = new THREE.Mesh(railGeo, metalMat);
        topRail.position.set(rx, railTopY, -dM * 0.05);
        bedGroup.add(topRail);

        for (const rz of [-railLen * 0.36 - dM * 0.05, railLen * 0.36 - dM * 0.05]) {
          const post = new THREE.Mesh(railPostGeo, metalMat);
          post.position.set(rx, mattressTop + 0.095, rz);
          bedGroup.add(post);
        }
      }

      if (showWireframe) {
        const outline = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.BoxGeometry(wM - 0.05, mattressH, dM - 0.09), 20),
          wallEdgeLineMat
        );
        outline.position.copy(mattress.position);
        bedGroup.add(outline);
      }

      roomGroup.add(bedGroup);
    } else if (
      element.kind === 'wall_cabinet' ||
      element.kind === 'kitchen_counter' ||
      element.kind === 'cabinet'
    ) {
      const normalDir = pl.facingNormal;
      const spec = resolveCabinetSpecForElement(element);
      const { group: cabGroup, parts, interactableMeshes } = buildInteractiveCabinetMesh({
        elementId: element.id,
        elementName: element.name,
        baseKind: element.kind,
        widthCm: pl.clampedWidthCm,
        depthCm: element.depthCm,
        heightCm: element.heightCm,
        spec,
        materials: {
          bodyMat: useSelectTint ? selectedAccentMat : customMat ?? cabBodyMat,
          interiorMat: cabBodyMat,
          doorMat: useSelectTint ? selectedAccentMat : customDarkMat ?? cabDoorMat,
          plinthMat: cabPlinthMat,
          metalMat,
          countertopMat: useSelectTint
            ? selectedAccentMat
            : customMat && element.kind !== 'kitchen_counter'
              ? customMat
              : countertopStoneMat,
          waterMat: waterAccentMat,
          cooktopMat: cooktopGlassMat,
          edgeLineMat: wallEdgeLineMat,
        },
        showWireframe,
        includeCooktopIfKitchenDefault:
          element.kind === 'kitchen_counter' && !element.cabinetSpec,
        castShadow: !isSoftwareGl,
        receiveShadow: !isSoftwareGl,
        openPartsMap: openCabinetParts,
      });

      cabGroup.position.set(pl.boxCenter.x * CM_TO_M, elevM, pl.boxCenter.y * CM_TO_M);
      cabGroup.rotation.y = Math.atan2(normalDir.x, normalDir.y);

      if (isSelected && customHex) {
        const selOutline = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.BoxGeometry(wM + 0.03, hM + 0.03, dM + 0.03)),
          selectionEdgeMat
        );
        selOutline.position.set(0, hM * 0.5, 0);
        cabGroup.add(selOutline);
      }

      handles.cabinetParts.push(...parts);
      handles.interactableMeshes.push(...interactableMeshes);
      roomGroup.add(cabGroup);
    } else if (element.kind === 'toilet') {
      const toiletGroup = new THREE.Group();
      const normalDir = pl.facingNormal;
      toiletGroup.position.set(pl.boxCenter.x * CM_TO_M, elevM, pl.boxCenter.y * CM_TO_M);
      toiletGroup.rotation.y = Math.atan2(normalDir.x, normalDir.y);

      const activeCeramic = useSelectTint ? selectedAccentMat : customMat ?? ceramicMat;
      const tankD = Math.min(0.22, dM * 0.33);
      const tankW = Math.min(wM * 0.94, 0.42);
      const tankH = Math.max(0.32, hM - 0.38);
      const seatH = Math.min(0.42, hM * 0.56);

      const tank = new THREE.Mesh(
        new THREE.BoxGeometry(tankW, tankH, tankD),
        activeCeramic
      );
      tank.position.set(0, seatH - 0.04 + tankH * 0.5, -dM * 0.5 + tankD * 0.5 + 0.01);
      tank.castShadow = !isSoftwareGl;
      toiletGroup.add(tank);

      const tankLid = new THREE.Mesh(
        new THREE.BoxGeometry(tankW + 0.016, 0.025, tankD + 0.016),
        activeCeramic
      );
      tankLid.position.set(0, seatH - 0.04 + tankH + 0.0125, -dM * 0.5 + tankD * 0.5 + 0.01);
      toiletGroup.add(tankLid);

      const flushBtn = new THREE.Mesh(
        new THREE.CylinderGeometry(0.02, 0.02, 0.012, 14),
        metalMat
      );
      flushBtn.position.set(0, seatH - 0.04 + tankH + 0.028, -dM * 0.5 + tankD * 0.5 + 0.01);
      toiletGroup.add(flushBtn);

      const bowlZ = -dM * 0.5 + tankD + (dM - tankD) * 0.52;
      const bowlRx = Math.min(wM * 0.44, 0.19);
      const pedestal = new THREE.Mesh(
        new THREE.CylinderGeometry(bowlRx * 0.78, bowlRx * 0.68, seatH * 0.68, 16),
        activeCeramic
      );
      pedestal.position.set(0, seatH * 0.34, bowlZ - 0.02);
      pedestal.scale.set(1, 1, 1.25);
      pedestal.castShadow = !isSoftwareGl;
      toiletGroup.add(pedestal);

      const bowlRim = new THREE.Mesh(
        new THREE.CylinderGeometry(bowlRx, bowlRx * 0.78, seatH * 0.36, 18),
        activeCeramic
      );
      bowlRim.position.set(0, seatH * 0.82, bowlZ);
      bowlRim.scale.set(1, 1, 1.24);
      bowlRim.castShadow = !isSoftwareGl;
      toiletGroup.add(bowlRim);

      const seatRing = new THREE.Mesh(
        new THREE.CylinderGeometry(bowlRx * 0.96, bowlRx * 0.96, 0.024, 18),
        activeCeramic
      );
      seatRing.position.set(0, seatH + 0.012, bowlZ);
      seatRing.scale.set(1, 1, 1.22);
      toiletGroup.add(seatRing);

      const bowlWater = new THREE.Mesh(
        new THREE.CylinderGeometry(bowlRx * 0.65, bowlRx * 0.5, 0.01, 14),
        waterAccentMat
      );
      bowlWater.position.set(0, seatH + 0.021, bowlZ);
      bowlWater.scale.set(1, 1, 1.15);
      toiletGroup.add(bowlWater);

      roomGroup.add(toiletGroup);
    } else if (element.kind === 'urinal') {
      const urinalGroup = new THREE.Group();
      const normalDir = pl.facingNormal;
      urinalGroup.position.set(pl.boxCenter.x * CM_TO_M, elevM, pl.boxCenter.y * CM_TO_M);
      urinalGroup.rotation.y = Math.atan2(normalDir.x, normalDir.y);

      const activeCeramic = useSelectTint ? selectedAccentMat : customMat ?? ceramicMat;
      const bodyW = Math.min(wM * 0.9, 0.36);
      const bodyD = Math.max(0.16, dM * 0.85);
      const basinH = Math.max(0.4, hM * 0.74);

      const backPlate = new THREE.Mesh(
        new THREE.BoxGeometry(bodyW, basinH, 0.04),
        activeCeramic
      );
      backPlate.position.set(0, basinH * 0.5, -dM * 0.5 + 0.02);
      backPlate.castShadow = !isSoftwareGl;
      urinalGroup.add(backPlate);

      const leftCheek = new THREE.Mesh(
        new THREE.BoxGeometry(0.036, basinH * 0.72, bodyD * 0.72),
        activeCeramic
      );
      leftCheek.position.set(-bodyW * 0.5 + 0.018, basinH * 0.45, -dM * 0.5 + bodyD * 0.38);
      urinalGroup.add(leftCheek);

      const rightCheek = new THREE.Mesh(
        new THREE.BoxGeometry(0.036, basinH * 0.72, bodyD * 0.72),
        activeCeramic
      );
      rightCheek.position.set(bodyW * 0.5 - 0.018, basinH * 0.45, -dM * 0.5 + bodyD * 0.38);
      urinalGroup.add(rightCheek);

      const bowlCup = new THREE.Mesh(
        new THREE.CylinderGeometry(bodyW * 0.48, bodyW * 0.32, basinH * 0.38, 16),
        activeCeramic
      );
      bowlCup.position.set(0, basinH * 0.2, -dM * 0.5 + bodyD * 0.46);
      bowlCup.scale.set(1, 1, Math.max(0.75, bodyD / bodyW));
      bowlCup.castShadow = !isSoftwareGl;
      urinalGroup.add(bowlCup);

      const flushPipe = new THREE.Mesh(
        new THREE.CylinderGeometry(0.014, 0.014, Math.max(0.14, hM - basinH), 10),
        metalMat
      );
      flushPipe.position.set(0, basinH + (hM - basinH) * 0.45, -dM * 0.5 + 0.05);
      urinalGroup.add(flushPipe);

      const flushValve = new THREE.Mesh(
        new THREE.BoxGeometry(0.075, 0.075, 0.055),
        metalMat
      );
      flushValve.position.set(0, hM - 0.05, -dM * 0.5 + 0.055);
      urinalGroup.add(flushValve);

      roomGroup.add(urinalGroup);
    } else if (element.kind === 'shower') {
      const showerGroup = new THREE.Group();
      const normalDir = pl.facingNormal;
      showerGroup.position.set(pl.boxCenter.x * CM_TO_M, elevM, pl.boxCenter.y * CM_TO_M);
      showerGroup.rotation.y = Math.atan2(normalDir.x, normalDir.y);

      const activeMetal = useSelectTint ? selectedAccentMat : customMat ?? metalMat;
      const backZ = -dM * 0.5 + 0.03;

      const riser = new THREE.Mesh(
        new THREE.CylinderGeometry(0.014, 0.014, hM - 0.14, 12),
        activeMetal
      );
      riser.position.set(0, (hM - 0.08) * 0.5 + 0.04, backZ);
      showerGroup.add(riser);

      const mixerBar = new THREE.Mesh(
        new THREE.BoxGeometry(Math.min(wM * 0.78, 0.26), 0.04, 0.055),
        activeMetal
      );
      mixerBar.position.set(0, 0.15, backZ + 0.025);
      showerGroup.add(mixerBar);

      const armLen = Math.max(0.2, dM * 0.78);
      const topArm = new THREE.Mesh(
        new THREE.CylinderGeometry(0.012, 0.012, armLen, 10),
        activeMetal
      );
      topArm.rotation.x = Math.PI * 0.5;
      topArm.position.set(0, hM - 0.04, backZ + armLen * 0.5);
      showerGroup.add(topArm);

      const rainHead = new THREE.Mesh(
        new THREE.CylinderGeometry(Math.min(wM * 0.36, 0.11), Math.min(wM * 0.36, 0.11), 0.022, 20),
        activeMetal
      );
      rainHead.position.set(0, hM - 0.075, backZ + armLen - 0.04);
      rainHead.castShadow = !isSoftwareGl;
      showerGroup.add(rainHead);

      const sprayCone = new THREE.Mesh(
        new THREE.CylinderGeometry(Math.min(wM * 0.3, 0.09), Math.min(wM * 0.48, 0.16), Math.max(0.25, hM * 0.42), 16, 1, true),
        waterAccentMat
      );
      sprayCone.position.set(0, hM - 0.09 - Math.max(0.25, hM * 0.42) * 0.5, backZ + armLen - 0.04);
      showerGroup.add(sprayCone);

      roomGroup.add(showerGroup);
    } else if (element.kind === 'sink') {
      const sinkGroup = new THREE.Group();
      const normalDir = pl.facingNormal;
      sinkGroup.position.set(pl.boxCenter.x * CM_TO_M, elevM, pl.boxCenter.y * CM_TO_M);
      sinkGroup.rotation.y = Math.atan2(normalDir.x, normalDir.y);

      const activeCeramic = useSelectTint ? selectedAccentMat : customMat ?? ceramicMat;
      const counterH = 0.065;
      const apronH = 0.12;
      const basinTopY = hM;

      const counterSlab = new THREE.Mesh(
        new THREE.BoxGeometry(wM, counterH, dM),
        activeCeramic
      );
      counterSlab.position.set(0, basinTopY - counterH * 0.5, 0);
      counterSlab.castShadow = !isSoftwareGl;
      counterSlab.receiveShadow = !isSoftwareGl;
      sinkGroup.add(counterSlab);

      const apron = new THREE.Mesh(
        new THREE.BoxGeometry(wM * 0.88, apronH, dM * 0.82),
        activeCeramic
      );
      apron.position.set(0, basinTopY - counterH - apronH * 0.5, -dM * 0.04);
      sinkGroup.add(apron);

      const backSplash = new THREE.Mesh(
        new THREE.BoxGeometry(wM, 0.065, 0.026),
        activeCeramic
      );
      backSplash.position.set(0, basinTopY + 0.0325, -dM * 0.5 + 0.013);
      sinkGroup.add(backSplash);

      const basinInner = new THREE.Mesh(
        new THREE.BoxGeometry(wM * 0.72, 0.012, dM * 0.58),
        waterAccentMat
      );
      basinInner.position.set(0, basinTopY + 0.004, dM * 0.05);
      sinkGroup.add(basinInner);

      const pedestalH = Math.max(0.15, basinTopY - counterH - apronH);
      const pedestal = new THREE.Mesh(
        new THREE.CylinderGeometry(0.085, 0.105, pedestalH, 16),
        activeCeramic
      );
      pedestal.position.set(0, pedestalH * 0.5, -dM * 0.12);
      pedestal.castShadow = !isSoftwareGl;
      sinkGroup.add(pedestal);

      // Chrome gooseneck faucet
      const faucetStem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.014, 0.016, 0.14, 10),
        metalMat
      );
      faucetStem.position.set(0, basinTopY + 0.07, -dM * 0.5 + 0.06);
      sinkGroup.add(faucetStem);

      const faucetSpout = new THREE.Mesh(
        new THREE.BoxGeometry(0.024, 0.02, 0.11),
        metalMat
      );
      faucetSpout.position.set(0, basinTopY + 0.135, -dM * 0.5 + 0.105);
      sinkGroup.add(faucetSpout);

      roomGroup.add(sinkGroup);
    } else if (element.kind === 'bed_curtain') {
      const curtainGroup = new THREE.Group();
      const normalDir = pl.facingNormal;
      curtainGroup.position.set(pl.boxCenter.x * CM_TO_M, elevM, pl.boxCenter.y * CM_TO_M);
      curtainGroup.rotation.y = Math.atan2(normalDir.x, normalDir.y);

      const topLocalY = Math.max(0.4, Math.min(ceilingM - 0.03 - elevM, hM));
      const meshBandH = Math.min(0.42, topLocalY * 0.24);
      const bodyH = Math.max(0.2, topLocalY - meshBandH);
      const activeFabric = useSelectTint ? selectedAccentMat : customMat ?? curtainFabricMat;

      // Left arm anchored at head-wall end (z = -dM/2) and front arm anchored at right end (x = +wM/2)
      const leftX = -wM * 0.5 + 0.018;
      const frontZ = dM * 0.5 - 0.018;

      const leftGroup = new THREE.Group();
      leftGroup.position.set(leftX, 0, -dM * 0.5);

      const leftBody = new THREE.Mesh(new THREE.BoxGeometry(0.02, bodyH, dM), activeFabric);
      leftBody.position.set(0, bodyH * 0.5, dM * 0.5);
      leftBody.castShadow = !isSoftwareGl;
      leftBody.userData.spaceInteractElementId = element.id;
      leftGroup.add(leftBody);
      handles.interactableMeshes.push(leftBody);

      const leftTopMesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.014, meshBandH, dM),
        curtainMeshTopMat
      );
      leftTopMesh.position.set(0, bodyH + meshBandH * 0.5, dM * 0.5);
      leftGroup.add(leftTopMesh);

      const zPleatCount = Math.max(3, Math.floor(dM / 0.3));
      for (let i = 1; i < zPleatCount; i++) {
        const pz = (i / zPleatCount) * dM;
        const rib = new THREE.Mesh(new THREE.BoxGeometry(0.034, bodyH, 0.014), activeFabric);
        rib.position.set(0, bodyH * 0.5, pz);
        leftGroup.add(rib);
      }
      curtainGroup.add(leftGroup);

      const frontGroup = new THREE.Group();
      frontGroup.position.set(wM * 0.5, 0, frontZ);

      const frontBody = new THREE.Mesh(new THREE.BoxGeometry(wM, bodyH, 0.02), activeFabric);
      frontBody.position.set(-wM * 0.5, bodyH * 0.5, 0);
      frontBody.castShadow = !isSoftwareGl;
      frontBody.userData.spaceInteractElementId = element.id;
      frontGroup.add(frontBody);
      handles.interactableMeshes.push(frontBody);

      const frontTopMesh = new THREE.Mesh(
        new THREE.BoxGeometry(wM, meshBandH, 0.014),
        curtainMeshTopMat
      );
      frontTopMesh.position.set(-wM * 0.5, bodyH + meshBandH * 0.5, 0);
      frontGroup.add(frontTopMesh);

      const xPleatCount = Math.max(3, Math.floor(wM / 0.3));
      for (let i = 1; i < xPleatCount; i++) {
        const px = -wM + (i / xPleatCount) * wM;
        const rib = new THREE.Mesh(new THREE.BoxGeometry(0.014, bodyH, 0.034), activeFabric);
        rib.position.set(px, bodyH * 0.5, 0);
        frontGroup.add(rib);
      }
      curtainGroup.add(frontGroup);

      // Metallic L-shaped ceiling track & suspension hangers to ceiling (remain stationary)
      const trackLeft = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.028, dM + 0.02), metalMat);
      trackLeft.position.set(leftX, topLocalY, 0);
      curtainGroup.add(trackLeft);

      const trackFront = new THREE.Mesh(new THREE.BoxGeometry(wM + 0.02, 0.028, 0.032), metalMat);
      trackFront.position.set(0, topLocalY, frontZ);
      curtainGroup.add(trackFront);

      const ceilingGap = ceilingM - elevM - topLocalY;
      if (ceilingGap > 0.04) {
        const rodGeo = new THREE.CylinderGeometry(0.008, 0.008, ceilingGap, 8);
        for (const [rx, rz] of [
          [leftX, -dM * 0.44],
          [leftX, frontZ],
          [wM * 0.44, frontZ],
        ]) {
          const rod = new THREE.Mesh(rodGeo, metalMat);
          rod.position.set(rx, topLocalY + ceilingGap * 0.5, rz);
          curtainGroup.add(rod);
        }
      }

      const curtainHandle: CurtainSceneHandle = {
        elementId: element.id,
        leftGroup,
        frontGroup,
        currentProgress: openElementIds[element.id] ? 1 : 0,
      };
      applyCurtainOpenProgress(curtainHandle, curtainHandle.currentProgress);
      handles.curtains.push(curtainHandle);

      roomGroup.add(curtainGroup);
    } else if (
      element.kind === 'panel_light' ||
      element.kind === 'track_light' ||
      element.kind === 'recessed_light' ||
      element.kind === 'wall_sconce'
    ) {
      handles.hasAnyLightFixture = true;
      const isOn = element.lightOn !== false;
      const lampGroup = new THREE.Group();
      const normalDir = pl.facingNormal;
      const clampedElevM =
        element.kind === 'wall_sconce'
          ? Math.min(Math.max(0.2, elevM), Math.max(0.2, ceilingM - hM))
          : Math.min(elevM, Math.max(0.4, ceilingM - hM));
      lampGroup.position.set(pl.boxCenter.x * CM_TO_M, clampedElevM, pl.boxCenter.y * CM_TO_M);
      lampGroup.rotation.y = Math.atan2(normalDir.x, normalDir.y);

      const housingMat = useSelectTint
        ? selectedAccentMat
        : customDarkMat ??
          new THREE.MeshStandardMaterial({
            color: element.kind === 'track_light' ? 0x1e293b : 0xf1f5f9,
            roughness: 0.42,
            metalness: element.kind === 'track_light' ? 0.55 : 0.15,
          });
      const diffuserMat = new THREE.MeshStandardMaterial({
        color: isOn ? (customHex || 0xfffbeb) : 0x94a3b8,
        emissive: isOn ? 0xffe4a0 : 0x000000,
        emissiveIntensity: isOn ? (enableLightingRender ? 1.85 : 0.95) : 0,
        roughness: 0.25,
        metalness: 0.0,
      });

      if (element.kind === 'panel_light') {
        const frame = new THREE.Mesh(new THREE.BoxGeometry(wM, hM, dM), housingMat);
        frame.position.set(0, hM * 0.5, 0);
        lampGroup.add(frame);

        const diffuser = new THREE.Mesh(
          new THREE.BoxGeometry(Math.max(0.08, wM - 0.05), 0.012, Math.max(0.08, dM - 0.05)),
          diffuserMat
        );
        diffuser.position.set(0, 0.004, 0);
        lampGroup.add(diffuser);
      } else if (element.kind === 'track_light') {
        const railH = Math.min(0.036, hM * 0.35);
        const rail = new THREE.Mesh(new THREE.BoxGeometry(wM, railH, Math.min(0.06, dM)), housingMat);
        rail.position.set(0, hM - railH * 0.5, 0);
        lampGroup.add(rail);

        const spotCount = wM >= 1.0 ? 3 : 2;
        const canR = Math.min(0.042, dM * 0.32);
        const canLen = Math.min(0.11, hM * 0.65);
        for (let i = 0; i < spotCount; i++) {
          const sx = -wM * 0.32 + (i / (spotCount - 1)) * (wM * 0.64);
          const stem = new THREE.Mesh(
            new THREE.CylinderGeometry(0.009, 0.009, 0.035, 8),
            metalMat
          );
          stem.position.set(sx, hM - railH - 0.0175, 0);
          lampGroup.add(stem);

          const canGroup = new THREE.Group();
          canGroup.position.set(sx, hM - railH - 0.045, 0);
          canGroup.rotation.x = i % 2 === 0 ? 0.28 : -0.22;

          const body = new THREE.Mesh(
            new THREE.CylinderGeometry(canR, canR * 0.92, canLen, 14),
            housingMat
          );
          body.position.set(0, -canLen * 0.45, 0);
          canGroup.add(body);

          const lens = new THREE.Mesh(
            new THREE.CylinderGeometry(canR * 0.8, canR * 0.8, 0.012, 14),
            diffuserMat
          );
          lens.position.set(0, -canLen * 0.95, 0);
          canGroup.add(lens);

          lampGroup.add(canGroup);
        }
      } else if (element.kind === 'recessed_light') {
        const outerR = Math.max(0.06, Math.min(wM, dM) * 0.5);
        const trimRing = new THREE.Mesh(
          new THREE.CylinderGeometry(outerR, outerR * 0.94, Math.min(0.025, hM * 0.5), 22),
          housingMat
        );
        trimRing.position.set(0, hM * 0.25, 0);
        lampGroup.add(trimRing);

        const innerDisc = new THREE.Mesh(
          new THREE.CylinderGeometry(outerR * 0.72, outerR * 0.72, 0.016, 20),
          diffuserMat
        );
        innerDisc.position.set(0, 0.008, 0);
        lampGroup.add(innerDisc);
      } else {
        // Wall sconce
        const backPlate = new THREE.Mesh(
          new THREE.BoxGeometry(Math.min(0.14, wM * 0.72), Math.min(0.18, hM * 0.65), 0.025),
          housingMat
        );
        backPlate.position.set(0, hM * 0.5, -dM * 0.5 + 0.0125);
        lampGroup.add(backPlate);

        const arm = new THREE.Mesh(
          new THREE.BoxGeometry(0.024, 0.024, Math.max(0.06, dM * 0.45)),
          metalMat
        );
        arm.position.set(0, hM * 0.45, -dM * 0.5 + dM * 0.24);
        lampGroup.add(arm);

        const shade = new THREE.Mesh(
          new THREE.CylinderGeometry(
            Math.min(0.07, wM * 0.36),
            Math.min(0.095, wM * 0.48),
            Math.min(0.16, hM * 0.58),
            18
          ),
          diffuserMat
        );
        shade.position.set(0, hM * 0.54, 0.01);
        lampGroup.add(shade);
      }

      if (enableLightingRender && isOn && handles.activeDynamicLightCount < 6) {
        const lightColor = customHex ? new THREE.Color(customHex).lerp(new THREE.Color(0xfff5dc), 0.65) : 0xfff3d6;
        const intensityMap: Record<string, number> = {
          panel_light: 3.8,
          track_light: 4.4,
          recessed_light: 3.0,
          wall_sconce: 2.6,
        };
        const distMap: Record<string, number> = {
          panel_light: 7.5,
          track_light: 7.5,
          recessed_light: 6.0,
          wall_sconce: 5.5,
        };
        const ptLight = new THREE.PointLight(
          lightColor,
          intensityMap[element.kind] ?? 3.2,
          distMap[element.kind] ?? 6.5,
          1.6
        );
        ptLight.castShadow = false;
        ptLight.position.set(0, element.kind === 'wall_sconce' ? hM * 0.35 : -0.1, element.kind === 'wall_sconce' ? 0.08 : 0);
        lampGroup.add(ptLight);
        handles.activeDynamicLightCount += 1;
      }

      if (isSelected) {
        const selOutline = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.BoxGeometry(wM + 0.03, hM + 0.03, dM + 0.03)),
          selectionEdgeMat
        );
        selOutline.position.set(0, hM * 0.5, 0);
        lampGroup.add(selOutline);
      }

      roomGroup.add(lampGroup);
    }
  }

  // 4. Optional 3D Dimension Callouts & Measurement Sprites
  if (showDimensions) {
    const dimGroup = new THREE.Group();
    const dimLineMat = new THREE.LineBasicMaterial({
      color: 0x3b82f6,
      transparent: true,
      opacity: 0.78,
      depthTest: true,
      depthWrite: false,
    });
    const heightLineMat = new THREE.LineBasicMaterial({
      color: 0x0f766e,
      transparent: true,
      opacity: 0.85,
      depthTest: true,
      depthWrite: false,
    });

    const dimVertices: number[] = [];
    const allSegments = [...solved.solvedEdges, ...solved.solvedInteriorWalls];
    allSegments.forEach((se, segIdx) => {
      if (!se.hasWall || se.lengthCm < 15) return;
      const layout = computeWallDimensionLayout(
        wallThickM,
        se.isInterior,
        se.lengthCm,
        segIdx
      );
      const ox = se.outwardNormal.x * layout.spanOffsetM;
      const oz = se.outwardNormal.y * layout.spanOffsetM;
      const sx = se.start.x * CM_TO_M;
      const sz = se.start.y * CM_TO_M;
      const ex = se.end.x * CM_TO_M;
      const ez = se.end.y * CM_TO_M;
      const yLine = layout.yLineM;

      // Dimension span line
      dimVertices.push(sx + ox, yLine, sz + oz, ex + ox, yLine, ez + oz);
      // Witness ticks
      dimVertices.push(
        sx + se.outwardNormal.x * layout.tickRatioM,
        yLine,
        sz + se.outwardNormal.y * layout.tickRatioM,
        sx + ox + se.outwardNormal.x * 0.08,
        yLine,
        sz + oz + se.outwardNormal.y * 0.08
      );
      dimVertices.push(
        ex + se.outwardNormal.x * layout.tickRatioM,
        yLine,
        ez + se.outwardNormal.y * layout.tickRatioM,
        ex + ox + se.outwardNormal.x * 0.08,
        yLine,
        ez + oz + se.outwardNormal.y * 0.08
      );

      const shortCode = se.label.split(' ')[0];
      const sprite = createDimensionBadgeSprite(
        `${shortCode} ${formatDimension(se.lengthCm, project.unit)}`,
        {
          bg: selectedEdgeId === se.id ? 'rgba(239, 246, 255, 0.96)' : 'rgba(255, 255, 255, 0.94)',
          border: selectedEdgeId === se.id ? '#2563eb' : '#94a3b8',
          color: selectedEdgeId === se.id ? '#1d4ed8' : '#0f172a',
          heightMeters: layout.badgeHeightM,
          depthTest: true,
        }
      );
      sprite.position.set(
        se.midpoint.x * CM_TO_M + ox,
        layout.badgeY,
        se.midpoint.y * CM_TO_M + oz
      );
      dimGroup.add(sprite);
    });

    // Ceiling height vertical ruler at first polygon corner (pushed along outward corner bisector)
    const ceilingRuler = computeCeilingRulerPosition(
      solved.polygonPoints,
      solved.solvedEdges,
      wallThickM,
      ceilingM
    );
    if (ceilingRuler) {
      const { x: rx, yBadge, z: rz, badgeHeightM } = ceilingRuler;
      const hVerts = new Float32Array([
        rx, 0.02, rz, rx, ceilingM, rz,
        rx - 0.1, 0.02, rz, rx + 0.1, 0.02, rz,
        rx - 0.1, ceilingM, rz, rx + 0.1, ceilingM, rz,
      ]);
      const hGeo = new THREE.BufferGeometry();
      hGeo.setAttribute('position', new THREE.BufferAttribute(hVerts, 3));
      const hLines = new THREE.LineSegments(hGeo, heightLineMat);
      hLines.renderOrder = 9;
      dimGroup.add(hLines);

      const ceilBadge = createDimensionBadgeSprite(
        `天花 ${formatDimension(project.ceilingHeightCm, project.unit)}`,
        {
          bg: 'rgba(240, 253, 250, 0.95)',
          border: '#0d9488',
          color: '#115e59',
          heightMeters: badgeHeightM,
          depthTest: true,
        }
      );
      ceilBadge.position.set(rx, yBadge, rz);
      dimGroup.add(ceilBadge);
    }

    // Opening (door / window) and selected furniture size badges
    for (const pl of placements) {
      const el = pl.element;
      const isSelected = selectedElementId === el.id;
      if (el.kind === 'door' || el.kind === 'window') {
        const wTxt = formatDimension(pl.clampedWidthCm, project.unit, false);
        const hTxt = formatDimension(el.heightCm, project.unit, false);
        const elevSuffix =
          el.kind === 'window' && el.elevationCm > 0
            ? ` 台${formatDimension(el.elevationCm, project.unit, false)}`
            : '';
        const badgeText = `${el.name} ${wTxt}×${hTxt}${elevSuffix}`;
        const pos = computeOpeningBadgePosition(pl.center, pl.edge, wallThickM, ceilingM);
        const badge = createDimensionBadgeSprite(badgeText, {
          bg: el.kind === 'window' ? 'rgba(240, 249, 255, 0.94)' : 'rgba(239, 246, 255, 0.94)',
          border: isSelected ? '#1d4ed8' : el.kind === 'window' ? '#0284c7' : '#3b82f6',
          color: el.kind === 'window' ? '#0369a1' : '#1e40af',
          heightMeters: pos.badgeHeightM,
          depthTest: true,
        });
        badge.position.set(pos.x, pos.y, pos.z);
        dimGroup.add(badge);

        // Short vertical leader tick above wall top anchoring the opening badge cleanly
        dimVertices.push(
          pos.x,
          pos.leaderBottomY,
          pos.z,
          pos.x,
          pos.leaderTopY,
          pos.z
        );
      } else if (isSelected) {
        const badgeText = `${el.name} ${Math.round(pl.clampedWidthCm)}×${Math.round(el.depthCm)}×${Math.round(el.heightCm)}`;
        const badge = createDimensionBadgeSprite(badgeText, {
          bg: 'rgba(239, 246, 255, 0.96)',
          border: '#1d4ed8',
          color: '#1e3a8a',
          heightMeters: 0.28,
          depthTest: true,
        });
        badge.position.set(
          pl.boxCenter.x * CM_TO_M,
          (el.elevationCm + el.heightCm) * CM_TO_M + 0.3,
          pl.boxCenter.y * CM_TO_M
        );
        dimGroup.add(badge);
      }
    }

    if (dimVertices.length > 0) {
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(dimVertices, 3));
      const dimLines = new THREE.LineSegments(lineGeo, dimLineMat);
      dimLines.renderOrder = 9;
      dimGroup.add(dimLines);
    }

    roomGroup.add(dimGroup);
  }

  return handles;
}

/**
 * Render a single crisp isometric 3D frame offscreen for PDF export when the 3D viewport is not currently mounted.
 */
export function renderOffscreen3DSnapshot(
  options: Omit<BuildRoomSceneOptions, 'isSoftwareGl' | 'floorTexture'>,
  width = 1600,
  height = 1080
): string | null {
  try {
    const isSoftwareGl = detectSoftwareGl();
    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.06;
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xeff3f8);
    scene.fog = new THREE.Fog(0xeff3f8, 22, 65);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTex = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTex;
    pmremGenerator.dispose();

    const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0xcbd5e1, 0.85);
    scene.add(hemiLight);
    const keyLight = new THREE.DirectionalLight(0xfff7ed, 1.55);
    keyLight.position.set(10, 16, 12);
    scene.add(keyLight);
    const rimLight = new THREE.DirectionalLight(0xe0f2fe, 0.55);
    rimLight.position.set(-10, 8, -10);
    scene.add(rimLight);

    const groundGeo = new THREE.PlaneGeometry(80, 80);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0xe6ecf3,
      roughness: 0.92,
      metalness: 0.0,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.025;
    scene.add(ground);

    const grid = new THREE.GridHelper(36, 36, 0xcbd5e1, 0xdbe4ee);
    grid.position.y = -0.02;
    scene.add(grid);

    const floorTex = createWoodFloorTexture(renderer.capabilities.getMaxAnisotropy());
    const roomGroup = new THREE.Group();
    scene.add(roomGroup);

    buildRoomSceneGroup(roomGroup, {
      ...options,
      isSoftwareGl,
      floorTexture: floorTex,
    });

    const cx = options.solved.bounds.centerX * CM_TO_M;
    const cz = options.solved.bounds.centerY * CM_TO_M;
    const maxSpan =
      Math.max(options.solved.bounds.widthCm, options.solved.bounds.heightCm, 250) * CM_TO_M;
    const ceilingM = Math.max(1.5, options.project.ceilingHeightCm * CM_TO_M);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.05, 120);
    camera.position.set(
      cx + maxSpan * 0.96,
      Math.max(6.2, maxSpan * 0.9),
      cz + maxSpan * 1.06
    );
    camera.lookAt(cx, ceilingM * 0.3, cz);
    camera.updateMatrixWorld();

    renderer.render(scene, camera);
    const dataUrl = renderer.domElement.toDataURL('image/png');

    disposeGroupContents(roomGroup, floorTex);
    floorTex.dispose();
    groundGeo.dispose();
    groundMat.dispose();
    envTex.dispose();
    renderer.dispose();

    return dataUrl;
  } catch {
    return null;
  }
}
