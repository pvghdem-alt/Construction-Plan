import type {
  FloorplanElement,
  QuoteAreaUnit,
  QuoteLineItem,
  QuoteSurfaceTarget,
  SolvedFloorplan,
  WallSurfaceSummary,
} from '../types/floorplan';
import {
  ELEMENT_KIND_DEFAULTS,
  getDoorSwingLabel,
  parseDoorSwing,
} from './floorplanGeometry';

export const QUOTE_TAX_RATE = 0.05;

export const QUOTE_TARGET_LABELS: Record<QuoteSurfaceTarget, string> = {
  ceiling: '天花板',
  wall: '牆面',
  floor: '地面',
  element: '空間物件',
  custom: '自訂項目',
};

export const QUOTE_UNIT_LABELS: Record<QuoteAreaUnit, string> = {
  m2: 'm²',
  ping: '坪',
  m: 'm',
  pcs: '式/件',
};

export interface QuoteSpaceMetrics {
  ceilingAreaM2: number;
  ceilingAreaPing: number;
  wallAreaM2: number;
  wallAreaPing: number;
  floorAreaM2: number;
  floorAreaPing: number;
  perimeterM: number;
}

export interface ResolvedQuoteLine {
  item: QuoteLineItem;
  resolvedQuantity: number;
  isLiveSynced: boolean;
  lineTotal: number;
}

