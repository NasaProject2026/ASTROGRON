'use client';

import React, { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Plus,
  FolderOpen,
  Download,
  Upload,
  Archive,
  Trash2,
  Copy,
  Pencil,
  Check,
  X,
  AlertTriangle,
  HardDrive,
  FlaskConical,
  ArrowRight,
  RotateCcw,
  MoreVertical,
} from 'lucide-react';
import { formatAreaWithUnit, useAstragron } from '@/hooks/use-astragron-store';
import {
  computeFarmAreaHa,
  isBuiltInResearchSite,
} from '@/adapters/storage-adapters';
import type { UserFarmDraft } from '@/domain/contracts';
import { FarmPolygonPreview } from './farm-polygon-preview';
import { IS_STATIC_SHOWCASE } from '@/lib/base-path';

export function MyFarmsDashboard() {
  const router = useRouter();
  const {
    farmDrafts,
    archivedFarmIds,
    renameFarmDraft,
    duplicateFarmDraft,
    archiveFarmDraft,
    deleteFarmDraft,
    exportAllFarmsBackup,
    importFarmsBackup,
    storageError,
    clearStorageError,
    getReportsForFarm,
    unitMode,
  } = useAstragron();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [backupNotice, setBackupNotice] = useState<{
    kind: 'ok' | 'err';
    text: string;
  } | null>(null);

  const archivedSet = useMemo(() => new Set(archivedFarmIds), [archivedFarmIds]);

  const { activeUserFarms, archivedUserFarms, exampleFarms } = useMemo(() => {
    const all = Object.values(farmDrafts);
    const active: UserFarmDraft[] = [];
    const archived: UserFarmDraft[] = [];
    const examples: UserFarmDraft[] = [];

    for (const draft of all) {
      if (isBuiltInResearchSite(draft.id)) {
        examples.push(draft);
      } else if (archivedSet.has(draft.id)) {
        archived.push(draft);
      } else {
        active.push(draft);
      }
    }

    const byRecent = (a: UserFarmDraft, b: UserFarmDraft) =>
      a.updatedAt < b.updatedAt ? 1 : -1;
    active.sort(byRecent);
    archived.sort(byRecent);
    examples.sort((a, b) => (a.id === 'uppsala-demo' ? -1 : b.id === 'uppsala-demo' ? 1 : 0));

    return {
      activeUserFarms: active,
      archivedUserFarms: archived,
      exampleFarms: examples,
    };
  }, [farmDrafts, archivedSet]);

  const visibleUserFarms = showArchived ? archivedUserFarms : activeUserFarms;

  const handleExportBackup = () => {
    const bundle = exportAllFarmsBackup();
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `astragron-my-farms-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setBackupNotice({
      kind: 'ok',
      text: `Exported ${Object.keys(bundle.farms).length} farm(s) and ${bundle.reports.length} report snapshot(s) with integrity checksum.`,
    });
  };

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const res = importFarmsBackup(text);
      if (res.ok) {
        setBackupNotice({
          kind: 'ok',
          text: `Restored ${res.importedCount} farm(s) cleanly from backup.`,
        });
      } else {
        setBackupNotice({
          kind: 'err',
          text: res.error ?? 'Backup import failed validation.',
        });
      }
    } catch {
      setBackupNotice({
        kind: 'err',
        text: 'Could not read the selected backup file.',
      });
    }
  };

  const handleDuplicate = (farmId: string, openAfter = false) => {
    const copy = duplicateFarmDraft(farmId);
    setOpenMenuId(null);
    if (copy) {
      setBackupNotice({
        kind: 'ok',
        text: `Created copy "${copy.name}".`,
      });
      if (openAfter) {
        router.push(
          IS_STATIC_SHOWCASE
            ? `/farm/new?from=${encodeURIComponent(copy.id)}`
            : `/farm/${copy.id}`
        );
      }
    }
  };

  const handleRenameSubmit = (farmId: string) => {
    if (renameValue.trim()) {
      renameFarmDraft(farmId, renameValue.trim());
    }
    setRenamingId(null);
    setRenameValue('');
  };

  return (
    <main className="min-h-screen bg-[#07111F] text-[#F1F7FD] py-8 sm:py-12">
      <div className="mx-auto max-w-[1280px] px-4 sm:px-6 lg:px-8 space-y-8">
        {/* Top Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-[#29455A] pb-6">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-[#548299]/60 bg-[#0D2031] px-3 py-1 text-[11px] font-mono text-[#72E4F1]">
              <HardDrive className="w-3.5 h-3.5" />
              <span>Saved on this device · Cloud sync not enabled</span>
            </div>
            <h1 className="font-display text-3xl sm:text-4xl font-bold text-[#F1F7FD]">
              My Farms
            </h1>
            <p className="text-sm text-[#AEC4D3] max-w-2xl">
              Manage your farm boundaries, review saved reports, or inspect built-in regional research examples.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <Link
              href="/farm/new"
              data-testid="my-farms-add-btn"
              className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-[#72E4F1] px-5 py-2.5 text-sm font-semibold text-[#061320] transition hover:bg-[#93EDF7]"
            >
              <Plus className="w-4 h-4" />
              <span>Add farm</span>
            </Link>
            <button
              type="button"
              onClick={handleExportBackup}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-[#548299] bg-[#0D2031] px-4 py-2 text-xs font-medium text-[#F1F7FD] hover:border-[#72E4F1] cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-[#72E4F1]" />
              <span>Export backup</span>
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-[#548299] bg-[#0D2031] px-4 py-2 text-xs font-medium text-[#F1F7FD] hover:border-[#72E4F1] cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5 text-[#57D9A7]" />
              <span>Import backup</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={handleImportFile}
              className="sr-only"
              aria-label="Import farm backup JSON"
            />
          </div>
        </div>

        {/* Storage Error Surface */}
        {storageError && (
          <div
            role="alert"
            data-testid="storage-error-banner"
            className="flex items-start justify-between gap-3 rounded-2xl border border-[#FF9299]/60 bg-[#2C141B] p-4 text-xs text-[#FF9299]"
          >
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold text-[#F1F7FD]">Device storage warning</div>
                <p className="mt-0.5">{storageError}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={clearStorageError}
              className="shrink-0 rounded-lg border border-[#FF9299]/40 px-2.5 py-1 text-[11px] hover:bg-[#3A1B24] cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Backup / Restore Notice */}
        {backupNotice && (
          <div
            role="status"
            data-testid="backup-status-notice"
            className={`flex items-center justify-between gap-3 rounded-xl border p-3.5 text-xs ${
              backupNotice.kind === 'ok'
                ? 'border-[#57D9A7]/50 bg-[#0D2B2A] text-[#57D9A7]'
                : 'border-[#FF9299]/50 bg-[#2C141B] text-[#FF9299]'
            }`}
          >
            <span>{backupNotice.text}</span>
            <button
              type="button"
              onClick={() => setBackupNotice(null)}
              className="text-current opacity-80 hover:opacity-100 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* SECTION 1: YOUR FARMS */}
        <section data-testid="my-farms-your-section" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-xl font-bold text-[#F1F7FD]">
                Your Farms ({activeUserFarms.length})
              </h2>
              <p className="text-xs text-[#90A8BA]">
                Private to this browser until you export a backup or connect cloud storage.
              </p>
            </div>
            {archivedUserFarms.length > 0 && (
              <button
                type="button"
                onClick={() => setShowArchived((v) => !v)}
                className="min-h-[38px] rounded-xl border border-[#29455A] bg-[#0D2031] px-3.5 py-1.5 text-xs text-[#AEC4D3] hover:border-[#72E4F1] cursor-pointer"
              >
                {showArchived
                  ? `Show active farms (${activeUserFarms.length})`
                  : `View archived (${archivedUserFarms.length})`}
              </button>
            )}
          </div>

          {visibleUserFarms.length === 0 ? (
            <div
              data-testid="my-farms-empty-state"
              className="rounded-3xl border border-dashed border-[#29455A] bg-[#0A1828] p-8 sm:p-12 text-center space-y-5"
            >
              <div className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-[#72E4F1]/30 bg-[#0F273B] text-[#72E4F1]">
                <FolderOpen className="w-6 h-6" />
              </div>
              <div className="space-y-2 max-w-md mx-auto">
                <h3 className="font-display text-2xl font-bold text-[#F1F7FD]">
                  {showArchived ? 'No archived farms.' : 'Your land, one clear view.'}
                </h3>
                <p className="text-sm text-[#AEC4D3]">
                  {showArchived
                    ? 'Farms you archive from the main list will appear here safely without losing reports.'
                    : 'Add your first farm in three simple steps to check satellite data coverage and build an offline PDF dossier.'}
                </p>
              </div>
              {!showArchived && (
                <div className="flex flex-wrap items-center justify-center gap-4 pt-1">
                  <Link
                    href="/farm/new"
                    className="inline-flex min-h-[46px] items-center gap-2 rounded-full bg-[#72E4F1] px-6 py-2.5 text-sm font-semibold text-[#061320] hover:bg-[#93EDF7]"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Add my first farm</span>
                  </Link>
                  <a
                    href="#research-examples"
                    className="text-sm text-[#AEC4D3] underline-offset-4 hover:text-[#72E4F1] hover:underline"
                  >
                    Explore sample research
                  </a>
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
              {visibleUserFarms.map((farm) => {
                const areaHa = computeFarmAreaHa(farm);
                const farmReports = getReportsForFarm(farm.id);
                const latestReport = farmReports[0] ?? null;
                const isRenaming = renamingId === farm.id;
                const isConfirmDelete = confirmDeleteId === farm.id;

                return (
                  <article
                    key={farm.id}
                    data-testid={`farm-card-${farm.id}`}
                    className="relative flex flex-col justify-between rounded-2xl border border-[#29455A] bg-[#0D2031] p-5 gap-4 transition hover:border-[#548299]"
                  >
                    <div className="space-y-3">
                      <FarmPolygonPreview farm={farm} className="h-28 w-full" />

                      <div className="flex items-start justify-between gap-2">
                        {isRenaming ? (
                          <div className="flex flex-1 items-center gap-1.5">
                            <input
                              type="text"
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              aria-label="New farm name"
                              className="w-full min-h-[38px] rounded-lg border border-[#72E4F1] bg-[#071422] px-2.5 text-sm text-[#F1F7FD]"
                            />
                            <button
                              type="button"
                              aria-label="Save name"
                              onClick={() => handleRenameSubmit(farm.id)}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-[#57D9A7] text-[#061320] cursor-pointer"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                            <button
                              type="button"
                              aria-label="Cancel rename"
                              onClick={() => setRenamingId(null)}
                              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[#29455A] text-[#AEC4D3] cursor-pointer"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        ) : (
                          <div className="min-w-0">
                            <h3 className="font-display text-lg font-bold text-[#F1F7FD] truncate">
                              {farm.name}
                            </h3>
                            <p className="text-xs text-[#90A8BA] truncate">
                              {farm.site.locationLabel}
                            </p>
                          </div>
                        )}

                        <div className="relative">
                          <button
                            type="button"
                            aria-label={`Manage ${farm.name}`}
                            aria-expanded={openMenuId === farm.id}
                            onClick={() =>
                              setOpenMenuId(openMenuId === farm.id ? null : farm.id)
                            }
                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[#29455A] bg-[#081728] text-[#AEC4D3] hover:text-[#F1F7FD] cursor-pointer"
                          >
                            <MoreVertical className="w-4 h-4" />
                          </button>

                          {openMenuId === farm.id && (
                            <div
                              role="menu"
                              className="absolute end-0 top-10 z-20 w-44 rounded-xl border border-[#29455A] bg-[#071524] p-1.5 shadow-xl text-xs"
                            >
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setOpenMenuId(null);
                                  setRenamingId(farm.id);
                                  setRenameValue(farm.name);
                                }}
                                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[#F1F7FD] hover:bg-[#132B3F] cursor-pointer"
                              >
                                <Pencil className="w-3.5 h-3.5 text-[#72E4F1]" />
                                <span>Rename</span>
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => handleDuplicate(farm.id)}
                                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[#F1F7FD] hover:bg-[#132B3F] cursor-pointer"
                              >
                                <Copy className="w-3.5 h-3.5 text-[#57D9A7]" />
                                <span>Duplicate</span>
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setOpenMenuId(null);
                                  archiveFarmDraft(farm.id, !archivedSet.has(farm.id));
                                }}
                                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[#F1F7FD] hover:bg-[#132B3F] cursor-pointer"
                              >
                                {archivedSet.has(farm.id) ? (
                                  <>
                                    <RotateCcw className="w-3.5 h-3.5 text-[#DCC08A]" />
                                    <span>Restore farm</span>
                                  </>
                                ) : (
                                  <>
                                    <Archive className="w-3.5 h-3.5 text-[#DCC08A]" />
                                    <span>Archive</span>
                                  </>
                                )}
                              </button>
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setOpenMenuId(null);
                                  setConfirmDeleteId(farm.id);
                                }}
                                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[#FF9299] hover:bg-[#2C141B] cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span>Delete</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-xs text-[#AEC4D3]">
                        <span>{farm.fields.length} field{farm.fields.length === 1 ? '' : 's'}</span>
                        <span>·</span>
                        <span>{formatAreaWithUnit(areaHa, unitMode)}</span>
                        <span>·</span>
                        <span className="font-mono text-[11px] text-[#90A8BA]">
                          Updated {new Date(farm.updatedAt).toLocaleDateString()}
                        </span>
                      </div>

                      <div className="inline-flex items-center rounded-full border border-[#548299]/40 bg-[#081728] px-2.5 py-0.5 text-[11px] font-mono text-[#DCC08A]">
                        {latestReport
                          ? `Saved report (${new Date(latestReport.createdAt).toLocaleDateString()})`
                          : 'Saved locally · Ready to check data'}
                      </div>
                    </div>

                    {isConfirmDelete ? (
                      <div className="rounded-xl border border-[#FF9299]/60 bg-[#2C141B] p-3 space-y-2 text-xs">
                        <div className="font-semibold text-[#F1F7FD]">
                          Delete &ldquo;{farm.name}&rdquo; permanently from this device?
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            data-testid={`confirm-delete-${farm.id}`}
                            onClick={() => {
                              deleteFarmDraft(farm.id);
                              setConfirmDeleteId(null);
                            }}
                            className="rounded-lg bg-[#FF9299] px-3 py-1.5 font-semibold text-[#1B080D] cursor-pointer"
                          >
                            Yes, delete
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="rounded-lg border border-[#548299] px-3 py-1.5 text-[#F1F7FD] cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#29455A]/70">
                        <Link
                          href={
                            IS_STATIC_SHOWCASE
                              ? `/farm/new?from=${encodeURIComponent(farm.id)}`
                              : `/farm/${farm.id}`
                          }
                          className="inline-flex min-h-[42px] flex-1 items-center justify-center gap-2 rounded-xl bg-[#72E4F1] px-4 py-2 text-xs font-semibold text-[#061320] transition hover:bg-[#93EDF7]"
                        >
                          <span>Open farm</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </Link>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>

        {/* SECTION 2: RESEARCH EXAMPLES (STRICTLY SEPARATED & IMMUTABLE) */}
        <section
          id="research-examples"
          data-testid="my-farms-examples-section"
          className="space-y-4 border-t border-[#29455A] pt-8"
        >
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <div className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-[#91B8FF]">
                <FlaskConical className="w-3.5 h-3.5" />
                <span>Read-Only Scientific Benchmarks</span>
              </div>
              <h2 className="font-display text-xl font-bold text-[#F1F7FD]">
                Research Examples
              </h2>
              <p className="text-xs text-[#90A8BA]">
                Reference farms used to inspect verified scientific archives and satellite coverage behavior. Originals stay read-only; duplicate to customize safely.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            {exampleFarms.map((ex) => {
              const isUppsala = ex.id === 'uppsala-demo';
              const areaHa = computeFarmAreaHa(ex);
              return (
                <article
                  key={ex.id}
                  data-testid={`example-card-${ex.id}`}
                  className="flex flex-col justify-between rounded-2xl border border-[#29455A] bg-[#081523] p-5 gap-4"
                >
                  <div className="space-y-3">
                    <FarmPolygonPreview farm={ex} className="h-24 w-full" />
                    <div>
                      <span className="inline-flex rounded-full border border-[#548299]/50 bg-[#0D2031] px-2.5 py-0.5 font-mono text-[10px] text-[#91B8FF] mb-1.5">
                        {isUppsala ? 'Multi-year M14 / Demo Benchmark' : 'Regional Coverage Example'}
                      </span>
                      <h3 className="font-display text-base font-bold text-[#F1F7FD]">
                        {ex.name}
                      </h3>
                      <p className="text-xs text-[#90A8BA]">{ex.site.locationLabel}</p>
                    </div>
                    <div className="text-xs text-[#AEC4D3]">
                      {ex.fields.length} field{ex.fields.length === 1 ? '' : 's'} ·{' '}
                      {formatAreaWithUnit(areaHa, unitMode)}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t border-[#29455A]/60">
                    <Link
                      href={`/farm/${ex.id}/results`}
                      className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-xl border border-[#72E4F1]/60 bg-[#0D2031] px-3 py-2 text-xs font-semibold text-[#72E4F1] hover:bg-[#13324F]"
                    >
                      <span>{isUppsala ? 'View report' : 'Inspect coverage'}</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </Link>
                    <button
                      type="button"
                      onClick={() => handleDuplicate(ex.id, true)}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-[#29455A] bg-[#0A1828] px-3 py-2 text-xs text-[#AEC4D3] hover:border-[#72E4F1] hover:text-[#F1F7FD] cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy &amp; edit</span>
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
