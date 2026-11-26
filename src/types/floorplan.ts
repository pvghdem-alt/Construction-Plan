export type UnitType = 'cm' | 'm' | 'mm';

export type ElementKind =
  | 'door'
  | 'window'
  | 'cabinet'
  | 'wall_cabinet'
  | 'kitchen_counter'
  | 'table'
  | 'round_table'
  | 'chair'
  | 'sofa'
  | 'bed'
  | 'bed_curtain'
  | 'toilet'
  | 'urinal'
  | 'shower'
  | 'sink';

export type ElementCategoryId =
  | 'opening'
  | 'furniture'
  | 'storage'
  | 'bathroom'
  | 'medical';

export interface SnapGuideLine {
  axis: 'x' | 'y';
  positionCm: number;
  startCm: number;
  endCm: number;
  reason: 'wall' | 'element' | 'center';
}

export type ElementPlacementMode = 'wall' | 'free';

export type ElementSide = 'inside' | 'outside';

export type DoorSwing =
  | 'inward-left'
  | 'inward-right'
  | 'outward-left'
  | 'outward-right'
  | 'sliding-inward-left'
  | 'sliding-inward-right'
  | 'sliding-outward-left'
  | 'sliding-outward-right';

export interface FloorplanLayer {
  id: string;
  name: string;
  visible: boolean;
  /** Optional uniform hex color applied to elements on this layer unless overridden per element */
  color?: string;
}

export type QuoteSurfaceTarget = 'ceiling' | 'wall' | 'floor' | 'element' | 'custom';

export type QuoteAreaUnit = 'm2' | 'ping' | 'm' | 'pcs';

export interface QuoteLineItem {
  id: string;
  target: QuoteSurfaceTarget;
  linkedElementId?: string;
  itemName: string;
  specNote?: string;
  unit: QuoteAreaUnit;
  quantity: number;
  manualQuantity?: boolean;
  unitPrice: number;
}

export type ViewMode = '2d' | '3d' | 'split' | 'elevation' | 'quote';

export type CameraPreset = 'iso' | 'top' | 'interior' | 'reset';

export interface WallEdge {
  id: string;
  label: string;
  lengthCm: number;
  /** Bearing angle in degrees: 0 = +X (right), 90 = +Y (down), 180 = -X (left), 270 = -Y (up) */
  angleDeg: number;
  hasWall: boolean;
  note?: string;
}

export interface InteriorWall {
  id: string;
  label: string;
  /** Start X in cm relative to the outer perimeter origin (0, 0) */
  startXCm: number;
  /** Start Y in cm relative to the outer perimeter origin (0, 0) */
  startYCm: number;
  lengthCm: number;
  /** Bearing angle in degrees: 0 = +X (right), 90 = +Y (down), 180 = -X (left), 270 = -Y (up) */
  angleDeg: number;
  hasWall: boolean;
  note?: string;
}

export interface FloorplanElement {
  id: string;
  kind: ElementKind;
  name: string;
  /** 'wall' anchors to an outer edge or interior wall; 'free' uses room-space xCm/yCm/rotationDeg */
  placement?: ElementPlacementMode;
  edgeId: string;
  /** Distance in cm from the start vertex of the anchored edge/wall (when placement === 'wall') */
  offsetCm: number;
  /** Free placement center X in cm (when placement === 'free') */
  xCm?: number;
  /** Free placement center Y in cm (when placement === 'free') */
  yCm?: number;
  /** Free placement rotation in degrees (0 = facing +Y down, 90 = -X left, 180 = -Y up, 270 = +X right) */
  rotationDeg?: number;
  /** Width along local X axis in cm */
  widthCm: number;
  /** Depth along local facing axis in cm */
  depthCm: number;
  /** Vertical height in cm */
  heightCm: number;
  /** Bottom elevation from floor in cm (0 for floor items, e.g. 90 for windows) */
  elevationCm: number;
  /** Placement side relative to wall normal (when placement === 'wall') */
  side: ElementSide;
  swingDirection?: DoorSwing;
  /** Show dashed care/clearance aisle outline around beds or furniture in 2D */
  showClearance?: boolean;
  /** Show distance callouts from all 4 sides of this item to surrounding walls in 2D */
  showWallDistances?: boolean;
  /** Optional custom hex color override (e.g. #d9b382) */
  color?: string;
  /** Layer identifier for batch visibility & uniform layer coloring */
  layerId?: string;
}

export interface SectionLine {
  id: string;
  label: string;
  startXCm: number;
  startYCm: number;
  endXCm: number;
  endYCm: number;
  /** +1 or -1 perpendicular viewing side from the cut line */
  viewDirection: 1 | -1;
}

export interface FloorplanProject {
  projectName: string;
  ceilingHeightCm: number;
  wallThicknessCm: number;
  unit: UnitType;
  autoSnapAngles: boolean;
  snapToleranceDeg: number;
  forceClose: boolean;
  edges: WallEdge[];
  interiorWalls?: InteriorWall[];
  elements: FloorplanElement[];
  sectionLines?: SectionLine[];
  wallColor?: string;
  floorColor?: string;
  layers?: FloorplanLayer[];
  quoteItems?: QuoteLineItem[];
  analysisNotes?: string;
}

export interface Point2D {
  x: number;
  y: number;
}

export interface SolvedWallSegment {
  id: string;
  label: string;
  hasWall: boolean;
  isInterior: boolean;
  start: Point2D;
  end: Point2D;
  rawAngleDeg: number;
  effectiveAngleDeg: number;
  snapped: boolean;
  lengthCm: number;
  /** Unit tangent vector along wall (start -> end) */
  tangent: Point2D;
  /** Unit normal vector pointing OUTWARD (or left of tangent for interior walls) */
  outwardNormal: Point2D;
  /** Unit normal vector pointing INWARD (or right of tangent for interior walls) */
  inwardNormal: Point2D;
  midpoint: Point2D;
}

