import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_DOOR_SWINGS,
  applyAutoCloseToProject,
  applyLayersToPlacements,
  buildDoorSwing,
  buildElevationRenderItems,
  computeElementWallClearances,
  computeMagneticSnapPosition,
  computeSectionElevation,
  computeWallDragResult,
  computeWallSurfaceAreas,
  createPresetSectionLine,
  DEFAULT_FLOORPLAN_LAYERS,
  duplicateElementForPaste,
  ELEMENT_CATEGORIES,
  ELEMENT_KIND_DEFAULTS,
  flipDoorSwing,
  formatDimension,
  getDefaultLayerIdForKind,
  getDoorSwingLabel,
  getEffectiveLayers,
  parseDoorSwing,
  resolveElementEffectiveColor,
  resolveElementPlacements,
  rotateElementAngle,
  sanitizeHexColor,
  snapAngleDeg,
  solveFloorplan,
} from './floorplanGeometry';
import {
  buildQuotationCsv,
  buildQuotationPlainText,
  buildQuoteItemFromElement,
  computeQuotationTotals,
  computeQuoteSpaceMetrics,
  createBlankQuoteLineItem,
  resolveQuoteItemQuantity,
} from './quotationCalculator';
import { buildElevationSvgString, buildFloorplan2DSvgString } from './drawingSvgExport';
import {
  buildGitHubPagesShareUrl,
  decodeShareToken,
  decodeShareTokenSync,
  encodeShareToken,
  encodeShareTokenSync,
  extractShareTokenFromLocation,
  sanitizeSharedProject,
} from './shareLink';
import {
  commitBaselineToHistory,
  createHistory,
  pushHistory,
  redoHistory,
  replacePresentHistory,
  undoHistory,
} from './historyManager';
import {
  ATTACHED_SKETCH_PRESET,
  CARE_ROOM_PRESET,
  L_STUDIO_PRESET,
  ROOM_IN_ROOM_PRESET,
} from './samplePresets';
import { formatFirebaseAuthError } from './authErrorMessages';
import {
  buildShareDocId,
  mergeShareEmailLists,
  normalizeShareAccessLevel,
  parseShareEmailsInput,
  removeShareEmail,
  resolveLatestFloorplanForOwner,
} from './cloudShareHelpers';
import {
  computeCeilingRulerPosition,
  computeOpeningBadgePosition,
  computeWallDimensionLayout,
} from './threeDimensionLayout';
import {
  buildFirstPersonColliders,
  computeFirstPersonSpawn,
  findNearestSpaceInteractable,
  getForward2DFromYaw,
  isLightingElementKind,
  stepFirstPersonMovement,
} from './firstPersonNavigation';

test('snapAngleDeg snaps near-orthogonal and near-diagonal angles when enabled', () => {
  assert.deepEqual(snapAngleDeg(3, true, 8), { angleDeg: 0, snapped: true });
  assert.deepEqual(snapAngleDeg(86, true, 8), { angleDeg: 90, snapped: true });
  assert.deepEqual(snapAngleDeg(133, true, 8), { angleDeg: 135, snapped: true });
  assert.deepEqual(snapAngleDeg(133, false, 8), { angleDeg: 133, snapped: false });
});

test('L_STUDIO_PRESET solves as a closed polygon with exact area and perimeter', () => {
  const solved = solveFloorplan(L_STUDIO_PRESET);
  assert.equal(solved.isClosed, true);
  assert.ok(solved.gapCm < 0.01);
  // 600*260 + 260*160 = 156000 + 41600 = 197600 cm^2 = 19.76 m^2
  assert.ok(Math.abs(solved.areaSqMeters - 19.76) < 0.01);
  assert.equal(solved.perimeterCm, 2040);
});

test('ATTACHED_SKETCH_PRESET detects small closure gap and auto-close closes it cleanly', () => {
  const rawSolved = solveFloorplan(ATTACHED_SKETCH_PRESET);
  assert.equal(rawSolved.isClosed, false);
  assert.ok(rawSolved.gapCm > 2 && rawSolved.gapCm < 10);
  assert.ok(rawSolved.closureSuggestions.length > 0);

  const forcedSolved = solveFloorplan({ ...ATTACHED_SKETCH_PRESET, forceClose: true });
  const lastEdge = forcedSolved.solvedEdges[forcedSolved.solvedEdges.length - 1];
  const firstEdge = forcedSolved.solvedEdges[0];
  assert.ok(Math.hypot(lastEdge.end.x - firstEdge.start.x, lastEdge.end.y - firstEdge.start.y) < 1e-6);

  const autoClosedProject = applyAutoCloseToProject(ATTACHED_SKETCH_PRESET);
  const reSolved = solveFloorplan(autoClosedProject);
  assert.equal(reSolved.isClosed, true);
});

test('resolveElementPlacements handles wall-anchored beds and free-rotated tables/chairs', () => {
  const solved = solveFloorplan(CARE_ROOM_PRESET);
  const placements = resolveElementPlacements(CARE_ROOM_PRESET.elements, solved);

  const bed = placements.find((p) => p.element.kind === 'bed')!;
  const table = placements.find((p) => p.element.kind === 'table')!;
  const chair = placements.find((p) => p.element.kind === 'chair')!;

  assert.equal(bed.placementMode, 'wall');
  assert.ok(bed.edge !== null);
  // Bed depth 215 anchored on top wall W1 -> center pushed inward +Y by 107.5 cm
  assert.ok(Math.abs(bed.boxCenter.y - 107.5) < 0.1);

  assert.equal(table.placementMode, 'free');
  assert.equal(table.edge, null);
  assert.equal(table.boxCenter.x, 295);
  assert.equal(table.boxCenter.y, 365);

  assert.equal(chair.placementMode, 'free');
  // At 180 deg rotation, chair facingNormal points -Y (up toward table)
  assert.ok(Math.abs(chair.facingNormal.y - -1) < 1e-6);
});

test('wall-anchored furniture supports rotationDeg while staying flush against wall', () => {
  const solved = solveFloorplan(CARE_ROOM_PRESET);
  const rotatedBedProject = {
    ...CARE_ROOM_PRESET,
    elements: CARE_ROOM_PRESET.elements.map((el) =>
      el.kind === 'bed' ? { ...el, rotationDeg: 90 } : el
    ),
  };
  const placements = resolveElementPlacements(rotatedBedProject.elements, solved);
  const bed = placements.find((p) => p.element.kind === 'bed')!;

  // Width 100cm rotated 90 deg -> half-width 50cm flush from top wall W1
  assert.ok(Math.abs(bed.boxCenter.y - 50) < 0.1);
  // Facing normal rotated +90 deg from +Y (0,1) -> -X (-1, 0)
  assert.ok(Math.abs(bed.facingNormal.x - -1) < 1e-6);
  assert.ok(Math.abs(bed.facingNormal.y) < 1e-6);

  assert.equal(rotateElementAngle(270, 90), 0);
  assert.equal(rotateElementAngle(45, -90), 315);
  assert.equal(flipDoorSwing('inward-right', 'hinge'), 'inward-left');
  assert.equal(flipDoorSwing('inward-right', 'side'), 'outward-right');
});

test('formatDimension converts cm, m, and mm accurately', () => {
  assert.equal(formatDimension(250, 'cm'), '250 cm');
  assert.equal(formatDimension(250, 'm'), '2.50 m');
  assert.equal(formatDimension(250, 'mm'), '2500 mm');
});

