import type { MouseEvent as ReactMouseEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { toMajorMinor } from './changelogData.js';
import type { AgentActivity, TabStatus } from './components/AgentCard.js';
import { BottomToolbar } from './components/BottomToolbar.js';
import { ChangelogModal } from './components/ChangelogModal.js';
import { ConnectionIndicator } from './components/ConnectionIndicator.js';
import { DebugView } from './components/DebugView.js';
import { EditActionBar } from './components/EditActionBar.js';
import { MigrationNotice } from './components/MigrationNotice.js';
import { MobileAgentBar } from './components/MobileAgentBar.js';
import { MobileKeyBar } from './components/MobileKeyBar.js';
import { MobileTerminalPage } from './components/MobileTerminalPage.js';
import { SettingsModal } from './components/SettingsModal.js';
import { TerminalDrawer } from './components/TerminalDrawer.js';
import { Tooltip } from './components/Tooltip.js';
import { Button } from './components/ui/Button.js';
import { Modal } from './components/ui/Modal.js';
import { VersionIndicator } from './components/VersionIndicator.js';
import { ZoomControls } from './components/ZoomControls.js';
import {
  MOBILE_VIEW_TRANSITION_MS,
  TERMINAL_DRAWER_DEFAULT_WIDTH_PX,
  TERMINAL_DRAWER_MAX_WIDTH_RATIO,
  TERMINAL_DRAWER_MIN_WIDTH_PX,
} from './constants.js';
import { useEditorActions } from './hooks/useEditorActions.js';
import { useEditorKeyboard } from './hooks/useEditorKeyboard.js';
import { useExtensionMessages } from './hooks/useExtensionMessages.js';
import { useIsMobile } from './hooks/useIsMobile.js';
import { useVisualViewportHeight } from './hooks/useVisualViewportHeight.js';
import { OfficeCanvas } from './office/components/OfficeCanvas.js';
import { ToolOverlay } from './office/components/ToolOverlay.js';
import { EditorState } from './office/editor/editorState.js';
import { EditorToolbar } from './office/editor/EditorToolbar.js';
import { OfficeState } from './office/engine/officeState.js';
import { exportLayoutToFile } from './office/layout/exportLayout.js';
import { isRotatable } from './office/layout/furnitureCatalog.js';
import { migrateLayoutColors } from './office/layout/layoutSerializer.js';
import { getPetCount } from './office/sprites/petSpriteData.js';
import { EditTool, type OfficeLayout } from './office/types.js';
import { isBrowserRuntime, isE2E } from './runtime.js';
import type { TerminalConnectionStatus } from './terminal/terminalClient.js';
import { installTestHooks } from './testHooks.js';
import { transport } from './transport/index.js';

// Game state lives outside React — updated imperatively by message handlers
const officeStateRef = { current: null as OfficeState | null };
const editorState = new EditorState();

// Test-only observability hooks (message/sound logs, addAgent wrapper, selectAgent).
// Installed only under the e2e harness so they never patch prototypes or grow
// unbounded logs in a real user's session.
if (isE2E) installTestHooks(officeStateRef);

function getOfficeState(): OfficeState {
  if (!officeStateRef.current) {
    officeStateRef.current = new OfficeState();
  }
  return officeStateRef.current;
}

function App() {
  // Browser runtime (dev or static dist): dispatch mock messages after the
  // useExtensionMessages listener has been registered.
  useEffect(() => {
    // browserMock is for Vite dev mode only (UI prototyping without a server).
    // In standalone server mode, the server sends all state over WebSocket.
    // In VS Code mode, the extension sends all state via postMessage.
    if (isBrowserRuntime && import.meta.env.DEV) {
      void import('./browserMock.js').then(({ dispatchMockMessages }) => dispatchMockMessages());
    }
  }, []);

  const editor = useEditorActions(getOfficeState, editorState);

  const isEditDirty = useCallback(
    () => editor.isEditMode && editor.isDirty,
    [editor.isEditMode, editor.isDirty],
  );

  const {
    agents,
    selectedAgent,
    agentTools,
    agentStatuses,
    agentAwaitingInput,
    agentSeenActivity,
    subagentTools,
    subagentCharacters,
    layoutReady,
    layoutWasReset,
    loadedAssets,
    workspaceFolders,
    agentFolderNames,
    externalAssetDirectories,
    lastSeenVersion,
    extensionVersion,
    watchAllSessions,
    setWatchAllSessions,
    alwaysShowLabels,
    hooksEnabled,
    setHooksEnabled,
    hooksInfoShown,
    areaMappings,
    setAreaMappings,
    showAreas,
    setShowAreas,
    terminalAvailable,
    terminalUnavailableReason,
    terminalAgentIds,
  } = useExtensionMessages(getOfficeState, editor.setLastSavedLayout, isEditDirty);

  // Show migration notice once layout reset is detected
  const [migrationNoticeDismissed, setMigrationNoticeDismissed] = useState(false);
  const showMigrationNotice = layoutWasReset && !migrationNoticeDismissed;

  const [isChangelogOpen, setIsChangelogOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHooksInfoOpen, setIsHooksInfoOpen] = useState(false);
  const [hooksTooltipDismissed, setHooksTooltipDismissed] = useState(false);
  const [isDebugMode, setIsDebugMode] = useState(false);
  const [alwaysShowOverlay, setAlwaysShowOverlay] = useState(false);
  const [activeTerminalAgentId, setActiveTerminalAgentId] = useState<number | null>(null);
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);
  const [terminalWidthPx, setTerminalWidthPx] = useState(TERMINAL_DRAWER_DEFAULT_WIDTH_PX);

  // Mobile shell: office and terminal are full-screen pages in a sliding
  // track, with the agent cards in a bottom scroller. Desktop keeps the
  // right-docked drawer. Crossing the breakpoint (rotation, window resize)
  // remounts the terminal panes; their sockets reconnect and the server
  // replays the current screen.
  const isMobile = useIsMobile();
  const [mobileView, setMobileView] = useState<'office' | 'terminal'>('office');
  // Software-keyboard handling: clamp the shell to the visual viewport so the
  // terminal shrinks (and the PTY resizes) instead of hiding its input line
  // under the keys. null while the keyboard is closed.
  const keyboardViewportHeight = useVisualViewportHeight(isMobile);
  // Mirror the office's imperative character selection into React so the
  // mobile card bar can restyle the focused agent's card — selection changes
  // from canvas taps would otherwise never re-render the bar.
  const [focusedAgentId, setFocusedAgentId] = useState<number | null>(null);
  useEffect(() => {
    const os = getOfficeState();
    os.onSelectionChange = setFocusedAgentId;
    setFocusedAgentId(os.selectedAgentId);
    return () => {
      os.onSelectionChange = null;
    };
  }, []);

  // Terminal socket status per agent for the mobile card bar's red dot — the
  // desktop equivalent lives inside TerminalDrawer, which mobile doesn't mount.
  const [mobileConnStatuses, setMobileConnStatuses] = useState<
    Record<number, TerminalConnectionStatus>
  >({});
  const handleMobileTermStatus = useCallback(
    (agentId: number, status: TerminalConnectionStatus) => {
      setMobileConnStatuses((prev) =>
        prev[agentId] === status ? prev : { ...prev, [agentId]: status },
      );
    },
    [],
  );

  // Drag the panel's left edge to resize. The office region is flex-1 beside it,
  // so it reflows to fill whatever width is left — the canvas ResizeObserver
  // repaints and re-centres the camera on the smaller region automatically.
  const handleTerminalResizeStart = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = terminalWidthPx;
      const maxWidth = window.innerWidth * TERMINAL_DRAWER_MAX_WIDTH_RATIO;
      const onMove = (ev: MouseEvent) => {
        // Dragging left (smaller clientX) widens the panel.
        const next = startWidth + (startX - ev.clientX);
        setTerminalWidthPx(Math.max(TERMINAL_DRAWER_MIN_WIDTH_PX, Math.min(maxWidth, next)));
      };
      const onUp = () => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        document.body.style.userSelect = '';
      };
      // Suppress text selection while dragging over the terminal/office.
      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    },
    [terminalWidthPx],
  );

  const currentMajorMinor = toMajorMinor(extensionVersion);

  const handleWhatsNewDismiss = useCallback(() => {
    transport.send({ type: 'setLastSeenVersion', version: currentMajorMinor });
  }, [currentMajorMinor]);

  const handleOpenChangelog = useCallback(() => {
    setIsChangelogOpen(true);
    transport.send({ type: 'setLastSeenVersion', version: currentMajorMinor });
  }, [currentMajorMinor]);

  // Sync alwaysShowOverlay from persisted settings
  useEffect(() => {
    setAlwaysShowOverlay(alwaysShowLabels);
  }, [alwaysShowLabels]);

  // Reveal a newly-opened terminal. Launching is async — the toolbar sends
  // launchAgent and the server answers with terminalSessionOpened once the PTY
  // is up — so "open the drawer on launch" is expressed as "open it when a
  // terminal we hadn't seen appears". This also restores the drawer after a
  // reload, when webviewReady re-announces the live sessions.
  //
  // Mobile only slides over for launches initiated from the + card
  // (pendingMobileLaunchRef): the office is the app's main screen, so a
  // reload that re-announces live sessions must land on the office, not
  // whatever terminal happens to exist.
  const knownTerminalIdsRef = useRef<number[]>([]);
  const pendingMobileLaunchRef = useRef(false);
  useEffect(() => {
    const added = terminalAgentIds.filter((id) => !knownTerminalIdsRef.current.includes(id));
    knownTerminalIdsRef.current = terminalAgentIds;
    if (added.length === 0) return;
    setActiveTerminalAgentId(added[added.length - 1]);
    setIsTerminalOpen(true);
    if (pendingMobileLaunchRef.current) setMobileView('terminal');
    pendingMobileLaunchRef.current = false;
  }, [terminalAgentIds]);

  // The + card in the mobile bar: launch, then slide to the new terminal when
  // the server announces it (see the effect above).
  const handleMobileLaunch = useCallback(() => {
    pendingMobileLaunchRef.current = true;
    editor.handleOpenClaude();
  }, [editor.handleOpenClaude]);

  const handleToggleDebugMode = useCallback(() => setIsDebugMode((prev) => !prev), []);
  const handleToggleAlwaysShowOverlay = useCallback(() => {
    setAlwaysShowOverlay((prev) => {
      const newVal = !prev;
      transport.send({ type: 'setAlwaysShowLabels', enabled: newVal });
      return newVal;
    });
  }, []);

  const handleSelectAgent = useCallback((id: number) => {
    transport.send({ type: 'focusAgent', id });
  }, []);

  // Mutate folder→Area mappings locally + send to server. Updates OfficeState in
  // the same tick so a follow-up agentCreated picks up the new mapping.
  const handleAreaMappingChange = useCallback(
    (folderName: string, areaLabel: string, action: 'add' | 'remove') => {
      const current = areaMappings[folderName] ?? [];
      let nextLabels: string[];
      if (action === 'add') {
        if (current.includes(areaLabel)) return;
        nextLabels = [...current, areaLabel];
      } else {
        nextLabels = current.filter((l) => l !== areaLabel);
      }
      const next = { ...areaMappings };
      if (nextLabels.length === 0) {
        delete next[folderName];
      } else {
        next[folderName] = nextLabels;
      }
      setAreaMappings(next);
      getOfficeState().setAreaMappings(next);
      transport.send({ type: 'saveAreaMappings', mappings: next });
    },
    [areaMappings, setAreaMappings],
  );

  // Toggle global Show Areas — persisted via setShowAreas message; runs server-
  // side through configPersistence.
  const onToggleShowAreas = useCallback(() => {
    const next = !showAreas;
    setShowAreas(next);
    transport.send({ type: 'setShowAreas', enabled: next });
  }, [showAreas, setShowAreas]);

  // When AREA_PAINT is active in the editor, force the overlay on even if the
  // user has toggled Show Areas off globally — they need to see what they're
  // editing. The selected area's overlay is alpha-bumped via activeAreaLabel.
  const isEditingAreas = editor.isEditMode && editorState.activeTool === EditTool.AREA_PAINT;
  const effectiveShowAreas = isEditingAreas || showAreas;
  const activeAreaLabel = isEditingAreas ? editor.selectedAreaLabel : null;

  // e2e: register the component-scoped editor-action drivers + the effective
  // show-areas gate on the test-hooks namespace (module-load installTestHooks
  // can't reach these React callbacks). Bypasses only canvas pixel→tile
  // geometry — the handlers still own undo/dirty/rebuild. Guarded on isE2E.
  useEffect(() => {
    if (!isE2E || typeof window === 'undefined') return;
    const hooks = (window.__pixelAgentsTestHooks ??= {});
    hooks.editorTileAction = (col, row) => editor.handleEditorTileAction(col, row);
    hooks.editorEraseAction = (col, row) => editor.handleEditorEraseAction(col, row);
    hooks.getShowAreas = () => effectiveShowAreas;
  }, [editor.handleEditorTileAction, editor.handleEditorEraseAction, effectiveShowAreas]);

  const containerRef = useRef<HTMLDivElement>(null);

  const [editorTickForKeyboard, setEditorTickForKeyboard] = useState(0);
  useEditorKeyboard(
    editor.isEditMode,
    editorState,
    editor.handleDeleteSelected,
    editor.handleRotateSelected,
    editor.handleToggleState,
    editor.handleUndo,
    editor.handleRedo,
    useCallback(() => setEditorTickForKeyboard((n) => n + 1), []),
    editor.handleToggleEditMode,
  );

  const handleCloseAgent = useCallback((id: number) => {
    transport.send({ type: 'closeAgent', id });
  }, []);

  const handleClick = useCallback(
    (agentId: number) => {
      // If clicked agent is a sub-agent, focus the parent's terminal instead
      const os = getOfficeState();
      const meta = os.subagentMeta.get(agentId);
      const focusId = meta ? meta.parentAgentId : agentId;
      transport.send({ type: 'focusAgent', id: focusId });
      // Standalone: focusAgent is a no-op server-side (there's no editor to
      // raise a panel in), so focus is resolved here — select the agent's tab
      // and open the drawer (desktop) or slide to the terminal page (mobile),
      // mirroring VS Code's terminalRef.show().
      if (terminalAgentIds.includes(focusId)) {
        setActiveTerminalAgentId(focusId);
        setIsTerminalOpen(true);
        if (isMobile) setMobileView('terminal');
      }
    },
    [terminalAgentIds, isMobile],
  );

  const handleSelectTerminal = useCallback((agentId: number) => {
    setActiveTerminalAgentId(agentId);
    setIsTerminalOpen(true);
    // Mirror a character click in the office: select the agent's character and
    // follow it with the camera, so the card and the office stay in sync.
    const os = getOfficeState();
    if (os.characters.has(agentId)) {
      os.selectedAgentId = agentId;
      os.cameraFollowId = agentId;
    }
  }, []);

  // PTY write functions handed up by each mobile TerminalPane, so the key bar
  // can inject bytes into whichever pane is showing. A ref, not state: sends
  // are imperative and registration must not re-render the app.
  const mobileTermInputsRef = useRef(new Map<number, (data: string) => void>());
  const registerMobileTermInput = useCallback(
    (agentId: number, send: ((data: string) => void) | null) => {
      if (send) mobileTermInputsRef.current.set(agentId, send);
      else mobileTermInputsRef.current.delete(agentId);
    },
    [],
  );
  const handleMobileKey = useCallback(
    (sequence: string) => {
      // Mirror MobileTerminalPage's fallback: first pane when the active agent
      // has no PTY.
      const targetId =
        activeTerminalAgentId !== null && terminalAgentIds.includes(activeTerminalAgentId)
          ? activeTerminalAgentId
          : (terminalAgentIds[0] ?? null);
      if (targetId !== null) mobileTermInputsRef.current.get(targetId)?.(sequence);
    },
    [activeTerminalAgentId, terminalAgentIds],
  );

  // Mobile card tap. In terminal view the bar is a tab strip: one tap
  // switches panes (external agents jump back to the office — they have no
  // pane). In office view it mirrors the character's two-step tap: first tap
  // focuses the character (camera follow + status label), a repeat tap on the
  // already-focused agent opens its terminal.
  const handleMobileCardSelect = useCallback(
    (agentId: number) => {
      const os = getOfficeState();
      const hasTerminal = terminalAgentIds.includes(agentId);
      const focusCharacter = () => {
        if (os.characters.has(agentId)) {
          os.selectedAgentId = agentId;
          os.cameraFollowId = agentId;
        }
      };

      if (mobileView === 'terminal') {
        focusCharacter();
        if (hasTerminal) {
          setActiveTerminalAgentId(agentId);
        } else {
          setMobileView('office');
        }
        return;
      }

      if (os.selectedAgentId === agentId && hasTerminal) {
        setActiveTerminalAgentId(agentId);
        setMobileView('terminal');
        return;
      }
      focusCharacter();
      // Pre-select the pane (and the card highlight) without leaving the office.
      if (hasTerminal) setActiveTerminalAgentId(agentId);
    },
    [terminalAgentIds, mobileView],
  );

  const officeState = getOfficeState();

  // A terminal tab shows the agent's character (front-facing mug shot), so it
  // reads the same palette/hueShift the office assigned that character.
  const getAgentAppearance = useCallback(
    (id: number) => {
      const ch = officeState.characters.get(id);
      return ch ? { palette: ch.palette, hueShift: ch.hueShift } : null;
    },
    [officeState],
  );

  // Activity for the tab status dot (green idle / blue working / yellow needs
  // attention). null until the agent's first activity, so the dot stays empty.
  // Connection-broken (red) is layered on top by the drawer itself.
  const getAgentActivity = useCallback(
    (id: number): AgentActivity | null => {
      if (!agentSeenActivity[id]) return null;
      const tools = agentTools[id];
      if (tools?.some((t) => t.permissionWait && !t.done)) return 'attention';
      if (tools?.some((t) => !t.done)) return 'working';
      if (agentAwaitingInput[id]) return 'attention';
      if (agentStatuses[id] === 'waiting') return 'idle';
      return 'working';
    },
    [agentSeenActivity, agentTools, agentStatuses, agentAwaitingInput],
  );

  // Card status for the mobile bar: connection-broken (red) wins for agents
  // whose terminal socket dropped; everything else shows live activity.
  // (Desktop's TerminalDrawer derives the same thing from its own pane state.)
  const mobileStatusFor = useCallback(
    (agentId: number): TabStatus | null => {
      const conn = mobileConnStatuses[agentId];
      if (terminalAgentIds.includes(agentId) && (conn === 'closed' || conn === 'reconnecting')) {
        return 'disconnected';
      }
      return getAgentActivity(agentId);
    },
    [mobileConnStatuses, terminalAgentIds, getAgentActivity],
  );

  // Merged set of folders the Areas dropdown can map: real workspace folders plus
  // every distinct folder an agent has run in this session (deduped by name; name
  // is the areaMappings key / seat-bias identity, path is only the React list key).
  const areaFolders = useMemo(() => {
    const byName = new Map<string, { name: string; path: string }>();
    for (const f of workspaceFolders) byName.set(f.name, f);
    for (const name of agentFolderNames) {
      if (!byName.has(name)) byName.set(name, { name, path: name });
    }
    return [...byName.values()];
  }, [workspaceFolders, agentFolderNames]);

  // Areas authoring is available when the layout already defines areas, or when
  // there is at least one mappable folder. Decouples the Areas UI from VS Code
  // multi-root workspaces (fixes single-root VS Code AND standalone, where
  // workspaceFolders is always empty).
  const areasAvailable = (officeState.getLayout().areas?.length ?? 0) > 0 || areaFolders.length > 0;

  const handleExportLayout = useCallback(() => {
    exportLayoutToFile(getOfficeState().getLayout());
  }, []);

  const handleImportLayout = useCallback(
    (file: File) => {
      // Browser-native import (standalone): read + validate + apply directly,
      // bypassing the layoutLoaded message whose dirty guard would skip it.
      if (
        isEditDirty() &&
        !window.confirm('Replace the current layout? Unsaved edits will be lost.')
      ) {
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const imported = JSON.parse(String(reader.result)) as Record<string, unknown>;
          // Match the VS Code guard, plus the furniture-array check VS Code omits
          // (migrate + rebuild iterate furniture and would throw on a non-array).
          if (
            imported.version !== 1 ||
            !Array.isArray(imported.tiles) ||
            !Array.isArray(imported.furniture)
          ) {
            window.alert('Invalid layout file.');
            return;
          }
          const migrated = migrateLayoutColors(imported as unknown as OfficeLayout);
          getOfficeState().rebuildFromLayout(migrated);
          editor.setLastSavedLayout(migrated);
          transport.send({
            type: 'saveLayout',
            layout: migrated as unknown as Record<string, unknown>,
          });
          editor.markClean();
        } catch {
          window.alert('Failed to read or parse layout file.');
        }
      };
      reader.readAsText(file);
    },
    [isEditDirty, editor],
  );

  // Force dependency on editorTickForKeyboard to propagate keyboard-triggered re-renders
  void editorTickForKeyboard;

  // Show "Press R to rotate" hint when a rotatable item is selected or being placed
  const showRotateHint =
    editor.isEditMode &&
    (() => {
      if (editorState.selectedFurnitureUid) {
        const item = officeState
          .getLayout()
          .furniture.find((f) => f.uid === editorState.selectedFurnitureUid);
        if (item && isRotatable(item.type)) return true;
      }
      if (
        editorState.activeTool === EditTool.FURNITURE_PLACE &&
        isRotatable(editorState.selectedFurnitureType)
      ) {
        return true;
      }
      return false;
    })();

  if (!layoutReady) {
    return <div className="w-full h-full flex items-center justify-center ">Loading...</div>;
  }

  // The office region is shared by both shells: desktop mounts it as the
  // flexing left half of the split view (the terminal panel docks beside it);
  // mobile mounts it as the first page of the sliding track. containerRef
  // (ToolOverlay geometry) rides along either way.
  const officeRegion = (
    <div
      ref={containerRef}
      className={`relative h-full overflow-hidden ${isMobile ? 'w-full' : 'flex-1 min-w-0'}`}
    >
      <OfficeCanvas
        officeState={officeState}
        onClick={handleClick}
        isEditMode={editor.isEditMode}
        editorState={editorState}
        onEditorTileAction={editor.handleEditorTileAction}
        onEditorEraseAction={editor.handleEditorEraseAction}
        onEditorSelectionChange={editor.handleEditorSelectionChange}
        onDeleteSelected={editor.handleDeleteSelected}
        onRotateSelected={editor.handleRotateSelected}
        onDragMove={editor.handleDragMove}
        editorTick={editor.editorTick}
        zoom={editor.zoom}
        onZoomChange={editor.handleZoomChange}
        panRef={editor.panRef}
        showAreas={effectiveShowAreas}
        activeAreaLabel={activeAreaLabel}
        tapSelectsFirst={isMobile}
      />

      {!isDebugMode ? (
        <>
          {/* Mobile: pinch replaces the zoom buttons, and the toolbar's
                jobs move to the card bar (+) and the floating Settings button. */}
          {!isMobile && <ZoomControls zoom={editor.zoom} onZoomChange={editor.handleZoomChange} />}

          {/* Vignette overlay */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{ background: 'var(--vignette)' }}
          />

          {editor.isEditMode && editor.isDirty && (
            <EditActionBar editor={editor} editorState={editorState} />
          )}

          {showRotateHint && (
            <div
              className="absolute left-1/2 -translate-x-1/2 z-11 bg-accent-bright text-white text-sm py-3 px-8 rounded-none border-2 border-accent shadow-pixel pointer-events-none whitespace-nowrap"
              style={{ top: editor.isDirty ? 64 : 8 }}
            >
              Rotate (R)
            </div>
          )}

          {editor.isEditMode &&
            (() => {
              const selUid = editorState.selectedFurnitureUid;
              const selColor = selUid
                ? (officeState.getLayout().furniture.find((f) => f.uid === selUid)?.color ?? null)
                : null;
              return (
                <EditorToolbar
                  activeTool={editorState.activeTool}
                  selectedTileType={editorState.selectedTileType}
                  selectedFurnitureType={editorState.selectedFurnitureType}
                  selectedFurnitureUid={selUid}
                  selectedFurnitureColor={selColor}
                  floorColor={editorState.floorColor}
                  wallColor={editorState.wallColor}
                  selectedWallSet={editorState.selectedWallSet}
                  onToolChange={editor.handleToolChange}
                  onTileTypeChange={editor.handleTileTypeChange}
                  onFloorColorChange={editor.handleFloorColorChange}
                  onWallColorChange={editor.handleWallColorChange}
                  onWallSetChange={editor.handleWallSetChange}
                  onSelectedFurnitureColorChange={editor.handleSelectedFurnitureColorChange}
                  pickedFurnitureColor={editorState.pickedFurnitureColor}
                  onPickedFurnitureColorChange={editor.handlePickedFurnitureColorChange}
                  onFurnitureTypeChange={editor.handleFurnitureTypeChange}
                  loadedAssets={loadedAssets}
                  activePetTypes={officeState.getActivePetTypes()}
                  petCount={getPetCount()}
                  onPetToggle={editor.handlePetToggle}
                  carpetVariant={editor.carpetVariant}
                  carpetColor={editor.carpetColor}
                  carpetAccentColor={editor.carpetAccentColor}
                  onCarpetVariantChange={editor.handleCarpetVariantChange}
                  onCarpetColorChange={editor.handleCarpetColorChange}
                  onCarpetAccentColorChange={editor.handleCarpetAccentColorChange}
                  areas={officeState.getLayout().areas ?? []}
                  selectedAreaLabel={editor.selectedAreaLabel}
                  workspaceFolders={areaFolders}
                  areasAvailable={areasAvailable}
                  areaMappings={areaMappings}
                  onSelectArea={editor.handleSelectArea}
                  onAddArea={editor.handleAddArea}
                  onRemoveArea={editor.handleRemoveArea}
                  onRenameArea={editor.handleRenameArea}
                  onAreaColorChange={editor.handleAreaColorChange}
                  onAreaMappingChange={handleAreaMappingChange}
                />
              );
            })()}

          <ToolOverlay
            officeState={officeState}
            agents={agents}
            agentTools={agentTools}
            subagentCharacters={subagentCharacters}
            containerRef={containerRef}
            zoom={editor.zoom}
            panRef={editor.panRef}
            onCloseAgent={handleCloseAgent}
            alwaysShowOverlay={alwaysShowOverlay}
          />
        </>
      ) : (
        <DebugView
          agents={agents}
          selectedAgent={selectedAgent}
          agentTools={agentTools}
          agentStatuses={agentStatuses}
          subagentTools={subagentTools}
          officeState={officeState}
          onSelectAgent={handleSelectAgent}
        />
      )}

      {/* Hooks first-run tooltip */}
      {!hooksInfoShown && !hooksTooltipDismissed && (
        <Tooltip
          title="Instant Detection Active"
          position="top-right"
          onDismiss={() => {
            setHooksTooltipDismissed(true);
            transport.send({ type: 'setHooksInfoShown' });
          }}
        >
          <span className="text-sm text-text leading-none">
            Your agents now respond in real-time.{' '}
            <span
              className="text-accent cursor-pointer underline"
              onClick={() => {
                setIsHooksInfoOpen(true);
                setHooksTooltipDismissed(true);
                transport.send({ type: 'setHooksInfoShown' });
              }}
            >
              View more
            </span>
          </span>
        </Tooltip>
      )}

      {/* Hooks info modal */}
      <Modal
        isOpen={isHooksInfoOpen}
        onClose={() => setIsHooksInfoOpen(false)}
        title="Instant Detection is ON"
        zIndex={52}
      >
        <div className="text-base text-text px-10" style={{ lineHeight: 1.4 }}>
          <p className="mb-8">Your Pixel Agents office now reacts in real-time:</p>
          <ul className="mb-8 pl-18 list-disc m-0">
            <li className="text-sm mb-2">Permission prompts appear instantly</li>
            <li className="text-sm mb-2">Turn completions detected the moment they happen</li>
            <li className="text-sm mb-2">Sound notifications play immediately</li>
          </ul>
          <p className="mb-12 text-text-muted">
            This works through Claude Code Hooks, small event listeners that notify Pixel Agents
            whenever something happens in your Claude sessions.
          </p>
          <div className="text-center">
            <button
              onClick={() => setIsHooksInfoOpen(false)}
              className="py-4 px-20 text-lg bg-accent text-white border-2 border-accent rounded-none cursor-pointer shadow-pixel"
            >
              Got it
            </button>
          </div>
          <p className="mt-8 text-xs text-text-muted text-center">
            To disable, go to Settings {'>'} Instant Detection
          </p>
        </div>
      </Modal>

      {!isMobile && (
        <BottomToolbar
          isEditMode={editor.isEditMode}
          onOpenClaude={editor.handleOpenClaude}
          onToggleEditMode={editor.handleToggleEditMode}
          isSettingsOpen={isSettingsOpen}
          onToggleSettings={() => setIsSettingsOpen((v) => !v)}
          workspaceFolders={workspaceFolders}
          terminalAvailable={terminalAvailable}
          terminalUnavailableReason={terminalUnavailableReason}
        />
      )}

      {/* Mobile: Settings floats top-left (the layout editor stays desktop-
            only — its tools are drag/hover-driven). */}
      {isMobile && !isDebugMode && (
        <div className="absolute mobile-safe-top left-8 z-20">
          <Button
            size="sm"
            variant={isSettingsOpen ? 'active' : 'default'}
            className="border-border! shadow-pixel"
            onClick={() => setIsSettingsOpen((v) => !v)}
          >
            Settings
          </Button>
        </div>
      )}

      <VersionIndicator
        currentVersion={extensionVersion}
        lastSeenVersion={lastSeenVersion}
        onDismiss={handleWhatsNewDismiss}
        onOpenChangelog={handleOpenChangelog}
      />

      <ConnectionIndicator />
    </div>
  );

  return (
    // Desktop: split view — the office region flexes to fill the space left of
    // the terminal panel. Mobile: a column — the sliding office/terminal track
    // on top, the agent-card bar pinned along the bottom.
    <div
      className={`w-full h-full relative overflow-hidden flex ${isMobile ? 'flex-col' : ''}`}
      style={
        isMobile && keyboardViewportHeight !== null ? { height: keyboardViewportHeight } : undefined
      }
    >
      {isMobile ? (
        <>
          <div className="relative flex-1 min-h-0 overflow-hidden">
            {/* Sliding track: office and terminal side by side at 200% width;
                selecting a terminal slides one viewport-width left. Both pages
                keep real layout at all times (never display:none), so the
                canvas ResizeObserver and xterm's fit always see dimensions. */}
            <div
              className="absolute top-0 bottom-0 left-0 flex w-[200%]"
              style={{
                transform: mobileView === 'terminal' ? 'translateX(-50%)' : 'translateX(0)',
                transition: `transform ${MOBILE_VIEW_TRANSITION_MS}ms ease-out`,
              }}
            >
              <div className="w-1/2 h-full relative overflow-hidden">{officeRegion}</div>
              <div className="w-1/2 h-full">
                <MobileTerminalPage
                  agentIds={terminalAgentIds}
                  activeAgentId={activeTerminalAgentId}
                  onStatusChange={handleMobileTermStatus}
                  onRegisterInput={registerMobileTermInput}
                />
              </div>
            </div>

            {/* View toggle — pinned outside the track so it never slides. */}
            {terminalAvailable && (
              <div className="absolute mobile-safe-top right-8 z-40">
                <Button
                  size="sm"
                  className="border-border! shadow-pixel"
                  onClick={() => setMobileView((v) => (v === 'office' ? 'terminal' : 'office'))}
                  title={mobileView === 'office' ? 'Show terminal' : 'Show office'}
                >
                  {mobileView === 'office' ? '>_' : 'Office'}
                </Button>
              </div>
            )}
          </div>

          <MobileAgentBar
            agentIds={agents}
            focusedAgentId={focusedAgentId}
            activeTerminalAgentId={activeTerminalAgentId}
            view={mobileView}
            onSelectAgent={handleMobileCardSelect}
            onCloseAgent={handleCloseAgent}
            onLaunch={handleMobileLaunch}
            canLaunch={terminalAvailable}
            launchUnavailableReason={terminalUnavailableReason}
            getAppearance={getAgentAppearance}
            statusFor={mobileStatusFor}
          />

          {/* Accessory keys for the TUI, only while the software keyboard is
              up (keyboardViewportHeight is the clamp signal) — the last flex
              child, so it sits directly above the keyboard. */}
          {mobileView === 'terminal' && keyboardViewportHeight !== null && (
            <MobileKeyBar onKey={handleMobileKey} />
          )}
        </>
      ) : (
        <>
          {officeRegion}

          {/* Standalone only: terminalAvailable is only ever true when the server
              reports a working PTY, which VS Code's surface never does. In flow as a
              flex sibling so the office region reflows beside it instead of being
              overlaid. */}
          {terminalAvailable && (
            <TerminalDrawer
              agentIds={terminalAgentIds}
              activeAgentId={activeTerminalAgentId}
              onSelectAgent={handleSelectTerminal}
              onCloseAgent={handleCloseAgent}
              isOpen={isTerminalOpen}
              onClosePanel={() => setIsTerminalOpen(false)}
              widthPx={terminalWidthPx}
              onResizeStart={handleTerminalResizeStart}
              getAppearance={getAgentAppearance}
              getActivity={getAgentActivity}
            />
          )}
        </>
      )}

      <ChangelogModal
        isOpen={isChangelogOpen}
        onClose={() => setIsChangelogOpen(false)}
        currentVersion={extensionVersion}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        isDebugMode={isDebugMode}
        onToggleDebugMode={handleToggleDebugMode}
        alwaysShowOverlay={alwaysShowOverlay}
        onToggleAlwaysShowOverlay={handleToggleAlwaysShowOverlay}
        externalAssetDirectories={externalAssetDirectories}
        watchAllSessions={watchAllSessions}
        onToggleWatchAllSessions={() => {
          const newVal = !watchAllSessions;
          setWatchAllSessions(newVal);
          transport.send({ type: 'setWatchAllSessions', enabled: newVal });
        }}
        hooksEnabled={hooksEnabled}
        onToggleHooksEnabled={() => {
          const newVal = !hooksEnabled;
          setHooksEnabled(newVal);
          transport.send({ type: 'setHooksEnabled', enabled: newVal });
        }}
        showAreas={showAreas}
        onToggleShowAreas={onToggleShowAreas}
        showAreasAvailable={areasAvailable}
        onExportLayout={handleExportLayout}
        onImportLayout={handleImportLayout}
      />

      {showMigrationNotice && (
        <MigrationNotice onDismiss={() => setMigrationNoticeDismissed(true)} />
      )}
    </div>
  );
}

export default App;