export interface QuotationTotals {
  lines: ResolvedQuoteLine[];
  subtotalBeforeTax: number;
  taxRate: number;
  taxAmount: number;
  grandTotal: number;
  byTarget: Record<QuoteSurfaceTarget, number>;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function computeQuoteSpaceMetrics(
  solved: SolvedFloorplan,
  wallAreaSummary: WallSurfaceSummary
): QuoteSpaceMetrics {
  return {
    ceilingAreaM2: round2(Math.max(0, solved.areaSqMeters)),
    ceilingAreaPing: round2(Math.max(0, solved.areaPing)),
    wallAreaM2: round2(Math.max(0, wallAreaSummary.totalNetAreaM2)),
    wallAreaPing: round2(Math.max(0, wallAreaSummary.totalNetAreaPing)),
    floorAreaM2: round2(Math.max(0, solved.areaSqMeters)),
    floorAreaPing: round2(Math.max(0, solved.areaPing)),
    perimeterM: round2(Math.max(0, solved.perimeterCm / 100)),
  };
}

export function resolveDefaultUnitForTarget(target: QuoteSurfaceTarget): QuoteAreaUnit {
  if (target === 'ceiling' || target === 'wall' || target === 'floor') {
    return 'm2';
  }
  return 'pcs';
}

export function resolveLiveAreaQuantity(
  target: QuoteSurfaceTarget,
  unit: QuoteAreaUnit,
  metrics: QuoteSpaceMetrics
): number | null {
  if (target === 'ceiling' || target === 'floor') {
    if (unit === 'm2') return metrics.floorAreaM2;
    if (unit === 'ping') return metrics.floorAreaPing;
    if (unit === 'm') return metrics.perimeterM;
    return null;
  }
  if (target === 'wall') {
    if (unit === 'm2') return metrics.wallAreaM2;
    if (unit === 'ping') return metrics.wallAreaPing;
    if (unit === 'm') return metrics.perimeterM;
    return null;
  }
  return null;
}

export function resolveQuoteItemQuantity(
  item: QuoteLineItem,
  metrics: QuoteSpaceMetrics
): { quantity: number; isLiveSynced: boolean } {
  if (!item.manualQuantity) {
    const live = resolveLiveAreaQuantity(item.target, item.unit, metrics);
    if (live !== null) {
      return { quantity: live, isLiveSynced: true };
    }
  }
  const safeQty = typeof item.quantity === 'number' && Number.isFinite(item.quantity)
    ? Math.max(0, item.quantity)
    : 0;
  return { quantity: round2(safeQty), isLiveSynced: false };
}

export function createBlankQuoteLineItem(
  target: QuoteSurfaceTarget = 'ceiling',
  metrics?: QuoteSpaceMetrics
): QuoteLineItem {
  const unit = resolveDefaultUnitForTarget(target);
  const liveQty = metrics ? resolveLiveAreaQuantity(target, unit, metrics) : null;
  return {
    id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    target,
    itemName: '',
    specNote: '',
    unit,
    quantity: liveQty ?? 1,
    manualQuantity: false,
    unitPrice: 0,
  };
}

export function formatElementQuoteName(el: FloorplanElement): string {
  const w = Math.round(el.widthCm);
  const d = Math.round(el.depthCm);
  const h = Math.round(el.heightCm);
  if (el.kind === 'door') {
    const parsed = parseDoorSwing(el.swingDirection);
    const hasSlidingLabel = el.name.includes('拉門') || el.name.includes('推拉');
    const title = parsed.mode === 'sliding' && !hasSlidingLabel
      ? `${el.name} 推拉門`
      : el.name;
    return `${title} (${w}×${h})`;
  }
  if (el.kind === 'window') {
    return `${el.name} (${w}×${h})`;
  }
  return `${el.name} (${w}×${d}×${h})`;
}

export function formatElementQuoteSpec(el: FloorplanElement): string {
  const w = Math.round(el.widthCm);
  const d = Math.round(el.depthCm);
  const h = Math.round(el.heightCm);
  const typeLabel = ELEMENT_KIND_DEFAULTS[el.kind]?.label ?? el.kind;
  if (el.kind === 'door') {
    return `${typeLabel} · ${getDoorSwingLabel(el.swingDirection)} · ${w}×${h} cm`;
  }
  if (el.kind === 'window') {
    return `${typeLabel} · ${w}×${h} cm (台高 ${Math.round(el.elevationCm)} cm)`;
  }
  return `${typeLabel} · ${w}×${d}×${h} cm`;
}

export function buildQuoteItemFromElement(el: FloorplanElement): QuoteLineItem {
  return {
    id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    target: 'element',
    linkedElementId: el.id,
    itemName: formatElementQuoteName(el),
    specNote: formatElementQuoteSpec(el),
    unit: 'pcs',
    quantity: 1,
    manualQuantity: true,
    unitPrice: 0,
  };
}

export function computeQuotationTotals(
  items: ReadonlyArray<QuoteLineItem>,
  metrics: QuoteSpaceMetrics
): QuotationTotals {
  const byTarget: Record<QuoteSurfaceTarget, number> = {
    ceiling: 0,
    wall: 0,
    floor: 0,
    element: 0,
    custom: 0,
  };

  let subtotalBeforeTax = 0;
  const lines: ResolvedQuoteLine[] = items.map((item) => {
    const { quantity, isLiveSynced } = resolveQuoteItemQuantity(item, metrics);
    const safePrice =
      typeof item.unitPrice === 'number' && Number.isFinite(item.unitPrice)
        ? Math.max(0, item.unitPrice)
        : 0;
    const lineTotal = Math.round(quantity * safePrice);
    subtotalBeforeTax += lineTotal;
    byTarget[item.target] = (byTarget[item.target] ?? 0) + lineTotal;
    return {
      item,
      resolvedQuantity: quantity,
      isLiveSynced,
      lineTotal,
    };
  });

  const taxAmount = Math.round(subtotalBeforeTax * QUOTE_TAX_RATE);
  const grandTotal = subtotalBeforeTax + taxAmount;

  return {
    lines,
    subtotalBeforeTax,
    taxRate: QUOTE_TAX_RATE,
    taxAmount,
    grandTotal,
    byTarget,
  };
}

function escapeCsvCell(val: string | number): string {
  const s = String(val ?? '');
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function buildQuotationCsv(
  projectName: string,
  items: ReadonlyArray<QuoteLineItem>,
  metrics: QuoteSpaceMetrics
): string {
  const totals = computeQuotationTotals(items, metrics);
  const rows: string[] = [];
  rows.push(['工程估價標單', projectName].map(escapeCsvCell).join(','));
  rows.push(
    [
      '空間面積參考',
      `天花板/地面 ${metrics.floorAreaM2.toFixed(2)} m² (${metrics.floorAreaPing.toFixed(2)} 坪)`,
      `牆面淨面積 ${metrics.wallAreaM2.toFixed(2)} m² (${metrics.wallAreaPing.toFixed(2)} 坪)`,
      `周長 ${metrics.perimeterM.toFixed(2)} m`,
    ]
      .map(escapeCsvCell)
      .join(',')
  );
  rows.push('');
  rows.push(
    ['項次', '施工對象', '施工項目 / 物件名稱', '規格備註', '數量', '單位', '單價 (NT$)', '複價 (NT$)']
      .map(escapeCsvCell)
      .join(',')
  );

  totals.lines.forEach((line, idx) => {
    rows.push(
      [
        idx + 1,
        QUOTE_TARGET_LABELS[line.item.target],
        line.item.itemName || '(未命名工項)',
        line.item.specNote || '',
        line.resolvedQuantity,
        QUOTE_UNIT_LABELS[line.item.unit],
        Math.round(line.item.unitPrice || 0),
        line.lineTotal,
      ]
        .map(escapeCsvCell)
        .join(',')
    );
  });

  rows.push('');
  rows.push(['', '', '', '', '', '', '未稅小計', totals.subtotalBeforeTax].map(escapeCsvCell).join(','));
  rows.push(['', '', '', '', '', '', '營業稅 (5%)', totals.taxAmount].map(escapeCsvCell).join(','));
  rows.push(['', '', '', '', '', '', '含稅總計', totals.grandTotal].map(escapeCsvCell).join(','));

  return `\uFEFF${rows.join('\r\n')}`;
}

export function buildQuotationPlainText(
  projectName: string,
  items: ReadonlyArray<QuoteLineItem>,
  metrics: QuoteSpaceMetrics
): string {
  const totals = computeQuotationTotals(items, metrics);
  const lines: string[] = [
    `【${projectName} — 工程估價標單】`,
    `天花板/地面面積：${metrics.floorAreaM2.toFixed(2)} m² (${metrics.floorAreaPing.toFixed(2)} 坪) · 牆面淨面積：${metrics.wallAreaM2.toFixed(2)} m² (${metrics.wallAreaPing.toFixed(2)} 坪)`,
    '',
  ];
  totals.lines.forEach((line, idx) => {
    const name = line.item.itemName || '(未命名工項)';
    const unitLabel = QUOTE_UNIT_LABELS[line.item.unit];
    const targetLabel = QUOTE_TARGET_LABELS[line.item.target];
    lines.push(
      `${idx + 1}. [${targetLabel}] ${name}：${line.resolvedQuantity} ${unitLabel} × NT$${Math.round(line.item.unitPrice || 0).toLocaleString()} = NT$${line.lineTotal.toLocaleString()}`
    );
  });
  lines.push('');
  lines.push(`未稅小計：NT$ ${totals.subtotalBeforeTax.toLocaleString()}`);
  lines.push(`營業稅 (5%)：NT$ ${totals.taxAmount.toLocaleString()}`);
  lines.push(`含稅總計：NT$ ${totals.grandTotal.toLocaleString()}`);
  return lines.join('\n');
}
