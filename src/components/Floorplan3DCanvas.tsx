import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  Box,
  ChevronDown,
  ChevronUp,
  Compass,
  DoorOpen,
  Eye,
  Footprints,
  Layers,
  Ruler,
  Sun,
} from 'lucide-react';
import type {
  CameraPreset,
  FloorplanProject,
  SolvedElementPlacement,
  SolvedFloorplan,
} from '../types/floorplan';
import {
  applyCabinetPartProgress,
  applyCurtainOpenProgress,
  applyDoorOpenProgress,
  applyRoomCeilingVisibility,
  buildRoomSceneGroup,
  CM_TO_M,
  createWoodFloorTexture,
  detectSoftwareGl,
  disposeGroupContents,
  type RoomSceneHandles,
} from '../utils/threeSceneBuilder';
import {
  getCabinetPartKey,
  type CabinetPartInteractionMeta,
} from '../utils/cabinet3DBuilder';
import { isCabinetElementKind } from '../utils/cabinetDesigner';
import {
  buildFirstPersonColliders,
  computeFirstPersonSpawn,
  DEFAULT_FP_TURN_SPEED_RAD_S,
  findNearestSpaceInteractable,
  getForward2DFromYaw,
  resolveCircleColliders,
  stepFirstPersonMovement,
  type SpaceInteractableTarget,
  type WallColliderRect,
} from '../utils/firstPersonNavigation';

export interface Floorplan3DHandle {
  capturePngDataUrl: () => string | null;
}

interface Floorplan3DCanvasProps {
  project: FloorplanProject;
  solved: SolvedFloorplan;
  placements: SolvedElementPlacement[];
  selectedEdgeId: string | null;
  selectedElementId: string | null;
  showDimensions3D?: boolean;
  onToggleDimensions3D?: (next: boolean) => void;
}

const _targetCamPos = new THREE.Vector3();
const _targetControlsTarget = new THREE.Vector3();

const FP_MOVEMENT_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'KeyQ',
  'KeyE',
]);

