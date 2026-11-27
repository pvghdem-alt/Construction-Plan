import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStarterCabinetPresets,
  computeCabinetCompartmentLayout,
  createElementFromCabinetTemplate,
  formatCabinetSpecSummary,
  getDefaultCabinetSpec,
  mergeCustomCabinetLibraries,
  resolveCabinetSpecForElement,
  sanitizeCabinetSpec,
  sanitizeCustomCabinetTemplate,
} from './cabinetDesigner';
import { findNearestSpaceInteractable } from './firstPersonNavigation';
import { ATTACHED_SKETCH_PRESET } from './samplePresets';
import { resolveElementPlacements, solveFloorplan } from './floorplanGeometry';
import { sanitizeSharedProject } from './shareLink';

test('sanitizeCabinetSpec enforces bounds, fallbacks, and door modes', () => {
  const clamped = sanitizeCabinetSpec(
    {
      drawerCount: 99,
      doorMode: 'invalid-mode',
      shelfCount: -3,
      hasHangingRod: true,
      hasSink: true,
    },
    'cabinet',
    120
  );
  assert.equal(clamped.drawerCount, 6);
  assert.equal(clamped.doorMode, 'double');
  assert.equal(clamped.shelfCount, 0);
  assert.equal(clamped.hasHangingRod, true);
  assert.equal(clamped.hasSink, true);

  const defKitchen = getDefaultCabinetSpec('kitchen_counter', 180);
  assert.equal(defKitchen.hasSink, true);
  assert.equal(defKitchen.drawerCount, 1);

  const summary = formatCabinetSpecSummary({
    drawerCount: 2,
    doorMode: 'single-left',
    shelfCount: 3,
    hasHangingRod: true,
    hasSink: true,
  });
  assert.ok(summary.includes('單開(左開)'));
  assert.ok(summary.includes('2抽屜'));
  assert.ok(summary.includes('3隔層'));
  assert.ok(summary.includes('掛衣桿'));
  assert.ok(summary.includes('含水槽'));
});

test('computeCabinetCompartmentLayout computes outward left/right hinges, drawers, rod, and shelves cleanly', () => {
  const leftLayout = computeCabinetCompartmentLayout({
    widthCm: 80,
    depthCm: 60,
    heightCm: 210,
    baseKind: 'cabinet',
    spec: {
      drawerCount: 2,
      doorMode: 'single-left',
      shelfCount: 2,
      hasHangingRod: true,
      hasSink: false,
    },
  });
  assert.equal(leftLayout.drawers.length, 2);
  assert.ok(leftLayout.drawers[0].yCenterM < leftLayout.drawers[1].yCenterM);
  assert.ok(leftLayout.drawers[0].openSlideZM > 0.1);
  assert.equal(leftLayout.doors.length, 1);
  assert.equal(leftLayout.doors[0].partId, 'door-left');
  assert.ok(leftLayout.doors[0].hingeXM < 0);
  assert.ok(leftLayout.doors[0].openAngleRad < 0, 'Left-hinged door swings outward (+Z) with negative Y rotation');
  assert.ok(leftLayout.hangingRodYM !== null);
  assert.equal(leftLayout.shelfYMs.length, 2);
  for (const shelfY of leftLayout.shelfYMs) {
    assert.ok(shelfY > leftLayout.upperBottomYM && shelfY < (leftLayout.hangingRodYM ?? 99));
  }

  const rightLayout = computeCabinetCompartmentLayout({
    widthCm: 60,
    depthCm: 55,
    heightCm: 200,
    baseKind: 'cabinet',
    spec: {
      drawerCount: 1,
      doorMode: 'single-right',
      shelfCount: 3,
      hasHangingRod: false,
      hasSink: false,
    },
  });
  assert.equal(rightLayout.doors.length, 1);
  assert.equal(rightLayout.doors[0].partId, 'door-right');
  assert.ok(rightLayout.doors[0].hingeXM > 0);
  assert.ok(rightLayout.doors[0].openAngleRad > 0, 'Right-hinged door swings outward (+Z) with positive Y rotation');
  assert.equal(rightLayout.hangingRodYM, null);
  assert.equal(rightLayout.shelfYMs.length, 3);

  const openChest = computeCabinetCompartmentLayout({
    widthCm: 80,
    depthCm: 50,
    heightCm: 90,
    baseKind: 'cabinet',
    spec: {
      drawerCount: 4,
      doorMode: 'none',
      shelfCount: 0,
      hasHangingRod: false,
      hasSink: true,
    },
  });
  assert.equal(openChest.doors.length, 0);
  assert.equal(openChest.drawers.length, 4);
  assert.ok(openChest.sinkRecessHM > 0);
});

