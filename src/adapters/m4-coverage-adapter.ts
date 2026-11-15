import type {
  CapabilityAssessment,
  CoverageStatus,
  EvidenceRecord,
  SiteContext,
  SourceCoverage,
} from '@/domain/contracts';
import {
  NativeM4GlobalCoverageManifestSchema,
  NativeM4SiteEntrySchema,
} from '@/domain/native-schemas';
import { EvidenceRecordSchema } from '@/domain/schemas';

export type M4SupportedUiSiteId = 'uppsala-demo' | 'nyeri-kenya' | 'wagga-australia';

export const UI_TO_M4_SITE_ID: Record<M4SupportedUiSiteId, 'SE_UPPSALA' | 'KE_NYERI_REGION' | 'AU_WAGGA_REGION'> = {
  'uppsala-demo': 'SE_UPPSALA',
  'nyeri-kenya': 'KE_NYERI_REGION',
  'wagga-australia': 'AU_WAGGA_REGION',
};

export const M4_TO_UI_SITE_ID: Record<'SE_UPPSALA' | 'KE_NYERI_REGION' | 'AU_WAGGA_REGION', M4SupportedUiSiteId> = {
  SE_UPPSALA: 'uppsala-demo',
  KE_NYERI_REGION: 'nyeri-kenya',
  AU_WAGGA_REGION: 'wagga-australia',
};

const CAPABILITY_LABELS: Record<string, string> = {
  climate_history: 'Historical Regional Meteorological Evidence (NASA POWER)',
  future_climate_context: 'Future Climate Projection Context (NEX-GDDP-CMIP6)',
  soil_characterization: 'Soil Hydraulic Characterization (SoilGrids)',
  crop_water_balance: 'Field Crop Water Balance',
  crop_regional_suitability: 'Regional Crop Suitability & Phenology',
  nitrogen: 'Soil Mineral Nitrogen (NO3-N / NH4-N)',
  growth_yield: 'Crop Yield Response Model',
  economic_assumptions: 'Economic & Legal Water-Rights Qualification',
  field_calibrated_recommendation: 'Field-Calibrated Agronomic Recommendation',
};

const VARIABLE_LABELS: Record<string, string> = {
  ALLSKY_SFC_SW_DWN: 'All-Sky Surface Shortwave Downward Irradiance (MJ/m²/day)',
  PRECTOTCORR: 'Bias-Corrected Daily Precipitation (mm/day)',
  PS: 'Surface Atmospheric Pressure (kPa)',
  RH2M: 'Relative Humidity at 2m (%)',
  T2M: 'Air Temperature at 2m Mean (°C)',
  T2M_MAX: 'Air Temperature at 2m Maximum (°C)',
  T2M_MIN: 'Air Temperature at 2m Minimum (°C)',
  WS2M: 'Wind Speed at 2m (m/s)',
  sand: 'SoilGrids Sand Content (unqualified native units)',
  silt: 'SoilGrids Silt Content (unqualified native units)',
  clay: 'SoilGrids Clay Content (unqualified native units)',
  phh2o: 'SoilGrids Soil pH in H2O (unqualified)',
  bdod: 'SoilGrids Bulk Density (unqualified)',
  soc: 'SoilGrids Soil Organic Carbon (unqualified)',
  nitrogen: 'SoilGrids Total N (NOT plant-available mineral NO3-N/NH4-N)',
};

const SITE_LOCATION_LABELS: Record<M4SupportedUiSiteId, { label: string; country: string; region: string; hemisphere: 'NORTHERN' | 'SOUTHERN' }> = {
  'uppsala-demo': {
    label: 'Uppsala, Sweden (SE_UPPSALA · M4 Evidence Node)',
    country: 'SE',
    region: 'Uppsala',
    hemisphere: 'NORTHERN',
  },
  'nyeri-kenya': {
    label: 'Nyeri Region, Kenya (KE_NYERI_REGION · M4 Coverage Only)',
    country: 'KE',
    region: 'Nyeri',
    hemisphere: 'SOUTHERN',
  },
  'wagga-australia': {
    label: 'Wagga Wagga Region, Australia (AU_WAGGA_REGION · M4 Coverage Only)',
    country: 'AU',
    region: 'New South Wales',
    hemisphere: 'SOUTHERN',
  },
};

export interface M4TranslatedSiteBundle {
  uiSiteId: M4SupportedUiSiteId;
  canonicalSiteId: 'SE_UPPSALA' | 'KE_NYERI_REGION' | 'AU_WAGGA_REGION';
  siteContext: SiteContext;
  capabilities: CapabilityAssessment[];
  sourceCoverages: SourceCoverage[];
  evidenceRecords: EvidenceRecord[];
  fieldCalibratedRecommendationReady: false;
  numericOptimizerCoupling: 'NONE';
}

