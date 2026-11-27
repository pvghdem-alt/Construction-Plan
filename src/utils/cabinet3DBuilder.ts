import * as THREE from 'three';
import type { CabinetBaseKind, CabinetSpec } from '../types/floorplan';
import {
  computeCabinetCompartmentLayout,
  sanitizeCabinetSpec,
} from './cabinetDesigner';

export interface CabinetPartInteractionMeta {
  elementId: string;
  partId: string;
  partType: 'door' | 'drawer';
  label: string;
}

export interface CabinetInteractivePartHandle {
  elementId: string;
  partId: string;
  key: string;
  partType: 'door' | 'drawer';
  label: string;
  pivot?: THREE.Group;
  closedAngleRad?: number;
  openAngleRad?: number;
  drawerGroup?: THREE.Group;
  closedZ?: number;
  openZ?: number;
  currentProgress: number;
}

export function getCabinetPartKey(elementId: string, partId: string): string {
  return `${elementId}::${partId}`;
}

export function applyCabinetPartProgress(
  handle: CabinetInteractivePartHandle,
  progress: number
): void {
  const p = Math.max(0, Math.min(1, progress));
  handle.currentProgress = p;
  if (handle.partType === 'door' && handle.pivot) {
    handle.pivot.rotation.y = THREE.MathUtils.lerp(
      handle.closedAngleRad ?? 0,
      handle.openAngleRad ?? 0,
      p
    );
  } else if (handle.partType === 'drawer' && handle.drawerGroup) {
    handle.drawerGroup.position.z = THREE.MathUtils.lerp(
      handle.closedZ ?? 0,
      handle.openZ ?? 0.25,
      p
    );
  }
}

export interface BuildCabinet3DOptions {
  elementId: string;
  elementName: string;
  baseKind: CabinetBaseKind;
  widthCm: number;
  depthCm: number;
  heightCm: number;
  spec: CabinetSpec;
  materials: {
    bodyMat: THREE.Material;
    interiorMat: THREE.Material;
    doorMat: THREE.Material;
    plinthMat: THREE.Material;
    metalMat: THREE.Material;
    countertopMat: THREE.Material;
    waterMat: THREE.Material;
    cooktopMat?: THREE.Material;
    edgeLineMat: THREE.LineBasicMaterial;
  };
  showWireframe?: boolean;
  includeCooktopIfKitchenDefault?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  openPartsMap?: Record<string, boolean>;
}

