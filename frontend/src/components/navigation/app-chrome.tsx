'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Globe2,
  BookOpen,
  FlaskConical,
  PlusCircle,
  Menu,
  X,
  HelpCircle,
  Settings,
  Layers,
  ShieldCheck,
  Sliders,
  BarChart3,
  CalendarRange,
  CloudRain,
  GitCompare,
  FileSearch,
  FileDown,
  MapPin,
  AlertOctagon,
  ChevronDown,
  ShieldAlert,
  FolderOpen,
  MessageSquareText,
} from 'lucide-react';
import {
  AstragronMark,
  ComplexityModeSwitch,
  DatasetModeSwitch,
  DemoDisclosureStrip,
} from '@/components/design-system/primitives';
import { ScientificProvenanceDrawer } from '@/components/evidence/provenance-drawer';
import { useAstragron } from '@/hooks/use-astragron-store';
import { isBuiltInResearchSite } from '@/adapters/storage-adapters';
import { useMessages } from '@/lib/i18n';

export function TopNavigationBar() {
  const pathname = usePathname();
  const m = useMessages();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

  const primaryLinks = [
    { href: '/research', label: 'Research Workspace', Icon: FlaskConical },
    { href: '/farms', label: 'My Farms', Icon: FolderOpen },
    { href: '/explore', label: 'Explore Map', Icon: Globe2 },
  ];

  const moreLinks = [
    { href: '/help', label: 'Help & Qualification FAQ', Icon: HelpCircle },
    { href: '/methodology', label: m.nav.howItWorks, Icon: BookOpen },
    { href: '/farm/uppsala-demo/results', label: 'Sample Research (Uppsala)', Icon: FlaskConical },
    { href: '/settings', label: m.nav.settings, Icon: Settings },
  ];

  return (
    <header className="sticky top-0 z-40 w-full no-print">
      <DemoDisclosureStrip connectedResearch={pathname === '/research'} />
      <div className="border-b border-white/[0.08] bg-[#040912]/85 backdrop-blur-xl">
        <div className="mx-auto flex h-14 sm:h-16 max-w-[1440px] items-center justify-between gap-2 xl:gap-3 px-3 sm:px-6 lg:px-4 xl:px-8">
          {/* Brand */}
          <div className="flex items-center gap-2.5 xl:gap-6 min-w-0">
            <Link
              href="/"
              className="group flex shrink-0 items-center gap-1.5 sm:gap-2 xl:gap-2.5 text-[#F1F7FD] focus:outline-none"
            >
              <AstragronMark className="w-7 h-7 sm:w-8 sm:h-8 shrink-0 transition-transform duration-200 group-hover:scale-105" />
              <div className="flex flex-col">
                <span className="font-display text-base xl:text-lg font-bold tracking-wider text-[#F1F7FD] whitespace-nowrap">
                  ASTRAGRON
                </span>
                <span className="font-mono text-[9px] sm:text-[10px] uppercase tracking-[0.04em] sm:tracking-[0.06em] xl:tracking-widest text-[#72E4F1] whitespace-nowrap">
                  Orbital Intelligence
                </span>
              </div>
            </Link>

            {/* Primary Desktop Nav (3 clear destinations: My Farms, Explore Map, Help / More) */}
            <nav aria-label="Main navigation" className="hidden lg:flex items-center gap-1 xl:gap-1.5">
              {primaryLinks.map(({ href, label, Icon }) => {
                const isActive =
                  pathname === href ||
                  (href === '/farms' && pathname.startsWith('/farm/') && pathname !== '/farm/new');
                return (
                  <Link
                    key={href}
                    href={href}
                    prefetch={false}
                    className={`inline-flex items-center gap-2 rounded-xl px-3 xl:px-3.5 py-2 text-xs xl:text-sm font-medium whitespace-nowrap transition min-h-[44px] ${
                      isActive
                        ? 'bg-[#132B3F] text-[#72E4F1] border border-[#548299]/60'
                        : 'text-[#AEC4D3] hover:bg-[#0D2031] hover:text-[#F1F7FD]'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{label}</span>
                  </Link>
                );
              })}

              <div className="relative">
                <button
                  type="button"
                  aria-expanded={moreMenuOpen}
                  aria-haspopup="menu"
                  data-testid="header-help-more-btn"
                  onClick={() => setMoreMenuOpen((v) => !v)}
                  className={`inline-flex items-center gap-1.5 rounded-xl px-3 xl:px-3.5 py-2 text-xs xl:text-sm font-medium whitespace-nowrap transition min-h-[44px] cursor-pointer ${
                    moreMenuOpen
                      ? 'bg-[#132B3F] text-[#72E4F1] border border-[#548299]/60'
                      : 'text-[#AEC4D3] hover:bg-[#0D2031] hover:text-[#F1F7FD]'
                  }`}
                >
                  <HelpCircle className="w-4 h-4 shrink-0" />
                  <span>Help / More</span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 transition-transform ${moreMenuOpen ? 'rotate-180' : ''}`}
                  />
                </button>

                {moreMenuOpen && (
                  <div
                    role="menu"
                    className="absolute start-0 top-12 z-50 w-72 rounded-2xl border border-[#29455A] bg-[#071524] p-2.5 shadow-2xl space-y-2"
                  >
                    <div className="space-y-1">
                      {moreLinks.map(({ href, label, Icon }) => (
                        <Link
                          key={href}
                          href={href}
                          prefetch={false}
                          role="menuitem"
                          onClick={() => setMoreMenuOpen(false)}
                          className="flex min-h-[42px] items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium text-[#F1F7FD] hover:bg-[#132B3F]"
                        >
                          <Icon className="w-4 h-4 text-[#72E4F1] shrink-0" />
                          <span>{label}</span>
                        </Link>
                      ))}
                    </div>
                    <div className="border-t border-[#29455A] pt-2.5 px-2 pb-1 space-y-1.5">
                      <span className="block font-mono text-[10px] uppercase text-[#90A8BA]">
                        View Complexity
                      </span>
                      <ComplexityModeSwitch />
                    </div>
                  </div>
                )}
              </div>
            </nav>
          </div>

          {/* Right controls: Single primary Add Farm CTA */}
          <div className="hidden lg:flex items-center gap-3">
            <Link
              href="/farm/new"
              prefetch={false}
              className="inline-flex h-11 shrink-0 items-center gap-2 rounded-xl bg-[#72E4F1] px-4 text-xs xl:text-sm font-semibold text-[#081521] whitespace-nowrap shadow-sm transition hover:bg-[#43C9C1]"
            >
              <PlusCircle className="w-4 h-4 shrink-0" />
              <span>Add Farm</span>
            </Link>
          </div>

          {/* Mobile Hamburger */}
          <div className="flex items-center gap-2 lg:hidden">
            <Link
              href="/farms"
              prefetch={false}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[#29455A] bg-[#0D2031] px-3 text-xs font-medium text-[#F1F7FD]"
            >
              <FolderOpen className="w-3.5 h-3.5 text-[#72E4F1]" />
              <span>My Farms</span>
            </Link>
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-expanded={mobileMenuOpen}
              aria-label="Toggle navigation menu"
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[#29455A] bg-[#0D2031] text-[#F1F7FD]"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile Drawer */}
        {mobileMenuOpen && (
          <div className="border-t border-[#29455A] bg-[#081728] px-4 py-4 lg:hidden space-y-4">
            <nav className="grid gap-1.5" aria-label="Mobile navigation">
              {primaryLinks.map(({ href, label, Icon }) => (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex min-h-[44px] items-center gap-3 rounded-xl border border-[#29455A]/60 bg-[#0D2031] px-4 py-3 text-sm font-medium text-[#F1F7FD]"
                >
                  <Icon className="w-4 h-4 text-[#72E4F1]" />
                  <span>{label}</span>
                </Link>
              ))}
              <Link
                href="/farm/new"
                onClick={() => setMobileMenuOpen(false)}
                className="flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-[#72E4F1] px-4 py-3 text-sm font-semibold text-[#081521]"
              >
                <PlusCircle className="w-4 h-4" />
                <span>Add Farm</span>
              </Link>
              <div className="grid grid-cols-2 gap-2 pt-2">
                {moreLinks.map(({ href, label, Icon }) => (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex min-h-[44px] items-center gap-2 rounded-xl border border-[#29455A] bg-[#132B3F] px-3 py-2 text-xs font-medium text-[#AEC4D3]"
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0 text-[#72E4F1]" />
                    <span className="truncate">{label}</span>
                  </Link>
                ))}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#29455A]/60">
                <span className="text-xs font-mono uppercase text-[#90A8BA]">View Mode:</span>
                <ComplexityModeSwitch />
              </div>
            </nav>
          </div>
        )}
      </div>
      <ScientificProvenanceDrawer />
    </header>
  );
}

function NavGroupDisclosure({
  defaultOpen,
  label,
  containsActivePage,
  children,
}: {
  defaultOpen: boolean;
  label: string;
  containsActivePage: boolean;
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState<boolean>(defaultOpen);
  return (
    <details open={isOpen} className="group rounded-xl">
      <summary
        onClick={(e) => {
          e.preventDefault();
          setIsOpen((prev) => !prev);
        }}
        className={`flex min-h-[44px] cursor-pointer list-none items-center justify-between gap-2 rounded-lg px-3 py-2 font-mono text-[10px] uppercase tracking-wider focus-visible:outline-2 focus-visible:outline-[#72E4F1] [&::-webkit-details-marker]:hidden ${
          containsActivePage ? 'bg-[#10283A] text-[#72E4F1]' : 'text-[#AFC4D3] hover:bg-[#132B3F]'
        }`}
      >
        <span>{label}</span>
        <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-0.5 py-1">{children}</div>
    </details>
  );
}

export function FarmWorkspaceShell({
  farmId,
  children,
}: {
  farmId: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { getFarmDraft, datasetMode, complexityMode, ensureFarmSyncedFromServer } = useAstragron();
  const draft = getFarmDraft(farmId);

  useEffect(() => {
    ensureFarmSyncedFromServer(farmId);
  }, [farmId, ensureFarmSyncedFromServer]);

  const isBuiltIn = isBuiltInResearchSite(farmId);
  const isModifiedDraft =
    draft !== null &&
    (Boolean(draft.inputsModified) ||
      Boolean(draft.isUserCreatedDraft) ||
      farmId.startsWith('custom-') ||
      farmId.startsWith('draft-'));

  const isUppsala =
    draft !== null &&
    !isModifiedDraft &&
    (farmId === 'uppsala-demo' ||
      farmId === 'uppsala-m14' ||
      draft.fixturePresetId === 'uppsala-m14');

  const isSimple = complexityMode === 'SIMPLE';

  const farmerPrimaryTabs = [
    { href: `/farm/${farmId}`, label: 'My Farm', Icon: Layers, exact: true },
    { href: `/farm/${farmId}/analysis`, label: 'Analysis', Icon: Sliders, exact: false },
    { href: `/farm/${farmId}/results`, label: 'Report', Icon: BarChart3, exact: false },
    { href: `/farm/${farmId}/chat`, label: 'Ask ASTRAGRON', Icon: MessageSquareText, exact: false },
  ];

  const navGroups = [
    {
      groupLabel: 'My Farm Workspace',
      items: [
        ...farmerPrimaryTabs,
        { href: `/farm/new?from=${farmId}`, label: 'Edit Fields & Info', Icon: PlusCircle, exact: false },
      ],
    },
    {
      groupLabel: 'Scientific Details & Exports',
      items: [
        { href: `/farm/${farmId}/coverage`, label: 'Evidence Readiness (M4)', Icon: ShieldCheck, exact: false },
        { href: `/farm/${farmId}/evidence`, label: 'Provenance Center', Icon: FileSearch, exact: false },
        { href: `/farm/${farmId}/plans`, label: 'Five-Year Plan Matrix', Icon: CalendarRange, exact: false },
        { href: `/farm/${farmId}/climate`, label: 'Climate & Water Series', Icon: CloudRain, exact: false },
        { href: `/farm/${farmId}/decisions`, label: 'Decision Explorer', Icon: GitCompare, exact: false },
        { href: `/farm/${farmId}/reports`, label: 'CSV / JSON Data Export', Icon: FileDown, exact: false },
      ],
    },
  ];

  const isWorkflowActive = (href: string, exact: boolean) => {
    const baseHref = href.split('?')[0]!;
    return exact
      ? pathname === baseHref
      : pathname.startsWith(baseHref) && baseHref !== `/farm/${farmId}`;
  };
  const activeStage = navGroups
    .flatMap((group) => group.items)
    .find((item) => isWorkflowActive(item.href, item.exact))?.label ?? 'My Farm';

  const workflowLink = (href: string, label: string, Icon: typeof Layers, exact: boolean) => {
    const active = isWorkflowActive(href, exact);
    return (
      <Link
        key={href}
        href={href}
        prefetch={false}
        aria-current={active ? 'page' : undefined}
        className={`flex min-w-0 w-full items-center gap-2.5 rounded-xl px-3 py-3 text-xs sm:text-sm font-medium leading-snug transition min-h-[44px] focus-visible:outline-2 focus-visible:outline-[#72E4F1] ${
          active
            ? 'border-s-2 border-[#72E4F1] bg-[#132B3F] text-[#72E4F1] font-semibold'
            : 'text-[#AEC4D3] hover:bg-[#17374A]/60 hover:text-[#F1F7FD]'
        }`}
      >
        <Icon className="w-4 h-4 shrink-0" />
        <span className="min-w-0 break-words">{label}</span>
      </Link>
    );
  };

  return (
    <div className="min-h-screen bg-[#07111F] text-[#F1F7FD]">
      {/* Farm Context Header Bar */}
      <div className="border-b border-[#29455A] bg-[#0B1B2B]/92 px-4 py-2.5 sm:py-3.5 sm:px-6 lg:px-8 no-print">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-2.5">
          <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              {!draft ? (
                <>
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono">
                    <span className="inline-flex items-center gap-1 rounded-md border border-[#FF9299]/60 bg-[#2C141B] px-2 py-0.5 text-[#FF9299]">
                      <ShieldAlert className="w-3 h-3" />
                      Farm Not Found ({farmId})
                    </span>
                  </div>
                  <h1 className="mt-1 font-display text-lg sm:text-2xl font-bold text-[#F1F7FD] truncate">
                    Unregistered Farm Site ({farmId})
                  </h1>
                  <p className="text-xs text-[#AEC4D3]">
                    No saved farm or research example exists for &quot;{farmId}&quot;.
                  </p>
                </>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono">
                    <Link
                      href="/farms"
                      className="inline-flex items-center gap-1 rounded-md border border-[#29455A] bg-[#081728] px-2 py-0.5 text-[#90A8BA] hover:text-[#72E4F1]"
                    >
                      &larr; My Farms
                    </Link>
                    <span className="inline-flex items-center gap-1 rounded-md border border-[#72E4F1]/40 bg-[#081728] px-2 py-0.5 text-[#72E4F1]">
                      <MapPin className="w-3 h-3" />
                      [{draft.site.longitude.toFixed(4)}, {draft.site.latitude.toFixed(4)}]
                    </span>
                    {isUppsala ? (
                      datasetMode === 'RECORDED_M14_RESEARCH' ? (
                        <span className="inline-flex items-center gap-1 rounded-md border border-[#32D583]/45 bg-[#0D2B22] px-2 py-0.5 text-[#7AE6B0]">
                          RECORDED M14 BENCHMARK · SE_UPPSALA · F1–F3 (24.0 HA)
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-md border border-[#DCC08A]/50 bg-[#252015] px-2 py-0.5 text-[#DCC08A]">
                          RESEARCH EXAMPLE · 3 FIELDS (24.0 HA)
                        </span>
                      )
                    ) : isModifiedDraft ? (
                      <span className="inline-flex items-center gap-1 rounded-md border border-[#FFCE7B]/50 bg-[#2A1F12] px-2 py-0.5 text-[#FFCE7B]">
                        <AlertOctagon className="w-3 h-3" />
                        SAVED ON THIS DEVICE · READY TO CHECK DATA
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-md border border-[#FFCE7B]/50 bg-[#2A1F12] px-2 py-0.5 text-[#FFCE7B]">
                        <AlertOctagon className="w-3 h-3" />
                        COVERAGE EXAMPLE · UNQUALIFIED SITE
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                    <h1 className="font-display text-lg sm:text-xl font-bold text-[#F1F7FD]">
                      {isUppsala && datasetMode === 'RECORDED_M14_RESEARCH'
                        ? 'Uppsala Recorded M14 Archive (SE_UPPSALA · 3 Fields · 24.0 ha)'
                        : draft.name}
                    </h1>
                    <span className="hidden sm:inline text-xs text-[#90A8BA]">{draft.site.locationLabel}</span>
                  </div>
                </>
              )}
            </div>

            {/* Reference switcher & dataset control — shown cleanly for built-in research examples or Scientific View */}
            {(isBuiltIn || !isSimple) && (
              <>
                <div className="hidden lg:flex flex-col items-end gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-mono text-[#90A8BA]">Examples:</span>
                    {[
                      {
                        id: 'uppsala-demo',
                        label:
                          datasetMode === 'RECORDED_M14_RESEARCH'
                            ? 'Uppsala (SE_UPPSALA · M14 Archive)'
                            : 'Uppsala (Sweden · Synthetic Demo)',
                      },
                      { id: 'nyeri-kenya', label: 'Nyeri (Kenya · Coverage Only)' },
                      { id: 'wagga-australia', label: 'Wagga (Australia · Coverage Only)' },
                    ].map((item) => {
                      const active = farmId === item.id;
                      const suffix = pathname.replace(`/farm/${farmId}`, '') || '';
                      return (
                        <Link
                          key={item.id}
                          href={`/farm/${item.id}${suffix}`}
                          className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                            active
                              ? 'border-[#72E4F1] bg-[#132B3F] text-[#72E4F1]'
                              : 'border-[#29455A] bg-[#081728] text-[#AEC4D3] hover:border-[#548299] hover:text-[#F1F7FD]'
                          }`}
                        >
                          {item.label}
                        </Link>
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <ComplexityModeSwitch />
                    <DatasetModeSwitch />
                  </div>
                </div>

                <details className="lg:hidden rounded-xl border border-[#29455A] bg-[#081728] px-3 py-1.5 text-xs">
                  <summary className="cursor-pointer font-mono text-[11px] text-[#91B8FF] select-none">
                    Switch research example or data archive
                  </summary>
                  <div className="mt-2.5 space-y-2.5 border-t border-[#29455A]/60 pt-2">
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        {
                          id: 'uppsala-demo',
                          label:
                            datasetMode === 'RECORDED_M14_RESEARCH' ? 'Uppsala (M14)' : 'Uppsala (Demo)',
                        },
                        { id: 'nyeri-kenya', label: 'Nyeri (Coverage Only)' },
                        { id: 'wagga-australia', label: 'Wagga (Coverage Only)' },
                      ].map((item) => {
                        const active = farmId === item.id;
                        const suffix = pathname.replace(`/farm/${farmId}`, '') || '';
                        return (
                          <Link
                            key={item.id}
                            href={`/farm/${item.id}${suffix}`}
                            className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium ${
                              active
                                ? 'border-[#72E4F1] bg-[#132B3F] text-[#72E4F1]'
                                : 'border-[#29455A] bg-[#0D2031] text-[#AEC4D3]'
                            }`}
                          >
                            {item.label}
                          </Link>
                        );
                      })}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                    <ComplexityModeSwitch />
                    <DatasetModeSwitch />
                  </div>
                  </div>
                </details>
              </>
            )}
          </div>

          {/* Streamlined 4-tab primary workspace navigation bar */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 pt-1 border-t border-[#29455A]/50">
            {farmerPrimaryTabs.map(({ href, label, Icon, exact }) => {
              const active = isWorkflowActive(href, exact);
              return (
                <Link
                  key={href}
                  href={href}
                  prefetch={false}
                  aria-current={active ? 'page' : undefined}
                  className={`inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-1.5 text-xs sm:text-sm font-medium transition ${
                    active
                      ? 'bg-[#72E4F1] text-[#061320] font-semibold'
                      : 'border border-[#29455A] bg-[#081728] text-[#AEC4D3] hover:border-[#72E4F1]/60 hover:text-[#F1F7FD]'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span>{label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      {/* Main Layout Grid */}
      <div className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <aside className="lg:col-span-3 no-print min-w-0">
            <nav aria-label="Farm research workflow stages" className="lg:hidden">
              <details className="group rounded-xl border border-[#29455A] bg-[#0D2031]">
                <summary className="flex min-h-[48px] cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-[#E6F6FD] focus-visible:outline-2 focus-visible:outline-[#72E4F1] [&::-webkit-details-marker]:hidden">
                  <span className="min-w-0">
                    <span className="block text-[10px] font-mono uppercase tracking-wider text-[#90A8BA]">Research navigation</span>
                    <span className="block truncate">{activeStage}</span>
                  </span>
                  <ChevronDown className="h-5 w-5 shrink-0 text-[#72E4F1] transition-transform group-open:rotate-180" />
                </summary>
                <div className="border-t border-[#29455A] px-3 pb-3 pt-2 space-y-3">
                  {navGroups.map((grp) => (
                    <div key={grp.groupLabel}>
                      <div className="px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-[#90A8BA]">{grp.groupLabel}</div>
                      <div className="grid grid-cols-1 min-[370px]:grid-cols-2 gap-1">
                        {grp.items.map(({ href, label, Icon, exact }) => workflowLink(href, label, Icon, exact))}
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            </nav>
            <nav aria-label="Farm research workflow stages" className="hidden lg:block lg:sticky lg:top-28 rounded-2xl border border-[#29455A] bg-[#0D2031] p-2.5 space-y-1">
              {navGroups.map((grp) => {
                const containsActivePage = grp.items.some((item) => isWorkflowActive(item.href, item.exact));
                return (
                  <NavGroupDisclosure
                    key={`${grp.groupLabel}:${pathname}:${complexityMode}`}
                    defaultOpen={containsActivePage}
                    label={grp.groupLabel}
                    containsActivePage={containsActivePage}
                  >
                    {grp.items.map(({ href, label, Icon, exact }) => workflowLink(href, label, Icon, exact))}
                  </NavGroupDisclosure>
                );
              })}
            </nav>
          </aside>

          {/* Main Workspace Content */}
          <main className="lg:col-span-9 min-w-0">{children}</main>
        </div>
      </div>
    </div>
  );
}

export function SiteFooter() {
  const m = useMessages();
  const connectedResearch = usePathname() === '/research';
  const { datasetMode } = useAstragron();
  const footerModeBanner = connectedResearch
    ? 'CONDITIONAL RESEARCH · EXECUTION LABELED PER ANALYSIS'
    : datasetMode === 'RECORDED_M14_RESEARCH'
      ? m.recordedUi.recordedWatermark
      : datasetMode === 'REAL_SCIENTIFIC_BACKEND'
        ? m.recordedUi.liveWatermark
        : m.banners.demoWatermark;
  return (
    <footer className="border-t border-[#29455A] bg-[#050A12] text-[#AEC4D3] no-print">
      <div className="mx-auto max-w-[1440px] px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-4">
          <div className="md:col-span-2 space-y-3">
            <div className="flex items-center gap-2.5">
              <AstragronMark className="w-7 h-7" />
              <span className="font-display text-lg font-bold tracking-wider text-[#F1F7FD]">
                ASTRAGRON
              </span>
            </div>
            <p className="max-w-md text-xs leading-relaxed text-[#90A8BA]">
              Earth-observation-informed agricultural research and decision-support platform.
              Data sources and scientific qualifications are labeled on each view. Historical
              archives, synthetic fixtures and new scientific requests retain their own provenance.
            </p>
            <div className="rounded-xl border border-[#29455A] bg-[#081728] p-3 text-[11px] font-mono text-[#90A8BA]">
              <strong className="text-[#DCC08A]">PROVENANCE & NON-ENDORSEMENT:</strong>{' '}
              {m.banners.nasaDisclaimer} Hero artwork is an original conceptual orbital visualization;
              data layers carry explicit dataset mode, resolution, and provenance disclosures.
            </div>
          </div>

          <div>
            <h3 className="font-mono text-xs uppercase tracking-wider text-[#72E4F1]">
              Platform Workflows
            </h3>
            <ul className="mt-3 space-y-2 text-xs">
              <li>
                <Link href="/explore" className="hover:text-[#F1F7FD]">
                  Global Earth & Coverage Explorer
                </Link>
              </li>
              <li>
                <Link href="/farm/new" prefetch={false} className="hover:text-[#F1F7FD]">
                  3-Step Add Farm Studio
                </Link>
              </li>
              <li>
                <Link href="/farm/uppsala-demo/results" className="hover:text-[#F1F7FD]">
                  Synthetic Decision Overview (Uppsala)
                </Link>
              </li>
              <li>
                <Link href="/farm/uppsala-demo/plans" className="hover:text-[#F1F7FD]">
                  Five-Year Field × Season Matrix
                </Link>
              </li>
              <li>
                <Link href="/farm/uppsala-demo/climate" className="hover:text-[#F1F7FD]">
                  Climate & Water Analytics (2006 / 2012 / 2018)
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="font-mono text-xs uppercase tracking-wider text-[#72E4F1]">
              Documentation & Governance
            </h3>
            <ul className="mt-3 space-y-2 text-xs">
              <li>
                <Link href="/methodology" className="hover:text-[#F1F7FD]">
                  How It Works & Scientific Methodology
                </Link>
              </li>
              <li>
                <Link href="/farm/uppsala-demo/evidence" prefetch={false} className="hover:text-[#F1F7FD]">
                  M4 Provenance & Evidence Center
                </Link>
              </li>
              <li>
                <Link href="/help" prefetch={false} className="hover:text-[#F1F7FD]">
                  Help, Glossary & Qualification Rules
                </Link>
              </li>
              <li>
                <Link href="/settings" prefetch={false} className="hover:text-[#F1F7FD]">
                  Units, Motion & Local Demo Privacy
                </Link>
              </li>
              <li>
                <Link href="/design-system" prefetch={false} className="hover:text-[#F1F7FD]">
                  Orbital Design System Specification
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-8 border-t border-[#29455A]/60 pt-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-[11px] font-mono text-[#90A8BA]">
          <span>
            {connectedResearch ? 'Provenance: bound to the selected analysis' : 'Contracts: astragron.global-evidence.v1 · astragron.m14.response.v1'}
          </span>
          <span>{footerModeBanner} · Language: English (en)</span>
        </div>
      </div>
    </footer>
  );
}
