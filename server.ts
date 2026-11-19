import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const FLOORPLAN_PROMPT = `你是一位專業的建築與室內設計製圖分析師。請仔細閱讀這份手寫平面圖草圖（可能是圖片或 PDF，且圖面可能旋轉 90 度，請先以文字方向判讀正確方位）。

請將草圖中的所有空間資訊結構化為嚴格的幾何資料（所有長度單位統一轉換為「公分 cm」，可保留一位小數如 12.5）：

1. **天花板高度 (ceilingHeightCm)**：
   - 尋找草圖上標註的「天花高度」、「天花板」、「樓高」、「H=」等數值（例如「天花高度 250」即為 250）。
   - 若圖面未標註，請設為 250（若窗戶上緣「離地 + 窗高」超過 250，則至少取至容納窗戶的高度），並在 analysisNotes 說明使用預設值。

2. **外圍牆壁輪廓 (edges) —— 只追蹤最外圈封閉外牆**：
   - 請從空間「最左上角」(0, 0) 開始，依「順時針」方向依序追蹤**最外圈**封閉空間的每一段邊界。
   - **絕對不要**把室內隔間牆（房中房、小房間、浴室、儲藏室的隔間牆）放進 \`edges\`！室內隔間牆請一律放到第 3 項的 \`interiorWalls\`。
   - **同一直線牆面的分段尺寸合併**：若同一面直牆上標註了多段連續數字（例如 \`23\` + \`門 120\` + \`54\`，或 \`146\` + \`338\`，或 \`窗 200\` + \`14\` + 小房寬 \`158.5\`），請**合併為同一條外牆邊界**，\`lengthCm\` 為各段總和，並把門/窗以正確的 \`offsetCm\` 附著在該牆上。
   - **牆面內凸柱體 / 凹槽（柱子）**：若某面外牆中間有一塊向室內凸出的方形結構柱（例如標註 \`51\`、\`42\`、\`51\` 形成向內突出矩形），必須在順時針外圍輪廓中依序轉折追蹤這 3 段牆壁（例如向內轉、橫越柱寬、向外轉回主牆線），不要忽略柱子。
   - \`angleDeg\` 採用標準 2D 平面圖方位角：
     - 0 = 向右 (+X)
     - 90 = 向下 (+Y)
     - 180 = 向左 (-X)
     - 270 = 向上 (-Y)
     - 斜角牆面（例如 45° 切角）請給出精確斜角如 45、135、225、315。
   - \`lengthCm\` 為該段牆壁總長度（公分），必須大於 0。

3. **室內隔間牆 / 房中房 (interiorWalls)**：
   - 若大房間內部還有用線條隔出的「小房間」、「衛浴」、「更衣室」或「獨立隔間牆」，請把每一段隔間牆獨立列在 \`interiorWalls\` 中（若無隔間牆則回傳空陣列 \`[]\`）。
   - 座標系原點 \`(0, 0)\` 為外圍第 1 條邊 \`edges[0]\` 的起點（空間最左上角），向右為 \`+X\`，向下為 \`+Y\`。
   - 每段隔間牆需提供準確的起點 \`startXCm\`、\`startYCm\`、長度 \`lengthCm\`、方位角 \`angleDeg\`（0=向右、90=向下、180=向左、270=向上）與 \`hasWall: true\`。
   - 範例推算：若上側主牆從左上角 \`(0,0)\` 起算，左側窗寬 \`200\` 後接一小段牆 \`14\`，接著有一條垂直向下的隔間牆長 \`160\`，則該隔間牆為 \`startXCm = 214, startYCm = 0, lengthCm = 160, angleDeg = 90\`；若其底端再向右延伸 \`12.5 + 90 + 56 = 158.5\` cm 接到右側外牆，則第二段隔間牆為 \`startXCm = 214, startYCm = 160, lengthCm = 158.5, angleDeg = 0\`。

4. **空間元件與家具 (elements)**：
   - 辨識草圖上標註的所有「門 (door)」、「窗戶 / 窗 (window)」、「櫃 / 系統櫃 / 衣櫃 (cabinet)」，以及家具：「桌子 (table)」、「椅子 (chair)」、「病床 (bed)」。
   - **仔細讀取窗戶與門的手寫標註**：
     - 窗戶常見格式如「窗 寬200×高160 離地90」→ \`widthCm = 200, heightCm = 160, elevationCm = 90\`；「窗 寬123×高73 離地172」→ \`widthCm = 123, heightCm = 73, elevationCm = 172\`。若有寫出明確數字，請**務必採用手寫數字**，不可被預設值覆蓋。
     - 門常見格式如「門 120」→ \`widthCm = 120, heightCm = 210, elevationCm = 0\`；若門兩側標有距離如 \`12.5\` 與 \`56\`，則 \`offsetCm = 12.5\`（距該牆段起點之距離）。
   - \`placement\` 與依附牆壁：
     - 貼牆或嵌在牆上的門、窗、靠牆櫃、靠牆病床設為 \`"wall"\`：
       - 若該元件位於**外圍牆壁 (\`edges\`)** 上：設 \`wallTarget = "outer"\`、\`edgeIndex\`（\`edges\` 的 0-based 索引）與 \`offsetCm\`（從該牆段「順時針起點」算起的公分數；注意由右向左的底牆 \`angleDeg=180\`，起點在右側，若從左側起算距離需換算）。
       - 若該元件位於**室內隔間牆 (\`interiorWalls\`)** 上（例如小房間牆上的門）：設 \`wallTarget = "interior"\`、\`interiorWallIndex\`（\`interiorWalls\` 的 0-based 索引）與 \`offsetCm\`（從該隔間牆 \`(startXCm, startYCm)\` 算起的公分數）。
     - 若元件位於空間中央或未貼牆（如桌子、椅子、獨立病床），設為 \`"free"\`，並提供中心座標 \`xCm\`、\`yCm\` 與旋轉角度 \`rotationDeg\`（0 = 朝下/+Y、90 = 朝左/-X、180 = 朝上/-Y、270 = 朝右/+X）。
   - 未標註尺寸時之預設：門寬 90/高 210、窗寬 140/高 140/離地 90、櫃深 60/高 210、桌 120×60×75、椅 48×48×85、病床 100×215×60。

5. **分析備註 (analysisNotes)**：
   - 輸出 JSON 前請先自我核對一次：(a) 上方總寬與下方總寬是否大致相符；(b) 左側總高與右側總高是否大致相符；(c) 隔間牆端點是否確實連接外牆或另一段隔間牆；(d) 門窗 \`offsetCm\` 是否符合順時針／隔間牆起點方向。
   - 在 \`analysisNotes\` 中用繁體中文簡要總結辨識出的主空間尺寸、隔間小房、柱體與門窗數值，以及任何手寫略微誤差處。`;

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return 'Unknown error';
  }
}