export interface M4TranslatedCatalog {
  schema: string;
  asOf: string;
  purpose: string;
  sites: Record<M4SupportedUiSiteId, M4TranslatedSiteBundle>;
  soilUnitConflictNote: string;
  projectionControlNote: string;
}

export function translateNativeM4Manifest(rawManifest: unknown): M4TranslatedCatalog {
  const manifest = NativeM4GlobalCoverageManifestSchema.parse(rawManifest);

  const sites = {} as Record<M4SupportedUiSiteId, M4TranslatedSiteBundle>;

  for (const rawSite of manifest.sites) {
    const parsedSite = NativeM4SiteEntrySchema.parse(rawSite);
    const canonicalId = parsedSite.site.site_id as keyof typeof M4_TO_UI_SITE_ID;
    const uiSiteId = M4_TO_UI_SITE_ID[canonicalId];
    if (!uiSiteId) {
      throw new Error(`Unexpected canonical M4 site_id in manifest: ${parsedSite.site.site_id}`);
    }
    const meta = SITE_LOCATION_LABELS[uiSiteId];

    const capabilities: CapabilityAssessment[] = parsedSite.capabilities.map((cap) => ({
      capability: cap.capability,
      capability_label: CAPABILITY_LABELS[cap.capability] ?? cap.capability,
      status: cap.status as CoverageStatus,
      evidence_ids: [...cap.evidence_ids],
      requirements_missing: [...cap.requirements_missing],
      scientific_scope: cap.scientific_scope,
    }));

    const sourceCoverages: SourceCoverage[] = parsedSite.source_coverage.map((sc) => {
      const obsPeriodObj = (sc as { observation_period?: { start?: string | null; end?: string | null; time_standard?: string } }).observation_period;
      const obsText = obsPeriodObj?.start && obsPeriodObj?.end
        ? `${obsPeriodObj.start} to ${obsPeriodObj.end} (${obsPeriodObj.time_standard ?? 'UTC'})`
        : obsPeriodObj?.time_standard ?? 'N/A';

      const sourceId = sc.source_id;
      const publisher =
        sourceId === 'POWER_DAILY' || sourceId === 'NEX_GDDP_CMIP6'
          ? 'NASA POWER'
          : 'ISRIC SoilGrids v2';

      const status = sc.status as CoverageStatus;
      const infElig: SourceCoverage['inference_eligibility'] =
        status === 'AVAILABLE'
          ? 'ELIGIBLE_DESCRIPTIVE_ONLY'
          : status === 'CONDITIONAL'
          ? 'CONDITIONAL_RESEARCH'
          : 'BLOCKED_FOR_FIELD_DECISION';

      return {
        source_id: sourceId,
        source_title:
          sourceId === 'POWER_DAILY'
            ? 'NASA POWER Daily Historical Meteorology (MERRA-2 / CERES)'
            : sourceId === 'NEX_GDDP_CMIP6'
            ? 'NASA NEX-GDDP-CMIP6 Future Climate Scenario Projection'
            : 'ISRIC SoilGrids 2.0 Global Gridded Soil Context',
        publisher,
        variable: sc.variable,
        variable_label: VARIABLE_LABELS[sc.variable] ?? sc.variable,
        status,
        spatial_coverage: String((sc as { spatial_coverage?: string }).spatial_coverage ?? 'REGIONAL_MODEL_GRID'),
        temporal_resolution: sourceId === 'ISRIC_SOILGRIDS_2' ? 'Static depth model (0–5 cm)' : 'Daily UTC',
        acquisition_status: String((sc as { acquisition_status?: string }).acquisition_status ?? 'UNKNOWN'),
        inference_eligibility: infElig,
        reason: sc.reason,
        why_unavailable_detail:
          sourceId === 'ISRIC_SOILGRIDS_2'
            ? 'ISRIC SoilGrids native grid response carries unqualified radiation-like unit metadata (W.m-2.Sr-1) and total N rather than plant-available mineral NO3-N/NH4-N.'
            : sourceId === 'NEX_GDDP_CMIP6'
            ? 'CMIP6 2050 diagnostic samples returned fill_value (-999 -> null) and upstream CMIP6 file license remains unresolved.'
            : undefined,
        site_id: uiSiteId,
        requested_point: parsedSite.site.geometry.point,
        observation_period: obsText,
        purpose: parsedSite.site.purpose,
      };
    });

    const evidenceRecords: EvidenceRecord[] = parsedSite.evidence.map((ev) => {
      const evRec = ev as Record<string, unknown>;
      const srcObj = (evRec.source ?? {}) as { publisher?: string; product?: string; api_version?: string; documentation?: string };
      const periodObj = (evRec.period ?? {}) as { start?: string; end?: string; time_standard?: string };
      const qualObj = (evRec.quality ?? {}) as { expected_days?: number; valid_days?: number; missing_days?: number; fill_value?: number };
      const licenseObj = (evRec.license ?? {}) as { identifier?: string; attribution?: string };
      const spatialObj = (evRec.spatial_support ?? {}) as { kind?: string; selection?: string };
      const samplesRaw = Array.isArray(evRec.samples) ? (evRec.samples as Array<{ date: string; value: number | null }>) : [];
      // Keep representative start/mid/end sample slice (up to 16 points) for compact client telemetry while keeping raw file intact on server
      const slice =
        samplesRaw.length <= 16
          ? samplesRaw
          : [...samplesRaw.slice(0, 8), ...samplesRaw.slice(-8)];

      return EvidenceRecordSchema.parse({
        evidence_id: ev.evidence_id,
        site_id: uiSiteId,
        dataset_mode: 'RECORDED_M14_RESEARCH',
        source: `${srcObj.publisher ?? 'NASA POWER'} · ${srcObj.product ?? 'POWER_DAILY'} (${canonicalId})`,
        product_version: srcObj.api_version ?? 'v2.10.3',
        variable: ev.variable,
        variable_label: VARIABLE_LABELS[ev.variable] ?? ev.variable,
        evidence_class:
          srcObj.product === 'NEX-GDDP-CMIP6' || (qualObj.valid_days ?? 0) === 0
            ? 'MISSING_OR_UNQUALIFIED'
            : 'REGIONAL_MODEL_EVIDENCE',
        spatial_support: `${spatialObj.kind ?? 'REGIONAL_MODEL_GRID_NOT_PARCEL'} — ${spatialObj.selection ?? 'nearest native grid cell'}`,
        period: `${periodObj.start ?? '2023-12-01'} to ${periodObj.end ?? '2024-12-31'}`,
        timezone: periodObj.time_standard ?? 'UTC',
        available_at: String(evRec.available_at ?? manifest.as_of),
        units: ev.units,
        quality: `valid_days=${qualObj.valid_days ?? 0}, missing_days=${qualObj.missing_days ?? 0} of ${qualObj.expected_days ?? 0}`,
        missingness_summary:
          (qualObj.missing_days ?? 0) > 0
            ? `${qualObj.missing_days} of ${qualObj.expected_days} days missing (fill -999 -> null, never coerced to 0).`
            : '0 missing days in extracted window.',
        uncertainty: String(evRec.uncertainty ?? 'Regional grid model uncertainty not field-calibrated.'),
        license: `${licenseObj.identifier ?? 'NASA_POWER_FREE_PUBLIC_ACCESS'}: ${licenseObj.attribution ?? 'NASA POWER attribution; no endorsement'}`,
        source_sha256: ev.source_sha256,
        extraction_recipe: JSON.stringify(evRec.extraction_recipe ?? 'POWER_DAILY_STRICT_V1'),
        samples: slice,
        limitations: Array.isArray(evRec.limitations) ? (evRec.limitations as string[]) : [],
        supports_components: ['coverage', 'evidence', 'reports'],
      });
    });

    sites[uiSiteId] = {
      uiSiteId,
      canonicalSiteId: canonicalId,
      siteContext: {
        site_id: uiSiteId,
        geometry: {
          point: parsedSite.site.geometry.point,
          polygon: null,
          crs: 'EPSG:4326',
          area_ha: parsedSite.site.geometry.area_ha,
          area_basis: 'USER_DECLARED_NOT_SURVEYED',
        },
        as_of: parsedSite.site.as_of,
        purpose: parsedSite.site.purpose,
        location_label: meta.label,
        country_code: meta.country,
        region_name: meta.region,
        hemisphere: meta.hemisphere,
      },
      capabilities,
      sourceCoverages,
      evidenceRecords,
      fieldCalibratedRecommendationReady: false,
      numericOptimizerCoupling: 'NONE',
    };
  }

  return {
    schema: manifest.schema,
    asOf: manifest.as_of,
    purpose: manifest.purpose,
    sites,
    soilUnitConflictNote:
      'SoilGrids native unit conflict (W.m-2.Sr-1 metadata in soil_source) and total-N != mineral-N rule block soil_characterization and nitrogen everywhere.',
    projectionControlNote:
      'NEX-GDDP-CMIP6 2050 ssp245 projection probe returned 7/7 null fill values across SE_UPPSALA/KE_NYERI_REGION/AU_WAGGA_REGION; Antarctic control is OUT_OF_COVERAGE.',
  };
}