export const Floorplan3DCanvas = React.forwardRef<Floorplan3DHandle, Floorplan3DCanvasProps>(
  function Floorplan3DCanvas(
    {
      project,
      solved,
      placements,
      selectedEdgeId,
      selectedElementId,
      showDimensions3D,
      onToggleDimensions3D,
    },
    ref
  ) {
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const mountRef = useRef<HTMLDivElement | null>(null);
    const [wallTransparent, setWallTransparent] = useState(false);
    const [showCeiling, setShowCeiling] = useState(false);
    const [showWireframe, setShowWireframe] = useState(true);
    const [enableLightingRender, setEnableLightingRender] = useState(true);
    const [localShowDimensions, setLocalShowDimensions] = useState(true);
    const showDimensions =
      showDimensions3D !== undefined ? showDimensions3D : localShowDimensions;

    const handleToggleDimensions = useCallback(() => {
      const next = !showDimensions;
      if (onToggleDimensions3D) {
        onToggleDimensions3D(next);
      } else {
        setLocalShowDimensions(next);
      }
    }, [showDimensions, onToggleDimensions3D]);

    const [activePreset, setActivePreset] = useState<CameraPreset>('iso');
    const [dockCollapsed, setDockCollapsed] = useState(false);
    const [webglError, setWebglError] = useState<string | null>(null);
    const [nearestInteractable, setNearestInteractable] =
      useState<SpaceInteractableTarget | null>(null);
    const [openIdsList, setOpenIdsList] = useState<string[]>([]);
    const [openCabinetPartsList, setOpenCabinetPartsList] = useState<string[]>([]);
    const [interactionStatus, setInteractionStatus] = useState<string | null>(null);

    const sceneRef = useRef<THREE.Scene | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const controlsRef = useRef<OrbitControls | null>(null);
    const roomGroupRef = useRef<THREE.Group | null>(null);
    const floorTexRef = useRef<THREE.CanvasTexture | null>(null);
    const hemiLightRef = useRef<THREE.HemisphereLight | null>(null);
    const keyLightRef = useRef<THREE.DirectionalLight | null>(null);
    const rimLightRef = useRef<THREE.DirectionalLight | null>(null);

    const isSoftwareGlRef = useRef<boolean>(false);
    const requestRenderRef = useRef<() => void>(() => {});
    const transitionActiveRef = useRef<boolean>(false);
    const activePresetRef = useRef<CameraPreset>('iso');
    const showCeilingRef = useRef<boolean>(false);
    const enableLightingRenderRef = useRef<boolean>(true);
    const boundsRef = useRef({ centerX: 0, centerZ: 0, maxSpan: 8, ceilingM: 2.5 });

    const sceneHandlesRef = useRef<RoomSceneHandles>({
      doors: [],
      curtains: [],
      cabinetParts: [],
      interactableMeshes: [],
      activeDynamicLightCount: 0,
      hasAnyLightFixture: false,
    });
    const doorOpenMapRef = useRef<Record<string, boolean>>({});
    const cabinetPartOpenMapRef = useRef<Record<string, boolean>>({});
    const interactionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const collidersRef = useRef<WallColliderRect[]>([]);
    const keysHeldRef = useRef<Set<string>>(new Set());
    const fpStateRef = useRef({
      active: false,
      xCm: 0,
      yCm: 0,
      eyeHeightCm: 160,
      yawRad: 0,
      pitchRad: 0,
    });

    const placementsRef = useRef(placements);
    const solvedRef = useRef(solved);
    const wallThicknessRef = useRef(project.wallThicknessCm);
    const ceilingHeightCmRef = useRef(project.ceilingHeightCm);
    const selectedElementIdRef = useRef(selectedElementId);

    placementsRef.current = placements;
    solvedRef.current = solved;
    wallThicknessRef.current = project.wallThicknessCm;
    ceilingHeightCmRef.current = project.ceilingHeightCm;
    selectedElementIdRef.current = selectedElementId;
    showCeilingRef.current = showCeiling;
    enableLightingRenderRef.current = enableLightingRender;

    useEffect(() => {
      const cx = solved.bounds.centerX * CM_TO_M;
      const cz = solved.bounds.centerY * CM_TO_M;
      const span = Math.max(solved.bounds.widthCm, solved.bounds.heightCm, 250) * CM_TO_M;
      const ceil = Math.max(1.5, project.ceilingHeightCm * CM_TO_M);
      boundsRef.current = { centerX: cx, centerZ: cz, maxSpan: span, ceilingM: ceil };
    }, [solved.bounds, project.ceilingHeightCm]);

    const syncFpDomAttributes = useCallback(() => {
      const el = viewportRef.current;
      if (!el) return;
      const fp = fpStateRef.current;
      el.setAttribute('data-fp-active', fp.active ? 'true' : 'false');
      el.setAttribute('data-fp-x', String(Math.round(fp.xCm * 10) / 10));
      el.setAttribute('data-fp-z', String(Math.round(fp.yCm * 10) / 10));
      el.setAttribute('data-fp-eye', String(Math.round(fp.eyeHeightCm * 10) / 10));
      el.setAttribute('data-fp-yaw', String(Math.round(fp.yawRad * 1000) / 1000));
    }, []);

    const refreshNearestInteractable = useCallback(() => {
      if (!fpStateRef.current.active) {
        setNearestInteractable((prev) => (prev === null ? prev : null));
        return;
      }
      const fwd = getForward2DFromYaw(fpStateRef.current.yawRad);
      const next = findNearestSpaceInteractable(
        fpStateRef.current.xCm,
        fpStateRef.current.yCm,
        fwd.x,
        fwd.y,
        placementsRef.current,
        240
      );
      setNearestInteractable((prev) => {
        if (!prev && !next) return prev;
        if (
          prev &&
          next &&
          prev.id === next.id &&
          prev.name === next.name &&
          prev.kind === next.kind
        ) {
          return prev;
        }
        return next;
      });
    }, []);

    const applyStudioLighting = useCallback(() => {
      const renderer = rendererRef.current;
      const scene = sceneRef.current;
      const hemi = hemiLightRef.current;
      const key = keyLightRef.current;
      const rim = rimLightRef.current;
      if (!renderer || !scene || !hemi || !key || !rim) return;

      const isSw = isSoftwareGlRef.current;
      const lightingOn = enableLightingRenderRef.current;
      const hasFixtures = sceneHandlesRef.current.hasAnyLightFixture;
      const inFp = activePresetRef.current === 'firstPerson';

      renderer.shadowMap.enabled = !isSw && lightingOn;
      key.castShadow = !isSw && lightingOn;

      if (lightingOn && hasFixtures) {
        hemi.intensity = inFp ? 0.22 : 0.38;
        key.intensity = inFp ? 0.35 : 0.72;
        rim.intensity = 0.2;
        scene.environmentIntensity = inFp ? 0.28 : 0.45;
        renderer.toneMappingExposure = 1.08;
      } else if (lightingOn) {
        hemi.intensity = 0.78;
        key.intensity = 1.5;
        rim.intensity = 0.5;
        scene.environmentIntensity = 0.85;
        renderer.toneMappingExposure = 1.06;
      } else {
        hemi.intensity = 1.15;
        key.intensity = 1.35;
        rim.intensity = 0.65;
        scene.environmentIntensity = 1.05;
        renderer.toneMappingExposure = 1.04;
      }
    }, []);

    const announceInteraction = useCallback((label: string) => {
      if (interactionTimerRef.current) {
        clearTimeout(interactionTimerRef.current);
      }
      setInteractionStatus(label);
      interactionTimerRef.current = setTimeout(() => {
        setInteractionStatus(null);
        interactionTimerRef.current = null;
      }, 2000);
    }, []);

    const syncOpenCabinetPartsList = useCallback(() => {
      setOpenCabinetPartsList(
        Object.keys(cabinetPartOpenMapRef.current).filter(
          (k) => cabinetPartOpenMapRef.current[k]
        )
      );
    }, []);

    const toggleCabinetPartByKey = useCallback(
      (elementId: string, partId: string, label?: string) => {
        const key = getCabinetPartKey(elementId, partId);
        const nextOpen = !cabinetPartOpenMapRef.current[key];
        cabinetPartOpenMapRef.current[key] = nextOpen;
        syncOpenCabinetPartsList();
        if (label) {
          announceInteraction(`${label}（${nextOpen ? '已開啟' : '已關閉'}）`);
        }
        requestRenderRef.current();
        return nextOpen;
      },
      [announceInteraction, syncOpenCabinetPartsList]
    );

    const toggleWholeCabinetParts = useCallback(
      (elementId: string, elementName?: string) => {
        const parts = sceneHandlesRef.current.cabinetParts.filter(
          (p) => p.elementId === elementId
        );
        if (parts.length === 0) return false;
        const anyOpen = parts.some((p) => cabinetPartOpenMapRef.current[p.key]);
        const nextOpen = !anyOpen;
        for (const p of parts) {
          cabinetPartOpenMapRef.current[p.key] = nextOpen;
        }
        syncOpenCabinetPartsList();
        if (elementName) {
          announceInteraction(
            `${elementName} 門片與抽屜（${nextOpen ? '全部開啟' : '全部關閉'}）`
          );
        }
        requestRenderRef.current();
        return true;
      },
      [announceInteraction, syncOpenCabinetPartsList]
    );

    const toggleNearestInteractable = useCallback(
      (explicitId?: string) => {
        let targetId = explicitId;
        if (!targetId) {
          if (fpStateRef.current.active) {
            const fwd = getForward2DFromYaw(fpStateRef.current.yawRad);
            const target = findNearestSpaceInteractable(
              fpStateRef.current.xCm,
              fpStateRef.current.yCm,
              fwd.x,
              fwd.y,
              placementsRef.current,
              240
            );
            targetId = target?.id;
          } else {
            const sel = selectedElementIdRef.current
              ? placementsRef.current.find((p) => p.element.id === selectedElementIdRef.current)
              : null;
            if (
              sel &&
              (sel.element.kind === 'door' ||
                sel.element.kind === 'bed_curtain' ||
                isCabinetElementKind(sel.element.kind))
            ) {
              targetId = sel.element.id;
            } else {
              const t = controlsRef.current?.target;
              const tx = t ? t.x / CM_TO_M : solvedRef.current.bounds.centerX;
              const ty = t ? t.z / CM_TO_M : solvedRef.current.bounds.centerY;
              const target = findNearestSpaceInteractable(
                tx,
                ty,
                0,
                -1,
                placementsRef.current,
                3000
              );
              targetId = target?.id;
            }
          }
        }
        if (!targetId) return false;

        const targetPlacement = placementsRef.current.find((p) => p.element.id === targetId);
        if (targetPlacement && isCabinetElementKind(targetPlacement.element.kind)) {
          return toggleWholeCabinetParts(targetId, targetPlacement.element.name);
        }

        const nextOpen = !doorOpenMapRef.current[targetId];
        doorOpenMapRef.current[targetId] = nextOpen;

        collidersRef.current = buildFirstPersonColliders(
          solvedRef.current,
          placementsRef.current,
          wallThicknessRef.current,
          doorOpenMapRef.current
        );
        setOpenIdsList(
          Object.keys(doorOpenMapRef.current).filter((id) => doorOpenMapRef.current[id])
        );
        if (targetPlacement) {
          announceInteraction(`${targetPlacement.element.name}（${nextOpen ? '已開啟' : '已關閉'}）`);
        }
        requestRenderRef.current();
        return true;
      },
      [announceInteraction, toggleWholeCabinetParts]
    );

    const applyCameraPreset = useCallback(
      (preset: CameraPreset, immediate = false) => {
        const { centerX, centerZ, maxSpan, ceilingM } = boundsRef.current;
        const mount = mountRef.current;
        const aspect =
          mount && mount.clientHeight > 0 ? mount.clientWidth / mount.clientHeight : 1.4;
        const aspectScale = aspect < 1.1 ? 1.15 / Math.max(0.65, aspect) : 1.0;

        if (preset === 'firstPerson') {
          collidersRef.current = buildFirstPersonColliders(
            solvedRef.current,
            placementsRef.current,
            wallThicknessRef.current,
            doorOpenMapRef.current
          );
          const spawn = computeFirstPersonSpawn(
            solvedRef.current,
            collidersRef.current,
            ceilingHeightCmRef.current,
            placementsRef.current
          );
          fpStateRef.current = {
            active: true,
            xCm: spawn.xCm,
            yCm: spawn.yCm,
            eyeHeightCm: spawn.eyeHeightCm,
            yawRad: spawn.yawRad,
            pitchRad: 0,
          };
          keysHeldRef.current.clear();
          transitionActiveRef.current = false;
          activePresetRef.current = 'firstPerson';
          setActivePreset('firstPerson');

          if (controlsRef.current) {
            controlsRef.current.enabled = false;
          }
          if (cameraRef.current) {
            cameraRef.current.rotation.order = 'YXZ';
            cameraRef.current.position.set(
              spawn.xCm * CM_TO_M,
              spawn.eyeHeightCm * CM_TO_M,
              spawn.yCm * CM_TO_M
            );
            cameraRef.current.rotation.set(0, spawn.yawRad, 0, 'YXZ');
          }
          syncFpDomAttributes();
          refreshNearestInteractable();
          applyStudioLighting();
          applyRoomCeilingVisibility(
            sceneHandlesRef.current,
            showCeilingRef.current,
            true,
            isSoftwareGlRef.current,
            enableLightingRenderRef.current
          );
          requestRenderRef.current();
          return;
        }

        const nextPreset: CameraPreset = preset === 'reset' ? 'iso' : preset;
        fpStateRef.current.active = false;
        keysHeldRef.current.clear();
        activePresetRef.current = nextPreset;
        setActivePreset(nextPreset);
        setNearestInteractable(null);

        if (cameraRef.current) {
          cameraRef.current.rotation.order = 'XYZ';
        }
        if (controlsRef.current) {
          controlsRef.current.enabled = true;
        }

        if (nextPreset === 'top') {
          _targetControlsTarget.set(centerX, 0, centerZ);
          _targetCamPos.set(centerX, maxSpan * 1.55 * aspectScale, centerZ + 0.08);
        } else if (nextPreset === 'interior') {
          _targetControlsTarget.set(centerX, ceilingM * 0.45, centerZ);
          _targetCamPos.set(
            centerX - maxSpan * 0.22,
            Math.min(1.65, ceilingM * 0.68),
            centerZ + maxSpan * 0.25
          );
        } else {
          _targetControlsTarget.set(centerX, ceilingM * 0.3, centerZ);
          _targetCamPos.set(
            centerX + maxSpan * 0.92 * aspectScale,
            Math.max(6.2, maxSpan * 0.88 * aspectScale),
            centerZ + maxSpan * 1.02 * aspectScale
          );
        }

        syncFpDomAttributes();
        applyStudioLighting();
        applyRoomCeilingVisibility(
          sceneHandlesRef.current,
          showCeilingRef.current,
          false,
          isSoftwareGlRef.current,
          enableLightingRenderRef.current
        );

        if (immediate && cameraRef.current && controlsRef.current) {
          cameraRef.current.position.copy(_targetCamPos);
          controlsRef.current.target.copy(_targetControlsTarget);
          controlsRef.current.update();
          transitionActiveRef.current = false;
          requestRenderRef.current();
        } else {
          transitionActiveRef.current = true;
          requestRenderRef.current();
        }
      },
      [applyStudioLighting, refreshNearestInteractable, syncFpDomAttributes]
    );

    useImperativeHandle(
      ref,
      () => ({
        capturePngDataUrl: () => {
          const renderer = rendererRef.current;
          const scene = sceneRef.current;
          const camera = cameraRef.current;
          if (!renderer || !scene || !camera) return null;
          if (!fpStateRef.current.active) {
            controlsRef.current?.update();
          }
          renderer.render(scene, camera);
          return renderer.domElement.toDataURL('image/png');
        },
      }),
      []
    );

    useEffect(() => {
      const mount = mountRef.current;
      if (!mount) return;

      const isSoftwareGl = detectSoftwareGl();
      isSoftwareGlRef.current = isSoftwareGl;

      let renderer: THREE.WebGLRenderer;
      try {
        renderer = new THREE.WebGLRenderer({
          antialias: !isSoftwareGl,
          powerPreference: 'high-performance',
        });
      } catch {
        setWebglError('無法初始化 3D WebGL 檢視環境，請確認瀏覽器支援 WebGL。');
        return;
      }

      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.06;
      renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
      renderer.shadowMap.enabled = !isSoftwareGl && enableLightingRenderRef.current;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;

      const initW = Math.max(100, mount.clientWidth);
      const initH = Math.max(100, mount.clientHeight);
      renderer.setSize(initW, initH);
      mount.appendChild(renderer.domElement);
      rendererRef.current = renderer;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0xeff3f8);
      scene.fog = new THREE.Fog(0xeff3f8, 22, 65);
      sceneRef.current = scene;

      const pmremGenerator = new THREE.PMREMGenerator(renderer);
      scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
      pmremGenerator.dispose();

      const camera = new THREE.PerspectiveCamera(54, initW / initH, 0.05, 120);
      cameraRef.current = camera;

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = !isSoftwareGl;
      controls.dampingFactor = 0.07;
      controls.maxPolarAngle = Math.PI * 0.495;
      controls.minDistance = 0.8;
      controls.maxDistance = 45;
      controlsRef.current = controls;

      const onControlStart = () => {
        transitionActiveRef.current = false;
      };
      const onControlChange = () => {
        if (!fpStateRef.current.active) {
          requestRenderRef.current();
        }
      };
      controls.addEventListener('start', onControlStart);
      controls.addEventListener('change', onControlChange);

      const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0xcbd5e1, 0.82);
      scene.add(hemiLight);
      hemiLightRef.current = hemiLight;

      const keyLight = new THREE.DirectionalLight(0xfff7ed, 1.55);
      keyLight.position.set(10, 16, 12);
      if (!isSoftwareGl) {
        keyLight.castShadow = enableLightingRenderRef.current;
        keyLight.shadow.mapSize.set(1024, 1024);
        keyLight.shadow.camera.near = 1;
        keyLight.shadow.camera.far = 45;
        keyLight.shadow.camera.left = -10;
        keyLight.shadow.camera.right = 10;
        keyLight.shadow.camera.top = 10;
        keyLight.shadow.camera.bottom = -10;
        keyLight.shadow.bias = -0.0005;
        keyLight.shadow.normalBias = 0.02;
      }
      scene.add(keyLight);
      keyLightRef.current = keyLight;

      const rimLight = new THREE.DirectionalLight(0xe0f2fe, 0.55);
      rimLight.position.set(-10, 8, -10);
      scene.add(rimLight);
      rimLightRef.current = rimLight;

      const studioGroundGeo = new THREE.PlaneGeometry(80, 80);
      const studioGroundMat = new THREE.MeshStandardMaterial({
        color: 0xe6ecf3,
        roughness: 0.92,
        metalness: 0.0,
      });
      const studioGround = new THREE.Mesh(studioGroundGeo, studioGroundMat);
      studioGround.rotation.x = -Math.PI / 2;
      studioGround.position.y = -0.025;
      studioGround.receiveShadow = !isSoftwareGl;
      scene.add(studioGround);

      const gridHelper = new THREE.GridHelper(36, 36, 0xcbd5e1, 0xdbe4ee);
      gridHelper.position.y = -0.02;
      scene.add(gridHelper);

      const floorTex = createWoodFloorTexture(renderer.capabilities.getMaxAnisotropy());
      floorTexRef.current = floorTex;

      const roomGroup = new THREE.Group();
      scene.add(roomGroup);
      roomGroupRef.current = roomGroup;

      const raycaster = new THREE.Raycaster();
      const pointerNdc = new THREE.Vector2();
      let fpDragging = false;
      let lastPtrX = 0;
      let lastPtrY = 0;
      let downPtrX = 0;
      let downPtrY = 0;
      let pointerDownOnCanvas = false;

      const pickInteractableAtClient = (clientX: number, clientY: number) => {
        const meshes = sceneHandlesRef.current.interactableMeshes;
        if (!meshes || meshes.length === 0) return null;
        const rect = renderer.domElement.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return null;
        pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(pointerNdc, camera);
        const hits = raycaster.intersectObjects(meshes, false);
        return hits.length > 0 ? hits[0] : null;
      };

      const onPointerDown = (e: PointerEvent) => {
        if (e.button !== 0) return;
        pointerDownOnCanvas = true;
        downPtrX = e.clientX;
        downPtrY = e.clientY;
        if (!fpStateRef.current.active) return;
        fpDragging = true;
        lastPtrX = e.clientX;
        lastPtrY = e.clientY;
        viewportRef.current?.focus({ preventScroll: true });
      };
      const onPointerMove = (e: PointerEvent) => {
        if (fpDragging && fpStateRef.current.active) {
          const dx = e.clientX - lastPtrX;
          const dy = e.clientY - lastPtrY;
          lastPtrX = e.clientX;
          lastPtrY = e.clientY;
          fpStateRef.current.yawRad -= dx * 0.0045;
          fpStateRef.current.pitchRad = Math.max(
            -1.22,
            Math.min(1.22, fpStateRef.current.pitchRad - dy * 0.004)
          );
          camera.rotation.order = 'YXZ';
          camera.rotation.set(fpStateRef.current.pitchRad, fpStateRef.current.yawRad, 0, 'YXZ');
          syncFpDomAttributes();
          refreshNearestInteractable();
          requestRenderRef.current();
          return;
        }
        if (!fpStateRef.current.active && e.buttons === 0 && e.target === renderer.domElement) {
          const hit = pickInteractableAtClient(e.clientX, e.clientY);
          renderer.domElement.style.cursor = hit ? 'pointer' : '';
        }
      };
      const onPointerUp = (e: PointerEvent) => {
        const wasFpDragging = fpDragging;
        fpDragging = false;
        const wasCanvasDown = pointerDownOnCanvas;
        pointerDownOnCanvas = false;
        if (!wasCanvasDown || e.button !== 0) return;

        const travel = Math.hypot(e.clientX - downPtrX, e.clientY - downPtrY);
        if (travel >= 5) return;
        if (wasFpDragging && e.target !== renderer.domElement) return;

        const hit = pickInteractableAtClient(e.clientX, e.clientY);
        if (!hit) return;

        const cabMeta = hit.object.userData?.cabinetInteract as
          | CabinetPartInteractionMeta
          | undefined;
        if (cabMeta) {
          toggleCabinetPartByKey(cabMeta.elementId, cabMeta.partId, cabMeta.label);
          return;
        }

        const spaceElId = hit.object.userData?.spaceInteractElementId as string | undefined;
        if (spaceElId) {
          toggleNearestInteractable(spaceElId);
        }
      };

      renderer.domElement.addEventListener('pointerdown', onPointerDown);
      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);

      const onContextLost = (e: Event) => {
        e.preventDefault();
        setWebglError('3D 繪圖環境暫時中斷，正在嘗試恢復...');
      };
      const onContextRestored = () => {
        setWebglError(null);
        requestRenderRef.current();
      };
      renderer.domElement.addEventListener('webglcontextlost', onContextLost);
      renderer.domElement.addEventListener('webglcontextrestored', onContextRestored);

      let frameId = 0;
      let renderBusy = false;
      let renderDirty = false;
      let disposed = false;
      let lastTime = performance.now();

      function afterDraw(cb: () => void) {
        const gl = renderer.getContext() as WebGL2RenderingContext;
        const sync = gl.fenceSync ? gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) : null;
        gl.flush();
        if (!sync) {
          frameId = window.setTimeout(cb, 80);
          return;
        }
        const poll = () => {
          if (disposed) return;
          const state = gl.getSyncParameter(sync, gl.SYNC_STATUS);
          if (state === gl.UNSIGNALED) {
            frameId = window.setTimeout(poll, 5);
          } else {
            gl.deleteSync(sync);
            frameId = window.setTimeout(cb, 80);
          }
        };
        frameId = window.setTimeout(poll, 5);
      }

      function requestRender() {
        if (disposed) return;
        if (renderBusy) {
          renderDirty = true;
          return;
        }
        renderBusy = true;
        frameId = requestAnimationFrame((now) => {
          if (disposed) return;
          const rawDt = Math.max(0.001, (now - lastTime) * 0.001);
          const dt = Math.min(0.05, rawDt);
          const fpDt = Math.min(0.12, rawDt);
          lastTime = now;
          renderDirty = false;

          if (fpStateRef.current.active) {
            const keys = keysHeldRef.current;
            const fwdIn =
              (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) -
              (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
            const turnIn =
              (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) -
              (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0);
            const rightIn = (keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0);

            if (turnIn !== 0) {
              fpStateRef.current.yawRad += turnIn * DEFAULT_FP_TURN_SPEED_RAD_S * fpDt;
              renderDirty = true;
            }
            if (fwdIn !== 0 || rightIn !== 0) {
              const nextPos = stepFirstPersonMovement({
                xCm: fpStateRef.current.xCm,
                yCm: fpStateRef.current.yCm,
                yawRad: fpStateRef.current.yawRad,
                forwardInput: fwdIn,
                rightInput: rightIn,
                dtSec: fpDt,
                colliders: collidersRef.current,
              });
              fpStateRef.current.xCm = nextPos.x;
              fpStateRef.current.yCm = nextPos.y;
              renderDirty = true;
            }

            camera.position.set(
              fpStateRef.current.xCm * CM_TO_M,
              fpStateRef.current.eyeHeightCm * CM_TO_M,
              fpStateRef.current.yCm * CM_TO_M
            );
            camera.rotation.order = 'YXZ';
            camera.rotation.set(
              fpStateRef.current.pitchRad,
              fpStateRef.current.yawRad,
              0,
              'YXZ'
            );

            if (fwdIn !== 0 || rightIn !== 0 || turnIn !== 0) {
              syncFpDomAttributes();
              refreshNearestInteractable();
            }
          } else if (transitionActiveRef.current) {
            const lambda = isSoftwareGl ? 18 : 8;
            camera.position.x = THREE.MathUtils.damp(
              camera.position.x,
              _targetCamPos.x,
              lambda,
              dt
            );
            camera.position.y = THREE.MathUtils.damp(
              camera.position.y,
              _targetCamPos.y,
              lambda,
              dt
            );
            camera.position.z = THREE.MathUtils.damp(
              camera.position.z,
              _targetCamPos.z,
              lambda,
              dt
            );
            controls.target.x = THREE.MathUtils.damp(
              controls.target.x,
              _targetControlsTarget.x,
              lambda,
              dt
            );
            controls.target.y = THREE.MathUtils.damp(
              controls.target.y,
              _targetControlsTarget.y,
              lambda,
              dt
            );
            controls.target.z = THREE.MathUtils.damp(
              controls.target.z,
              _targetControlsTarget.z,
              lambda,
              dt
            );

            const distPos = camera.position.distanceTo(_targetCamPos);
            const distTarget = controls.target.distanceTo(_targetControlsTarget);
            if (distPos < 0.02 && distTarget < 0.02) {
              camera.position.copy(_targetCamPos);
              controls.target.copy(_targetControlsTarget);
              transitionActiveRef.current = false;
            } else {
              renderDirty = true;
            }
          }

          const interactLambda = isSoftwareGl ? 18 : 10;
          for (const dh of sceneHandlesRef.current.doors) {
            const target = doorOpenMapRef.current[dh.elementId] ? 1 : 0;
            if (Math.abs(dh.currentProgress - target) > 0.004) {
              const nextP = THREE.MathUtils.damp(dh.currentProgress, target, interactLambda, dt);
              applyDoorOpenProgress(dh, Math.abs(nextP - target) <= 0.004 ? target : nextP);
              renderDirty = true;
            }
          }
          for (const ch of sceneHandlesRef.current.curtains) {
            const target = doorOpenMapRef.current[ch.elementId] ? 1 : 0;
            if (Math.abs(ch.currentProgress - target) > 0.004) {
              const nextP = THREE.MathUtils.damp(ch.currentProgress, target, interactLambda, dt);
              applyCurtainOpenProgress(ch, Math.abs(nextP - target) <= 0.004 ? target : nextP);
              renderDirty = true;
            }
          }
          for (const cp of sceneHandlesRef.current.cabinetParts) {
            const target = cabinetPartOpenMapRef.current[cp.key] ? 1 : 0;
            if (Math.abs(cp.currentProgress - target) > 0.004) {
              const nextP = THREE.MathUtils.damp(cp.currentProgress, target, interactLambda, dt);
              applyCabinetPartProgress(cp, Math.abs(nextP - target) <= 0.004 ? target : nextP);
              renderDirty = true;
            }
          }

          if (!fpStateRef.current.active) {
            controls.update();
          }
          renderer.render(scene, camera);

          const done = () => {
            renderBusy = false;
            if (renderDirty && !disposed) {
              requestRender();
            }
          };
          if (isSoftwareGl) afterDraw(done);
          else done();
        });
      }
      requestRenderRef.current = requestRender;

      applyCameraPreset('iso', true);

      if (!isSoftwareGl) {
        renderer.compile(scene, camera);
      }

      const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const w = Math.max(100, entry.contentRect.width);
          const h = Math.max(100, entry.contentRect.height);
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          renderer.setSize(w, h);
          requestRender();
        }
      });
      resizeObserver.observe(mount);

      return () => {
        disposed = true;
        cancelAnimationFrame(frameId);
        clearTimeout(frameId);
        if (interactionTimerRef.current) {
          clearTimeout(interactionTimerRef.current);
          interactionTimerRef.current = null;
        }
        resizeObserver.disconnect();
        controls.removeEventListener('start', onControlStart);
        controls.removeEventListener('change', onControlChange);
        controls.dispose();
        renderer.domElement.removeEventListener('pointerdown', onPointerDown);
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
        renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
        renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored);

        disposeGroupContents(roomGroup, floorTex);
        studioGroundGeo.dispose();
        studioGroundMat.dispose();
        floorTex.dispose();
        if (scene.environment) scene.environment.dispose();
        renderer.dispose();
        if (renderer.domElement.parentNode === mount) {
          mount.removeChild(renderer.domElement);
        }
      };
    }, [
      applyCameraPreset,
      refreshNearestInteractable,
      syncFpDomAttributes,
      toggleCabinetPartByKey,
      toggleNearestInteractable,
    ]);

    useEffect(() => {
      const onKeyDown = (e: KeyboardEvent) => {
        const targetEl = e.target as HTMLElement | null;
        const tag = targetEl?.tagName.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select' || targetEl?.isContentEditable) {
          return;
        }
        const mount = mountRef.current;
        if (!mount || mount.clientWidth <= 0 || mount.clientHeight <= 0) {
          return;
        }

        if (e.code === 'Space') {
          const isExternalButton =
            (tag === 'button' || tag === 'a') &&
            targetEl !== null &&
            !viewportRef.current?.contains(targetEl);
          if (!isExternalButton || fpStateRef.current.active) {
            e.preventDefault();
            toggleNearestInteractable();
          }
          return;
        }

        if (fpStateRef.current.active && FP_MOVEMENT_KEYS.has(e.code)) {
          e.preventDefault();
          if (!keysHeldRef.current.has(e.code)) {
            keysHeldRef.current.add(e.code);
            requestRenderRef.current();
          }
        }
      };

      const onKeyUp = (e: KeyboardEvent) => {
        if (keysHeldRef.current.has(e.code)) {
          keysHeldRef.current.delete(e.code);
        }
      };

      const onWindowBlur = () => {
        keysHeldRef.current.clear();
      };

      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      window.addEventListener('blur', onWindowBlur);
      return () => {
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        window.removeEventListener('blur', onWindowBlur);
      };
    }, [toggleNearestInteractable]);

    useEffect(() => {
      const roomGroup = roomGroupRef.current;
      if (!roomGroup) return;

      const validIds = new Set(placements.map((p) => p.element.id));
      let pruned = false;
      for (const id of Object.keys(doorOpenMapRef.current)) {
        if (!validIds.has(id)) {
          delete doorOpenMapRef.current[id];
          pruned = true;
        }
      }
      if (pruned) {
        setOpenIdsList(Object.keys(doorOpenMapRef.current).filter((id) => doorOpenMapRef.current[id]));
      }
      let prunedCab = false;
      for (const key of Object.keys(cabinetPartOpenMapRef.current)) {
        const elId = key.split('::')[0];
        if (!validIds.has(elId)) {
          delete cabinetPartOpenMapRef.current[key];
          prunedCab = true;
        }
      }
      if (prunedCab) {
        syncOpenCabinetPartsList();
      }

      sceneHandlesRef.current = buildRoomSceneGroup(roomGroup, {
        project,
        solved,
        placements,
        selectedEdgeId,
        selectedElementId,
        wallTransparent,
        showCeiling: showCeilingRef.current,
        solidCeiling: activePresetRef.current === 'firstPerson',
        showWireframe,
        showDimensions,
        enableLightingRender,
        openElementIds: doorOpenMapRef.current,
        openCabinetParts: cabinetPartOpenMapRef.current,
        isSoftwareGl: isSoftwareGlRef.current,
        floorTexture: floorTexRef.current,
      });

      collidersRef.current = buildFirstPersonColliders(
        solved,
        placements,
        project.wallThicknessCm,
        doorOpenMapRef.current
      );

      if (fpStateRef.current.active) {
        fpStateRef.current.eyeHeightCm = Math.min(
          160,
          Math.max(85, (project.ceilingHeightCm || 250) - 18)
        );
        const safePos = resolveCircleColliders(
          fpStateRef.current.xCm,
          fpStateRef.current.yCm,
          22,
          collidersRef.current
        );
        fpStateRef.current.xCm = safePos.x;
        fpStateRef.current.yCm = safePos.y;
        syncFpDomAttributes();
        refreshNearestInteractable();
      }

      applyStudioLighting();
      requestRenderRef.current();
    }, [
      project,
      solved,
      placements,
      selectedEdgeId,
      selectedElementId,
      wallTransparent,
      showWireframe,
      showDimensions,
      enableLightingRender,
      applyStudioLighting,
      refreshNearestInteractable,
      syncFpDomAttributes,
    ]);

    useEffect(() => {
      applyRoomCeilingVisibility(
        sceneHandlesRef.current,
        showCeiling,
        activePreset === 'firstPerson',
        isSoftwareGlRef.current,
        enableLightingRender
      );
      requestRenderRef.current();
    }, [showCeiling, activePreset, enableLightingRender]);

    if (webglError) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center bg-slate-100 text-slate-700 p-6 text-center">
          <Box className="w-10 h-10 text-slate-400 mb-3" />
          <p className="text-sm font-medium">{webglError}</p>
        </div>
      );
    }

    const selectedCabPlacement = selectedElementId
      ? placements.find(
          (p) => p.element.id === selectedElementId && isCabinetElementKind(p.element.kind)
        ) ?? null
      : null;

    const isNearestOpen = nearestInteractable
      ? isCabinetElementKind(nearestInteractable.kind as never)
        ? openCabinetPartsList.some((k) => k.startsWith(`${nearestInteractable.id}::`))
        : openIdsList.includes(nearestInteractable.id)
      : false;

    return (
      <div
        ref={viewportRef}
        tabIndex={-1}
        className="relative w-full h-full bg-[#eff3f8] overflow-hidden outline-none"
        data-testid="floorplan-3d-viewport"
        data-dimensions-visible={showDimensions ? 'true' : 'false'}
        data-fp-active={activePreset === 'firstPerson' ? 'true' : 'false'}
        data-lighting-render={enableLightingRender ? 'true' : 'false'}
        data-open-ids={openIdsList.join(',')}
        data-open-cabinet-parts={openCabinetPartsList.join(',')}
      >
        <div ref={mountRef} className="w-full h-full" />

        <div className="absolute top-3 left-3 pointer-events-none bg-white/95 border border-slate-200 rounded-md px-3 py-1.5 text-xs text-slate-600 flex items-center gap-2 shadow-xs">
          {activePreset === 'firstPerson' ? (
            <>
              <span className="font-semibold text-blue-700">第一人稱漫遊 (160 cm)</span>
              <span aria-hidden="true">·</span>
              <span>W/S 前後移動 · A/D 左右旋轉 · 點擊櫃門/抽屜或按空白鍵開關</span>
            </>
          ) : (
            <>
              <span className="font-medium text-slate-800">3D 空間模型</span>
              <span aria-hidden="true">·</span>
              <span>左鍵旋轉 · 右鍵平移 · 滾輪縮放 · 點擊門扇/櫃門/抽屜直接開關</span>
            </>
          )}
        </div>

        {interactionStatus && (
          <div
            data-testid="3d-interaction-status"
            className="pointer-events-none absolute top-12 left-3 z-20 bg-slate-900/95 text-white text-xs font-medium px-3 py-1.5 rounded-md shadow-sm"
          >
            {interactionStatus}
          </div>
        )}

        <div
          className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center max-w-[96vw]"
          style={{ transition: 'transform 180ms cubic-bezier(0.16, 1, 0.3, 1)' }}
        >
          {activePreset === 'firstPerson' && nearestInteractable && (
            <button
              type="button"
              data-testid="fp-interact-btn"
              onClick={() => toggleNearestInteractable(nearestInteractable.id)}
              className="mb-2 flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 text-white border border-slate-700 shadow-lg hover:bg-slate-800 transition-colors whitespace-nowrap"
            >
              <DoorOpen className="w-4 h-4 text-amber-300" />
              <span>
                [空白鍵] {isNearestOpen ? '關閉' : '開啟'}「{nearestInteractable.name}」
              </span>
            </button>
          )}
          {activePreset !== 'firstPerson' && selectedCabPlacement && (
            <button
              type="button"
              data-testid="toggle-selected-cabinet-btn"
              onClick={() =>
                toggleWholeCabinetParts(
                  selectedCabPlacement.element.id,
                  selectedCabPlacement.element.name
                )
              }
              className="mb-2 flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 text-white border border-slate-700 shadow-lg hover:bg-slate-800 transition-colors whitespace-nowrap"
            >
              <DoorOpen className="w-4 h-4 text-amber-300" />
              <span>
                開關「{selectedCabPlacement.element.name}」門扇與抽屜
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setDockCollapsed((v) => !v)}
            aria-expanded={!dockCollapsed}
            className="mb-1.5 flex items-center gap-1 px-3 py-1 rounded-md text-xs font-medium bg-white/95 border border-slate-200 text-slate-700 hover:text-slate-900 shadow-xs whitespace-nowrap shrink-0"
          >
            {dockCollapsed ? (
              <>
                <ChevronUp className="w-3.5 h-3.5" />
                <span>展開 3D 控制列</span>
              </>
            ) : (
              <>
                <ChevronDown className="w-3.5 h-3.5" />
                <span>收合控制列</span>
              </>
            )}
          </button>

          {!dockCollapsed && (
            <div className="flex flex-col items-center gap-1.5 bg-white/95 border border-slate-200 rounded-xl px-2.5 py-2 shadow-md">
              <div className="flex flex-wrap items-center justify-center gap-1 bg-slate-100 p-0.5 rounded-lg">
                {(
                  [
                    { id: 'iso', label: '斜角鳥瞰' },
                    { id: 'top', label: '垂直俯視' },
                    { id: 'interior', label: '室內視角' },
                    { id: 'firstPerson', label: '第一人稱 (160cm)', isFp: true },
                  ] as const
                ).map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={(e) => {
                      applyCameraPreset(preset.id);
                      if (preset.id === 'firstPerson') {
                        e.currentTarget.blur();
                        viewportRef.current?.focus({ preventScroll: true });
                      }
                    }}
                    className={`px-2 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 flex items-center gap-1 ${
                      activePreset === preset.id
                        ? 'bg-white text-blue-700 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {'isFp' in preset && <Footprints className="w-3.5 h-3.5" />}
                    <span>{preset.label}</span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => applyCameraPreset('reset')}
                  className="px-2 py-1 rounded-md text-xs font-medium text-slate-600 hover:text-slate-900 flex items-center gap-1 whitespace-nowrap shrink-0"
                  title="重設 3D 相機視角"
                >
                  <Compass className="w-3.5 h-3.5" />
                  <span>重設</span>
                </button>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-1.5">
                <button
                  type="button"
                  onClick={handleToggleDimensions}
                  aria-pressed={showDimensions}
                  className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap shrink-0 ${
                    showDimensions
                      ? 'bg-blue-600 border-blue-600 text-white'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <Ruler className="w-3.5 h-3.5" />
                  <span>3D 尺寸標示</span>
                </button>
                <button
                  type="button"
                  onClick={() => setWallTransparent((v) => !v)}
                  aria-pressed={wallTransparent}
                  className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap shrink-0 ${
                    wallTransparent
                      ? 'bg-blue-50 border-blue-200 text-blue-700'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>牆面半透明</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowCeiling((v) => !v)}
                  aria-pressed={showCeiling}
                  className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap shrink-0 ${
                    showCeiling
                      ? 'bg-blue-50 border-blue-200 text-blue-700'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>顯示天花板</span>
                </button>
                <button
                  type="button"
                  onClick={() => setEnableLightingRender((v) => !v)}
                  aria-pressed={enableLightingRender}
                  className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap shrink-0 ${
                    enableLightingRender
                      ? 'bg-amber-50 border-amber-300 text-amber-800'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <Sun className="w-3.5 h-3.5" />
                  <span>光影渲染</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowWireframe((v) => !v)}
                  aria-pressed={showWireframe}
                  className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap shrink-0 ${
                    showWireframe
                      ? 'bg-slate-900 border-slate-900 text-white'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <span>邊線輪廓</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }
);

