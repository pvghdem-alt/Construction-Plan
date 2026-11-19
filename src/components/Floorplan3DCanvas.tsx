import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ChevronDown, ChevronUp, Compass, Eye, Layers, Box, Ruler } from 'lucide-react';
import type {
  CameraPreset,
  FloorplanProject,
  SolvedElementPlacement,
  SolvedFloorplan,
} from '../types/floorplan';
import {
  buildRoomSceneGroup,
  CM_TO_M,
  createWoodFloorTexture,
  detectSoftwareGl,
  disposeGroupContents,
} from '../utils/threeSceneBuilder';

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
    const mountRef = useRef<HTMLDivElement | null>(null);
    const [wallTransparent, setWallTransparent] = useState(false);
    const [showCeiling, setShowCeiling] = useState(false);
    const [showWireframe, setShowWireframe] = useState(true);
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

    const sceneRef = useRef<THREE.Scene | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const controlsRef = useRef<OrbitControls | null>(null);
    const roomGroupRef = useRef<THREE.Group | null>(null);
    const floorTexRef = useRef<THREE.CanvasTexture | null>(null);
    const isSoftwareGlRef = useRef<boolean>(false);
    const requestRenderRef = useRef<() => void>(() => {});
    const transitionActiveRef = useRef<boolean>(false);
    const boundsRef = useRef({ centerX: 0, centerZ: 0, maxSpan: 8, ceilingM: 2.5 });

    useEffect(() => {
      const cx = solved.bounds.centerX * CM_TO_M;
      const cz = solved.bounds.centerY * CM_TO_M;
      const span = Math.max(solved.bounds.widthCm, solved.bounds.heightCm, 250) * CM_TO_M;
      const ceil = Math.max(1.5, project.ceilingHeightCm * CM_TO_M);
      boundsRef.current = { centerX: cx, centerZ: cz, maxSpan: span, ceilingM: ceil };
    }, [solved.bounds, project.ceilingHeightCm]);

    const applyCameraPreset = useCallback((preset: CameraPreset, immediate = false) => {
      const { centerX, centerZ, maxSpan, ceilingM } = boundsRef.current;
      const mount = mountRef.current;
      const aspect =
        mount && mount.clientHeight > 0 ? mount.clientWidth / mount.clientHeight : 1.4;
      const aspectScale = aspect < 1.1 ? 1.15 / Math.max(0.65, aspect) : 1.0;
      setActivePreset(preset);

      if (preset === 'top') {
        _targetControlsTarget.set(centerX, 0, centerZ);
        _targetCamPos.set(centerX, maxSpan * 1.55 * aspectScale, centerZ + 0.08);
      } else if (preset === 'interior') {
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
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        capturePngDataUrl: () => {
          const renderer = rendererRef.current;
          const scene = sceneRef.current;
          const camera = cameraRef.current;
          if (!renderer || !scene || !camera) return null;
          controlsRef.current?.update();
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
      renderer.shadowMap.enabled = !isSoftwareGl;
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

      const camera = new THREE.PerspectiveCamera(45, initW / initH, 0.05, 120);
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
        requestRenderRef.current();
      };
      controls.addEventListener('start', onControlStart);
      controls.addEventListener('change', onControlChange);

      const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0xcbd5e1, 0.82);
      scene.add(hemiLight);

      const keyLight = new THREE.DirectionalLight(0xfff7ed, 1.55);
      keyLight.position.set(10, 16, 12);
      if (!isSoftwareGl) {
        keyLight.castShadow = true;
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

      const rimLight = new THREE.DirectionalLight(0xe0f2fe, 0.55);
      rimLight.position.set(-10, 8, -10);
      scene.add(rimLight);

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
          const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) * 0.001));
          lastTime = now;
          renderDirty = false;

          if (transitionActiveRef.current) {
            const lambda = isSoftwareGl ? 18 : 8;
            camera.position.x = THREE.MathUtils.damp(camera.position.x, _targetCamPos.x, lambda, dt);
            camera.position.y = THREE.MathUtils.damp(camera.position.y, _targetCamPos.y, lambda, dt);
            camera.position.z = THREE.MathUtils.damp(camera.position.z, _targetCamPos.z, lambda, dt);
            controls.target.x = THREE.MathUtils.damp(controls.target.x, _targetControlsTarget.x, lambda, dt);
            controls.target.y = THREE.MathUtils.damp(controls.target.y, _targetControlsTarget.y, lambda, dt);
            controls.target.z = THREE.MathUtils.damp(controls.target.z, _targetControlsTarget.z, lambda, dt);

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

          controls.update();
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
        resizeObserver.disconnect();
        controls.removeEventListener('start', onControlStart);
        controls.removeEventListener('change', onControlChange);
        controls.dispose();
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
    }, [applyCameraPreset]);

    useEffect(() => {
      const roomGroup = roomGroupRef.current;
      if (!roomGroup) return;

      buildRoomSceneGroup(roomGroup, {
        project,
        solved,
        placements,
        selectedEdgeId,
        selectedElementId,
        wallTransparent,
        showCeiling,
        showWireframe,
        showDimensions,
        isSoftwareGl: isSoftwareGlRef.current,
        floorTexture: floorTexRef.current,
      });

      requestRenderRef.current();
    }, [
      project,
      solved,
      placements,
      selectedEdgeId,
      selectedElementId,
      wallTransparent,
      showCeiling,
      showWireframe,
      showDimensions,
    ]);

    if (webglError) {
      return (
        <div className="w-full h-full flex flex-col items-center justify-center bg-slate-100 text-slate-700 p-6 text-center">
          <Box className="w-10 h-10 text-slate-400 mb-3" />
          <p className="text-sm font-medium">{webglError}</p>
        </div>
      );
    }

    return (
      <div
        className="relative w-full h-full bg-[#eff3f8] overflow-hidden"
        data-testid="floorplan-3d-viewport"
        data-dimensions-visible={showDimensions ? 'true' : 'false'}
      >
        <div ref={mountRef} className="w-full h-full" />

        <div className="absolute top-3 left-3 pointer-events-none bg-white/90 border border-slate-200 rounded-md px-3 py-1.5 text-xs text-slate-600 flex items-center gap-2 shadow-xs">
          <span className="font-medium text-slate-800">3D 空間模型</span>
          <span aria-hidden="true">·</span>
          <span>左鍵旋轉 · 右鍵平移 · 滾輪縮放</span>
        </div>

        <div
          className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center max-w-[94vw]"
          style={{ transition: 'transform 180ms cubic-bezier(0.16, 1, 0.3, 1)' }}
        >
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
            <div className="flex flex-wrap items-center justify-center gap-2 bg-white/95 border border-slate-200 rounded-xl px-3 py-2 shadow-md">
              <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg">
                {(
                  [
                    { id: 'iso', label: '斜角鳥瞰' },
                    { id: 'top', label: '垂直俯視' },
                    { id: 'interior', label: '室內視角' },
                  ] as const
                ).map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => applyCameraPreset(preset.id)}
                    className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      activePreset === preset.id
                        ? 'bg-white text-blue-700 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => applyCameraPreset('reset')}
                  className="px-2.5 py-1.5 rounded-md text-xs font-medium text-slate-600 hover:text-slate-900 flex items-center gap-1 whitespace-nowrap shrink-0"
                  title="重設 3D 相機視角"
                >
                  <Compass className="w-3.5 h-3.5" />
                  <span>重設</span>
                </button>
              </div>

              <div className="w-px h-5 bg-slate-200 hidden sm:block" />

              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleToggleDimensions}
                  aria-pressed={showDimensions}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap shrink-0 ${
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
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap shrink-0 ${
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
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap shrink-0 ${
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
                  onClick={() => setShowWireframe((v) => !v)}
                  aria-pressed={showWireframe}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors whitespace-nowrap shrink-0 ${
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