test('ROOM_IN_ROOM_PRESET solves interior partition walls and anchors doors onto interior walls', () => {
  const solved = solveFloorplan(ROOM_IN_ROOM_PRESET);
  assert.equal(solved.isClosed, true);
  assert.equal(solved.solvedInteriorWalls.length, 2);

  const iw1 = solved.solvedInteriorWalls[0];
  const iw2 = solved.solvedInteriorWalls[1];
  assert.equal(iw1.isInterior, true);
  assert.equal(iw1.start.x, 214);
  assert.equal(iw1.start.y, 0);
  assert.ok(Math.abs(iw1.end.x - 214) < 1e-6);
  assert.ok(Math.abs(iw1.end.y - 160) < 1e-6);

  assert.equal(iw2.start.x, 214);
  assert.equal(iw2.start.y, 160);
  assert.ok(Math.abs(iw2.end.x - 372.5) < 1e-6);
  assert.ok(Math.abs(iw2.end.y - 160) < 1e-6);

  const placements = resolveElementPlacements(ROOM_IN_ROOM_PRESET.elements, solved);
  const subDoor = placements.find((p) => p.element.id === 'rel-door-sub')!;
  assert.ok(subDoor);
  assert.equal(subDoor.edge?.id, 'iw2');
  assert.equal(subDoor.edge?.isInterior, true);
  assert.equal(subDoor.clampedOffsetCm, 12.5);
  assert.ok(Math.abs(subDoor.startPoint.x - (214 + 12.5)) < 1e-6);
  assert.ok(Math.abs(subDoor.startPoint.y - 160) < 1e-6);
});

test('computeWallSurfaceAreas calculates gross, door/window deductions, and interior wall double faces', () => {
  const solved = solveFloorplan(ROOM_IN_ROOM_PRESET);
  const placements = resolveElementPlacements(ROOM_IN_ROOM_PRESET.elements, solved);

  const summary2Faces = computeWallSurfaceAreas(ROOM_IN_ROOM_PRESET, solved, placements, {
    interiorWallFaces: 2,
  });
  const summary1Face = computeWallSurfaceAreas(ROOM_IN_ROOM_PRESET, solved, placements, {
    interiorWallFaces: 1,
  });

  // Outer perimeter 1815 cm * height 260 cm = 47.19 m^2
  // Interior partitions: (160 + 158.5) = 318.5 cm * 260 cm = 8.281 m^2 per face -> 16.562 m^2 for 2 faces
  const expectedGross2 = (1815 * 260 + 318.5 * 260 * 2) / 10000;
  assert.ok(Math.abs(summary2Faces.totalGrossAreaM2 - expectedGross2) < 0.001);

  // Deductions:
  // Outer: main door 120*210 + main window 200*160 + high window 123*73 = 2.52 + 3.20 + 0.8979 = 6.6179 m^2
  // Interior (2 faces): sub door 90*210 * 2 = 3.78 m^2
  const expectedDeduct2 = (120 * 210 + 200 * 160 + 123 * 73 + 90 * 210 * 2) / 10000;
  assert.ok(Math.abs(summary2Faces.totalDeductionAreaM2 - expectedDeduct2) < 0.001);
  assert.ok(
    Math.abs(
      summary2Faces.totalNetAreaM2 -
        (summary2Faces.totalGrossAreaM2 - summary2Faces.totalDeductionAreaM2)
    ) < 0.001
  );

  // 1-face mode should halve interior partition net area while keeping outer net area identical
  assert.ok(Math.abs(summary2Faces.outerNetAreaM2 - summary1Face.outerNetAreaM2) < 0.001);
  assert.ok(
    Math.abs(summary2Faces.interiorPartitionNetAreaM2 - summary1Face.interiorPartitionNetAreaM2 * 2) <
      0.001
  );
});

test('historyManager supports push, live preview transaction commit, undo, and redo', () => {
  let h = createHistory(10);
  assert.equal(h.past.length, 0);
  assert.equal(h.present, 10);

  h = pushHistory(h, 20);
  assert.deepEqual(h.past, [10]);
  assert.equal(h.present, 20);

  // Live preview during drag/rotate updates present without adding intermediate past entries
  const baseline = h.present;
  h = replacePresentHistory(h, 25);
  h = replacePresentHistory(h, 30);
  assert.deepEqual(h.past, [10]);
  assert.equal(h.present, 30);

  // Commit transaction once on pointerup
  h = commitBaselineToHistory(h, baseline, h.present);
  assert.deepEqual(h.past, [10, 20]);
  assert.equal(h.present, 30);
  assert.deepEqual(h.future, []);

  // Undo & Redo
  h = undoHistory(h);
  assert.equal(h.present, 20);
  assert.deepEqual(h.future, [30]);

  h = undoHistory(h);
  assert.equal(h.present, 10);
  assert.deepEqual(h.future, [20, 30]);

  h = redoHistory(h);
  assert.equal(h.present, 20);
  assert.deepEqual(h.future, [30]);

  // Pushing new change clears future
  h = pushHistory(h, 99);
  assert.equal(h.present, 99);
  assert.deepEqual(h.future, []);
});

test('computeElementWallClearances measures distances from all 4 item sides to surrounding walls', () => {
  const solved = solveFloorplan(CARE_ROOM_PRESET);
  const placements = resolveElementPlacements(CARE_ROOM_PRESET.elements, solved);
  const table = placements.find((p) => p.element.kind === 'table')!;
  const clearances = computeElementWallClearances(table, solved, CARE_ROOM_PRESET.wallThicknessCm);

  assert.equal(clearances.rays.length, 4);
  const left = clearances.rays.find((r) => r.side === 'left')!;
  const right = clearances.rays.find((r) => r.side === 'right')!;
  const back = clearances.rays.find((r) => r.side === 'back')!;
  const front = clearances.rays.find((r) => r.side === 'front')!;

  // Table center is (295, 365), width 110 (x: 240..350), depth 60 (y: 335..395) inside 420x480 room
  assert.ok(Math.abs(left.distanceCm - 240) < 0.5);
  assert.ok(Math.abs(right.distanceCm - (420 - 350)) < 0.5);
  assert.ok(Math.abs(back.distanceCm - 335) < 0.5);
  assert.ok(Math.abs(front.distanceCm - (480 - 395)) < 0.5);

  const bed = placements.find((p) => p.element.kind === 'bed')!;
  const bedClearances = computeElementWallClearances(bed, solved, CARE_ROOM_PRESET.wallThicknessCm);
  const bedBack = bedClearances.rays.find((r) => r.side === 'back')!;
  assert.equal(bedBack.distanceCm, 0);
});

test('duplicateElementForPaste duplicates free and wall-anchored items with clean names and offsets', () => {
  const solved = solveFloorplan(CARE_ROOM_PRESET);
  const tableSource = CARE_ROOM_PRESET.elements.find((e) => e.kind === 'table')!;
  const pastedTable = duplicateElementForPaste(tableSource, CARE_ROOM_PRESET, solved, 1);

  assert.notEqual(pastedTable.id, tableSource.id);
  assert.equal(pastedTable.name, `${tableSource.name} (複製)`);
  assert.equal(pastedTable.xCm, (tableSource.xCm ?? 0) + 28);
  assert.equal(pastedTable.yCm, (tableSource.yCm ?? 0) + 28);

  const doorSource = CARE_ROOM_PRESET.elements.find((e) => e.kind === 'door')!;
  const pastedDoor = duplicateElementForPaste(doorSource, CARE_ROOM_PRESET, solved, 1);
  assert.notEqual(pastedDoor.id, doorSource.id);
  assert.notEqual(pastedDoor.offsetCm, doorSource.offsetCm);
  assert.equal(pastedDoor.edgeId, doorSource.edgeId);
});

