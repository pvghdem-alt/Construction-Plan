import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type {
  FloorplanProject,
  SolvedElementPlacement,
  SolvedFloorplan,
  SolvedWallSegment,
} from '../types/floorplan';
import { formatDimension } from './floorplanGeometry';

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

  ctx.fillStyle = '#e7dccb';
  ctx.fillRect(0, 0, size, size);

  const plankRows = 8;
  const plankH = size / plankRows;
  for (let r = 0; r < plankRows; r++) {
    const y = r * plankH;
    const tint = (r % 3) * 4 - 4;
    ctx.fillStyle = `rgb(${228 + tint}, ${214 + tint}, ${194 + tint})`;
    ctx.fillRect(0, y, size, plankH - 1);

    ctx.strokeStyle = 'rgba(166, 138, 100, 0.14)';
    ctx.lineWidth = 1;
    for (let g = 0; g < 6; g++) {
      const gy = y + 6 + g * ((plankH - 12) / 6);
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(size, gy + ((g % 2) * 2 - 1) * 1.5);
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(140, 115, 85, 0.25)';
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
  } = {}
): THREE.Sprite {
  const bg = options.bg ?? 'rgba(255, 255, 255, 0.94)';
  const border = options.border ?? '#94a3b8';
  const color = options.color ?? '#0f172a';
  const heightM = options.heightMeters ?? 0.34;

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
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.renderOrder = 30;
  const aspect = canvas.width / canvas.height;
  sprite.scale.set(heightM * aspect, heightM, 1);
  return sprite;
}

export interface BuildRoomSceneOptions {
  project: FloorplanProject;
  solved: SolvedFloorplan;
  placements: SolvedElementPlacement[];
  selectedEdgeId: string | null;
  selectedElementId: string | null;
  wallTransparent: boolean;
  showCeiling: boolean;
  showWireframe: boolean;
  showDimensions: boolean;
  isSoftwareGl: boolean;
  floorTexture: THREE.Texture | null;
}