export interface SolvedEdge extends SolvedWallSegment {
  edge: WallEdge;
  index: number;
  isInterior: false;
  bowditchDeltaCm: number;
}

export interface SolvedInteriorWall extends SolvedWallSegment {
  wall: InteriorWall;
  index: number;
  isInterior: true;
}

export interface ClosureSuggestion {
  edgeId: string;
  label: string;
  currentLengthCm: number;
  suggestedLengthCm: number;
  deltaLengthCm: number;
  reason: string;
}

export interface SolvedFloorplan {
  solvedEdges: SolvedEdge[];
  solvedInteriorWalls: SolvedInteriorWall[];
  polygonPoints: Point2D[];
  rawEndPoint: Point2D;
  isClockwise: boolean;
  isClosed: boolean;
  gapCm: number;
  gapDxCm: number;
  gapDyCm: number;
  perimeterCm: number;
  areaCm2: number;
  areaSqMeters: number;
  areaPing: number;
  bounds: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
    widthCm: number;
    heightCm: number;
    centerX: number;
    centerY: number;
  };
  closureSuggestions: ClosureSuggestion[];
}

export interface SolvedElementPlacement {
  element: FloorplanElement;
  placementMode: ElementPlacementMode;
  edge: SolvedWallSegment | null;
  center: Point2D;
  startPoint: Point2D;
  endPoint: Point2D;
  /** Geometric box center in 2D cm coordinates */
  boxCenter: Point2D;
  /** Local width axis unit vector (along wall tangent for wall mode, or rotated X for free mode) */
  tangent: Point2D;
  /** Local facing axis unit vector (inward normal for wall mode, or facing direction for free mode) */
  facingNormal: Point2D;
  angleRad: number;
  angleDeg: number;
  outwardNormal: Point2D;
  inwardNormal: Point2D;
  clampedOffsetCm: number;
  clampedWidthCm: number;
}

export interface WallOpeningDeduction {
  elementId: string;
  name: string;
  kind: 'door' | 'window';
  widthCm: number;
  effectiveHeightCm: number;
  deductAreaM2: number;
}

export interface WallSurfaceBreakdownItem {
  wallId: string;
  label: string;
  isInterior: boolean;
  faces: 1 | 2;
  lengthCm: number;
  heightCm: number;
  grossAreaM2: number;
  deductionAreaM2: number;
  netAreaM2: number;
  openings: WallOpeningDeduction[];
}

export interface WallSurfaceSummary {
  ceilingHeightCm: number;
  interiorWallFaces: 1 | 2;
  items: WallSurfaceBreakdownItem[];
  totalGrossAreaM2: number;
  totalDeductionAreaM2: number;
  totalNetAreaM2: number;
  totalNetAreaPing: number;
  outerNetAreaM2: number;
  interiorPartitionNetAreaM2: number;
  floorAreaM2: number;
  floorAreaPing: number;
}

export interface ElementWallClearanceRay {
  side: 'left' | 'right' | 'back' | 'front';
  sideLabel: string;
  start: Point2D;
  end: Point2D;
  distanceCm: number;
  wallId: string;
  wallLabel: string;
}

export interface ElementWallClearancesResult {
  elementId: string;
  rays: ElementWallClearanceRay[];
}

export interface ElevationWallItem {
  wallId: string;
  label: string;
  isInterior: boolean;
  isCutThrough: boolean;
  sStartCm: number;
  sEndCm: number;
  depthCm: number;
  dStartCm?: number;
  dEndCm?: number;
  heightCm: number;
}

export interface ElevationOpeningItem {
  elementId: string;
  hostWallId?: string;
  kind: 'door' | 'window';
  name: string;
  swingDirection?: DoorSwing;
  /** +1 slides toward +S (screen right), -1 slides toward -S (screen left) in elevation view */
  slideSignInView?: 1 | -1;
  sStartCm: number;
  sEndCm: number;
  visibleSStartCm?: number;
  visibleSEndCm?: number;
  dimSStartCm?: number;
  dimSEndCm?: number;
  projectedWidthCm: number;
  actualWidthCm: number;
  elevationCm: number;
  heightCm: number;
  depthCm: number;
  color?: string;
}

export interface ElevationFurnitureItem {
  elementId: string;
  kind: Exclude<ElementKind, 'door' | 'window'>;
  name: string;
  sStartCm: number;
  sEndCm: number;
  visibleSStartCm?: number;
  visibleSEndCm?: number;
  elevationCm: number;
  heightCm: number;
  depthCm: number;
  color?: string;
}

export type ElevationRenderItem =
  | {
      kind: 'wall';
      renderDepthCm: number;
      priority: 0;
      wall: ElevationWallItem;
      wallIndex: number;
    }
  | {
      kind: 'opening';
      renderDepthCm: number;
      priority: 1;
      opening: ElevationOpeningItem;
      openingIndex: number;
    }
  | {
      kind: 'furniture';
      renderDepthCm: number;
      priority: 2;
      furniture: ElevationFurnitureItem;
    };

export interface SolvedElevation {
  sectionLine: SectionLine;
  cutLengthCm: number;
  ceilingHeightCm: number;
  sMinCm: number;
  sMaxCm: number;
  walls: ElevationWallItem[];
  openings: ElevationOpeningItem[];
  furniture: ElevationFurnitureItem[];
}



