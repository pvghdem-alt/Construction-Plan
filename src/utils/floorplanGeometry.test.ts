import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_DOOR_SWINGS,
  applyAutoCloseToProject,
  buildDoorSwing,
  computeElementWallClearances,
  computeSectionElevation,
  computeWallSurfaceAreas,
  createPresetSectionLine,
  duplicateElementForPaste,
  flipDoorSwing,
  formatDimension,
  getDoorSwingLabel,
  parseDoorSwing,
  resolveElementPlacements,
  rotateElementAngle,
  snapAngleDeg,
  solveFloorplan,
} from './floorplanGeometry';
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