function isTransientOverloadError(err: unknown): boolean {
  const msg = extractErrorMessage(err).toUpperCase();
  const status =
    typeof err === 'object' && err !== null && 'status' in err
      ? Number((err as { status?: unknown }).status)
      : undefined;
  if (status === 503 || status === 502 || status === 504) return true;
  return (
    msg.includes('503') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('HIGH DEMAND') ||
    msg.includes('OVERLOADED') ||
    msg.includes('DEADLINE_EXCEEDED') ||
    msg.includes('ECONNRESET') ||
    msg.includes('ETIMEDOUT')
  );
}

async function callFloorplanModel(
  ai: GoogleGenAI,
  model: string,
  mimeType: string,
  base64Data: string
) {
  return ai.models.generateContent({
    model,
    contents: {
      parts: [
        {
          inlineData: {
            mimeType,
            data: base64Data,
          },
        },
        { text: FLOORPLAN_PROMPT },
      ],
    },
    config: {
      systemInstruction:
        'You are an architectural drafting parser. Always return strictly valid JSON matching the schema. Use Traditional Chinese for labels and notes.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          projectName: {
            type: Type.STRING,
            description: 'Concise Traditional Chinese title for the room plan.',
          },
          ceilingHeightCm: {
            type: Type.NUMBER,
            description: 'Ceiling height in centimeters (default 250 if unspecified).',
          },
          analysisNotes: {
            type: Type.STRING,
            description: 'Summary in Traditional Chinese of recognized elements and any ambiguities.',
          },
          edges: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                label: { type: Type.STRING },
                lengthCm: { type: Type.NUMBER },
                angleDeg: { type: Type.NUMBER },
                hasWall: { type: Type.BOOLEAN },
              },
              required: ['label', 'lengthCm', 'angleDeg', 'hasWall'],
            },
          },
          interiorWalls: {
            type: Type.ARRAY,
            description: 'Interior partition walls (e.g. rooms inside a room). Empty array if none.',
            items: {
              type: Type.OBJECT,
              properties: {
                label: { type: Type.STRING },
                startXCm: { type: Type.NUMBER },
                startYCm: { type: Type.NUMBER },
                lengthCm: { type: Type.NUMBER },
                angleDeg: { type: Type.NUMBER },
                hasWall: { type: Type.BOOLEAN },
              },
              required: ['label', 'startXCm', 'startYCm', 'lengthCm', 'angleDeg', 'hasWall'],
            },
          },
          elements: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                kind: {
                  type: Type.STRING,
                  description: 'Must be one of: door, cabinet, window, table, chair, bed',
                },
                name: { type: Type.STRING },
                placement: {
                  type: Type.STRING,
                  description: 'wall or free',
                },
                wallTarget: {
                  type: Type.STRING,
                  description: 'outer (for edges) or interior (for interiorWalls)',
                },
                edgeIndex: { type: Type.INTEGER },
                interiorWallIndex: { type: Type.INTEGER },
                offsetCm: { type: Type.NUMBER },
                xCm: { type: Type.NUMBER },
                yCm: { type: Type.NUMBER },
                rotationDeg: { type: Type.NUMBER },
                widthCm: { type: Type.NUMBER },
                depthCm: { type: Type.NUMBER },
                heightCm: { type: Type.NUMBER },
                elevationCm: { type: Type.NUMBER },
                side: {
                  type: Type.STRING,
                  description: 'inside or outside',
                },
                swingDirection: {
                  type: Type.STRING,
                  description:
                    'Optional for door: inward-left, inward-right, outward-left, or outward-right',
                },
              },
              required: [
                'kind',
                'name',
                'placement',
                'wallTarget',
                'edgeIndex',
                'interiorWallIndex',
                'offsetCm',
                'widthCm',
                'depthCm',
                'heightCm',
                'elevationCm',
                'side',
              ],
            },
          },
        },
        required: [
          'projectName',
          'ceilingHeightCm',
          'analysisNotes',
          'edges',
          'interiorWalls',
          'elements',
        ],
      },
    },
  });
}