test('computeSectionElevation projects windows, doors, and walls accurately in viewing direction', () => {
  const solved = solveFloorplan(ROOM_IN_ROOM_PRESET);
  const placements = resolveElementPlacements(ROOM_IN_ROOM_PRESET.elements, solved);

  // Horizontal section across center looking North (-Y) toward top/interior walls & windows
  const secNorth = createPresetSectionLine(solved, 'north', []);
  const elevNorth = computeSectionElevation(ROOM_IN_ROOM_PRESET, solved, placements, secNorth);

  assert.equal(elevNorth.ceilingHeightCm, ROOM_IN_ROOM_PRESET.ceilingHeightCm);
  assert.ok(elevNorth.walls.length >= 2);
  // Looking North should show the subroom interior door (y=160) & north wall windows (y=0)
  const northWindowNames = elevNorth.openings.map((o) => o.name);
  assert.ok(northWindowNames.some((n) => n.includes('窗')));
  assert.ok(elevNorth.openings.every((o) => o.actualWidthCm > 0 && o.heightCm > 0));

  // Flipping direction (looking South +Y) should look away from North wall windows (y=0)
  const secSouth = { ...secNorth, viewDirection: -1 as const };
  const elevSouth = computeSectionElevation(ROOM_IN_ROOM_PRESET, solved, placements, secSouth);
  const southWindowNames = elevSouth.openings.map((o) => o.name);
  assert.ok(!southWindowNames.some((n) => n.includes('對外大窗')));

  const secWest = createPresetSectionLine(solved, 'west', []);
  const secEast = createPresetSectionLine(solved, 'east', []);
  const elevWest = computeSectionElevation(ROOM_IN_ROOM_PRESET, solved, placements, secWest);
  const elevEast = computeSectionElevation(ROOM_IN_ROOM_PRESET, solved, placements, secEast);
  assert.ok(elevWest.openings.some((o) => o.name.includes('入口門')) || elevWest.walls.length > 0);
  assert.ok(elevEast.walls.length > 0);
  assert.equal(secWest.viewDirection, -1);
  assert.equal(secEast.viewDirection, 1);
});

test('8-variant DoorSwing helpers support swing and sliding doors across hinge, side, and type axes', () => {
  assert.equal(ALL_DOOR_SWINGS.length, 8);
  assert.deepEqual(parseDoorSwing('sliding-outward-left'), {
    mode: 'sliding',
    side: 'outward',
    dir: 'left',
  });
  assert.equal(buildDoorSwing('sliding', 'inward', 'right'), 'sliding-inward-right');
  assert.equal(getDoorSwingLabel('inward-left'), '內開·左開');
  assert.equal(getDoorSwingLabel('sliding-outward-right'), '外橫拉·往右');

  assert.equal(flipDoorSwing('inward-right', 'type'), 'sliding-inward-right');
  assert.equal(flipDoorSwing('sliding-inward-right', 'side'), 'sliding-outward-right');
  assert.equal(flipDoorSwing('sliding-outward-right', 'hinge'), 'sliding-outward-left');
  assert.equal(flipDoorSwing('sliding-outward-left', 'type'), 'outward-left');
});

test('shareLink encodes, compresses, extracts, and sanitizes read-only floorplan URLs', async () => {
  const modifiedProject = {
    ...ROOM_IN_ROOM_PRESET,
    elements: ROOM_IN_ROOM_PRESET.elements.map((el) =>
      el.kind === 'door' ? { ...el, swingDirection: 'sliding-outward-left' as const } : el
    ),
  };

  const syncToken = encodeShareTokenSync(modifiedProject);
  assert.ok(syncToken.startsWith('u:'));
  const syncDecoded = decodeShareTokenSync(syncToken);
  assert.ok(syncDecoded);
  assert.equal(syncDecoded.projectName, modifiedProject.projectName);
  const syncDoor = syncDecoded.elements.find((el) => el.kind === 'door');
  assert.equal(syncDoor?.swingDirection, 'sliding-outward-left');

  const asyncToken = await encodeShareToken(modifiedProject);
  assert.ok(asyncToken.startsWith('z:'));
  assert.ok(asyncToken.length < syncToken.length);
  const asyncDecoded = await decodeShareToken(asyncToken);
  assert.ok(asyncDecoded);
  assert.equal(asyncDecoded.edges.length, modifiedProject.edges.length);

  const shareUrl = buildGitHubPagesShareUrl('https://example.github.io/floorplan-app/', asyncToken);
  const parsedUrl = new URL(shareUrl);
  const extracted = extractShareTokenFromLocation(parsedUrl.hash, parsedUrl.search);
  assert.equal(extracted, asyncToken);

  assert.equal(sanitizeSharedProject(null), null);
  assert.equal(sanitizeSharedProject({ edges: [{ lengthCm: 100, angleDeg: 0 }] }), null);
});

test('formatFirebaseAuthError maps Firebase auth error codes to clear Traditional Chinese guidance', () => {
  const unauthDomainMsg = formatFirebaseAuthError(
    new Error('Firebase: Error (auth/unauthorized-domain).'),
    'pvghdem-alt.github.io'
  );
  assert.ok(unauthDomainMsg.includes('pvghdem-alt.github.io'));
  assert.ok(unauthDomainMsg.includes('Email / 密碼登入'));

  const invalidCredMsg = formatFirebaseAuthError(
    new Error('Firebase: Error (auth/invalid-credential).')
  );
  assert.ok(invalidCredMsg.includes('Email 或密碼不正確'));

  const weakPwMsg = formatFirebaseAuthError(new Error('Firebase: Error (auth/weak-password).'));
  assert.ok(weakPwMsg.includes('6 個字元'));

  const fallbackMsg = formatFirebaseAuthError(new Error('Custom network hiccup'));
  assert.equal(fallbackMsg, 'Custom network hiccup');
});

test('cloudShareHelpers parses, deduplicates, merges, removes emails and builds valid Firestore IDs', () => {
  const parsed = parseShareEmailsInput(
    ' Jason2134@gmail.com, pvghdem@gmail.com ; invalid-email , jason2134@gmail.com ',
    'pvghdem@gmail.com'
  );
  assert.deepEqual(parsed.validEmails, ['jason2134@gmail.com']);
  assert.deepEqual(parsed.invalidTokens, ['invalid-email']);
  assert.equal(parsed.ignoredSelf, true);

  const merged = mergeShareEmailLists(['jason2134@gmail.com'], ['UserB@example.com', 'jason2134@gmail.com']);
  assert.deepEqual(merged, ['jason2134@gmail.com', 'userb@example.com']);

  const removed = removeShareEmail(merged, 'JASON2134@gmail.com');
  assert.deepEqual(removed, ['userb@example.com']);

  const docId = buildShareDocId('uid123_abc', 'plan_1700000_xyz');
  assert.equal(docId, 'share_uid123_abc_plan_1700000_xyz');
  assert.ok(/^[a-zA-Z0-9_-]{1,128}$/.test(docId));

  const longId = buildShareDocId('u'.repeat(80), 'p'.repeat(80));
  assert.ok(longId.length <= 128);
  assert.ok(/^[a-zA-Z0-9_-]{1,128}$/.test(longId));
});

test('threeDimensionLayout keeps badges clear of wall geometry and ceiling headers', () => {
  const solved = solveFloorplan(CARE_ROOM_PRESET);
  const placements = resolveElementPlacements(CARE_ROOM_PRESET.elements, solved);
  const wallThickM = CARE_ROOM_PRESET.wallThicknessCm * 0.01;
  const ceilingM = CARE_ROOM_PRESET.ceilingHeightCm * 0.01;

  const outerLayout = computeWallDimensionLayout(wallThickM, false, 420, 0);
  assert.ok(outerLayout.spanOffsetM >= wallThickM + 0.45);
  assert.ok(outerLayout.badgeY - outerLayout.badgeHeightM * 0.5 > outerLayout.yLineM);

  const shortOddLayout = computeWallDimensionLayout(wallThickM, false, 62, 1);
  assert.ok(shortOddLayout.badgeY > outerLayout.badgeY);

  const ceilRuler = computeCeilingRulerPosition(
    solved.polygonPoints,
    solved.solvedEdges,
    wallThickM,
    ceilingM
  )!;
  assert.ok(ceilRuler.x < 0 && ceilRuler.z < 0);

  const doorPlacement = placements.find((p) => p.element.kind === 'door')!;
  const openingPos = computeOpeningBadgePosition(
    doorPlacement.center,
    doorPlacement.edge,
    wallThickM,
    ceilingM
  );
  // Bottom of opening badge must clear the top of the wall so wall headers never clip it under depthTest
  assert.ok(openingPos.y - openingPos.badgeHeightM * 0.5 > ceilingM);
  assert.ok(openingPos.leaderBottomY > ceilingM);
});

