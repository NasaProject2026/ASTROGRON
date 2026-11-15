export type AnalysisCapabilityStatus =
  | 'SUPPORTED_VERIFIED'
  | 'PARTIAL_OR_CONDITIONAL'
  | 'CONFIRMED_UNSUPPORTED'
  | 'UNKNOWN_UNASSESSED'
  | 'TEMPORARILY_UNAVAILABLE'
  | 'RESEARCH_ONLY';

export interface CapabilityOverlayMeta {
  status: AnalysisCapabilityStatus;
  shortLabel: string;
  farmerHeadline: string;
  description: string;
  fillColor: string;
  fillOpacity: number;
  strokeColor: string;
  strokeWidth: number;
  badgeClasses: string;
  allowsFarmSave: true;
  allowsCropOptimization: boolean;
}

export const CAPABILITY_OVERLAY_META: Record<AnalysisCapabilityStatus, CapabilityOverlayMeta> = {
  SUPPORTED_VERIFIED: {
    status: 'SUPPORTED_VERIFIED',
    shortLabel: 'Supported · Verified',
    farmerHeadline: 'Full crop & irrigation analysis supported',
    description:
      'Calibrated agronomic models and multi-year weather forcing are verified for this zone.',
    fillColor: '#10b981',
    fillOpacity: 0.12,
    strokeColor: '#34d399',
    strokeWidth: 1.5,
    badgeClasses: 'border-emerald-400/50 bg-emerald-950/70 text-emerald-200',
    allowsFarmSave: true,
    allowsCropOptimization: true,
  },
  PARTIAL_OR_CONDITIONAL: {
    status: 'PARTIAL_OR_CONDITIONAL',
    shortLabel: 'Partial / Conditional',
    farmerHeadline: 'Partial support or boundary overlaps limits',
    description:
      'Earth-observation metadata or regional context is inspectable with caveats; custom field optimization requires qualified model support.',
    fillColor: '#f59e0b',
    fillOpacity: 0.14,
    strokeColor: '#fbbf24',
    strokeWidth: 1.5,
    badgeClasses: 'border-amber-400/50 bg-amber-950/70 text-amber-200',
    allowsFarmSave: true,
    allowsCropOptimization: false,
  },
  CONFIRMED_UNSUPPORTED: {
    status: 'CONFIRMED_UNSUPPORTED',
    shortLabel: 'Unsupported · Verified',
    farmerHeadline: 'Agronomic analysis is not available in this verified zone or site',
    description:
      'Scientific validation confirmed crop/soil optimization models are not calibrated here. Saving your farm remains enabled.',
    fillColor: '#ef4444',
    fillOpacity: 0.14,
    strokeColor: '#f87171',
    strokeWidth: 1.25,
    badgeClasses: 'border-rose-400/55 bg-rose-950/75 text-rose-200',
    allowsFarmSave: true,
    allowsCropOptimization: false,
  },
  UNKNOWN_UNASSESSED: {
    status: 'UNKNOWN_UNASSESSED',
    shortLabel: 'Unassessed / Neutral',
    farmerHeadline: 'Not yet locally assessed for crop optimization',
    description:
      'No verified capability zone covers these coordinates yet. Global map visualization & parcel saving stay active.',
    fillColor: '#94a3b8',
    fillOpacity: 0.0,
    strokeColor: '#64748b',
    strokeWidth: 1,
    badgeClasses: 'border-slate-500/40 bg-slate-900/70 text-slate-200',
    allowsFarmSave: true,
    allowsCropOptimization: false,
  },
  TEMPORARILY_UNAVAILABLE: {
    status: 'TEMPORARILY_UNAVAILABLE',
    shortLabel: 'Temporarily Unavailable',
    farmerHeadline: 'Service temporarily unreachable in this region',
    description:
      'Upstream compute or data service is temporarily offline. You can still save your farm and export boundaries.',
    fillColor: '#64748b',
    fillOpacity: 0.12,
    strokeColor: '#94a3b8',
    strokeWidth: 1.25,
    badgeClasses: 'border-slate-400/50 bg-slate-900/80 text-slate-200',
    allowsFarmSave: true,
    allowsCropOptimization: false,
  },
  RESEARCH_ONLY: {
    status: 'RESEARCH_ONLY',
    shortLabel: 'Research Archive Only',
    farmerHeadline: 'Read-only historical M14 research archive',
    description:
      'Verified Uppsala M14 archive exists as a fixed scientific benchmark only; not a live advisory engine for modified parcels.',
    fillColor: '#8b5cf6',
    fillOpacity: 0.11,
    strokeColor: '#a78bfa',
    strokeWidth: 1.3,
    badgeClasses: 'border-violet-400/50 bg-violet-950/70 text-violet-200',
    allowsFarmSave: true,
    allowsCropOptimization: false,
  },
};

export interface CapabilitySeparationMatrix {
  m4EarthDataCoverage: 'SUPPORTED_VERIFIED' | 'PARTIAL_OR_CONDITIONAL' | 'UNKNOWN_UNASSESSED';
  descriptiveEvidence: 'AVAILABLE' | 'LIMITED';
  recordedM14Research: 'RESEARCH_ONLY' | 'NOT_APPLICABLE';
  fieldCropOptimization:
    | 'SUPPORTED_VERIFIED'
    | 'PARTIAL_OR_CONDITIONAL'
    | 'CONFIRMED_UNSUPPORTED'
    | 'UNKNOWN_UNASSESSED'
    | 'TEMPORARILY_UNAVAILABLE'
    | 'RESEARCH_ONLY';
  serviceReadiness: 'AVAILABLE' | 'UNAVAILABLE' | 'UNVERIFIED';
}

export interface SiteCapabilityCheckResult {
  status: AnalysisCapabilityStatus;
  zoneId: string | null;
  zoneTitle: string;
  coordinates: [number, number];
  overlapsBoundary: boolean;
  allowsFarmSave: true;
  allowsAnalysisAction: boolean;
  headline: string;
  explanation: string;
  reasons: string[];
  alternatives: string[];
  matrix: CapabilitySeparationMatrix;
  assessedScopeNote: string;
  checkedAt: string;
}

export interface CapabilityFootprintsResponse {
  ok: boolean;
  source: 'LOCAL_SCIENTIFIC_REGISTRY' | 'BACKEND_ELIGIBILITY_API';
  assessedScopeNote: string;
  totalAssessedFeatures: number;
  confirmedUnsupportedCount: number;
  benchmarkPointCount: number;
  validatedRemotePolygonCount: number;
  featureCollection: GeoJSON.FeatureCollection;
}
