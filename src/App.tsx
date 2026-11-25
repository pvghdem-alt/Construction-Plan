import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Download,
  Layers,
  Box,
  Columns2,
  SlidersHorizontal,
  Eye,
  Cloud,
  Undo2,
  Redo2,
  Calculator,
  Scissors,
  FileDown,
  Share2,
  Lock,
} from 'lucide-react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import { auth, googleProvider } from './firebase';
import { formatFirebaseAuthError } from './utils/authErrorMessages';
import {
  deleteCloudFloorplan,
  ensureUserProfile,
  revokeCloudFloorplanShareEmail,
  saveNewCloudFloorplan,
  shareCloudFloorplanWithEmails,
  subscribeMySharedFloorplans,
  subscribeSharedWithMeFloorplans,
  subscribeUserFloorplans,
  updateCloudFloorplan,
  type CloudFloorplanRecord,
  type SharedCloudFloorplanRecord,
} from './services/cloudFloorplans';
import { CloudStorageModal } from './components/CloudStorageModal';
import { ElementDimensionsModal } from './components/ElementDimensionsModal';
import { ElevationCanvas } from './components/ElevationCanvas';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Floorplan2DCanvas, type Floorplan2DHandle } from './components/Floorplan2DCanvas';
import { Floorplan3DCanvas, type Floorplan3DHandle } from './components/Floorplan3DCanvas';
import { ParameterSidebar } from './components/ParameterSidebar';
import { ReadOnlySummarySidebar } from './components/ReadOnlySummarySidebar';
import { ShareModal } from './components/ShareModal';
import { WallAreaModal } from './components/WallAreaModal';
import type { FloorplanElement, FloorplanProject, SectionLine, ViewMode } from './types/floorplan';
import {
  applyAutoCloseToProject,
  computeWallSurfaceAreas,
  duplicateElementForPaste,
  flipDoorSwing,
  formatDimension,
  resolveElementPlacements,
  solveFloorplan,
} from './utils/floorplanGeometry';
import { exportFloorplanBundlePdf } from './utils/pdfExporter';
import {
  commitBaselineToHistory,
  createHistory,
  pushHistory,
  redoHistory,
  replacePresentHistory,
  undoHistory,
  type HistoryState,
} from './utils/historyManager';
import {
  ATTACHED_SKETCH_PRESET,
  CARE_ROOM_PRESET,
  L_STUDIO_PRESET,
  ROOM_IN_ROOM_PRESET,
} from './utils/samplePresets';
import {
  decodeShareToken,
  decodeShareTokenSync,
  extractShareTokenFromLocation,
} from './utils/shareLink';

function resolveInitialSharedState(): {
  project: FloorplanProject;
  isReadOnly: boolean;
} {
  if (typeof window !== 'undefined') {
    const token = extractShareTokenFromLocation(window.location.hash, window.location.search);
    if (token) {
      const syncDecoded = decodeShareTokenSync(token);
      if (syncDecoded) {
        return { project: syncDecoded, isReadOnly: true };
      }
      return { project: ATTACHED_SKETCH_PRESET, isReadOnly: true };
    }
  }
  return { project: ATTACHED_SKETCH_PRESET, isReadOnly: false };
}