test('createElementFromCabinetTemplate repeatedly spawns distinct elements preserving cabinetSpec', () => {
  const preset = buildStarterCabinetPresets()[0];
  const solved = solveFloorplan(ATTACHED_SKETCH_PRESET);

  const first = createElementFromCabinetTemplate(preset, ATTACHED_SKETCH_PRESET, solved, {
    selectedEdgeId: ATTACHED_SKETCH_PRESET.edges[0].id,
  });
  assert.ok(first);
  assert.equal(first.customCabinetId, preset.id);
  assert.deepEqual(resolveCabinetSpecForElement(first), preset.cabinetSpec);

  const projWithFirst = {
    ...ATTACHED_SKETCH_PRESET,
    elements: [...ATTACHED_SKETCH_PRESET.elements, first],
  };
  const second = createElementFromCabinetTemplate(preset, projWithFirst, solved, {
    selectedEdgeId: ATTACHED_SKETCH_PRESET.edges[0].id,
  });
  assert.ok(second);
  assert.notEqual(second.id, first.id);
  assert.ok(second.offsetCm > first.offsetCm);
  assert.deepEqual(resolveCabinetSpecForElement(second), preset.cabinetSpec);
});

test('findNearestSpaceInteractable detects nearby interactable cabinets and skips open-only shelves', () => {
  const interactableCabId = 'cab-interactable-1';
  const openOnlyCabId = 'cab-open-only-1';
  const proj = {
    ...ATTACHED_SKETCH_PRESET,
    elements: [
      {
        id: interactableCabId,
        kind: 'cabinet' as const,
        name: '可開關衣櫃',
        placement: 'free' as const,
        edgeId: ATTACHED_SKETCH_PRESET.edges[0].id,
        offsetCm: 0,
        xCm: 250,
        yCm: 200,
        rotationDeg: 0,
        widthCm: 100,
        depthCm: 60,
        heightCm: 210,
        elevationCm: 0,
        side: 'inside' as const,
        cabinetSpec: {
          drawerCount: 2,
          doorMode: 'double' as const,
          shelfCount: 1,
          hasHangingRod: true,
          hasSink: false,
        },
      },
      {
        id: openOnlyCabId,
        kind: 'cabinet' as const,
        name: '純開放展示層架',
        placement: 'free' as const,
        edgeId: ATTACHED_SKETCH_PRESET.edges[0].id,
        offsetCm: 0,
        xCm: 500,
        yCm: 200,
        rotationDeg: 0,
        widthCm: 100,
        depthCm: 40,
        heightCm: 180,
        elevationCm: 0,
        side: 'inside' as const,
        cabinetSpec: {
          drawerCount: 0,
          doorMode: 'none' as const,
          shelfCount: 4,
          hasHangingRod: false,
          hasSink: false,
        },
      },
    ],
  };
  const solved = solveFloorplan(proj);
  const placements = resolveElementPlacements(proj.elements, solved);

  const nearCab = findNearestSpaceInteractable(250, 260, 0, -1, placements, 160);
  assert.ok(nearCab);
  assert.equal(nearCab.id, interactableCabId);
  assert.equal(nearCab.kind, 'cabinet');

  const nearOpenOnly = findNearestSpaceInteractable(500, 230, 0, -1, placements, 160);
  assert.equal(nearOpenOnly, null);
});

test('mergeCustomCabinetLibraries & sanitizeSharedProject preserve cabinet templates and specs', () => {
  const localTpl = sanitizeCustomCabinetTemplate(
    {
      id: 'cab_1',
      name: '舊版名稱',
      baseKind: 'cabinet',
      widthCm: 90,
      depthCm: 60,
      heightCm: 200,
      elevationCm: 0,
      defaultPlacement: 'wall',
      cabinetSpec: {
        drawerCount: 1,
        doorMode: 'single-left',
        shelfCount: 2,
        hasHangingRod: false,
        hasSink: false,
      },
      createdAtMs: 1000,
      updatedAtMs: 1000,
    },
    'cab_1'
  )!;
  const cloudTpl = sanitizeCustomCabinetTemplate(
    {
      ...localTpl,
      name: '雲端最新雙門水槽櫃',
      updatedAtMs: 2000,
      cabinetSpec: {
        drawerCount: 2,
        doorMode: 'double',
        shelfCount: 1,
        hasHangingRod: false,
        hasSink: true,
      },
    },
    'cab_1'
  )!;

  const merged = mergeCustomCabinetLibraries([localTpl], [cloudTpl]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].name, '雲端最新雙門水槽櫃');
  assert.equal(merged[0].cabinetSpec.hasSink, true);

  const sanitizedProj = sanitizeSharedProject({
    ...ATTACHED_SKETCH_PRESET,
    elements: [
      {
        ...ATTACHED_SKETCH_PRESET.elements[0],
        id: 'cab-shared',
        kind: 'cabinet',
        name: '共用櫃體',
        customCabinetId: 'cab_1',
        cabinetSpec: {
          drawerCount: 3,
          doorMode: 'single-right',
          shelfCount: 2,
          hasHangingRod: true,
          hasSink: false,
        },
      },
    ],
  });
  assert.ok(sanitizedProj);
  assert.equal(sanitizedProj.elements[0].customCabinetId, 'cab_1');
  assert.equal(sanitizedProj.elements[0].cabinetSpec?.drawerCount, 3);
  assert.equal(sanitizedProj.elements[0].cabinetSpec?.doorMode, 'single-right');
  assert.equal(sanitizedProj.elements[0].cabinetSpec?.hasHangingRod, true);
});