test('collaborative sharing helpers default legacy shares to editor and resolve newer shared edits for owner', () => {
  assert.equal(normalizeShareAccessLevel(undefined), 'editor');
  assert.equal(normalizeShareAccessLevel(null), 'editor');
  assert.equal(normalizeShareAccessLevel('editor'), 'editor');
  assert.equal(normalizeShareAccessLevel('viewer'), 'viewer');

  const ownSnap = {
    project: { ...CARE_ROOM_PRESET, projectName: 'Old Owner Copy' },
    summary: { areaSqMeters: 20.16, areaPing: 6.1, edgeCount: 4, elementCount: 4 },
    updatedAtMs: 10000,
  };
  const newerShareSnap = {
    project: { ...CARE_ROOM_PRESET, projectName: 'Collaborator Edited Copy' },
    summary: { areaSqMeters: 21.5, areaPing: 6.5, edgeCount: 4, elementCount: 5 },
    updatedAtMs: 15000,
    lastEditedByEmail: 'jason2134@gmail.com',
    lastEditedByName: 'jason2134@gmail.com',
  };

  const resolvedNewer = resolveLatestFloorplanForOwner(ownSnap, newerShareSnap);
  assert.equal(resolvedNewer.useSharedVersion, true);
  assert.equal(resolvedNewer.project.projectName, 'Collaborator Edited Copy');
  assert.equal(resolvedNewer.editedByLabel, 'jason2134@gmail.com');

  const olderShareSnap = { ...newerShareSnap, updatedAtMs: 10500 };
  const resolvedOwn = resolveLatestFloorplanForOwner(ownSnap, olderShareSnap);
  assert.equal(resolvedOwn.useSharedVersion, false);
  assert.equal(resolvedOwn.project.projectName, 'Old Owner Copy');
});

test('computeSectionElevation culls windows and furniture hidden behind nearer partition walls and orders back-to-front', () => {
  const projectWithSubroomCabinet = {
    ...ROOM_IN_ROOM_PRESET,
    elements: [
      ...ROOM_IN_ROOM_PRESET.elements,
      {
        id: 'cab-hidden',
        kind: 'cabinet' as const,
        name: '小房內衣櫃',
        placement: 'free' as const,
        edgeId: 'rw1',
        offsetCm: 0,
        xCm: 300,
        yCm: 50,
        widthCm: 80,
        depthCm: 45,
        heightCm: 200,
        elevationCm: 0,
        side: 'inside' as const,
      },
      {
        id: 'win-partial',
        kind: 'window' as const,
        name: '半遮擋窗',
        placement: 'wall' as const,
        edgeId: 'rw1',
        offsetCm: 170,
        widthCm: 90,
        depthCm: 12,
        heightCm: 100,
        elevationCm: 120,
        side: 'inside' as const,
      },
    ],
  };

  const solved = solveFloorplan(projectWithSubroomCabinet);
  const placements = resolveElementPlacements(projectWithSubroomCabinet.elements, solved);

  // Horizontal cut across center (y=242) looking North: iw2 (y=160, x=214..372.5) is in front of rw1 (y=0)
  const secNorth = createPresetSectionLine(solved, 'north', []);
  const elevNorth = computeSectionElevation(projectWithSubroomCabinet, solved, placements, secNorth);
  const openingNames = elevNorth.openings.map((o) => o.name);

  // Fully occluded subroom window and subroom cabinet must NOT appear
  assert.ok(!openingNames.includes('小房高窗'));
  assert.equal(
    elevNorth.furniture.some((f) => f.name === '小房內衣櫃'),
    false
  );

  // Unoccluded main window and subroom front door MUST appear
  assert.ok(openingNames.includes('主室大窗'));
  assert.ok(openingNames.includes('小房門'));

  // Partially occluded window (x=170..260 with iw2 blocking x>=214) stays visible in [170..214]
  const partialWin = elevNorth.openings.find((o) => o.name === '半遮擋窗');
  assert.ok(partialWin);
  assert.ok((partialWin.visibleSEndCm ?? partialWin.sEndCm) <= (partialWin.sEndCm - 30));
  assert.ok((partialWin.dimSEndCm ?? partialWin.sEndCm) <= (partialWin.sEndCm - 30));

  // Render order must draw rw1 & 主室大窗 before iw2 & 小房門, and cut walls last
  const renderItems = buildElevationRenderItems(elevNorth);
  const idxBackWin = renderItems.findIndex(
    (it) => it.kind === 'opening' && it.opening.name === '主室大窗'
  );
  const idxFrontPartition = renderItems.findIndex(
    (it) => it.kind === 'wall' && it.wall.wallId === 'iw2'
  );
  const idxSubDoor = renderItems.findIndex(
    (it) => it.kind === 'opening' && it.opening.name === '小房門'
  );
  const idxCutWall = renderItems.findIndex(
    (it) => it.kind === 'wall' && it.wall.isCutThrough
  );
  assert.ok(idxBackWin >= 0 && idxFrontPartition > idxBackWin);
  assert.ok(idxSubDoor > idxFrontPartition);
  assert.ok(idxCutWall > idxSubDoor);

  // Exported SVG must NOT include hidden 小房高窗 or 小房內衣櫃
  const svg = buildElevationSvgString(projectWithSubroomCabinet, solved, placements, secNorth, elevNorth);
  assert.equal(svg.includes('小房高窗'), false);
  assert.equal(svg.includes('小房內衣櫃'), false);
  assert.ok(svg.includes('主室大窗'));
  assert.ok(svg.includes('小房門'));

  // A section line placed INSIDE the small room (y=80 looking North) CAN see 小房高窗 and 小房內衣櫃
  const secInsideSubroom = {
    id: 'sec-sub',
    label: 'B-B',
    startXCm: 200,
    startYCm: 80,
    endXCm: 380,
    endYCm: 80,
    viewDirection: 1 as const,
  };
  const elevSubroom = computeSectionElevation(
    projectWithSubroomCabinet,
    solved,
    placements,
    secInsideSubroom
  );
  assert.ok(elevSubroom.openings.some((o) => o.name === '小房高窗'));
  assert.ok(elevSubroom.furniture.some((f) => f.name === '小房內衣櫃'));
  assert.equal(
    elevSubroom.openings.some((o) => o.name === '小房門'),
    false
  );
});