export default function App() {
  const initialShared = useMemo(() => resolveInitialSharedState(), []);
  const [isReadOnly, setIsReadOnly] = useState<boolean>(initialShared.isReadOnly);
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [history, setHistory] = useState<HistoryState<FloorplanProject>>(() =>
    createHistory(initialShared.project)
  );
  const project = history.present;
  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  const projectRef = useRef(project);
  projectRef.current = project;
  const interactionBaselineRef = useRef<FloorplanProject | null>(null);

  const setProject = useCallback(
    (
      updater:
        | FloorplanProject
        | ((prev: FloorplanProject) => FloorplanProject)
    ) => {
      setHistory((prev) => {
        const next =
          typeof updater === 'function' ? updater(prev.present) : updater;
        return pushHistory(prev, next);
      });
    },
    []
  );

  const previewProject = useCallback(
    (updater: (prev: FloorplanProject) => FloorplanProject) => {
      setHistory((prev) => replacePresentHistory(prev, updater(prev.present)));
    },
    []
  );

  const handleBeginElementInteraction = useCallback(() => {
    interactionBaselineRef.current = projectRef.current;
  }, []);

  const handleEndElementInteraction = useCallback(() => {
    const baseline = interactionBaselineRef.current;
    interactionBaselineRef.current = null;
    if (!baseline) return;
    setHistory((prev) =>
      commitBaselineToHistory(prev, baseline, prev.present)
    );
  }, []);

  const handleUndo = useCallback(() => {
    setHistory((prev) => undoHistory(prev));
  }, []);

  const handleRedo = useCallback(() => {
    setHistory((prev) => redoHistory(prev));
  }, []);

  const [viewMode, setViewMode] = useState<ViewMode>('2d');
  const [mobilePanel, setMobilePanel] = useState<'editor' | 'canvas'>('canvas');
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(
    () => initialShared.project.sectionLines?.[0]?.id ?? null
  );
  const [sectionDrawMode, setSectionDrawMode] = useState(false);
  const [showDimensions3D, setShowDimensions3D] = useState(true);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [actionToast, setActionToast] = useState<string | null>(null);
  const [editingElementId, setEditingElementId] = useState<string | null>(null);
  const [wallAreaModalOpen, setWallAreaModalOpen] = useState(false);
  const [interiorWallFaces, setInteriorWallFaces] = useState<1 | 2>(2);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  // Firebase Auth & Cloud Storage State
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authRefreshTick, setAuthRefreshTick] = useState(0);
  const [cloudModalOpen, setCloudModalOpen] = useState(false);
  const [cloudRecords, setCloudRecords] = useState<CloudFloorplanRecord[]>([]);
  const [mySharedRecords, setMySharedRecords] = useState<SharedCloudFloorplanRecord[]>([]);
  const [sharedWithMeRecords, setSharedWithMeRecords] = useState<SharedCloudFloorplanRecord[]>([]);
  const [isLoadingCloud, setIsLoadingCloud] = useState(false);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [activeCloudId, setActiveCloudId] = useState<string | null>(null);

  const canvas2DRef = useRef<Floorplan2DHandle | null>(null);
  const canvas3DRef = useRef<Floorplan3DHandle | null>(null);
  const clipboardElementRef = useRef<FloorplanElement | null>(null);
  const pasteCountRef = useRef<number>(0);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string) => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current);
    }
    setActionToast(message);
    toastTimerRef.current = setTimeout(() => {
      setActionToast(null);
      toastTimerRef.current = null;
    }, 2600);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  // Load compressed (#share=z:...) or updated share tokens on mount and hashchange
  useEffect(() => {
    let active = true;
    const applyFromLocation = async () => {
      const token = extractShareTokenFromLocation(window.location.hash, window.location.search);
      if (!token) {
        setIsReadOnly(false);
        return;
      }
      const decoded = await decodeShareToken(token);
      if (!active) return;
      if (decoded) {
        setIsReadOnly(true);
        setShareModalOpen(false);
        setCloudModalOpen(false);
        setEditingElementId(null);
        setSectionDrawMode(false);
        setSelectedEdgeId(null);
        setSelectedElementId(null);
        setSelectedSectionId(decoded.sectionLines?.[0]?.id ?? null);
        setHistory(createHistory(decoded));
      } else {
        setIsReadOnly(false);
        showToast('分享連結無效或已損毀，已切換回一般編輯模式');
      }
    };

    void applyFromLocation();
    const onHashChange = () => {
      void applyFromLocation();
    };
    window.addEventListener('hashchange', onHashChange);
    return () => {
      active = false;
      window.removeEventListener('hashchange', onHashChange);
    };
  }, [showToast]);

  const solved = useMemo(() => solveFloorplan(project), [project]);
  const placements = useMemo(
    () => resolveElementPlacements(project.elements, solved),
    [project.elements, solved]
  );
  const wallAreaSummary = useMemo(
    () =>
      computeWallSurfaceAreas(project, solved, placements, {
        interiorWallFaces,
      }),
    [project, solved, placements, interiorWallFaces]
  );
  const editingElement = useMemo(
    () =>
      editingElementId
        ? project.elements.find((el) => el.id === editingElementId) ?? null
        : null,
    [project.elements, editingElementId]
  );

  // Auth listener + conditional Firestore onSnapshot listener (requires verified email per firestore.rules)
  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
      if (!nextUser) {
        setCloudRecords([]);
        setMySharedRecords([]);
        setSharedWithMeRecords([]);
        setActiveCloudId(null);
        setCloudError(null);
        setIsLoadingCloud(false);
      } else if (nextUser.emailVerified) {
        void ensureUserProfile(nextUser).catch((err) => {
          setCloudError(err instanceof Error ? err.message : '無法建立使用者資料');
        });
      } else {
        setCloudRecords([]);
        setMySharedRecords([]);
        setSharedWithMeRecords([]);
        setActiveCloudId(null);
        setCloudError(null);
        setIsLoadingCloud(false);
      }
    });
    return () => unsubAuth();
  }, []);

  useEffect(() => {
    if (!authReady || !user || !user.emailVerified) return;
    setIsLoadingCloud(true);
    setCloudError(null);
    void ensureUserProfile(user).catch((err) => {
      setCloudError(err instanceof Error ? err.message : '無法建立使用者資料');
    });
    const unsubOwn = subscribeUserFloorplans(
      user.uid,
      (records) => {
        setCloudRecords(records);
        setIsLoadingCloud(false);
      },
      (err) => {
        setCloudError(err.message);
        setIsLoadingCloud(false);
      }
    );
    const unsubMyShares = subscribeMySharedFloorplans(
      user.uid,
      (records) => {
        setMySharedRecords(records);
      },
      (err) => {
        setCloudError(err.message);
      }
    );
    const unsubSharedWithMe = user.email
      ? subscribeSharedWithMeFloorplans(
          user.email,
          (records) => {
            setSharedWithMeRecords(records.filter((r) => r.ownerId !== user.uid));
          },
          (err) => {
            setCloudError(err.message);
          }
        )
      : () => {};
    return () => {
      unsubOwn();
      unsubMyShares();
      unsubSharedWithMe();
    };
  }, [authReady, user, authRefreshTick]);

  const handleSignIn = useCallback(async () => {
    setCloudError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const host = typeof window !== 'undefined' ? window.location.hostname : '';
      setCloudError(formatFirebaseAuthError(err, host));
    }
  }, []);

  const handleSignInWithEmail = useCallback(async (email: string, password: string) => {
    setCloudError(null);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err) {
      const host = typeof window !== 'undefined' ? window.location.hostname : '';
      const msg = formatFirebaseAuthError(err, host);
      setCloudError(msg);
      throw new Error(msg);
    }
  }, []);

  const handleRegisterWithEmail = useCallback(async (email: string, password: string) => {
    setCloudError(null);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      if (cred.user && !cred.user.emailVerified) {
        await sendEmailVerification(cred.user);
      }
    } catch (err) {
      const host = typeof window !== 'undefined' ? window.location.hostname : '';
      const msg = formatFirebaseAuthError(err, host);
      setCloudError(msg);
      throw new Error(msg);
    }
  }, []);

  const handleSendPasswordReset = useCallback(async (email: string) => {
    setCloudError(null);
    try {
      await sendPasswordResetEmail(auth, email.trim());
    } catch (err) {
      const host = typeof window !== 'undefined' ? window.location.hostname : '';
      const msg = formatFirebaseAuthError(err, host);
      setCloudError(msg);
      throw new Error(msg);
    }
  }, []);

  const handleSendVerificationEmail = useCallback(async () => {
    if (!auth.currentUser) throw new Error('請先登入帳號。');
    setCloudError(null);
    try {
      await sendEmailVerification(auth.currentUser);
    } catch (err) {
      const host = typeof window !== 'undefined' ? window.location.hostname : '';
      const msg = formatFirebaseAuthError(err, host);
      setCloudError(msg);
      throw new Error(msg);
    }
  }, []);

  const handleReloadVerification = useCallback(async (): Promise<boolean> => {
    if (!auth.currentUser) return false;
    setCloudError(null);
    await auth.currentUser.reload();
    await auth.currentUser.getIdToken(true);
    setUser(auth.currentUser);
    setAuthRefreshTick((t) => t + 1);
    return auth.currentUser.emailVerified;
  }, []);

  const handleSignOut = useCallback(async () => {
    setCloudError(null);
    await signOut(auth);
  }, []);

  const handleSaveNewCloud = useCallback(
    async (titleOverride?: string) => {
      if (!user) throw new Error('請先登入 Google 帳號。');
      const nextProject: FloorplanProject = titleOverride
        ? { ...project, projectName: titleOverride }
        : project;
      const nextSolved = solveFloorplan(nextProject);
      const newId = await saveNewCloudFloorplan(user.uid, nextProject, nextSolved);
      setProject(nextProject);
      setActiveCloudId(newId);
    },
    [user, project]
  );

  const handleUpdateCloud = useCallback(
    async (titleOverride?: string) => {
      if (!user || !activeCloudId) throw new Error('沒有連結中的雲端專案。');
      const nextProject: FloorplanProject = titleOverride
        ? { ...project, projectName: titleOverride }
        : project;
      const nextSolved = solveFloorplan(nextProject);
      await updateCloudFloorplan(
        user.uid,
        activeCloudId,
        nextProject,
        nextSolved,
        user.displayName || user.email
      );
      setProject(nextProject);
    },
    [user, activeCloudId, project]
  );

  const handleLoadCloudRecord = useCallback((record: CloudFloorplanRecord) => {
    setAnalyzeError(null);
    setSelectedEdgeId(null);
    setSelectedElementId(null);
    setSelectedSectionId(record.project.sectionLines?.[0]?.id ?? null);
    setSectionDrawMode(false);
    setProject(record.project);
    setActiveCloudId(record.id);
    setMobilePanel('canvas');
  }, [setProject]);

  const handleLoadSharedRecord = useCallback((record: SharedCloudFloorplanRecord) => {
    setAnalyzeError(null);
    setSelectedEdgeId(null);
    setSelectedElementId(null);
    setSelectedSectionId(record.project.sectionLines?.[0]?.id ?? null);
    setSectionDrawMode(false);
    setProject(record.project);
    setActiveCloudId(null);
    setMobilePanel('canvas');
    showToast(`已載入共用專案「${record.project.projectName}」（如需保留修改請另存至個人雲端）`);
  }, [setProject, showToast]);

  const handleShareCloudRecords = useCallback(
    async (recordsToShare: CloudFloorplanRecord[], recipientEmails: string[]) => {
      if (!user) throw new Error('請先登入帳號。');
      await Promise.all(
        recordsToShare.map((rec) => shareCloudFloorplanWithEmails(user, rec, recipientEmails))
      );
    },
    [user]
  );

  const handleRevokeShareEmail = useCallback(
    async (shareRecord: SharedCloudFloorplanRecord, email: string) => {
      if (!user) return;
      await revokeCloudFloorplanShareEmail(shareRecord, email);
    },
    [user]
  );

  const handleDeleteCloudRecord = useCallback(
    async (record: CloudFloorplanRecord) => {
      if (!user) return;
      await deleteCloudFloorplan(user.uid, record.id);
      if (activeCloudId === record.id) {
        setActiveCloudId(null);
      }
    },
    [user, activeCloudId]
  );

  const handleAutoClose = useCallback(() => {
    setProject((prev) => applyAutoCloseToProject(prev));
  }, [setProject]);

  const handleLoadPreset = useCallback(
    (preset: 'attached' | 'l-studio' | 'care-room' | 'room-in-room') => {
      setAnalyzeError(null);
      setSelectedEdgeId(null);
      setSelectedElementId(null);
      setSelectedSectionId(null);
      setSectionDrawMode(false);
      setActiveCloudId(null);
      if (preset === 'care-room') {
        setProject(CARE_ROOM_PRESET);
      } else if (preset === 'l-studio') {
        setProject(L_STUDIO_PRESET);
      } else if (preset === 'room-in-room') {
        setProject(ROOM_IN_ROOM_PRESET);
      } else {
        setProject(ATTACHED_SKETCH_PRESET);
      }
    },
    [setProject]
  );

  const handleMoveElement = useCallback(
    (elementId: string, xCm: number, yCm: number) => {
      const apply = interactionBaselineRef.current ? previewProject : setProject;
      apply((prev) => ({
        ...prev,
        elements: prev.elements.map((el) =>
          el.id === elementId ? { ...el, xCm, yCm } : el
        ),
      }));
    },
    [previewProject, setProject]
  );

  const handleRotateElement = useCallback(
    (elementId: string, rotationDeg: number) => {
      const apply = interactionBaselineRef.current ? previewProject : setProject;
      apply((prev) => ({
        ...prev,
        elements: prev.elements.map((el) =>
          el.id === elementId ? { ...el, rotationDeg } : el
        ),
      }));
    },
    [previewProject, setProject]
  );

  const handleFlipDoor = useCallback(
    (elementId: string, axis: 'hinge' | 'side' | 'type') => {
      if (isReadOnly) return;
      setProject((prev) => ({
        ...prev,
        elements: prev.elements.map((el) =>
          el.id === elementId
            ? { ...el, swingDirection: flipDoorSwing(el.swingDirection, axis) }
            : el
        ),
      }));
    },
    [isReadOnly, setProject]
  );

  const handleDeleteElement = useCallback(
    (elementId: string) => {
      setProject((prev) => ({
        ...prev,
        elements: prev.elements.filter((el) => el.id !== elementId),
      }));
      setSelectedElementId((prev) => (prev === elementId ? null : prev));
      setEditingElementId((prev) => (prev === elementId ? null : prev));
    },
    [setProject]
  );

  const handleUpdateElement = useCallback(
    (elementId: string, patch: Partial<FloorplanElement>) => {
      setProject((prev) => ({
        ...prev,
        elements: prev.elements.map((el) =>
          el.id === elementId ? { ...el, ...patch } : el
        ),
      }));
    },
    [setProject]
  );

  const handleToggleWallDistances = useCallback(
    (elementId: string) => {
      setProject((prev) => ({
        ...prev,
        elements: prev.elements.map((el) =>
          el.id === elementId
            ? { ...el, showWallDistances: !el.showWallDistances }
            : el
        ),
      }));
    },
    [setProject]
  );

  const handleCopyElement = useCallback(
    (elementId?: string | null) => {
      const targetId = elementId ?? selectedElementId;
      if (!targetId) return;
      const found = projectRef.current.elements.find((el) => el.id === targetId);
      if (!found) return;
      clipboardElementRef.current = { ...found };
      pasteCountRef.current = 0;
      showToast(`已複製「${found.name}」`);
    },
    [selectedElementId, showToast]
  );

  const handlePasteElement = useCallback(() => {
    const source = clipboardElementRef.current;
    if (!source) return;
    pasteCountRef.current += 1;
    const seq = pasteCountRef.current;
    const currentProj = projectRef.current;
    const currentSolved = solveFloorplan(currentProj);
    const pasted = duplicateElementForPaste(source, currentProj, currentSolved, seq);
    setProject((prev) => ({
      ...prev,
      elements: [...prev.elements, pasted],
    }));
    setSelectedElementId(pasted.id);
    setSelectedEdgeId(null);
    setSelectedSectionId(null);
    showToast(`已貼上「${pasted.name}」`);
  }, [setProject, showToast]);

  const handleCreateSectionLine = useCallback(
    (section: SectionLine) => {
      setProject((prev) => ({
        ...prev,
        sectionLines: [...(prev.sectionLines ?? []), section],
      }));
      setSelectedSectionId(section.id);
      setSelectedElementId(null);
      setSelectedEdgeId(null);
      setSectionDrawMode(false);
      showToast(`已新增剖面線 ${section.label}`);
    },
    [setProject, showToast]
  );

  const handleUpdateSectionLine = useCallback(
    (sectionId: string, patch: Partial<SectionLine>) => {
      const apply = interactionBaselineRef.current ? previewProject : setProject;
      apply((prev) => ({
        ...prev,
        sectionLines: (prev.sectionLines ?? []).map((s) =>
          s.id === sectionId ? { ...s, ...patch } : s
        ),
      }));
    },
    [previewProject, setProject]
  );

  const handleFlipSectionDirection = useCallback(
    (sectionId: string) => {
      setProject((prev) => ({
        ...prev,
        sectionLines: (prev.sectionLines ?? []).map((s) =>
          s.id === sectionId
            ? { ...s, viewDirection: s.viewDirection === -1 ? 1 : -1 }
            : s
        ),
      }));
    },
    [setProject]
  );

  const handleDeleteSectionLine = useCallback(
    (sectionId: string) => {
      setProject((prev) => {
        const remaining = (prev.sectionLines ?? []).filter((s) => s.id !== sectionId);
        return {
          ...prev,
          sectionLines: remaining,
        };
      });
      setSelectedSectionId((prev) => (prev === sectionId ? null : prev));
    },
    [setProject]
  );

  const handleViewSectionElevation = useCallback((sectionId: string) => {
    setSelectedSectionId(sectionId);
    setViewMode('elevation');
  }, []);

  const handleExportPdf = useCallback(async () => {
    if (isExportingPdf) return;
    setIsExportingPdf(true);
    try {
      const result = await exportFloorplanBundlePdf({
        project,
        solved,
        placements,
        selectedEdgeId,
        selectedElementId,
        showDimensions3D,
        captureLive3DPng: () => canvas3DRef.current?.capturePngDataUrl() ?? null,
      });
      showToast(`已匯出 ${result.pageCount} 頁 PDF：${result.fileName}`);
    } catch (err) {
      showToast(
        err instanceof Error ? `PDF 匯出失敗：${err.message}` : 'PDF 匯出失敗，請稍後再試'
      );
    } finally {
      setIsExportingPdf(false);
    }
  }, [
    isExportingPdf,
    project,
    solved,
    placements,
    selectedEdgeId,
    selectedElementId,
    showDimensions3D,
    showToast,
  ]);

  // Global keyboard shortcuts: Escape, Ctrl/Cmd+C, Ctrl/Cmd+V, Delete, Ctrl/Cmd+Z undo, Ctrl/Cmd+Y redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        isReadOnly ||
        shareModalOpen ||
        cloudModalOpen ||
        wallAreaModalOpen ||
        editingElementId !== null
      ) {
        return;
      }
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        target?.isContentEditable
      ) {
        return;
      }

      if (e.key === 'Escape' && sectionDrawMode) {
        e.preventDefault();
        setSectionDrawMode(false);
        return;
      }

      const mod = e.ctrlKey || e.metaKey;
      const keyLower = e.key.toLowerCase();
      if (mod && keyLower === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
        return;
      }
      if ((mod && keyLower === 'y') || (mod && e.shiftKey && keyLower === 'z')) {
        e.preventDefault();
        handleRedo();
        return;
      }
      if (mod && keyLower === 'c' && selectedElementId) {
        e.preventDefault();
        handleCopyElement(selectedElementId);
        return;
      }
      if (mod && keyLower === 'v' && clipboardElementRef.current) {
        e.preventDefault();
        handlePasteElement();
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedElementId) {
          e.preventDefault();
          handleDeleteElement(selectedElementId);
          return;
        }
        if (selectedSectionId) {
          e.preventDefault();
          handleDeleteSectionLine(selectedSectionId);
          return;
        }
        if (selectedEdgeId) {
          const isInterior = (projectRef.current.interiorWalls ?? []).some(
            (w) => w.id === selectedEdgeId
          );
          if (isInterior) {
            e.preventDefault();
            const wallToDelete = selectedEdgeId;
            setProject((prev) => {
              const remainingIw = (prev.interiorWalls ?? []).filter(
                (w) => w.id !== wallToDelete
              );
              const fallbackId = prev.edges[0]?.id ?? remainingIw[0]?.id ?? '';
              return {
                ...prev,
                interiorWalls: remainingIw,
                elements: prev.elements
                  .map((el) =>
                    el.edgeId === wallToDelete ? { ...el, edgeId: fallbackId } : el
                  )
                  .filter((el) => el.edgeId !== ''),
              };
            });
            setSelectedEdgeId(null);
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    isReadOnly,
    shareModalOpen,
    cloudModalOpen,
    wallAreaModalOpen,
    editingElementId,
    sectionDrawMode,
    selectedElementId,
    selectedSectionId,
    selectedEdgeId,
    handleUndo,
    handleRedo,
    handleCopyElement,
    handlePasteElement,
    handleDeleteElement,
    handleDeleteSectionLine,
    setProject,
  ]);

  const runAnalysisRequest = useCallback(async (bodyPayload: Record<string, unknown>) => {
    setIsAnalyzing(true);
    setAnalyzeError(null);
    try {
      const res = await fetch('/api/analyze-floorplan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload),
      });
      const data = await res.json();
      if (!res.ok) {
        setAnalyzeError(data.error || '草圖辨識發生錯誤，請稍後再試。');
        return;
      }
      if (data.project) {
        setProject(data.project);
        setSelectedEdgeId(null);
        setSelectedElementId(null);
        setSelectedSectionId(null);
        setSectionDrawMode(false);
        setMobilePanel('canvas');
      }
    } catch {
      setAnalyzeError('無法連線至分析伺服器，請確認網路狀態或稍後再試。');
    } finally {
      setIsAnalyzing(false);
    }
  }, [setProject]);

  const handleAnalyzeUpload = useCallback(
    async (payload: { mimeType: string; dataBase64: string; fileName: string }) => {
      await runAnalysisRequest(payload);
    },
    [runAnalysisRequest]
  );

  const handleAnalyzeSamplePdf = useCallback(async () => {
    await runAnalysisRequest({ useSamplePdf: true, fileName: '範例手寫平面圖.pdf' });
  }, [runAnalysisRequest]);

  return (
    <ErrorBoundary>
      <div
        className="h-screen w-full flex flex-col bg-slate-50 text-slate-900 overflow-hidden"
        data-view-mode={viewMode}
        data-readonly={isReadOnly ? 'true' : 'false'}
      >
        {/* Top Bar Contract: Single-row 3-zone header */}
        <header className="h-14 shrink-0 bg-white border-b border-slate-200 px-4 lg:px-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <h1 className="text-base lg:text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
              圖稿空間轉換器
            </h1>
            {isReadOnly && (
              <span
                data-testid="readonly-badge"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200 whitespace-nowrap shrink-0"
              >
                <Lock className="w-3 h-3 text-amber-700" />
                <span>唯讀檢視（僅供瀏覽）</span>
              </span>
            )}
          </div>

          {/* Clean Unboxed Space Metrics (Zero Pills) */}
          <div className="hidden md:flex items-center gap-2.5 text-xs text-slate-600 tabular-nums whitespace-nowrap overflow-hidden">
            <span className="font-medium text-slate-800 truncate max-w-[180px]">
              {project.projectName}
            </span>
            <span aria-hidden="true">·</span>
            <span>
              地板 {solved.areaSqMeters.toFixed(2)} m² ({solved.areaPing.toFixed(2)} 坪)
            </span>
            <span aria-hidden="true">·</span>
            <span>
              內牆淨面積 {wallAreaSummary.totalNetAreaM2.toFixed(2)} m²
            </span>
            <span aria-hidden="true">·</span>
            <span className="hidden xl:inline">
              總周長 {formatDimension(solved.perimeterCm, project.unit)}
            </span>
            <span aria-hidden="true" className="hidden xl:inline">·</span>
            <span className="hidden xl:inline">
              天花板 {formatDimension(project.ceilingHeightCm, project.unit)}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {!isReadOnly && (
              <>
                <button
                  type="button"
                  onClick={() => setShareModalOpen(true)}
                  aria-label="分享唯讀連結"
                  title="產生 GitHub Pages 第三方唯讀檢視連結"
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 transition-colors whitespace-nowrap shrink-0"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span>分享連結</span>
                </button>

                <button
                  type="button"
                  onClick={() => setCloudModalOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 transition-colors whitespace-nowrap shrink-0"
                >
                  <Cloud className="w-3.5 h-3.5" />
                  <span>
                    {user
                      ? `雲端專案 (${cloudRecords.length + sharedWithMeRecords.length})`
                      : '雲端儲存 / 讀取'}
                  </span>
                </button>
              </>
            )}

            <button
              type="button"
              onClick={handleExportPdf}
              disabled={isExportingPdf}
              aria-label="匯出完整圖面 PDF"
              title="輸出 2D 平面圖、3D 空間圖與所有剖面立面圖至單一 PDF"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0"
            >
              <FileDown className="w-3.5 h-3.5" />
              <span>{isExportingPdf ? '匯出中...' : '匯出 PDF'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (viewMode === '3d' || viewMode === 'elevation') {
                  setViewMode('2d');
                  setTimeout(() => canvas2DRef.current?.exportPng(), 80);
                } else {
                  canvas2DRef.current?.exportPng();
                }
              }}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-900 text-white hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span>匯出 2D PNG</span>
            </button>
          </div>
        </header>

      {/* Mobile Panel Switcher (< lg) */}
      <div className="lg:hidden shrink-0 bg-white border-b border-slate-200 px-3 py-1.5 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setMobilePanel('editor')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
            mobilePanel === 'editor'
              ? 'bg-slate-900 text-white'
              : 'bg-slate-100 text-slate-700'
          }`}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          <span>{isReadOnly ? '空間資訊總覽' : '草圖與參數編輯'}</span>
        </button>
        <button
          type="button"
          onClick={() => setMobilePanel('canvas')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
            mobilePanel === 'canvas'
              ? 'bg-slate-900 text-white'
              : 'bg-slate-100 text-slate-700'
          }`}
        >
          <Eye className="w-3.5 h-3.5" />
          <span>2D / 3D 畫布</span>
        </button>
      </div>

      {/* Main Split Workspace */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
        {/* Left Sidebar: Editable Parameter Panel or Read-Only Summary */}
        <div
          className={`${
            mobilePanel === 'editor' ? 'flex' : 'hidden'
          } lg:flex flex-1 lg:flex-none min-h-0`}
        >
          {isReadOnly ? (
            <ReadOnlySummarySidebar
              project={project}
              solved={solved}
              selectedEdgeId={selectedEdgeId}
              selectedElementId={selectedElementId}
              selectedSectionId={selectedSectionId}
              onSelectEdge={setSelectedEdgeId}
              onSelectElement={setSelectedElementId}
              onViewSection={handleViewSectionElevation}
            />
          ) : (
            <ParameterSidebar
              project={project}
              solved={solved}
              selectedEdgeId={selectedEdgeId}
              selectedElementId={selectedElementId}
              onSelectEdge={setSelectedEdgeId}
              onSelectElement={setSelectedElementId}
              onUpdateProject={setProject}
              onAutoClose={handleAutoClose}
              onLoadPreset={handleLoadPreset}
              onAnalyzeUpload={handleAnalyzeUpload}
              onAnalyzeSamplePdf={handleAnalyzeSamplePdf}
              isAnalyzing={isAnalyzing}
              analyzeError={analyzeError}
            />
          )}
        </div>

        {/* Right Workspace: Toolbar + 2D / 3D Interactive Canvas */}
        <main
          className={`${
            mobilePanel === 'canvas' ? 'flex' : 'hidden'
          } lg:flex flex-1 min-w-0 min-h-0 flex-col bg-slate-100`}
        >
          {/* Workspace Mode, History, Wall Area & Export Toolbar */}
          <div className="h-12 shrink-0 bg-white border-b border-slate-200 px-3 lg:px-4 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div
                role="tablist"
                aria-label="檢視模式切換"
                className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={viewMode === '2d'}
                  onClick={() => setViewMode('2d')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    viewMode === '2d'
                      ? 'bg-white text-blue-700 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>2D 平面圖</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={viewMode === '3d'}
                  onClick={() => setViewMode('3d')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    viewMode === '3d'
                      ? 'bg-white text-blue-700 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Box className="w-3.5 h-3.5" />
                  <span>3D 空間檢視</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={viewMode === 'split'}
                  onClick={() => setViewMode('split')}
                  className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    viewMode === 'split'
                      ? 'bg-white text-blue-700 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Columns2 className="w-3.5 h-3.5" />
                  <span>並排檢視</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={viewMode === 'elevation'}
                  onClick={() => setViewMode('elevation')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    viewMode === 'elevation'
                      ? 'bg-white text-rose-700 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Scissors className="w-3.5 h-3.5" />
                  <span>
                    立面圖
                    {(project.sectionLines?.length ?? 0) > 0
                      ? ` (${project.sectionLines!.length})`
                      : ''}
                  </span>
                </button>
              </div>

              {/* Undo / Redo History Controls */}
              {!isReadOnly && (
                <div className="flex items-center gap-1 pl-1 border-l border-slate-200">
                  <button
                    type="button"
                    disabled={!canUndo}
                    onClick={handleUndo}
                    aria-label="復原上一步"
                    title="復原上一步 (Ctrl+Z)"
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0"
                  >
                    <Undo2 className="w-3.5 h-3.5" />
                    <span className="hidden md:inline">上一步</span>
                  </button>
                  <button
                    type="button"
                    disabled={!canRedo}
                    onClick={handleRedo}
                    aria-label="重做下一步"
                    title="重做下一步 (Ctrl+Y / Ctrl+Shift+Z)"
                    className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap shrink-0"
                  >
                    <Redo2 className="w-3.5 h-3.5" />
                    <span className="hidden md:inline">下一步</span>
                  </button>
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 text-xs text-slate-600 shrink-0">
              <span className="hidden 2xl:inline tabular-nums">
                {solved.isClosed
                  ? '幾何狀態：已閉合'
                  : project.forceClose
                    ? `幾何狀態：已強制分配誤差 (${formatDimension(solved.gapCm, project.unit)})`
                    : `幾何狀態：缺口 ${formatDimension(solved.gapCm, project.unit)}`}
              </span>
              <button
                type="button"
                onClick={() => setWallAreaModalOpen(true)}
                aria-label="檢視空間內牆面面積明細"
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 transition-colors whitespace-nowrap shrink-0 tabular-nums"
              >
                <Calculator className="w-3.5 h-3.5" />
                <span>牆面面積 {wallAreaSummary.totalNetAreaM2.toFixed(2)} m²</span>
              </button>
              {(viewMode === '2d' || viewMode === 'split') && (
                <button
                  type="button"
                  onClick={() => canvas2DRef.current?.exportSvg()}
                  className="px-2.5 py-1.5 rounded-md text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0"
                >
                  匯出 SVG
                </button>
              )}
            </div>
          </div>

          {/* Interactive Canvas Container */}
          <div className="flex-1 min-h-0 relative">
            {viewMode === '2d' && (
              <Floorplan2DCanvas
                ref={canvas2DRef}
                project={project}
                solved={solved}
                placements={placements}
                selectedEdgeId={selectedEdgeId}
                selectedElementId={selectedElementId}
                selectedSectionId={selectedSectionId}
                sectionDrawMode={isReadOnly ? false : sectionDrawMode}
                readOnly={isReadOnly}
                onSetSectionDrawMode={isReadOnly ? undefined : setSectionDrawMode}
                onSelectEdge={setSelectedEdgeId}
                onSelectElement={setSelectedElementId}
                onSelectSection={setSelectedSectionId}
                onMoveElement={isReadOnly ? undefined : handleMoveElement}
                onRotateElement={isReadOnly ? undefined : handleRotateElement}
                onFlipDoor={isReadOnly ? undefined : handleFlipDoor}
                onBeginElementInteraction={isReadOnly ? undefined : handleBeginElementInteraction}
                onEndElementInteraction={isReadOnly ? undefined : handleEndElementInteraction}
                onDoubleClickElement={isReadOnly ? undefined : setEditingElementId}
                onDeleteElement={isReadOnly ? undefined : handleDeleteElement}
                onToggleWallDistances={isReadOnly ? undefined : handleToggleWallDistances}
                onCopyElement={isReadOnly ? undefined : handleCopyElement}
                onCreateSectionLine={isReadOnly ? undefined : handleCreateSectionLine}
                onUpdateSectionLine={isReadOnly ? undefined : handleUpdateSectionLine}
                onFlipSectionDirection={isReadOnly ? undefined : handleFlipSectionDirection}
                onDeleteSectionLine={isReadOnly ? undefined : handleDeleteSectionLine}
                onViewSectionElevation={handleViewSectionElevation}
              />
            )}

            {viewMode === '3d' && (
              <Floorplan3DCanvas
                ref={canvas3DRef}
                project={project}
                solved={solved}
                placements={placements}
                selectedEdgeId={selectedEdgeId}
                selectedElementId={selectedElementId}
                showDimensions3D={showDimensions3D}
                onToggleDimensions3D={setShowDimensions3D}
              />
            )}

            {viewMode === 'split' && (
              <div className="w-full h-full grid grid-cols-1 xl:grid-cols-2 divide-y xl:divide-y-0 xl:divide-x divide-slate-200">
                <div className="min-h-0 relative">
                  <Floorplan2DCanvas
                    ref={canvas2DRef}
                    project={project}
                    solved={solved}
                    placements={placements}
                    selectedEdgeId={selectedEdgeId}
                    selectedElementId={selectedElementId}
                    selectedSectionId={selectedSectionId}
                    sectionDrawMode={isReadOnly ? false : sectionDrawMode}
                    readOnly={isReadOnly}
                    onSetSectionDrawMode={isReadOnly ? undefined : setSectionDrawMode}
                    onSelectEdge={setSelectedEdgeId}
                    onSelectElement={setSelectedElementId}
                    onSelectSection={setSelectedSectionId}
                    onMoveElement={isReadOnly ? undefined : handleMoveElement}
                    onRotateElement={isReadOnly ? undefined : handleRotateElement}
                    onFlipDoor={isReadOnly ? undefined : handleFlipDoor}
                    onBeginElementInteraction={isReadOnly ? undefined : handleBeginElementInteraction}
                    onEndElementInteraction={isReadOnly ? undefined : handleEndElementInteraction}
                    onDoubleClickElement={isReadOnly ? undefined : setEditingElementId}
                    onDeleteElement={isReadOnly ? undefined : handleDeleteElement}
                    onToggleWallDistances={isReadOnly ? undefined : handleToggleWallDistances}
                    onCopyElement={isReadOnly ? undefined : handleCopyElement}
                    onCreateSectionLine={isReadOnly ? undefined : handleCreateSectionLine}
                    onUpdateSectionLine={isReadOnly ? undefined : handleUpdateSectionLine}
                    onFlipSectionDirection={isReadOnly ? undefined : handleFlipSectionDirection}
                    onDeleteSectionLine={isReadOnly ? undefined : handleDeleteSectionLine}
                    onViewSectionElevation={handleViewSectionElevation}
                  />
                </div>
                <div className="min-h-0 relative">
                  <Floorplan3DCanvas
                    ref={canvas3DRef}
                    project={project}
                    solved={solved}
                    placements={placements}
                    selectedEdgeId={selectedEdgeId}
                    selectedElementId={selectedElementId}
                    showDimensions3D={showDimensions3D}
                    onToggleDimensions3D={setShowDimensions3D}
                  />
                </div>
              </div>
            )}

            {viewMode === 'elevation' && (
              <ElevationCanvas
                project={project}
                solved={solved}
                placements={placements}
                selectedSectionId={selectedSectionId}
                selectedElementId={selectedElementId}
                readOnly={isReadOnly}
                onSelectSection={setSelectedSectionId}
                onSelectElement={setSelectedElementId}
                onAddSectionLine={isReadOnly ? undefined : handleCreateSectionLine}
                onFlipSectionDirection={isReadOnly ? undefined : handleFlipSectionDirection}
                onDeleteSectionLine={isReadOnly ? undefined : handleDeleteSectionLine}
                onSwitchToDraw2D={
                  isReadOnly
                    ? undefined
                    : () => {
                        setViewMode('2d');
                        setSectionDrawMode(true);
                      }
                }
              />
            )}

            {actionToast && (
              <div
                role="status"
                aria-live="polite"
                data-testid="action-toast"
                className="pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 z-30 bg-slate-900 text-white text-xs font-medium px-3.5 py-2 rounded-lg shadow-md"
              >
                {actionToast}
              </div>
            )}
          </div>
        </main>
      </div>

      {!isReadOnly && (
        <>
          <ShareModal
            isOpen={shareModalOpen}
            onClose={() => setShareModalOpen(false)}
            project={project}
          />

          <CloudStorageModal
            isOpen={cloudModalOpen}
            onClose={() => setCloudModalOpen(false)}
            user={user}
            authReady={authReady}
            onSignIn={handleSignIn}
            onSignInWithEmail={handleSignInWithEmail}
            onRegisterWithEmail={handleRegisterWithEmail}
            onSendPasswordReset={handleSendPasswordReset}
            onSendVerificationEmail={handleSendVerificationEmail}
            onReloadVerification={handleReloadVerification}
            onSignOut={handleSignOut}
            currentProject={project}
            currentSolved={solved}
            activeCloudId={activeCloudId}
            records={cloudRecords}
            mySharedRecords={mySharedRecords}
            sharedWithMeRecords={sharedWithMeRecords}
            isLoadingRecords={isLoadingCloud}
            cloudError={cloudError}
            onSaveNew={handleSaveNewCloud}
            onUpdateExisting={handleUpdateCloud}
            onLoadRecord={handleLoadCloudRecord}
            onLoadSharedRecord={handleLoadSharedRecord}
            onShareRecords={handleShareCloudRecords}
            onRevokeShareEmail={handleRevokeShareEmail}
            onDeleteRecord={handleDeleteCloudRecord}
          />

          <ElementDimensionsModal
            element={editingElement}
            unit={project.unit}
            onClose={() => setEditingElementId(null)}
            onSave={handleUpdateElement}
            onDelete={handleDeleteElement}
          />
        </>
      )}

      <WallAreaModal
        isOpen={wallAreaModalOpen}
        onClose={() => setWallAreaModalOpen(false)}
        summary={wallAreaSummary}
        unit={project.unit}
        interiorWallFaces={interiorWallFaces}
        onChangeInteriorWallFaces={setInteriorWallFaces}
        onSelectWall={(wallId) => {
          setSelectedEdgeId(wallId);
          setSelectedElementId(null);
        }}
      />
    </div>
    </ErrorBoundary>
  );
}