export function buildInteractiveCabinetMesh(options: BuildCabinet3DOptions): {
  group: THREE.Group;
  parts: CabinetInteractivePartHandle[];
  interactableMeshes: THREE.Object3D[];
} {
  const {
    elementId,
    elementName,
    baseKind,
    widthCm,
    depthCm,
    heightCm,
    materials,
    showWireframe = false,
    includeCooktopIfKitchenDefault = false,
    castShadow = false,
    receiveShadow = false,
    openPartsMap = {},
  } = options;

  const spec = sanitizeCabinetSpec(options.spec, baseKind, widthCm);
  const layout = computeCabinetCompartmentLayout({
    widthCm,
    depthCm,
    heightCm,
    baseKind,
    spec,
  });

  const {
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
    drawers,
    upperBottomYM,
    doors,
    shelfYMs,
    hangingRodYM,
  } = layout;

  const cabGroup = new THREE.Group();
  const parts: CabinetInteractivePartHandle[] = [];
  const interactableMeshes: THREE.Object3D[] = [];

  const carcassDepth = Math.max(0.08, dM - panelTM);
  const carcassCenterZ = -panelTM * 0.5;

  // 1. Plinth (floor-standing cabinets)
  if (plinthHM > 0.005) {
    const plinth = new THREE.Mesh(
      new THREE.BoxGeometry(Math.max(0.08, wM - 0.015), plinthHM, Math.max(0.06, dM - 0.045)),
      materials.plinthMat
    );
    plinth.position.set(0, plinthHM * 0.5, -0.018);
    plinth.castShadow = castShadow;
    plinth.receiveShadow = receiveShadow;
    cabGroup.add(plinth);
  }

  // 2. Hollow carcass panels (bottom, left, right, back) so opening doors exposes interior
  const bottomPanel = new THREE.Mesh(
    new THREE.BoxGeometry(wM, panelTM, carcassDepth),
    materials.bodyMat
  );
  bottomPanel.position.set(0, plinthHM + panelTM * 0.5, carcassCenterZ);
  bottomPanel.castShadow = castShadow;
  bottomPanel.receiveShadow = receiveShadow;
  cabGroup.add(bottomPanel);

  const leftSide = new THREE.Mesh(
    new THREE.BoxGeometry(panelTM, cavHeightM, carcassDepth),
    materials.bodyMat
  );
  leftSide.position.set(-wM * 0.5 + panelTM * 0.5, cavBottomYM + cavHeightM * 0.5, carcassCenterZ);
  leftSide.castShadow = castShadow;
  leftSide.receiveShadow = receiveShadow;
  cabGroup.add(leftSide);

  const rightSide = new THREE.Mesh(
    new THREE.BoxGeometry(panelTM, cavHeightM, carcassDepth),
    materials.bodyMat
  );
  rightSide.position.set(wM * 0.5 - panelTM * 0.5, cavBottomYM + cavHeightM * 0.5, carcassCenterZ);
  rightSide.castShadow = castShadow;
  rightSide.receiveShadow = receiveShadow;
  cabGroup.add(rightSide);

  const backBoardT = Math.max(0.01, panelTM * 0.7);
  const backPanel = new THREE.Mesh(
    new THREE.BoxGeometry(interiorWM + 0.002, cavHeightM, backBoardT),
    materials.interiorMat
  );
  backPanel.position.set(
    0,
    cavBottomYM + cavHeightM * 0.5,
    -dM * 0.5 + backBoardT * 0.5
  );
  backPanel.receiveShadow = receiveShadow;
  cabGroup.add(backPanel);

  // Horizontal divider between drawer stack and upper door/shelf zone
  if (drawers.length > 0 && layout.upperHeightM > 0.06) {
    const dividerT = Math.max(0.012, panelTM * 0.8);
    const divider = new THREE.Mesh(
      new THREE.BoxGeometry(interiorWM, dividerT, interiorDM),
      materials.interiorMat
    );
    divider.position.set(0, upperBottomYM, carcassCenterZ - 0.005);
    divider.receiveShadow = receiveShadow;
    cabGroup.add(divider);
  }

  // 3. Top Cap / Countertop & Optional Integrated Sink
  if (spec.hasSink || baseKind === 'kitchen_counter') {
    const topSlab = new THREE.Mesh(
      new THREE.BoxGeometry(wM + 0.012, topTrimHM, dM + 0.012),
      materials.countertopMat
    );
    topSlab.position.set(0, cavTopYM + topTrimHM * 0.5, 0);
    topSlab.castShadow = castShadow;
    topSlab.receiveShadow = receiveShadow;
    cabGroup.add(topSlab);

    const splashH = 0.055;
    const backsplash = new THREE.Mesh(
      new THREE.BoxGeometry(wM + 0.012, splashH, 0.02),
      materials.countertopMat
    );
    backsplash.position.set(0, hM + splashH * 0.5, -dM * 0.5 + 0.006);
    cabGroup.add(backsplash);

    if (spec.hasSink) {
      const hasRightCooktop = Boolean(includeCooktopIfKitchenDefault && materials.cooktopMat && wM >= 1.2);
      const sinkW = hasRightCooktop
        ? Math.min(0.64, wM * 0.3)
        : Math.min(wM * 0.72, 0.68);
      const sinkD = Math.min(dM * 0.68, 0.44);
      const sinkX = hasRightCooktop ? -wM * 0.25 : 0;
      const sinkZ = 0.025;

      // Outer stainless sink rim
      const sinkRim = new THREE.Mesh(
        new THREE.BoxGeometry(sinkW, 0.012, sinkD),
        materials.metalMat
      );
      sinkRim.position.set(sinkX, hM + 0.006, sinkZ);
      cabGroup.add(sinkRim);

      // Recessed basin water/bottom tint
      const basinWater = new THREE.Mesh(
        new THREE.BoxGeometry(Math.max(0.08, sinkW * 0.84), 0.014, Math.max(0.08, sinkD * 0.78)),
        materials.waterMat
      );
      basinWater.position.set(sinkX, hM + 0.008, sinkZ);
      cabGroup.add(basinWater);

      // Drain ring
      const drain = new THREE.Mesh(
        new THREE.CylinderGeometry(0.022, 0.022, 0.004, 14),
        materials.metalMat
      );
      drain.position.set(sinkX, hM + 0.016, sinkZ);
      cabGroup.add(drain);

      // Gooseneck faucet
      const faucetBaseZ = sinkZ - sinkD * 0.5 - 0.03;
      const faucetStem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.013, 0.016, 0.16, 12),
        materials.metalMat
      );
      faucetStem.position.set(sinkX, hM + 0.08, Math.max(-dM * 0.44, faucetBaseZ));
      cabGroup.add(faucetStem);

      const faucetNeck = new THREE.Mesh(
        new THREE.BoxGeometry(0.022, 0.02, 0.11),
        materials.metalMat
      );
      faucetNeck.position.set(sinkX, hM + 0.155, Math.max(-dM * 0.44, faucetBaseZ) + 0.048);
      cabGroup.add(faucetNeck);

      const faucetSpoutTip = new THREE.Mesh(
        new THREE.CylinderGeometry(0.01, 0.01, 0.028, 10),
        materials.metalMat
      );
      faucetSpoutTip.position.set(sinkX, hM + 0.136, Math.max(-dM * 0.44, faucetBaseZ) + 0.095);
      cabGroup.add(faucetSpoutTip);

      if (hasRightCooktop && materials.cooktopMat) {
        const hobW = Math.min(0.68, wM * 0.28);
        const hobD = Math.min(0.42, dM * 0.64);
        const hobX = wM * 0.24;
        const hob = new THREE.Mesh(
          new THREE.BoxGeometry(hobW, 0.014, hobD),
          materials.cooktopMat
        );
        hob.position.set(hobX, hM + 0.007, 0.01);
        cabGroup.add(hob);

        const ringR = Math.min(0.09, hobW * 0.16);
        const burnerGeo = new THREE.CylinderGeometry(ringR, ringR, 0.004, 18);
        for (const bOff of [-hobW * 0.22, hobW * 0.22]) {
          const burner = new THREE.Mesh(burnerGeo, materials.metalMat);
          burner.position.set(hobX + bOff, hM + 0.016, 0.01);
          cabGroup.add(burner);
        }
      }
    }
  } else {
    const topCap = new THREE.Mesh(
      new THREE.BoxGeometry(wM + 0.008, topTrimHM, dM + 0.006),
      materials.doorMat
    );
    topCap.position.set(0, cavTopYM + topTrimHM * 0.5, 0);
    topCap.castShadow = castShadow;
    topCap.receiveShadow = receiveShadow;
    cabGroup.add(topCap);
  }

  // 4. Interior Shelves
  const shelfT = Math.max(0.012, panelTM * 0.8);
  const shelfDepth = Math.max(0.06, interiorDM - 0.015);
  for (const shelfY of shelfYMs) {
    const shelf = new THREE.Mesh(
      new THREE.BoxGeometry(interiorWM - 0.004, shelfT, shelfDepth),
      materials.interiorMat
    );
    shelf.position.set(0, shelfY, -dM * 0.5 + backBoardT + shelfDepth * 0.5 + 0.005);
    shelf.receiveShadow = receiveShadow;
    cabGroup.add(shelf);
  }

  // 5. Interior Clothes Hanging Rod
  if (hangingRodYM !== null) {
    const rodLen = Math.max(0.06, interiorWM - 0.01);
    const rodMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, rodLen, 14),
      materials.metalMat
    );
    rodMesh.rotation.z = Math.PI * 0.5;
    rodMesh.position.set(0, hangingRodYM, 0);
    cabGroup.add(rodMesh);

    const flangeGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.014, 12);
    for (const sideSign of [-1, 1]) {
      const flange = new THREE.Mesh(flangeGeo, materials.metalMat);
      flange.rotation.z = Math.PI * 0.5;
      flange.position.set(sideSign * (interiorWM * 0.5 - 0.007), hangingRodYM, 0);
      cabGroup.add(flange);
    }

    // Minimalist wire hangers for visual clarity inside wardrobe
    const hangerOffsets = rodLen >= 0.45 ? [-rodLen * 0.22, rodLen * 0.22] : [0];
    for (const hx of hangerOffsets) {
      const hook = new THREE.Mesh(
        new THREE.BoxGeometry(0.008, 0.045, 0.008),
        materials.metalMat
      );
      hook.position.set(hx, hangingRodYM - 0.022, 0);
      cabGroup.add(hook);

      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(0.012, 0.012, Math.min(0.28, interiorDM * 0.65)),
        materials.metalMat
      );
      bar.position.set(hx, hangingRodYM - 0.065, 0);
      cabGroup.add(bar);
    }
  }

  // 6. Sliding Drawers (interactive)
  const frontZ = dM * 0.5 - panelTM * 0.5;
  for (const d of drawers) {
    const drawerGroup = new THREE.Group();
    drawerGroup.position.set(0, d.yCenterM, 0);

    const partId = `drawer-${d.index}`;
    const key = getCabinetPartKey(elementId, partId);
    const label = `${elementName} · 抽屜 #${d.index + 1}`;
    const meta: CabinetPartInteractionMeta = {
      elementId,
      partId,
      partType: 'drawer',
      label,
    };

    const boxW = Math.max(0.06, interiorWM - 0.02);
    const boxH = Math.max(0.03, d.heightM * 0.72);
    const boxD = d.boxDepthM;
    const boxWallT = 0.012;
    const boxCenterZ = frontZ - panelTM * 0.5 - boxD * 0.5;
    const boxYOffset = -d.heightM * 0.1;

    // Drawer box bottom & sides (reveals cavity when pulled out)
    const dBottom = new THREE.Mesh(
      new THREE.BoxGeometry(boxW, boxWallT, boxD),
      materials.interiorMat
    );
    dBottom.position.set(0, boxYOffset - boxH * 0.5 + boxWallT * 0.5, boxCenterZ);
    drawerGroup.add(dBottom);

    const dLeft = new THREE.Mesh(
      new THREE.BoxGeometry(boxWallT, boxH, boxD),
      materials.interiorMat
    );
    dLeft.position.set(-boxW * 0.5 + boxWallT * 0.5, boxYOffset, boxCenterZ);
    drawerGroup.add(dLeft);

    const dRight = new THREE.Mesh(
      new THREE.BoxGeometry(boxWallT, boxH, boxD),
      materials.interiorMat
    );
    dRight.position.set(boxW * 0.5 - boxWallT * 0.5, boxYOffset, boxCenterZ);
    drawerGroup.add(dRight);

    const dBack = new THREE.Mesh(
      new THREE.BoxGeometry(boxW - boxWallT * 2, boxH, boxWallT),
      materials.interiorMat
    );
    dBack.position.set(0, boxYOffset, boxCenterZ - boxD * 0.5 + boxWallT * 0.5);
    drawerGroup.add(dBack);

    // Drawer front panel
    const frontW = Math.max(0.08, wM - 0.016);
    const dFront = new THREE.Mesh(
      new THREE.BoxGeometry(frontW, d.heightM, panelTM),
      materials.doorMat
    );
    dFront.position.set(0, 0, frontZ);
    dFront.castShadow = castShadow;
    dFront.receiveShadow = receiveShadow;
    dFront.userData.cabinetInteract = meta;
    drawerGroup.add(dFront);
    interactableMeshes.push(dFront);

    // Drawer pull bar
    const pullBar = new THREE.Mesh(
      new THREE.BoxGeometry(Math.min(0.18, frontW * 0.36), 0.014, 0.022),
      materials.metalMat
    );
    pullBar.position.set(0, 0, frontZ + panelTM * 0.5 + 0.011);
    pullBar.userData.cabinetInteract = meta;
    drawerGroup.add(pullBar);
    interactableMeshes.push(pullBar);

    if (showWireframe) {
      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(frontW, d.heightM, panelTM), 20),
        materials.edgeLineMat
      );
      outline.position.copy(dFront.position);
      drawerGroup.add(outline);
    }

    const handle: CabinetInteractivePartHandle = {
      elementId,
      partId,
      key,
      partType: 'drawer',
      label,
      drawerGroup,
      closedZ: 0,
      openZ: d.openSlideZM,
      currentProgress: openPartsMap[key] ? 1 : 0,
    };
    applyCabinetPartProgress(handle, handle.currentProgress);
    parts.push(handle);
    cabGroup.add(drawerGroup);
  }

  // 7. Hinged Doors (interactive)
  for (const door of doors) {
    const pivot = new THREE.Group();
    pivot.position.set(door.hingeXM, door.centerYM, frontZ);

    const key = getCabinetPartKey(elementId, door.partId);
    const label = `${elementName} · ${door.label}`;
    const meta: CabinetPartInteractionMeta = {
      elementId,
      partId: door.partId,
      partType: 'door',
      label,
    };

    const doorPanel = new THREE.Mesh(
      new THREE.BoxGeometry(door.leafWidthM, door.leafHeightM, panelTM),
      materials.doorMat
    );
    doorPanel.position.set(door.leafCenterOffsetXM, 0, 0);
    doorPanel.castShadow = castShadow;
    doorPanel.receiveShadow = receiveShadow;
    doorPanel.userData.cabinetInteract = meta;
    pivot.add(doorPanel);
    interactableMeshes.push(doorPanel);

    const handleH = Math.min(0.22, door.leafHeightM * 0.28);
    const doorHandle = new THREE.Mesh(
      new THREE.BoxGeometry(0.014, handleH, 0.022),
      materials.metalMat
    );
    const handleYOffset =
      door.leafHeightM > 0.65 ? -door.leafHeightM * 0.06 : 0;
    doorHandle.position.set(
      door.leafCenterOffsetXM + door.handleOffsetXM,
      handleYOffset,
      panelTM * 0.5 + 0.011
    );
    doorHandle.userData.cabinetInteract = meta;
    pivot.add(doorHandle);
    interactableMeshes.push(doorHandle);

    if (showWireframe) {
      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(
          new THREE.BoxGeometry(door.leafWidthM, door.leafHeightM, panelTM),
          20
        ),
        materials.edgeLineMat
      );
      outline.position.copy(doorPanel.position);
      pivot.add(outline);
    }

    const handle: CabinetInteractivePartHandle = {
      elementId,
      partId: door.partId,
      key,
      partType: 'door',
      label,
      pivot,
      closedAngleRad: door.closedAngleRad,
      openAngleRad: door.openAngleRad,
      currentProgress: openPartsMap[key] ? 1 : 0,
    };
    applyCabinetPartProgress(handle, handle.currentProgress);
    parts.push(handle);
    cabGroup.add(pivot);
  }

  if (showWireframe) {
    const outerOutline = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(wM, hM, dM), 20),
      materials.edgeLineMat
    );
    outerOutline.position.set(0, hM * 0.5, 0);
    cabGroup.add(outerOutline);
  }

  return { group: cabGroup, parts, interactableMeshes };
}
