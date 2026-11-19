import { jsPDF } from 'jspdf';
import type {
  FloorplanProject,
  SolvedElementPlacement,
  SolvedFloorplan,
} from '../types/floorplan';
import {
  buildElevationSvgString,
  buildFloorplan2DSvgString,
} from './drawingSvgExport';
import { formatDimension } from './floorplanGeometry';
import { renderOffscreen3DSnapshot } from './threeSceneBuilder';

export interface PdfExportInput {
  project: FloorplanProject;
  solved: SolvedFloorplan;
  placements: SolvedElementPlacement[];
  selectedEdgeId: string | null;
  selectedElementId: string | null;
  showDimensions3D: boolean;
  /** Optional live 3D capture callback if 3D viewport is currently mounted */
  captureLive3DPng?: (() => string | null) | null;
}

const SHEET_W = 2480;
const SHEET_H = 1754;
const HEADER_H = 132;
const MARGIN = 56;

function loadImageFromSvg(svgString: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (err) => {
      URL.revokeObjectURL(url);
      reject(err);
    };
    img.src = url;
  });
}

function loadImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = dataUrl;
  });
}

function composeArchitecturalSheet(
  img: HTMLImageElement,
  options: {
    projectName: string;
    sheetTitle: string;
    sheetSubtitle: string;
    pageNumber: number;
    totalPages: number;
    metricsLine: string;
  }
): string {
  const canvas = document.createElement('canvas');
  canvas.width = SHEET_W;
  canvas.height = SHEET_H;
  const ctx = canvas.getContext('2d')!;

  // White background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, SHEET_W, SHEET_H);

  // Outer architectural frame
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 3;
  ctx.strokeRect(MARGIN, MARGIN, SHEET_W - MARGIN * 2, SHEET_H - MARGIN * 2);

  // Top title block bar
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(MARGIN, MARGIN, SHEET_W - MARGIN * 2, HEADER_H);
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(MARGIN, MARGIN + HEADER_H);
  ctx.lineTo(SHEET_W - MARGIN, MARGIN + HEADER_H);
  ctx.stroke();

  // Left: Project & Sheet Title
  ctx.fillStyle = '#0f172a';
  ctx.font = '700 42px "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(options.sheetTitle, MARGIN + 34, MARGIN + 48);

  ctx.fillStyle = '#475569';
  ctx.font = '500 24px "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif';
  ctx.fillText(
    `${options.projectName} · ${options.sheetSubtitle}`,
    MARGIN + 34,
    MARGIN + 98
  );

  // Right: Architectural metadata & page number
  ctx.textAlign = 'right';
  ctx.fillStyle = '#1e293b';
  ctx.font = '700 28px "Noto Sans TC", monospace';
  ctx.fillText(
    `圖頁 ${options.pageNumber} / ${options.totalPages}`,
    SHEET_W - MARGIN - 34,
    MARGIN + 46
  );

  ctx.fillStyle = '#64748b';
  ctx.font = '500 22px "Noto Sans TC", monospace';
  ctx.fillText(options.metricsLine, SHEET_W - MARGIN - 34, MARGIN + 96);

  // Content viewport area (aspect-fit centered)
  const contentX = MARGIN + 24;
  const contentY = MARGIN + HEADER_H + 24;
  const contentW = SHEET_W - (MARGIN + 24) * 2;
  const contentH = SHEET_H - MARGIN - 24 - contentY;

  const imgW = img.naturalWidth || img.width || 1600;
  const imgH = img.naturalHeight || img.height || 1000;
  const scale = Math.min(contentW / imgW, contentH / imgH);
  const drawW = imgW * scale;
  const drawH = imgH * scale;
  const drawX = contentX + (contentW - drawW) * 0.5;
  const drawY = contentY + (contentH - drawH) * 0.5;

  ctx.drawImage(img, drawX, drawY, drawW, drawH);

  // Bottom-right subtle date stamp
  ctx.textAlign = 'right';
  ctx.fillStyle = '#94a3b8';
  ctx.font = '500 20px "Noto Sans TC", sans-serif';
  const dateStr = new Date().toLocaleDateString('zh-TW');
  ctx.fillText(`圖稿空間轉換器匯出 · ${dateStr}`, SHEET_W - MARGIN - 24, SHEET_H - MARGIN - 18);

  return canvas.toDataURL('image/png');
}

export async function exportFloorplanBundlePdf(
  input: PdfExportInput
): Promise<{ pageCount: number; fileName: string }> {
  const {
    project,
    solved,
    placements,
    selectedEdgeId,
    selectedElementId,
    showDimensions3D,
    captureLive3DPng,
  } = input;

  const sectionLines = project.sectionLines ?? [];
  const totalPages = 2 + sectionLines.length;
  const metricsLine = `地板 ${solved.areaSqMeters.toFixed(2)} m² (${solved.areaPing.toFixed(2)} 坪) · 周長 ${formatDimension(solved.perimeterCm, project.unit)} · 天花 ${formatDimension(project.ceilingHeightCm, project.unit)}`;

  const pdf = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  // Page 1: 2D Floorplan
  const svg2D = buildFloorplan2DSvgString(project, solved, placements);
  const img2D = await loadImageFromSvg(svg2D);
  const sheet1 = composeArchitecturalSheet(img2D, {
    projectName: project.projectName,
    sheetTitle: '2D 等比例空間平面圖',
    sheetSubtitle:
      sectionLines.length > 0
        ? `含 ${sectionLines.length} 道剖面線標示`
        : '建築牆線、門窗與家具配置',
    pageNumber: 1,
    totalPages,
    metricsLine,
  });
  pdf.addImage(sheet1, 'PNG', 0, 0, 297, 210);

  // Page 2: 3D Spatial View
  let png3D = captureLive3DPng?.() ?? null;
  if (!png3D) {
    png3D = renderOffscreen3DSnapshot({
      project,
      solved,
      placements,
      selectedEdgeId,
      selectedElementId,
      wallTransparent: false,
      showCeiling: false,
      showWireframe: true,
      showDimensions: showDimensions3D,
    });
  }
  if (png3D) {
    const img3D = await loadImageFromDataUrl(png3D);
    const sheet2 = composeArchitecturalSheet(img3D, {
      projectName: project.projectName,
      sheetTitle: '3D 立體空間透視圖',
      sheetSubtitle: showDimensions3D ? '含 3D 尺寸標示' : '純淨空間模型',
      pageNumber: 2,
      totalPages,
      metricsLine,
    });
    pdf.addPage('a4', 'landscape');
    pdf.addImage(sheet2, 'PNG', 0, 0, 297, 210);
  }

  // Pages 3..N: All Section Elevation Drawings
  for (let i = 0; i < sectionLines.length; i++) {
    const sec = sectionLines[i];
    const svgElev = buildElevationSvgString(project, solved, placements, sec);
    const imgElev = await loadImageFromSvg(svgElev);
    const sheetElev = composeArchitecturalSheet(imgElev, {
      projectName: project.projectName,
      sheetTitle: `空間剖面立面圖 (${sec.label})`,
      sheetSubtitle: '門窗尺寸、窗台高度與家具立面投影',
      pageNumber: 3 + i,
      totalPages,
      metricsLine,
    });
    pdf.addPage('a4', 'landscape');
    pdf.addImage(sheetElev, 'PNG', 0, 0, 297, 210);
  }

  const safeName = (project.projectName || 'floorplan').replace(/[\\/:*?"<>|]/g, '_');
  const fileName = `${safeName}-完整圖面.pdf`;
  pdf.save(fileName);

  return { pageCount: totalPages, fileName };
}