test('supports wall_cabinet, bed_curtain, toilet, urinal, shower, and sink across placement, elevation, SVG export, and share sanitization', () => {
  const newKinds = ['wall_cabinet', 'bed_curtain', 'toilet', 'urinal', 'shower', 'sink'] as const;
  for (const kind of newKinds) {
    assert.ok(ELEMENT_KIND_DEFAULTS[kind], `Missing defaults for ${kind}`);
  }
  assert.equal(ELEMENT_KIND_DEFAULTS.wall_cabinet.defaultPlacement, 'free');
  assert.equal(ELEMENT_KIND_DEFAULTS.wall_cabinet.elevationCm, 145);
  assert.equal(ELEMENT_KIND_DEFAULTS.bed_curtain.defaultPlacement, 'free');
  assert.equal(ELEMENT_KIND_DEFAULTS.bed_curtain.elevationCm, 40);
  assert.equal(ELEMENT_KIND_DEFAULTS.toilet.defaultPlacement, 'free');
  assert.equal(ELEMENT_KIND_DEFAULTS.urinal.defaultPlacement, 'free');
  assert.equal(ELEMENT_KIND_DEFAULTS.shower.defaultPlacement, 'free');
  assert.equal(ELEMENT_KIND_DEFAULTS.sink.defaultPlacement, 'free');

  const testProject = {
    ...CARE_ROOM_PRESET,
    elements: [
      {
        id: 'el-wc',
        kind: 'wall_cabinet' as const,
        name: '吊櫃',
        placement: 'wall' as const,
        edgeId: 'e1',
        offsetCm: 30,
        widthCm: 100,
        depthCm: 35,
        heightCm: 70,
        elevationCm: 145,
        side: 'inside' as const,
      },
      {
        id: 'el-toilet',
        kind: 'toilet' as const,
        name: '馬桶',
        placement: 'wall' as const,
        edgeId: 'e1',
        offsetCm: 150,
        widthCm: 40,
        depthCm: 70,
        heightCm: 75,
        elevationCm: 0,
        side: 'inside' as const,
      },
      {
        id: 'el-urinal',
        kind: 'urinal' as const,
        name: '小便斗',
        placement: 'wall' as const,
        edgeId: 'e1',
        offsetCm: 210,
        widthCm: 36,
        depthCm: 36,
        heightCm: 75,
        elevationCm: 50,
        side: 'inside' as const,
      },
      {
        id: 'el-shower',
        kind: 'shower' as const,
        name: '蓮蓬頭',
        placement: 'wall' as const,
        edgeId: 'e1',
        offsetCm: 270,
        widthCm: 30,
        depthCm: 35,
        heightCm: 130,
        elevationCm: 80,
        side: 'inside' as const,
      },
      {
        id: 'el-sink',
        kind: 'sink' as const,
        name: '洗手台',
        placement: 'wall' as const,
        edgeId: 'e1',
        offsetCm: 320,
        widthCm: 60,
        depthCm: 48,
        heightCm: 85,
        elevationCm: 0,
        side: 'inside' as const,
      },
      {
        id: 'el-curtain',
        kind: 'bed_curtain' as const,
        name: '病床隔簾(L型)',
        placement: 'free' as const,
        edgeId: 'e1',
        offsetCm: 0,
        xCm: 200,
        yCm: 250,
        rotationDeg: 90,
        widthCm: 160,
        depthCm: 240,
        heightCm: 210,
        elevationCm: 40,
        side: 'inside' as const,
      },
    ],
  };

  const solved = solveFloorplan(testProject);
  const placements = resolveElementPlacements(testProject.elements, solved);
  assert.equal(placements.length, 6);

  const toiletPl = placements.find((p) => p.element.kind === 'toilet')!;
  assert.equal(toiletPl.placementMode, 'wall');
  assert.ok(Math.abs(toiletPl.boxCenter.y - 35) < 0.1);

  const curtainPl = placements.find((p) => p.element.kind === 'bed_curtain')!;
  assert.equal(curtainPl.placementMode, 'free');
  assert.equal(curtainPl.boxCenter.x, 200);
  assert.equal(curtainPl.boxCenter.y, 250);
  assert.ok(Math.abs(curtainPl.facingNormal.x - -1) < 1e-6);

  // Elevation looking North (-Y) from y=320 sees all 6 fixtures
  const secNorth = createPresetSectionLine(solved, 'north', []);
  const elevNorth = computeSectionElevation(testProject, solved, placements, secNorth);
  for (const kind of newKinds) {
    assert.ok(
      elevNorth.furniture.some((f) => f.kind === kind),
      `Missing ${kind} in section elevation`
    );
  }
  const wcElev = elevNorth.furniture.find((f) => f.kind === 'wall_cabinet')!;
  assert.equal(wcElev.elevationCm, 145);
  assert.equal(wcElev.heightCm, 70);

  // 2D & Elevation SVG exports render all 6 element names cleanly
  const svg2d = buildFloorplan2DSvgString(testProject, solved, placements);
  const svgElev = buildElevationSvgString(testProject, solved, placements, secNorth, elevNorth);
  for (const el of testProject.elements) {
    assert.ok(svg2d.includes(el.name), `Missing ${el.name} in 2D SVG`);
    assert.ok(svgElev.includes(el.name), `Missing ${el.name} in Elevation SVG`);
  }

  // Share link sanitization preserves all 6 new kinds
  const sanitized = sanitizeSharedProject(testProject);
  assert.ok(sanitized);
  assert.equal(sanitized.elements.length, 6);
  for (const kind of newKinds) {
    assert.ok(sanitized.elements.some((e) => e.kind === kind));
  }
});

test('computeWallDragResult slides wall-anchored openings/fixtures and detaches fixtures pulled away from wall', () => {
  // Top horizontal wall: tangent=(1,0), inwardNormal=(0,1), facingNormal=(0,1)
  const slideRes = computeWallDragResult({
    dxCm: 55,
    dyCm: 8,
    origOffsetCm: 20,
    origBoxXCm: 40,
    origBoxYCm: 35,
    edgeLengthCm: 420,
    elementWidthCm: 40,
    tangent: { x: 1, y: 0 },
    inwardNormal: { x: 0, y: 1 },
    facingNormal: { x: 0, y: 1 },
    isOpening: false,
  });
  assert.deepEqual(slideRes, { mode: 'wall', offsetCm: 75 });

  // Pulling a fixture 60 cm away from the wall detaches smoothly to free placement keeping orientation
  const detachRes = computeWallDragResult({
    dxCm: 55,
    dyCm: 60,
    origOffsetCm: 20,
    origBoxXCm: 40,
    origBoxYCm: 35,
    edgeLengthCm: 420,
    elementWidthCm: 40,
    tangent: { x: 1, y: 0 },
    inwardNormal: { x: 0, y: 1 },
    facingNormal: { x: 0, y: 1 },
    isOpening: false,
  });
  assert.deepEqual(detachRes, { mode: 'free', xCm: 95, yCm: 95, rotationDeg: 0 });

  // Doors/windows never detach from their host wall even on large perpendicular mouse motion
  const doorRes = computeWallDragResult({
    dxCm: 40,
    dyCm: 120,
    origOffsetCm: 30,
    origBoxXCm: 85,
    origBoxYCm: 0,
    edgeLengthCm: 420,
    elementWidthCm: 110,
    tangent: { x: 1, y: 0 },
    inwardNormal: { x: 0, y: 1 },
    facingNormal: { x: 0, y: 1 },
    isOpening: true,
  });
  assert.deepEqual(doorRes, { mode: 'wall', offsetCm: 70 });

  // Disabling snap skips endpoint/midpoint snapping along wall
  const unsnappedSlide = computeWallDragResult({
    dxCm: 2,
    dyCm: 0,
    origOffsetCm: 0,
    origBoxXCm: 20,
    origBoxYCm: 35,
    edgeLengthCm: 420,
    elementWidthCm: 40,
    tangent: { x: 1, y: 0 },
    inwardNormal: { x: 0, y: 1 },
    facingNormal: { x: 0, y: 1 },
    isOpening: false,
    snapEnabled: false,
  });
  assert.deepEqual(unsnappedSlide, { mode: 'wall', offsetCm: 2 });
});

test('ELEMENT_CATEGORIES covers all 19 element kinds without duplicates', () => {
  const allDefaultKinds = Object.keys(ELEMENT_KIND_DEFAULTS);
  assert.equal(allDefaultKinds.length, 19);
  const seen: string[] = [];
  for (const cat of ELEMENT_CATEGORIES) {
    assert.ok(cat.kinds.length > 0, `Empty category: ${cat.id}`);
    for (const k of cat.kinds) {
      assert.ok(ELEMENT_KIND_DEFAULTS[k], `Unknown kind in category ${cat.id}: ${k}`);
      assert.equal(ELEMENT_KIND_DEFAULTS[k].category, cat.id);
      seen.push(k);
    }
  }
  assert.equal(seen.length, allDefaultKinds.length);
  assert.equal(new Set(seen).size, allDefaultKinds.length);
});

