export const EXPLORER_SELECTION_STORAGE_KEY = 'astragron:selected-explorer-region';

export interface ExplorerRegionSelection {
  siteKey: string;
  label: string;
  countryCode: string;
  regionName: string;
  lon: number;
  lat: number;
  updatedAt: string;
}

function isValidSelection(raw: unknown): raw is ExplorerRegionSelection {
  if (!raw || typeof raw !== 'object') return false;
  const candidate = raw as Record<string, unknown>;
  return (
    typeof candidate.siteKey === 'string' &&
    candidate.siteKey.trim().length > 0 &&
    typeof candidate.label === 'string' &&
    candidate.label.trim().length > 0 &&
    typeof candidate.lon === 'number' &&
    Number.isFinite(candidate.lon) &&
    candidate.lon >= -180 &&
    candidate.lon <= 180 &&
    typeof candidate.lat === 'number' &&
    Number.isFinite(candidate.lat) &&
    candidate.lat >= -90 &&
    candidate.lat <= 90
  );
}

export function saveExplorerSelection(selection: ExplorerRegionSelection): void {
  if (typeof window === 'undefined' || !isValidSelection(selection)) return;
  const serialized = JSON.stringify(selection);
  try {
    window.sessionStorage.setItem(EXPLORER_SELECTION_STORAGE_KEY, serialized);
  } catch {
    // Ignore storage quota/private-mode restrictions cleanly
  }
  try {
    window.localStorage.setItem(EXPLORER_SELECTION_STORAGE_KEY, serialized);
  } catch {
    // Ignore storage quota/private-mode restrictions cleanly
  }
}

export function loadExplorerSelection(): ExplorerRegionSelection | null {
  if (typeof window === 'undefined') return null;
  for (const store of [window.sessionStorage, window.localStorage]) {
    try {
      const raw = store.getItem(EXPLORER_SELECTION_STORAGE_KEY);
      if (!raw) continue;
      const parsed: unknown = JSON.parse(raw);
      if (isValidSelection(parsed)) return parsed;
    } catch {
      // Ignore corrupt storage entries
    }
  }
  return null;
}

export function parseResearchSelectionFromUrl(search: string): ExplorerRegionSelection | null {
  try {
    const params = new URLSearchParams(search);
    const siteKey = params.get('selectedSite')?.trim();
    const label = params.get('label')?.trim();
    const lon = Number(params.get('lon'));
    const lat = Number(params.get('lat'));
    if (!siteKey || !label || !Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
    return {
      siteKey: siteKey.slice(0, 80),
      label: label.slice(0, 120),
      countryCode: (params.get('country')?.trim() || 'INTL').slice(0, 16),
      regionName: (params.get('region')?.trim() || 'Explorer Selection').slice(0, 120),
      lon: Number(lon.toFixed(5)),
      lat: Number(lat.toFixed(5)),
      updatedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function buildResearchDemoHref(
  selection: Pick<ExplorerRegionSelection, 'siteKey' | 'label' | 'lon' | 'lat' | 'countryCode' | 'regionName'>
): string {
  const params = new URLSearchParams({
    selectedSite: selection.siteKey,
    label: selection.label,
    lon: selection.lon.toFixed(5),
    lat: selection.lat.toFixed(5),
    country: selection.countryCode || 'INTL',
    region: selection.regionName || 'Explorer Selection',
  });
  return `/research?${params.toString()}`;
}