async function analyzeWithRetry(
  ai: GoogleGenAI,
  mimeType: string,
  base64Data: string,
  attempts = 3
) {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await callFloorplanModel(ai, 'gemini-4-hydrogen', mimeType, base64Data);
    } catch (err) {
      lastErr = err;
      if (!isTransientOverloadError(err)) {
        throw err;
      }
      if (i < attempts - 1) {
        const baseDelay = 1100 * Math.pow(2, i);
        const jitter = Math.floor(Math.random() * 400);
        await new Promise((r) => setTimeout(r, baseDelay + jitter));
      }
    }
  }

  // Secondary fallback model when gemini-4-hydrogen experiences a sustained 503 spike
  if (isTransientOverloadError(lastErr)) {
    try {
      return await callFloorplanModel(ai, 'gemini-3.1-flash-lite', mimeType, base64Data);
    } catch (fallbackErr) {
      lastErr = fallbackErr;
    }
  }

  throw lastErr;
}

async function createServer() {
  const app = express();
  app.use(express.json({ limit: '25mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.post('/api/analyze-floorplan', async (req, res) => {
    try {
      const { mimeType, dataBase64, fileName, useSamplePdf } = req.body ?? {};

      let resolvedMime = typeof mimeType === 'string' ? mimeType : '';
      let resolvedBase64 = typeof dataBase64 === 'string' ? dataBase64 : '';

      if (useSamplePdf) {
        const samplePath = path.join(
          __dirname,
          'public/assets/aistudio/20261119_094437_bf0502ec.pdf'
        );
        if (!fs.existsSync(samplePath)) {
          res.status(404).json({ error: '找不到內建範例 PDF 草圖檔案。' });
          return;
        }
        resolvedMime = 'application/pdf';
        resolvedBase64 = fs.readFileSync(samplePath).toString('base64');
      }

      if (!ALLOWED_MIME_TYPES.has(resolvedMime)) {
        res.status(400).json({
          error: '不支援的檔案格式，請上傳 JPG、PNG、WebP 圖片或 PDF 檔案。',
        });
        return;
      }

      if (!resolvedBase64 || resolvedBase64.length < 16) {
        res.status(400).json({ error: '上傳檔案內容為空，請重新選擇檔案。' });
        return;
      }

      // Strip data URL prefix if client included it
      const cleanBase64 = resolvedBase64.includes(',')
        ? resolvedBase64.split(',').pop() || ''
        : resolvedBase64;

      const ai = getGeminiClient();
      if (!ai) {
        res.status(503).json({
          error:
            '伺服器尚未設定有效的 GEMINI_API_KEY。請於 AI Studio 的 Settings > Secrets 面板確認 GEMINI_API_KEY 設定。',
        });
        return;
      }

      const aiResponse = await analyzeWithRetry(ai, resolvedMime, cleanBase64);
      const rawText = (aiResponse.text ?? '').trim();
      if (!rawText) {
        res.status(502).json({ error: 'AI 模型未回傳有效的平面圖分析結果，請再試一次。' });
        return;
      }

      const parsed = JSON.parse(rawText);
      const rawEdges = Array.isArray(parsed.edges) ? parsed.edges : [];
      if (rawEdges.length < 3) {
        res.status(422).json({
          error: '辨識到的牆壁邊界少於 3 段，無法構成空間輪廓，請上傳更清晰的草圖。',
        });
        return;
      }

      const round1 = (val: unknown, fallback: number): number => {
        const num = Number(val);
        return Number.isFinite(num) ? Math.round(num * 10) / 10 : fallback;
      };

      const timestamp = Date.now();
      const edges = rawEdges.map((edge: Record<string, unknown>, idx: number) => ({
        id: `ai-w-${timestamp}-${idx + 1}`,
        label:
          typeof edge.label === 'string' && edge.label.trim()
            ? edge.label.trim()
            : `W${idx + 1}`,
        lengthCm: Math.max(5, round1(edge.lengthCm, 100)),
        angleDeg: ((Number(edge.angleDeg) || 0) % 360 + 360) % 360,
        hasWall: edge.hasWall !== false,
      }));

      const rawInteriorWalls = Array.isArray(parsed.interiorWalls) ? parsed.interiorWalls : [];
      const interiorWalls = rawInteriorWalls
        .filter((w: unknown) => typeof w === 'object' && w !== null)
        .map((w: Record<string, unknown>, idx: number) => ({
          id: `ai-iw-${timestamp}-${idx + 1}`,
          label:
            typeof w.label === 'string' && w.label.trim()
              ? w.label.trim()
              : `I${idx + 1} 隔間牆`,
          startXCm: round1(w.startXCm, 0),
          startYCm: round1(w.startYCm, 0),
          lengthCm: Math.max(5, round1(w.lengthCm, 100)),
          angleDeg: ((Number(w.angleDeg) || 0) % 360 + 360) % 360,
          hasWall: w.hasWall !== false,
        }));

      let ceilingHeightCm = Math.min(
        800,
        Math.max(120, Math.round(Number(parsed.ceilingHeightCm) || 250))
      );

      const allowedKinds = new Set(['door', 'cabinet', 'window', 'table', 'chair', 'bed']);
      const allowedSwings = new Set([
        'inward-left',
        'inward-right',
        'outward-left',
        'outward-right',
      ]);
      const kindDefaults: Record<
        string,
        { name: string; w: number; d: number; h: number; elev: number }
      > = {
        door: { name: '門', w: 90, d: 12, h: 210, elev: 0 },
        cabinet: { name: '櫃體', w: 100, d: 60, h: 210, elev: 0 },
        window: { name: '窗戶', w: 140, d: 12, h: 140, elev: 90 },
        table: { name: '桌子', w: 120, d: 60, h: 75, elev: 0 },
        chair: { name: '椅子', w: 48, d: 48, h: 85, elev: 0 },
        bed: { name: '病床', w: 100, d: 215, h: 60, elev: 0 },
      };

      const rawElements = Array.isArray(parsed.elements) ? parsed.elements : [];

      // Ensure ceiling height accommodates any explicitly dimensioned tall window or door
      for (const el of rawElements) {
        if (typeof el === 'object' && el !== null) {
          const rec = el as Record<string, unknown>;
          const elev = Number(rec.elevationCm);
          const h = Number(rec.heightCm);
          if (Number.isFinite(elev) && Number.isFinite(h) && elev >= 0 && h > 0) {
            const top = Math.ceil(elev + h);
            if (top > ceilingHeightCm && top <= 800) {
              ceilingHeightCm = top;
            }
          }
        }
      }

      const elements = rawElements.map((el: Record<string, unknown>, idx: number) => {
        const rawKind = String(el.kind || '').toLowerCase();
        const kind = allowedKinds.has(rawKind) ? rawKind : 'cabinet';
        const defs = kindDefaults[kind];
        const useInterior =
          el.wallTarget === 'interior' && interiorWalls.length > 0;
        const edgeIdx = Math.min(
          edges.length - 1,
          Math.max(0, Math.round(Number(el.edgeIndex) || 0))
        );
        const iwIdx = Math.min(
          Math.max(0, interiorWalls.length - 1),
          Math.max(0, Math.round(Number(el.interiorWallIndex) || 0))
        );
        const resolvedEdgeId = useInterior
          ? interiorWalls[iwIdx].id
          : edges[edgeIdx].id;

        const placement =
          el.placement === 'free' || (kind === 'table' || kind === 'chair') && el.placement !== 'wall'
            ? 'free'
            : 'wall';
        const rawSwing = typeof el.swingDirection === 'string' ? el.swingDirection : '';
        const swingDirection = allowedSwings.has(rawSwing) ? rawSwing : 'inward-right';

        return {
          id: `ai-el-${timestamp}-${idx + 1}`,
          kind,
          name:
            typeof el.name === 'string' && el.name.trim()
              ? el.name.trim()
              : defs.name,
          placement,
          edgeId: resolvedEdgeId,
          offsetCm: Math.max(0, round1(el.offsetCm, 0)),
          ...(placement === 'free'
            ? {
                xCm: round1(el.xCm, 150),
                yCm: round1(el.yCm, 150),
                rotationDeg: ((Number(el.rotationDeg) || 0) % 360 + 360) % 360,
              }
            : el.rotationDeg !== undefined && Number.isFinite(Number(el.rotationDeg))
              ? {
                  rotationDeg: ((Number(el.rotationDeg) % 360) + 360) % 360,
                }
              : {}),
          widthCm: Math.max(15, round1(el.widthCm, defs.w)),
          depthCm: Math.max(8, round1(el.depthCm, defs.d)),
          heightCm: Math.min(
            ceilingHeightCm,
            Math.max(20, round1(el.heightCm, defs.h))
          ),
          elevationCm: Math.max(0, round1(el.elevationCm, defs.elev)),
          side: el.side === 'outside' ? 'outside' : 'inside',
          ...(kind === 'door' ? { swingDirection } : {}),
          ...(kind === 'bed' ? { showClearance: true } : {}),
        };
      });

      res.json({
        project: {
          projectName:
            typeof parsed.projectName === 'string' && parsed.projectName.trim()
              ? parsed.projectName.trim()
              : fileName
                ? `${fileName} 辨識結果`
                : 'AI 草圖辨識空間',
          ceilingHeightCm,
          wallThicknessCm: 12,
          unit: 'cm',
          autoSnapAngles: true,
          snapToleranceDeg: 8,
          forceClose: false,
          edges,
          ...(interiorWalls.length > 0 ? { interiorWalls } : {}),
          elements,
          analysisNotes:
            typeof parsed.analysisNotes === 'string'
              ? parsed.analysisNotes
              : '已完成手寫平面圖辨識。',
        },
      });
    } catch (err) {
      console.error('Error in /api/analyze-floorplan:', err);
      const rawMessage = extractErrorMessage(err);
      let readableMessage = rawMessage;
      try {
        const parsedErr = JSON.parse(rawMessage);
        if (typeof parsedErr?.error?.message === 'string' && parsedErr.error.message.trim()) {
          readableMessage = parsedErr.error.message.trim();
        }
      } catch {
        // Not raw JSON
      }

      if (rawMessage.includes('API_KEY_INVALID') || rawMessage.includes('PERMISSION_DENIED')) {
        res.status(403).json({
          error: 'Gemini API 金鑰權限不足或無效，請檢查 Settings > Secrets 中的 GEMINI_API_KEY。',
        });
        return;
      }
      if (rawMessage.includes('RESOURCE_EXHAUSTED')) {
        res.status(429).json({
          error: 'AI 模型請求額度已達上限，請稍後再試或檢查 Settings > Secrets 中的 API 配額。',
        });
        return;
      }
      if (isTransientOverloadError(err)) {
        res.status(503).json({
          error:
            'Gemini AI 模型目前因瞬間流量過高而暫時忙碌（503 UNAVAILABLE），並非您的 PDF 檔案異常。通常數秒內即可恢復，請稍候再點擊一次「AI 辨識上傳草圖」。',
        });
        return;
      }
      res.status(500).json({
        error: `草圖分析失敗：${readableMessage}`,
      });
    }
  });

  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Floorplan studio server running at http://localhost:${PORT}`);
  });
}

createServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