test('supports round_table, sofa, kitchen_counter and custom wall/floor/item hex colors', () => {
  assert.equal(ELEMENT_KIND_DEFAULTS.round_table.category, 'furniture');
  assert.equal(ELEMENT_KIND_DEFAULTS.sofa.category, 'furniture');
  assert.equal(ELEMENT_KIND_DEFAULTS.kitchen_counter.category, 'storage');

  assert.equal(sanitizeHexColor('#A1B2C3'), '#a1b2c3');
  assert.equal(sanitizeHexColor('red'), undefined);
  assert.equal(sanitizeHexColor('#xyz123'), undefined);
  assert.equal(sanitizeHexColor('123456'), undefined);

  const customProject = {
    ...CARE_ROOM_PRESET,
    wallColor: '#d1fae5',
    floorColor: '#b0845c',
    elements: [
      {
        id: 'el-rt',
        kind: 'round_table' as const,
        name: '圓桌',
        placement: 'free' as const,
        edgeId: 'e1',
        offsetCm: 0,
        xCm: 140,
        yCm: 160,
        rotationDeg: 0,
        widthCm: 110,
        depthCm: 110,
        heightCm: 75,
        elevationCm: 0,
        side: 'inside' as const,
        color: '#93c5fd',
      },
      {
        id: 'el-sofa',
        kind: 'sofa' as const,
        name: '沙發',
        placement: 'free' as const,
        edgeId: 'e1',
        offsetCm: 0,
        xCm: 280,
        yCm: 160,
        rotationDeg: 0,
        widthCm: 210,
        depthCm: 88,
        heightCm: 82,
        elevationCm: 0,
        side: 'inside' as const,
        color: '#475569',
      },
      {
        id: 'el-kc',
        kind: 'kitchen_counter' as const,
        name: '廚房一字櫥櫃',
        placement: 'wall' as const,
        edgeId: 'e1',
        offsetCm: 60,
        widthCm: 240,
        depthCm: 65,
        heightCm: 85,
        elevationCm: 0,
        side: 'inside' as const,
        color: '#ffffff',
      },
    ],
  };

  const solved = solveFloorplan(customProject);
  const placements = resolveElementPlacements(customProject.elements, solved);
  assert.equal(placements.length, 3);

  const secNorth = createPresetSectionLine(solved, 'north', []);
  const elevNorth = computeSectionElevation(customProject, solved, placements, secNorth);
  assert.equal(elevNorth.furniture.find((f) => f.kind === 'round_table')?.color, '#93c5fd');
  assert.equal(elevNorth.furniture.find((f) => f.kind === 'sofa')?.color, '#475569');
  assert.equal(elevNorth.furniture.find((f) => f.kind === 'kitchen_counter')?.color, '#ffffff');

  const svg2d = buildFloorplan2DSvgString(customProject, solved, placements);
  assert.ok(svg2d.includes('#b0845c'), '2D SVG should include custom floorColor');
  assert.ok(svg2d.includes('#d1fae5'), '2D SVG should include custom wallColor');
  assert.ok(svg2d.includes('#93c5fd'), '2D SVG should include custom item color');
  assert.ok(svg2d.includes('<ellipse'), '2D SVG should render ellipse for round_table');
  assert.ok(svg2d.includes('廚房一字櫥櫃'));

  const svgElev = buildElevationSvgString(customProject, solved, placements, secNorth, elevNorth);
  assert.ok(svgElev.includes('#d1fae5'), 'Elevation SVG should include custom wallColor');
  assert.ok(svgElev.includes('#475569'), 'Elevation SVG should include custom sofa color');

  const sanitized = sanitizeSharedProject({
    ...customProject,
    wallColor: '#D1FAE5',
    floorColor: 'not-a-hex',
  });
  assert.ok(sanitized);
  assert.equal(sanitized.wallColor, '#d1fae5');
  assert.equal(sanitized.floorColor, undefined);
  assert.equal(sanitized.elements.find((e) => e.kind === 'sofa')?.color, '#475569');

  const invalidItemColor = sanitizeSharedProject({
    ...customProject,
    elements: [{ ...customProject.elements[0], color: 'javascript:alert(1)' }],
  });
  assert.ok(invalidItemColor);
  assert.equal(invalidItemColor.elements[0].color, undefined);
});

test('computeMagneticSnapPosition snaps to walls, interior partitions, peers, rotated extents, and disables cleanly', () => {
  const projectWithPartition = {
    ...CARE_ROOM_PRESET,
    interiorWalls: [
      {
        id: 'iw1',
        label: '隔間牆',
        startXCm: 220,
        startYCm: 0,
        lengthCm: 200,
        angleDeg: 90,
        hasWall: true,
      },
    ],
    elements: [
      {
        id: 'peer-table',
        kind: 'table' as const,
        name: '鄰近桌',
        placement: 'free' as const,
        edgeId: 'e1',
        offsetCm: 0,
        xCm: 320,
        yCm: 280,
        rotationDeg: 0,
        widthCm: 100,
        depthCm: 60,
        heightCm: 75,
        elevationCm: 0,
        side: 'inside' as const,
      },
      {
        id: 'moving-sofa',
        kind: 'sofa' as const,
        name: '沙發',
        placement: 'free' as const,
        edgeId: 'e1',
        offsetCm: 0,
        xCm: 100,
        yCm: 100,
        rotationDeg: 0,
        widthCm: 100,
        depthCm: 60,
        heightCm: 82,
        elevationCm: 0,
        side: 'inside' as const,
      },
    ],
  };

  const solved = solveFloorplan(projectWithPartition);
  const placements = resolveElementPlacements(projectWithPartition.elements, solved);

  // 1. Snapping top & left edges flush against outer walls (x=0, y=0)
  const wallSnap = computeMagneticSnapPosition({
    elementId: 'moving-sofa',
    candidateXCm: 56, // left edge at 6 -> within 12cm of x=0 -> snaps center to 50
    candidateYCm: 35, // top edge at 5 -> within 12cm of y=0 -> snaps center to 30
    widthCm: 100,
    depthCm: 60,
    rotationDeg: 0,
    wallThicknessCm: 12,
    solved,
    placements,
    enabled: true,
  });
  assert.equal(wallSnap.xCm, 50);
  assert.equal(wallSnap.yCm, 30);
  assert.ok(wallSnap.guides.some((g) => g.axis === 'x' && g.reason === 'wall'));
  assert.ok(wallSnap.guides.some((g) => g.axis === 'y' && g.reason === 'wall'));

  // 2. Snapping to interior partition right face (x = 220 + 6 = 226)
  const partitionSnap = computeMagneticSnapPosition({
    elementId: 'moving-sofa',
    candidateXCm: 280, // left edge 230, 4cm from right face x=226 -> snaps center to 276
    candidateYCm: 120,
    widthCm: 100,
    depthCm: 60,
    rotationDeg: 0,
    wallThicknessCm: 12,
    solved,
    placements,
    enabled: true,
  });
  assert.equal(partitionSnap.xCm, 276);
  assert.ok(partitionSnap.guides.some((g) => g.axis === 'x' && g.reason === 'wall'));

  // 3. Snapping to adjacent peer table center X=320 and flush bottom/top edge Y=280-30=250
  const peerSnap = computeMagneticSnapPosition({
    elementId: 'moving-sofa',
    candidateXCm: 325, // 5cm from peer center 320 -> snaps to 320
    candidateYCm: 216, // bottom edge at 246, 4cm from peer top edge 250 -> snaps center to 220
    widthCm: 100,
    depthCm: 60,
    rotationDeg: 0,
    wallThicknessCm: 12,
    solved,
    placements,
    enabled: true,
  });
  assert.equal(peerSnap.xCm, 320);
  assert.equal(peerSnap.yCm, 220);
  assert.ok(peerSnap.guides.some((g) => g.axis === 'x' && g.reason === 'element'));
  assert.ok(peerSnap.guides.some((g) => g.axis === 'y' && g.reason === 'element'));

  // 4. 90 deg rotation swaps half-extents (halfX=30, halfY=50)
  const rotatedSnap = computeMagneticSnapPosition({
    elementId: 'moving-sofa',
    candidateXCm: 35, // left edge at 5 -> snaps center to 30
    candidateYCm: 54, // top edge at 4 -> snaps center to 50
    widthCm: 100,
    depthCm: 60,
    rotationDeg: 90,
    wallThicknessCm: 12,
    solved,
    placements,
    enabled: true,
  });
  assert.equal(rotatedSnap.xCm, 30);
  assert.equal(rotatedSnap.yCm, 50);

  // 5. Disabled snap returns raw rounded coordinates and no guides
  const disabledSnap = computeMagneticSnapPosition({
    elementId: 'moving-sofa',
    candidateXCm: 56.4,
    candidateYCm: 35.2,
    widthCm: 100,
    depthCm: 60,
    rotationDeg: 0,
    wallThicknessCm: 12,
    solved,
    placements,
    enabled: false,
  });
  assert.deepEqual(disabledSnap, { xCm: 56, yCm: 35, guides: [] });
});