export function buildRoomSceneGroup(
  roomGroup: THREE.Group,
  options: BuildRoomSceneOptions
): void {
  const {
    project,
    solved,
    placements,
    selectedEdgeId,
    selectedElementId,
    wallTransparent,
    showCeiling,
    showWireframe,
    showDimensions,
    isSoftwareGl,
    floorTexture,
  } = options;

  disposeGroupContents(roomGroup, floorTexture);

  const ceilingM = Math.max(1.2, project.ceilingHeightCm * CM_TO_M);
  const wallThickM = Math.max(0.06, project.wallThicknessCm * CM_TO_M);

  const wallMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
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
  });
  const wallEdgeLineMat = new THREE.LineBasicMaterial({
    color: 0x94a3b8,
    transparent: true,
    opacity: wallTransparent ? 0.45 : 0.75,
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
      color: 0xffffff,
      roughness: 0.68,
      metalness: 0.03,
      side: THREE.DoubleSide,
    });
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.y = 0.0;
    floorMesh.receiveShadow = !isSoftwareGl;
    roomGroup.add(floorMesh);

    if (showCeiling) {
      const ceilGeo = new THREE.ShapeGeometry(shape);
      const ceilMat = new THREE.MeshStandardMaterial({
        color: 0xf1f5f9,
        roughness: 0.9,
        metalness: 0.0,
        transparent: true,
        opacity: 0.32,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const ceilMesh = new THREE.Mesh(ceilGeo, ceilMat);
      ceilMesh.rotation.x = -Math.PI / 2;
      ceilMesh.position.y = ceilingM + 0.005;
      roomGroup.add(ceilMesh);
    }
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
    roomGroup.add(mesh);

    if (showWireframe) {
      const edgesGeo = new THREE.EdgesGeometry(geo, 20);
      const line = new THREE.LineSegments(edgesGeo, wallEdgeLineMat);
      line.position.copy(mesh.position);
      line.rotation.copy(mesh.rotation);
      roomGroup.add(line);
    }
  };

  // 2. Extrude Outer & Interior Partition Walls
  for (const se of [...solved.solvedEdges, ...solved.solvedInteriorWalls]) {
    if (!se.hasWall) continue;
    const wallLenM = se.lengthCm * CM_TO_M;
    const isSelected = selectedEdgeId === se.id;
    const openings = (openingsByEdge.get(se.id) || []).sort(
      (a, b) => a.startM - a.startM
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
  const selectedAccentMat = new THREE.MeshStandardMaterial({
    color: 0x3b82f6,
    roughness: 0.4,
    metalness: 0.1,
  });

  for (const pl of placements) {
    const { element, edge: se } = pl;
    const isSelected = selectedElementId === element.id;
    const wM = pl.clampedWidthCm * CM_TO_M;
    const dM = Math.max(0.06, element.depthCm * CM_TO_M);
    const hM = Math.min(ceilingM, Math.max(0.2, element.heightCm * CM_TO_M));
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
      const activeFrameMat = isSelected ? selectedAccentMat : frameWoodMat;

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

      const swing = element.swingDirection || 'inward-right';
      const isOutward = swing.startsWith('outward');
      const isHingeRight = swing.endsWith('right');
      const leafW = Math.max(0.2, wM - jambT * 2);
      const leafH = Math.max(0.4, hM - jambT - 0.02);

      const pivot = new THREE.Group();
      pivot.position.set(
        isHingeRight ? wM * 0.5 - jambT : -wM * 0.5 + jambT,
        0.015,
        0
      );
      const swingAngle = 0.48 * (isHingeRight ? -1 : 1) * (isOutward ? -1 : 1);
      pivot.rotation.y = swingAngle;

      const leafMesh = new THREE.Mesh(
        new THREE.BoxGeometry(leafW, leafH, 0.042),
        isSelected ? selectedAccentMat : doorLeafMat
      );
      leafMesh.position.set(isHingeRight ? -leafW * 0.5 : leafW * 0.5, leafH * 0.5, 0);
      leafMesh.castShadow = !isSoftwareGl;
      pivot.add(leafMesh);

      const handle = new THREE.Mesh(
        new THREE.BoxGeometry(0.11, 0.024, 0.085),
        metalMat
      );
      handle.position.set(
        isHingeRight ? -leafW + 0.09 : leafW - 0.09,
        Math.min(1.02, leafH * 0.48),
        0
      );
      pivot.add(handle);

      doorGroup.add(pivot);
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
      const activeAlum = isSelected ? selectedAccentMat : windowAlumMat;

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
        isSelected ? selectedAccentMat : tableTopMat
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

      roomGroup.add(tableGroup);
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
        isSelected ? selectedAccentMat : chairFabricMat
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
        isSelected ? selectedAccentMat : chairFabricMat
      );
      backPanel.position.set(0, hM - backPanelH * 0.5 - 0.02, -dM * 0.5 + 0.03);
      backPanel.castShadow = !isSoftwareGl;
      chairGroup.add(backPanel);

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
        isSelected ? selectedAccentMat : mattressMat
      );
      mattress.position.set(0, casterH + frameH + mattressH * 0.5, 0);
      mattress.castShadow = !isSoftwareGl;
      mattress.receiveShadow = !isSoftwareGl;
      bedGroup.add(mattress);

      const activeBoardMat = isSelected ? selectedAccentMat : bedFrameMat;
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
        blanketMat
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
    } else {
      const cabGroup = new THREE.Group();
      const normalDir = pl.facingNormal;
      const cx = pl.boxCenter.x * CM_TO_M;
      const cz = pl.boxCenter.y * CM_TO_M;
      cabGroup.position.set(cx, elevM, cz);
      cabGroup.rotation.y = Math.atan2(normalDir.x, normalDir.y);

      const plinthH = Math.min(0.08, hM * 0.12);
      const topTrimH = 0.025;
      const bodyH = Math.max(0.1, hM - plinthH - topTrimH);

      const plinth = new THREE.Mesh(
        new THREE.BoxGeometry(wM - 0.01, plinthH, dM - 0.04),
        cabPlinthMat
      );
      plinth.position.set(0, plinthH * 0.5, -0.015);
      cabGroup.add(plinth);

      const body = new THREE.Mesh(
        new THREE.BoxGeometry(wM, bodyH, dM - 0.022),
        isSelected ? selectedAccentMat : cabBodyMat
      );
      body.position.set(0, plinthH + bodyH * 0.5, -0.011);
      body.castShadow = !isSoftwareGl;
      body.receiveShadow = !isSoftwareGl;
      cabGroup.add(body);

      const topCap = new THREE.Mesh(
        new THREE.BoxGeometry(wM + 0.008, topTrimH, dM + 0.006),
        isSelected ? selectedAccentMat : cabDoorMat
      );
      topCap.position.set(0, plinthH + bodyH + topTrimH * 0.5, 0);
      topCap.castShadow = !isSoftwareGl;
      cabGroup.add(topCap);

      const numDoors = wM > 0.75 ? 2 : 1;
      const doorGap = 0.012;
      const singleDoorW = (wM - doorGap * (numDoors + 1)) / numDoors;
      for (let dIdx = 0; dIdx < numDoors; dIdx++) {
        const dx =
          -wM * 0.5 + doorGap + singleDoorW * 0.5 + dIdx * (singleDoorW + doorGap);
        const doorPanel = new THREE.Mesh(
          new THREE.BoxGeometry(singleDoorW, bodyH - 0.016, 0.02),
          isSelected ? selectedAccentMat : cabDoorMat
        );
        doorPanel.position.set(dx, plinthH + bodyH * 0.5, dM * 0.5 - 0.01);
        cabGroup.add(doorPanel);

        const handleOffset =
          numDoors === 2
            ? dIdx === 0
              ? singleDoorW * 0.36
              : -singleDoorW * 0.36
            : -singleDoorW * 0.35;
        const handle = new THREE.Mesh(
          new THREE.BoxGeometry(0.014, Math.min(0.24, bodyH * 0.25), 0.022),
          metalMat
        );
        handle.position.set(
          dx + handleOffset,
          plinthH + Math.min(1.05, bodyH * 0.55),
          dM * 0.5 + 0.008
        );
        cabGroup.add(handle);
      }

      if (showWireframe) {
        const outlineGeo = new THREE.EdgesGeometry(
          new THREE.BoxGeometry(wM, hM, dM),
          20
        );
        const outline = new THREE.LineSegments(outlineGeo, wallEdgeLineMat);
        outline.position.set(0, hM * 0.5, 0);
        cabGroup.add(outline);
      }

      roomGroup.add(cabGroup);
    }
  }

  // 4. Optional 3D Dimension Callouts & Measurement Sprites
  if (showDimensions) {
    const dimGroup = new THREE.Group();
    const dimLineMat = new THREE.LineBasicMaterial({
      color: 0x3b82f6,
      transparent: true,
      opacity: 0.75,
    });
    const heightLineMat = new THREE.LineBasicMaterial({
      color: 0x0f766e,
      transparent: true,
      opacity: 0.85,
    });

    const dimVertices: number[] = [];
    for (const se of [...solved.solvedEdges, ...solved.solvedInteriorWalls]) {
      if (!se.hasWall || se.lengthCm < 15) continue;
      const offsetM = se.isInterior ? 0.22 : wallThickM + 0.38;
      const ox = se.outwardNormal.x * offsetM;
      const oz = se.outwardNormal.y * offsetM;
      const sx = se.start.x * CM_TO_M;
      const sz = se.start.y * CM_TO_M;
      const ex = se.end.x * CM_TO_M;
      const ez = se.end.y * CM_TO_M;
      const yLine = 0.025;

      // Dimension span line
      dimVertices.push(sx + ox, yLine, sz + oz, ex + ox, yLine, ez + oz);
      // Witness ticks
      const tickRatio = se.isInterior ? 0.08 : 0.14;
      dimVertices.push(
        sx + se.outwardNormal.x * tickRatio,
        yLine,
        sz + se.outwardNormal.y * tickRatio,
        sx + ox + se.outwardNormal.x * 0.08,
        yLine,
        sz + oz + se.outwardNormal.y * 0.08
      );
      dimVertices.push(
        ex + se.outwardNormal.x * tickRatio,
        yLine,
        ez + se.outwardNormal.y * tickRatio,
        ex + ox + se.outwardNormal.x * 0.08,
        yLine,
        ez + oz + se.outwardNormal.y * 0.08
      );

      const shortCode = se.label.split(' ')[0];
      const sprite = createDimensionBadgeSprite(
        `${shortCode} ${formatDimension(se.lengthCm, project.unit)}`,
        {
          bg: selectedEdgeId === se.id ? 'rgba(239, 246, 255, 0.96)' : 'rgba(255, 255, 255, 0.92)',
          border: selectedEdgeId === se.id ? '#2563eb' : '#94a3b8',
          color: selectedEdgeId === se.id ? '#1d4ed8' : '#0f172a',
          heightMeters: 0.28,
        }
      );
      sprite.position.set(
        se.midpoint.x * CM_TO_M + ox,
        0.22,
        se.midpoint.y * CM_TO_M + oz
      );
      dimGroup.add(sprite);
    }

    if (dimVertices.length > 0) {
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(dimVertices, 3));
      dimGroup.add(new THREE.LineSegments(lineGeo, dimLineMat));
    }

    // Ceiling height vertical ruler at first polygon corner
    if (solved.polygonPoints.length > 0) {
      const p0 = solved.polygonPoints[0];
      const rx = p0.x * CM_TO_M - wallThickM - 0.35;
      const rz = p0.y * CM_TO_M - wallThickM - 0.35;
      const hVerts = new Float32Array([
        rx, 0, rz, rx, ceilingM, rz,
        rx - 0.1, 0, rz, rx + 0.1, 0, rz,
        rx - 0.1, ceilingM, rz, rx + 0.1, ceilingM, rz,
      ]);
      const hGeo = new THREE.BufferGeometry();
      hGeo.setAttribute('position', new THREE.BufferAttribute(hVerts, 3));
      dimGroup.add(new THREE.LineSegments(hGeo, heightLineMat));

      const ceilBadge = createDimensionBadgeSprite(
        `天花 ${formatDimension(project.ceilingHeightCm, project.unit)}`,
        {
          bg: 'rgba(240, 253, 250, 0.95)',
          border: '#0d9488',
          color: '#115e59',
          heightMeters: 0.3,
        }
      );
      ceilBadge.position.set(rx, ceilingM * 0.55, rz);
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
        const badge = createDimensionBadgeSprite(badgeText, {
          bg: el.kind === 'window' ? 'rgba(240, 249, 255, 0.94)' : 'rgba(239, 246, 255, 0.94)',
          border: isSelected ? '#1d4ed8' : el.kind === 'window' ? '#0284c7' : '#3b82f6',
          color: el.kind === 'window' ? '#0369a1' : '#1e40af',
          heightMeters: 0.26,
        });
        const yPos = Math.min(
          ceilingM + 0.28,
          (el.elevationCm + el.heightCm) * CM_TO_M + 0.24
        );
        const normalShiftM = pl.edge && !pl.edge.isInterior ? wallThickM * 0.5 : 0;
        badge.position.set(
          pl.center.x * CM_TO_M + (pl.edge?.outwardNormal.x ?? 0) * normalShiftM,
          yPos,
          pl.center.y * CM_TO_M + (pl.edge?.outwardNormal.y ?? 0) * normalShiftM
        );
        dimGroup.add(badge);
      } else if (isSelected) {
        const badgeText = `${el.name} ${Math.round(pl.clampedWidthCm)}×${Math.round(el.depthCm)}×${Math.round(el.heightCm)}`;
        const badge = createDimensionBadgeSprite(badgeText, {
          bg: 'rgba(239, 246, 255, 0.96)',
          border: '#1d4ed8',
          color: '#1e3a8a',
          heightMeters: 0.28,
        });
        badge.position.set(
          pl.boxCenter.x * CM_TO_M,
          (el.elevationCm + el.heightCm) * CM_TO_M + 0.3,
          pl.boxCenter.y * CM_TO_M
        );
        dimGroup.add(badge);
      }
    }

    roomGroup.add(dimGroup);
  }
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
