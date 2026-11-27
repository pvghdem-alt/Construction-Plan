import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DoorOpen, Eye, RotateCcw } from 'lucide-react';
import type { CabinetBaseKind, CabinetSpec } from '../types/floorplan';
import {
  applyCabinetPartProgress,
  buildInteractiveCabinetMesh,
  getCabinetPartKey,
  type CabinetInteractivePartHandle,
  type CabinetPartInteractionMeta,
} from '../utils/cabinet3DBuilder';
import { sanitizeCabinetSpec } from '../utils/cabinetDesigner';
import { ELEMENT_KIND_DEFAULTS, sanitizeHexColor } from '../utils/floorplanGeometry';

interface CabinetPreview3DProps {
  name: string;
  baseKind: CabinetBaseKind;
  widthCm: number;
  depthCm: number;
  heightCm: number;
  color?: string;
  spec: CabinetSpec;
}

const PREVIEW_ELEMENT_ID = 'cabinet-designer-preview';

function disposeObjectSubtree(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (mesh.geometry) geometries.add(mesh.geometry);
    if (mesh.material) {
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((m) => materials.add(m));
      } else {
        materials.add(mesh.material);
      }
    }
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
}

export const CabinetPreview3D: React.FC<CabinetPreview3DProps> = ({
  name,
  baseKind,
  widthCm,
  depthCm,
  heightCm,
  color,
  spec,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [showWireframe, setShowWireframe] = useState(false);
  const [openPartsMap, setOpenPartsMap] = useState<Record<string, boolean>>({});
  const [lastInteractedLabel, setLastInteractedLabel] = useState<string | null>(null);

  const openPartsMapRef = useRef(openPartsMap);
  openPartsMapRef.current = openPartsMap;

  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const cabinetRootRef = useRef<THREE.Group | null>(null);
  const partsRef = useRef<CabinetInteractivePartHandle[]>([]);
  const interactableMeshesRef = useRef<THREE.Object3D[]>([]);
  const requestRenderRef = useRef<() => void>(() => {});
  const autoFrameNeededRef = useRef(true);

  const normalizedSpec = useMemo(
    () => sanitizeCabinetSpec(spec, baseKind, widthCm),
    [spec, baseKind, widthCm]
  );

  const openPartsList = useMemo(
    () =>
      Object.entries(openPartsMap)
        .filter(([, isOpen]) => isOpen)
        .map(([key]) => key)
        .sort(),
    [openPartsMap]
  );

  // One-time Three.js WebGL stage initialization
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#eef2f6');
    sceneRef.current = scene;

    const width = Math.max(320, container.clientWidth);
    const height = Math.max(260, container.clientHeight);
    const camera = new THREE.PerspectiveCamera(42, width / height, 0.05, 60);
    camera.position.set(1.65, 1.45, 2.25);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 0.55;
    controls.maxDistance = 9.0;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.target.set(0, 0.75, 0);
    controls.update();
    controlsRef.current = controls;

    // Studio three-point lighting
    const hemi = new THREE.HemisphereLight('#ffffff', '#cbd5e1', 0.85);
    scene.add(hemi);

    const keyLight = new THREE.DirectionalLight('#fffbf5', 1.1);
    keyLight.position.set(2.4, 3.8, 3.1);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 0.3;
    keyLight.shadow.camera.far = 14;
    keyLight.shadow.camera.left = -2.5;
    keyLight.shadow.camera.right = 2.5;
    keyLight.shadow.camera.top = 2.5;
    keyLight.shadow.camera.bottom = -2.5;
    keyLight.shadow.bias = -0.0005;
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight('#e2e8f0', 0.45);
    fillLight.position.set(-2.6, 2.0, -1.8);
    scene.add(fillLight);

    // Studio floor disc + subtle CAD grid
    const floorMat = new THREE.MeshStandardMaterial({
      color: '#e2e8f0',
      roughness: 0.92,
      metalness: 0.02,
    });
    const floorMesh = new THREE.Mesh(new THREE.CircleGeometry(4.5, 48), floorMat);
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.position.y = -0.002;
    floorMesh.receiveShadow = true;
    scene.add(floorMesh);

    const grid = new THREE.GridHelper(6, 24, '#94a3b8', '#cbd5e1');
    grid.position.y = 0.001;
    scene.add(grid);

    const cabinetRoot = new THREE.Group();
    scene.add(cabinetRoot);
    cabinetRootRef.current = cabinetRoot;

    // On-demand render & animation damping loop
    let animFrameId: number | null = null;
    let lastTime = performance.now();

    const tick = (now: number) => {
      animFrameId = null;
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;

      const dampingChanged = controls.update();
      let cabinetAnimating = false;
      const openMap = openPartsMapRef.current;
      for (const part of partsRef.current) {
        const target = openMap[part.key] ? 1 : 0;
        if (Math.abs(target - part.currentProgress) > 0.003) {
          const factor = 1 - Math.exp(-11 * dt);
          const nextP = part.currentProgress + (target - part.currentProgress) * factor;
          applyCabinetPartProgress(part, Math.abs(target - nextP) < 0.004 ? target : nextP);
          cabinetAnimating = true;
        } else if (part.currentProgress !== target) {
          applyCabinetPartProgress(part, target);
        }
      }

      renderer.render(scene, camera);

      if (dampingChanged || cabinetAnimating) {
        animFrameId = requestAnimationFrame(tick);
      }
    };

    const requestRender = () => {
      if (animFrameId === null) {
        lastTime = performance.now();
        animFrameId = requestAnimationFrame(tick);
      }
    };
    requestRenderRef.current = requestRender;
    controls.addEventListener('change', requestRender);

    // Raycaster pointer interaction on doors & drawers (< 5px travel)
    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2();
    let downX = 0;
    let downY = 0;

    const findInteractiveMeta = (hitObj: THREE.Object3D | null): CabinetPartInteractionMeta | null => {
      let cur: THREE.Object3D | null = hitObj;
      while (cur) {
        if (cur.userData?.cabinetInteract) {
          return cur.userData.cabinetInteract as CabinetPartInteractionMeta;
        }
        cur = cur.parent;
      }
      return null;
    };

    const handlePointerMove = (e: PointerEvent) => {
      const meshes = interactableMeshesRef.current;
      if (meshes.length === 0) {
        renderer.domElement.style.cursor = '';
        return;
      }
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointerNdc, camera);
      const hits = raycaster.intersectObjects(meshes, true);
      renderer.domElement.style.cursor =
        hits.length > 0 && findInteractiveMeta(hits[0].object) ? 'pointer' : '';
    };

    const handlePointerDown = (e: PointerEvent) => {
      downX = e.clientX;
      downY = e.clientY;
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const dist = Math.hypot(e.clientX - downX, e.clientY - downY);
      if (dist > 5) return;
      const meshes = interactableMeshesRef.current;
      if (meshes.length === 0) return;
      const rect = renderer.domElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointerNdc, camera);
      const hits = raycaster.intersectObjects(meshes, true);
      if (hits.length === 0) return;
      const meta = findInteractiveMeta(hits[0].object);
      if (!meta) return;

      const partKey = getCabinetPartKey(meta.elementId, meta.partId);
      setOpenPartsMap((prev) => {
        const nextOpen = !prev[partKey];
        setLastInteractedLabel(`${meta.label}${nextOpen ? '已開啟' : '已關閉'}`);
        return {
          ...prev,
          [partKey]: nextOpen,
        };
      });
      requestRender();
    };

    renderer.domElement.addEventListener('pointermove', handlePointerMove);
    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    renderer.domElement.addEventListener('pointerup', handlePointerUp);

    const resizeObserver = new ResizeObserver(() => {
      const nextW = Math.max(240, container.clientWidth);
      const nextH = Math.max(200, container.clientHeight);
      camera.aspect = nextW / nextH;
      camera.updateProjectionMatrix();
      renderer.setSize(nextW, nextH);
      requestRender();
    });
    resizeObserver.observe(container);

    requestRender();

    return () => {
      if (animFrameId !== null) cancelAnimationFrame(animFrameId);
      resizeObserver.disconnect();
      controls.removeEventListener('change', requestRender);
      renderer.domElement.removeEventListener('pointermove', handlePointerMove);
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.removeEventListener('pointerup', handlePointerUp);
      controls.dispose();
      disposeObjectSubtree(scene);
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      cabinetRootRef.current = null;
      partsRef.current = [];
      interactableMeshesRef.current = [];
    };
  }, []);

  // Rebuild cabinet geometry when design parameters change
  useEffect(() => {
    const root = cabinetRootRef.current;
    if (!root) return;

    while (root.children.length > 0) {
      const child = root.children[0];
      root.remove(child);
      disposeObjectSubtree(child);
    }

    const cleanHex = sanitizeHexColor(color);
    const defaultHex =
      baseKind === 'kitchen_counter'
        ? '#f5efe6'
        : baseKind === 'wall_cabinet'
          ? '#ffedd5'
          : '#d9b382';
    const bodyColor = new THREE.Color(cleanHex ?? defaultHex);
    const interiorColor = bodyColor.clone().lerp(new THREE.Color('#ffffff'), 0.25);
    const doorColor = bodyColor.clone().lerp(new THREE.Color('#ffffff'), 0.08);
    const plinthColor = bodyColor.clone().multiplyScalar(0.58);

    const bodyMat = new THREE.MeshStandardMaterial({
      color: bodyColor,
      roughness: 0.68,
      metalness: 0.04,
      wireframe: showWireframe,
    });
    const interiorMat = new THREE.MeshStandardMaterial({
      color: interiorColor,
      roughness: 0.72,
      metalness: 0.03,
      wireframe: showWireframe,
    });
    const doorMat = new THREE.MeshStandardMaterial({
      color: doorColor,
      roughness: 0.56,
      metalness: 0.05,
      wireframe: showWireframe,
    });
    const plinthMat = new THREE.MeshStandardMaterial({
      color: plinthColor,
      roughness: 0.85,
      metalness: 0.04,
      wireframe: showWireframe,
    });
    const metalMat = new THREE.MeshStandardMaterial({
      color: '#cbd5e1',
      roughness: 0.28,
      metalness: 0.78,
      wireframe: showWireframe,
    });
    const countertopMat = new THREE.MeshStandardMaterial({
      color: cleanHex ? bodyColor.clone().lerp(new THREE.Color('#f8fafc'), 0.55) : '#e2e8f0',
      roughness: 0.36,
      metalness: 0.06,
      wireframe: showWireframe,
    });
    const waterMat = new THREE.MeshStandardMaterial({
      color: '#38bdf8',
      roughness: 0.12,
      metalness: 0.1,
      transparent: true,
      opacity: 0.48,
      wireframe: showWireframe,
    });
    const edgeLineMat = new THREE.LineBasicMaterial({
      color: '#334155',
      transparent: true,
      opacity: 0.32,
    });

    const built = buildInteractiveCabinetMesh({
      elementId: PREVIEW_ELEMENT_ID,
      elementName: name || ELEMENT_KIND_DEFAULTS[baseKind].label,
      baseKind,
      widthCm,
      depthCm,
      heightCm,
      spec: normalizedSpec,
      materials: {
        bodyMat,
        interiorMat,
        doorMat,
        plinthMat,
        metalMat,
        countertopMat,
        waterMat,
        edgeLineMat,
      },
      showWireframe,
      includeCooktopIfKitchenDefault: false,
      castShadow: true,
      receiveShadow: true,
      openPartsMap: openPartsMapRef.current,
    });

    root.add(built.group);
    partsRef.current = built.parts;
    interactableMeshesRef.current = built.interactableMeshes;

    // Prune stale open state keys cleanly while keeping existing door/drawer open states intact
    const validKeys = new Set(built.parts.map((p) => p.key));
    setOpenPartsMap((prev) => {
      const next: Record<string, boolean> = {};
      let changed = false;
      for (const [k, v] of Object.entries(prev)) {
        if (validKeys.has(k)) {
          next[k] = v;
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });

    if (autoFrameNeededRef.current && cameraRef.current && controlsRef.current) {
      autoFrameNeededRef.current = false;
      const wM = Math.max(0.2, widthCm * 0.01);
      const dM = Math.max(0.15, depthCm * 0.01);
      const hM = Math.max(0.2, heightCm * 0.01);
      const maxDim = Math.max(wM, dM, hM, 0.8);
      controlsRef.current.target.set(0, hM * 0.5, 0);
      cameraRef.current.position.set(
        maxDim * 0.85,
        Math.max(hM * 0.72, 0.55) + maxDim * 0.25,
        maxDim * 1.45
      );
      controlsRef.current.update();
    }

    requestRenderRef.current();
  }, [name, baseKind, widthCm, depthCm, heightCm, color, normalizedSpec, showWireframe]);

  // Trigger animation whenever openPartsMap updates
  useEffect(() => {
    requestRenderRef.current();
  }, [openPartsMap]);

  const handleOpenAll = () => {
    const next: Record<string, boolean> = {};
    for (const part of partsRef.current) {
      next[part.key] = true;
    }
    setOpenPartsMap(next);
    setLastInteractedLabel(partsRef.current.length > 0 ? '已全部開啟門扇與抽屜' : null);
  };

  const handleCloseAll = () => {
    setOpenPartsMap({});
    setLastInteractedLabel(partsRef.current.length > 0 ? '已全部關閉' : null);
  };

  const handleResetCamera = () => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    const wM = Math.max(0.2, widthCm * 0.01);
    const dM = Math.max(0.15, depthCm * 0.01);
    const hM = Math.max(0.2, heightCm * 0.01);
    const maxDim = Math.max(wM, dM, hM, 0.8);
    controls.target.set(0, hM * 0.5, 0);
    camera.position.set(
      maxDim * 0.85,
      Math.max(hM * 0.72, 0.55) + maxDim * 0.25,
      maxDim * 1.45
    );
    controls.update();
    requestRenderRef.current();
  };

  const hasInteractableParts =
    normalizedSpec.doorMode !== 'none' || normalizedSpec.drawerCount > 0;

  return (
    <div
      ref={containerRef}
      data-testid="cabinet-preview-3d"
      data-open-parts={openPartsList.join(',')}
      className="relative w-full h-full min-h-[300px] bg-[#eef2f6] select-none overflow-hidden"
    >
      {/* Top-Left Preview Caption */}
      <div className="pointer-events-none absolute top-3 left-3 z-10 flex flex-col gap-1">
        <div className="pointer-events-auto inline-flex items-center gap-2 bg-white/95 border border-slate-200 rounded-md px-2.5 py-1.5 text-xs text-slate-700 shadow-xs">
          <span className="font-semibold text-slate-900 truncate max-w-[180px]">
            {name || '自訂櫃體預覽'}
          </span>
          <span className="text-slate-300">|</span>
          <span className="font-mono tabular-nums text-[11px] text-slate-600">
            {Math.round(widthCm)}×{Math.round(depthCm)}×{Math.round(heightCm)} cm
          </span>
        </div>
        {lastInteractedLabel && (
          <div
            data-testid="cabinet-preview-status"
            className="inline-flex items-center gap-1.5 bg-slate-900/90 text-white rounded-md px-2.5 py-1 text-[11px] font-medium shadow-xs w-fit"
          >
            <DoorOpen className="w-3 h-3 text-emerald-300 shrink-0" />
            <span>{lastInteractedLabel}</span>
          </div>
        )}
      </div>

      {/* Top-Right Studio Controls */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-1.5 flex-wrap justify-end">
        {hasInteractableParts && (
          <>
            <button
              type="button"
              onClick={handleOpenAll}
              className="px-2.5 py-1.5 rounded-md text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 shadow-xs transition-colors whitespace-nowrap shrink-0"
            >
              全部開啟
            </button>
            <button
              type="button"
              onClick={handleCloseAll}
              className="px-2.5 py-1.5 rounded-md text-xs font-medium bg-white/95 text-slate-700 border border-slate-200 hover:bg-slate-50 shadow-xs transition-colors whitespace-nowrap shrink-0"
            >
              全部關閉
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => setShowWireframe((v) => !v)}
          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium border shadow-xs transition-colors whitespace-nowrap shrink-0 ${
            showWireframe
              ? 'bg-blue-600 text-white border-blue-600'
              : 'bg-white/95 text-slate-700 border-slate-200 hover:bg-slate-50'
          }`}
        >
          <Eye className="w-3.5 h-3.5" />
          <span>線框</span>
        </button>
        <button
          type="button"
          onClick={handleResetCamera}
          aria-label="重設 3D 預覽視角"
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium bg-white/95 text-slate-700 border border-slate-200 hover:bg-slate-50 shadow-xs transition-colors whitespace-nowrap shrink-0"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>重設視角</span>
        </button>
      </div>

      {/* Bottom Hint */}
      <div className="pointer-events-none absolute bottom-3 left-3 z-10 bg-white/90 border border-slate-200 rounded-md px-2.5 py-1 text-[11px] text-slate-600">
        左鍵拖曳旋轉 · 滾輪縮放 ·{' '}
        <span className="font-semibold text-slate-900">直接點擊門片或抽屜即可開關測試</span>
      </div>
    </div>
  );
};