test('element layer visibility and uniform layer coloring propagate across placements, elevation, SVG, and shareLink', () => {
  const defaultLayers = getEffectiveLayers();
  assert.equal(defaultLayers.length, DEFAULT_FLOORPLAN_LAYERS.length);
  assert.equal(getDefaultLayerIdForKind('door', defaultLayers), 'layer-opening');
  assert.equal(getDefaultLayerIdForKind('bed', defaultLayers), 'layer-medical');

  const layeredProject = {
    ...CARE_ROOM_PRESET,
    layers: defaultLayers.map((l) =>
      l.id === 'layer-opening'
        ? { ...l, visible: false }
        : l.id === 'layer-furniture'
          ? { ...l, color: '#2563eb' }
          : l
    ),
    elements: CARE_ROOM_PRESET.elements.map((el) =>
      el.kind === 'chair' ? { ...el, color: '#10b981' } : el
    ),
  };

  const solved = solveFloorplan(layeredProject);
  const allPlacements = resolveElementPlacements(layeredProject.elements, solved);
  const visiblePlacements = applyLayersToPlacements(allPlacements, layeredProject.layers);

  // Opening layer is hidden -> no doors or windows in visiblePlacements
  assert.ok(!visiblePlacements.some((p) => p.element.kind === 'door' || p.element.kind === 'window'));
  // Furniture layer has uniform color #2563eb applied to table (no individual override)
  const tablePl = visiblePlacements.find((p) => p.element.kind === 'table');
  assert.ok(tablePl);
  assert.equal(tablePl.element.color, '#2563eb');
  // Individual override on chair still wins over layer uniform color
  const chairEl = layeredProject.elements.find((e) => e.kind === 'chair');
  assert.ok(chairEl);
  assert.equal(resolveElementEffectiveColor(chairEl, layeredProject.layers), '#10b981');

  // Uniform color on opening layer propagates into 2D & Elevation SVG when visible
  const visibleDoorProject = {
    ...ATTACHED_SKETCH_PRESET,
    layers: defaultLayers.map((l) =>
      l.id === 'layer-opening' ? { ...l, visible: true, color: '#ea580c' } : l
    ),
  };
  const doorSolved = solveFloorplan(visibleDoorProject);
  const doorPlacements = applyLayersToPlacements(
    resolveElementPlacements(visibleDoorProject.elements, doorSolved),
    visibleDoorProject.layers
  );
  const svg2d = buildFloorplan2DSvgString(visibleDoorProject, doorSolved, doorPlacements);
  assert.ok(svg2d.includes('#'), '2D SVG renders opening with layer color');
  const secLine = createPresetSectionLine(doorSolved, 'west');
  const elev = computeSectionElevation(visibleDoorProject, doorSolved, doorPlacements, secLine);
  assert.ok(elev.openings.some((o) => o.color === '#ea580c'));
  const elevSvg = buildElevationSvgString(visibleDoorProject, doorSolved, doorPlacements, secLine, elev);
  assert.ok(elevSvg.includes('#ea580c'));

  // shareLink sanitization preserves layers, layerId, and quoteItems
  const sanitized = sanitizeSharedProject({
    ...layeredProject,
    elements: layeredProject.elements.map((e, i) => (i === 0 ? { ...e, layerId: 'layer-custom-1' } : e)),
    quoteItems: [
      {
        id: 'q1',
        target: 'ceiling',
        itemName: '平釘天花板',
        unit: 'm2',
        quantity: 20,
        manualQuantity: false,
        unitPrice: 1500,
      },
    ],
  });
  assert.ok(sanitized);
  assert.equal(sanitized.layers?.length, defaultLayers.length);
  assert.equal(sanitized.elements[0].layerId, 'layer-custom-1');
  assert.equal(sanitized.quoteItems?.[0].unitPrice, 1500);
});

test('quotationCalculator computes live ceiling/wall/floor areas, imports sliding door (120x210), and applies 5% tax', () => {
  const solved = solveFloorplan(ATTACHED_SKETCH_PRESET);
  const placements = resolveElementPlacements(ATTACHED_SKETCH_PRESET.elements, solved);
  const wallSummary = computeWallSurfaceAreas(ATTACHED_SKETCH_PRESET, solved, placements, {
    interiorWallFaces: 2,
  });
  const metrics = computeQuoteSpaceMetrics(solved, wallSummary);

  assert.equal(metrics.ceilingAreaM2, Math.round(solved.areaSqMeters * 100) / 100);
  assert.equal(metrics.floorAreaM2, Math.round(solved.areaSqMeters * 100) / 100);
  assert.equal(metrics.wallAreaM2, Math.round(wallSummary.totalNetAreaM2 * 100) / 100);

  // Blank ceiling row syncs automatically in m2 and ping
  const ceilingRow = {
    ...createBlankQuoteLineItem('ceiling', metrics),
    itemName: '矽酸鈣板平釘天花板',
    unitPrice: 1000,
  };
  assert.equal(resolveQuoteItemQuantity(ceilingRow, metrics).isLiveSynced, true);
  assert.equal(resolveQuoteItemQuantity(ceilingRow, metrics).quantity, metrics.ceilingAreaM2);

  // Wall row in ping syncs to wallAreaPing
  const wallPingRow = {
    ...createBlankQuoteLineItem('wall', metrics),
    itemName: '乳膠漆粉刷',
    unit: 'ping' as const,
    unitPrice: 2000,
  };
  assert.equal(resolveQuoteItemQuantity(wallPingRow, metrics).quantity, metrics.wallAreaPing);

  // Sliding door 120x210 imported from floorplan element
  const slidingDoor = {
    ...ATTACHED_SKETCH_PRESET.elements[0],
    kind: 'door' as const,
    name: '入口門',
    widthCm: 120,
    heightCm: 210,
    swingDirection: 'sliding-inward-left' as const,
  };
  const doorQuote = {
    ...buildQuoteItemFromElement(slidingDoor),
    unitPrice: 18000,
  };
  assert.ok(doorQuote.itemName.includes('120×210'));
  assert.ok(doorQuote.itemName.includes('推拉門'));
  assert.equal(doorQuote.unit, 'pcs');

  const totals = computeQuotationTotals([ceilingRow, wallPingRow, doorQuote], metrics);
  const expectedSubtotal =
    Math.round(metrics.ceilingAreaM2 * 1000) +
    Math.round(metrics.wallAreaPing * 2000) +
    18000;
  assert.equal(totals.subtotalBeforeTax, expectedSubtotal);
  assert.equal(totals.taxAmount, Math.round(expectedSubtotal * 0.05));
  assert.equal(totals.grandTotal, expectedSubtotal + totals.taxAmount);

  const csv = buildQuotationCsv(ATTACHED_SKETCH_PRESET.projectName, [doorQuote], metrics);
  assert.ok(csv.startsWith('\uFEFF'), 'CSV starts with UTF-8 BOM');
  assert.ok(csv.includes('營業稅 (5%)'));
  assert.ok(csv.includes('18900'));

  const txt = buildQuotationPlainText(ATTACHED_SKETCH_PRESET.projectName, [doorQuote], metrics);
  assert.ok(txt.includes('含稅總計'));
});

test('lighting fixtures (panel, track, recessed, wall_sconce) support defaults, lighting layer, lightOn switch, SVG & shareLink', () => {
  const lampKinds = ['panel_light', 'track_light', 'recessed_light', 'wall_sconce'] as const;
  for (const kind of lampKinds) {
    assert.equal(isLightingElementKind(kind), true);
    assert.equal(ELEMENT_KIND_DEFAULTS[kind].category, 'lighting');
    assert.equal(getDefaultLayerIdForKind(kind, DEFAULT_FLOORPLAN_LAYERS), 'layer-lighting');
  }
  assert.equal(isLightingElementKind('bed'), false);

  const projectWithLamps = {
    ...CARE_ROOM_PRESET,
    elements: [
      ...CARE_ROOM_PRESET.elements,
      {
        id: 'lamp-panel',
        kind: 'panel_light' as const,
        name: '平板燈',
        placement: 'free' as const,
        edgeId: 'c1',
        offsetCm: 0,
        xCm: 180,
        yCm: 200,
        widthCm: 60,
        depthCm: 60,
        heightCm: 4,
        elevationCm: 246,
        side: 'inside' as const,
        lightOn: true,
      },
      {
        id: 'lamp-sconce',
        kind: 'wall_sconce' as const,
        name: '壁燈',
        placement: 'wall' as const,
        edgeId: 'c1',
        offsetCm: 140,
        widthCm: 26,
        depthCm: 14,
        heightCm: 24,
        elevationCm: 175,
        side: 'inside' as const,
        lightOn: false,
      },
    ],
  };

  const solved = solveFloorplan(projectWithLamps);
  const placements = resolveElementPlacements(projectWithLamps.elements, solved);
  const svgOn = buildFloorplan2DSvgString(projectWithLamps, solved, placements);
  assert.ok(svgOn.includes('平板燈'));
  assert.ok(svgOn.includes('壁燈'));
  assert.ok(svgOn.includes('#fef9c3'), 'ON panel light renders warm fill in 2D SVG');
  assert.ok(svgOn.includes('#f1f5f9'), 'OFF sconce renders muted fill in 2D SVG');

  // Verify lightOn state is preserved by shareLink sanitization
  const sanitized = sanitizeSharedProject(projectWithLamps);
  assert.ok(sanitized);
  const sanPanel = sanitized.elements.find((e) => e.id === 'lamp-panel');
  const sanSconce = sanitized.elements.find((e) => e.id === 'lamp-sconce');
  assert.equal(sanPanel?.lightOn, true);
  assert.equal(sanSconce?.lightOn, false);

  // Hiding layer-lighting removes lighting fixtures from visible placements
  const hiddenLampsLayers = DEFAULT_FLOORPLAN_LAYERS.map((l) =>
    l.id === 'layer-lighting' ? { ...l, visible: false } : l
  );
  const visible = applyLayersToPlacements(placements, hiddenLampsLayers);
  assert.equal(visible.some((p) => isLightingElementKind(p.element.kind)), false);
});

test('firstPersonNavigation spawns at ~160cm, collides with walls & closed doors, passes open doors, and locates Space targets', () => {
  const solved = solveFloorplan(ROOM_IN_ROOM_PRESET);
  const placements = resolveElementPlacements(ROOM_IN_ROOM_PRESET.elements, solved);

  // Closed colliders block walking straight through North outer wall (y=0) or subroom partition wall
  const closedMap: Record<string, boolean> = {};
  const collidersClosed = buildFirstPersonColliders(
    solved,
    placements,
    ROOM_IN_ROOM_PRESET.wallThicknessCm,
    closedMap
  );

  const spawn = computeFirstPersonSpawn(
    solved,
    collidersClosed,
    ROOM_IN_ROOM_PRESET.ceilingHeightCm,
    placements
  );
  assert.equal(spawn.eyeHeightCm, 160);
  assert.ok(spawn.xCm > 25 && spawn.xCm < solved.bounds.maxX - 25);
  assert.ok(spawn.yCm > 25 && spawn.yCm < solved.bounds.maxY - 25);

  // Short ceiling (170 cm) clamps eye height safely below ceiling
  const shortSpawn = computeFirstPersonSpawn(solved, collidersClosed, 170, placements);
  assert.equal(shortSpawn.eyeHeightCm, 152);

  // Walking straight North (yaw=0 -> forward=(0,-1)) toward outer North wall (y=0) stops outside wall + player radius
  let pos = { x: 100, y: 60 };
  for (let i = 0; i < 30; i++) {
    pos = stepFirstPersonMovement({
      xCm: pos.x,
      yCm: pos.y,
      yawRad: 0,
      forwardInput: 1,
      rightInput: 0,
      dtSec: 0.05,
      colliders: collidersClosed,
    });
  }
  assert.ok(pos.y >= 20, `Player should be stopped by North wall (y=${pos.y})`);

  // Walking into the closed subroom door along iw2 (y=160, x=214..372.5, subroom door x ~234..324) stops on main-room side
  let doorPos = { x: 279, y: 210 };
  for (let i = 0; i < 30; i++) {
    doorPos = stepFirstPersonMovement({
      xCm: doorPos.x,
      yCm: doorPos.y,
      yawRad: 0,
      forwardInput: 1,
      rightInput: 0,
      dtSec: 0.05,
      colliders: collidersClosed,
    });
  }
  assert.ok(doorPos.y > 165, `Closed door should block passage across iw2 (y=${doorPos.y})`);

  // Nearest interactable from (279, 210) facing North is the subroom door
  const fwd = getForward2DFromYaw(0);
  const subDoorTarget = findNearestSpaceInteractable(doorPos.x, doorPos.y, fwd.x, fwd.y, placements, 240);
  assert.ok(subDoorTarget);
  assert.equal(subDoorTarget.kind, 'door');

  // Once that door is opened via Space, rebuilding colliders carves the doorway and player walks smoothly into subroom (y < 140)
  const openedMap: Record<string, boolean> = { [subDoorTarget.id]: true };
  const collidersOpen = buildFirstPersonColliders(
    solved,
    placements,
    ROOM_IN_ROOM_PRESET.wallThicknessCm,
    openedMap
  );
  let openWalkPos = { ...doorPos };
  for (let i = 0; i < 30; i++) {
    openWalkPos = stepFirstPersonMovement({
      xCm: openWalkPos.x,
      yCm: openWalkPos.y,
      yawRad: 0,
      forwardInput: 1,
      rightInput: 0,
      dtSec: 0.05,
      colliders: collidersOpen,
    });
  }
  assert.ok(openWalkPos.y < 130, `Open door should allow walking into subroom (y=${openWalkPos.y})`);

  // Verify Spacebar also detects L-shaped bed_curtain
  const projectWithCurtain = {
    ...CARE_ROOM_PRESET,
    elements: [
      ...CARE_ROOM_PRESET.elements,
      {
        id: 'curtain-test',
        kind: 'bed_curtain' as const,
        name: '病床隔簾(L型)',
        placement: 'free' as const,
        edgeId: 'c1',
        offsetCm: 0,
        xCm: 150,
        yCm: 150,
        widthCm: 150,
        depthCm: 230,
        heightCm: 205,
        elevationCm: 40,
        side: 'inside' as const,
      },
    ],
  };
  const careSolved = solveFloorplan(projectWithCurtain);
  const carePlacements = resolveElementPlacements(projectWithCurtain.elements, careSolved);
  const curtainPl = carePlacements.find((p) => p.element.kind === 'bed_curtain')!;
  assert.ok(curtainPl);
  const nearCurtain = findNearestSpaceInteractable(
    curtainPl.boxCenter.x,
    curtainPl.boxCenter.y,
    0,
    1,
    carePlacements,
    240
  );
  assert.ok(nearCurtain);
  assert.equal(nearCurtain.id, curtainPl.element.id);
  assert.equal(nearCurtain.kind, 'bed_curtain');

  // Verify A/D yaw rotation turns facing direction cleanly (left +yaw faces -X, right -yaw faces +X)
  const leftYaw = Math.PI / 2;
  const fwdLeft = getForward2DFromYaw(leftYaw);
  assert.ok(fwdLeft.x < -0.99 && Math.abs(fwdLeft.y) < 1e-6);
  const rightYaw = -Math.PI / 2;
  const fwdRight = getForward2DFromYaw(rightYaw);
  assert.ok(fwdRight.x > 0.99 && Math.abs(fwdRight.y) < 1e-6);
});
