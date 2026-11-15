export const enMessages = {
  meta: {
    locale: 'en',
    direction: 'ltr' as const,
    appName: 'ASTRAGRON',
    tagline: 'Orbital Intelligence for Agricultural Research & Decision Support',
  },
  banners: {
    demoWatermark: 'SYNTHETIC INTERFACE DEMONSTRATION — NOT RECORDED SCIENTIFIC RESULTS',
    researchQualifier: 'Synthetic UI fixture · Field recommendation blocked · Not field-validated',
    nasaDisclaimer:
      'Research experience using selected NASA Earth-data concepts. Not endorsed, certified, or operated by NASA.',
    abstentionPrimary:
      'No tested policy meets the declared water-service criterion across all 9 scenario states in this synthetic demonstration. You can still compare conditional research alternatives, but a field recommendation is not available.',
  },
  nav: {
    exploreEarth: 'Explore Earth',
    howItWorks: 'How It Works',
    researchDemo: 'Synthetic Demo',
    setupFarm: 'Set Up Farm Draft',
    designSystem: 'Design System',
    helpFaq: 'Help & Qualification',
    settings: 'Settings',
    groups: {
      setup: 'Site & Setup',
      evidence: 'Evidence & Coverage',
      analysis: 'Scenario Analysis',
      results: 'Research Outcomes',
    },
    farmTabs: {
      overview: 'Farm Overview',
      coverage: 'Evidence Readiness',
      analysis: 'Analysis Setup',
      results: 'Decision Overview',
      plans: 'Five-Year Plan',
      climate: 'Climate & Water',
      decisions: 'Decision Explorer',
      evidence: 'Provenance Center',
      reports: 'Reports & Export',
    },
  },
  hero: {
    eyebrow: 'ORBITAL INTELLIGENCE · EARTH OBSERVATION TO FIELD EVIDENCE',
    headline: 'Understand your land. Explore what comes next.',
    subcopy:
      'Explore Earth observations, evaluate multi-year agricultural research scenarios, and inspect the evidence and uncertainty behind every result.',
    ctaPrimary: 'Explore Earth',
    ctaSecondary: 'View Synthetic Demo',
    ctaWizard: 'Start Guided Farm Setup',
    qualifierBadge: 'Research demonstration — not a field-validated agricultural recommendation',
    artDisclosure:
      'Visual context: Original bespoke orbital illustration created for ASTRAGRON editorial orientation (Proprietary artwork, not a live satellite observation or NASA photograph). Platform telemetry and map views declare dataset mode, resolution, and provenance explicitly.',
    telemetry: {
      schemaLabel: 'M4 Evidence Contract',
      schemaValue: 'astragron.global-evidence.v1',
      decisionSchemaLabel: 'M14 Decision Contract',
      decisionSchemaValue: 'astragron.m14.response.v1',
      recommendationStatusLabel: 'Field Recommendation Eligibility',
      recommendationStatusValue: 'BLOCKED (Research-Conditional)',
    },
  },
  landing: {
    section1: {
      eyebrow: '01 · SCIENTIFIC WORKFLOW',
      title: 'Earth → Evidence → Conditional Research Decision',
      subtitle:
        'A transparent three-stage pathway that separates global satellite context from local field measurements and finite scenario comparisons.',
      step1Title: '1. Geolocation & Field Geometry',
      step1Body:
        'Select any coordinate on the globe, draw or edit WGS84 (EPSG:4326) field polygons, and declare whether area is a geometry estimate or user-entered value.',
      step2Title: '2. Qualified Source Coverage',
      step2Body:
        'Inspect source availability per site × variable × time × purpose. Distinguish observed weather records, regional modeled estimates, and missing field measurements.',
      step3Title: '3. Multi-Scenario Research Evaluation',
      step3Body:
        'Compare finite 5-year crop and water policies across weather analogues (2018 dry, 2006 median, 2012 wet) and water resource regimes—including explicit abstention when universal criteria fail.',
    },
    section2: {
      eyebrow: '02 · PLANETARY DATA, LOCAL QUESTIONS',
      title: 'Global satellite coverage does not equal local crop qualification',
      subtitle:
        'Orbital sensors observe climate and regional hydrology at coarse resolutions. Honest agricultural science requires pairing macro Earth observations with local field constraints.',
      colMacroTitle: 'What NASA & EO Sources Provide',
      colMacroBody:
        'Regional meteorological reanalysis (NASA POWER ~0.5°), precipitation estimates (GPM IMERG ~0.1°), root-zone modeled soil moisture (SMAP L4 ~9 km), and surface reflectance (HLS ~30 m).',
      colLocalTitle: 'What Local Field Qualification Requires',
      colLocalBody:
        'In-situ soil horizon profiles, verified irrigation delivery infrastructure, legal water withdrawal rights, and regionally calibrated crop phenology coefficients.',
    },
    section3: {
      eyebrow: '03 · GLOBAL COVERAGE EXPLORER',
      title: 'Inspect site-specific source readiness across latitudes',
      subtitle:
        'Compare the Uppsala (Sweden) 3-field (24.0 ha) synthetic research demonstration with source-coverage-only fixtures in Nyeri (Kenya) and Wagga Wagga (Australia). Swedish crop parameters are never extrapolated to other climates.',
      openExplorerCta: 'Launch Full Earth Explorer',
    },
    section4: {
      eyebrow: '04 · FIVE-YEAR RESEARCH PLANNING',
      title: 'Multi-year field × season matrix with explicit constraint tracking',
      subtitle:
        'Inspect how candidate 5-year crop sequences perform across non-irrigable (F1, F2) and irrigable (F3) fields under dry, median, and wet weather analogues.',
      openPlansCta: 'Inspect 5-Year Research Matrix',
    },
    section5: {
      eyebrow: '05 · DECISION TRANSPARENCY & HONEST ABSTENTION',
      title: 'When no plan passes every scenario, the system abstains clearly',
      subtitle:
        'Instead of hiding risk behind a single black-box score, ASTRAGRON separates universal water-service feasibility from conditional research rankings (least worst ET shortfall, minimax regret, and Pareto trade-offs).',
      openDecisionsCta: 'Explore Decision Trade-Offs',
    },
    section6: {
      eyebrow: '06 · BEGIN YOUR INVESTIGATION',
      title: 'Start exploring Earth observations or inspect the synthetic Uppsala demonstration',
      subtitle:
        'No account required. All draft geometry and parameters stay under your local browser control.',
    },
  },
  coverageStatuses: {
    AVAILABLE: {
      label: 'Available',
      shortDesc: 'Source product covers site and period for declared purpose.',
    },
    CONDITIONAL: {
      label: 'Conditional',
      shortDesc: 'Available with spatial resolution, latency, or regional modeling caveats.',
    },
    INSUFFICIENT_EVIDENCE: {
      label: 'Insufficient Evidence',
      shortDesc: 'Source alone cannot establish field-scale agronomic qualification.',
    },
    OUT_OF_COVERAGE: {
      label: 'Out of Coverage',
      shortDesc: 'Site lies outside sensor latitude band, land mask, or calibrated domain.',
    },
    TEMPORARILY_UNAVAILABLE: {
      label: 'Temporarily Unavailable',
      shortDesc: 'Upstream archive or adapter unreachable in current session.',
    },
  },
  evidenceClasses: {
    OBSERVED: {
      label: 'Observed',
      description: 'Direct station or calibrated instrument measurement.',
    },
    DERIVED: {
      label: 'Derived',
      description: 'Calculated deterministically from observed inputs.',
    },
    REGIONAL_MODEL_EVIDENCE: {
      label: 'Regional Model Evidence',
      description: 'Gridded assimilation or reanalysis product (not an in-field sensor).',
    },
    RESEARCH_ASSUMPTION: {
      label: 'Research Assumption',
      description: 'Explicit scenario parameter or user-declared test assumption.',
    },
    SYNTHETIC_UI_FIXTURE: {
      label: 'Synthetic UI Fixture',
      description: 'Synthetic deterministic fixture constructed for interface demonstration (not recorded M14 output).',
    },
    MISSING_OR_UNQUALIFIED: {
      label: 'Missing / Unqualified',
      description: 'Unmeasured or unverified for field-calibrated decision use.',
    },
  },
  preferences: {
    STRICT_ALL_SCENARIOS_SERVICE: {
      label: 'Meets every tested scenario',
      code: 'STRICT_ALL_SCENARIOS_SERVICE',
      plainExplanation:
        'Requires a candidate policy to satisfy the declared water-service threshold (<= 100 mm deficit per field/year) across all 9 scenario states without exception.',
      scientificExplanation:
        'Universal conjunctive feasibility filter over all numeric calendar/weather states. In the synthetic UI demonstration, 0 of 12 policies pass all 9 states.',
    },
    MINIMIZE_WORST_ET_SHORTFALL: {
      label: 'Minimize worst water deficit',
      code: 'MINIMIZE_WORST_ET_SHORTFALL',
      plainExplanation:
        'Ranks comparable policies by their worst-case modeled evapotranspiration shortfall across all tested scenarios (minimax physical deficit).',
      scientificExplanation:
        'Minimax objective over state-level aggregate ET shortfall (m³ equivalent). Selects synthetic policy SYNTH-POL-01 (38,420.50 m³ eq in worst state) within the 12-policy synthetic candidate set.',
    },
    MINIMAX_REGRET: {
      label: 'Minimize maximum regret',
      code: 'MINIMAX_REGRET',
      plainExplanation:
        'This ranks plans by their largest disadvantage versus the best comparable plan in each tested scenario.',
      scientificExplanation:
        'Minimax regret across comparable numeric policies (m³ equivalent difference from state-optimal benchmark). Selects synthetic policy SYNTH-POL-02 (640.25 m³ eq maximum regret).',
    },
    PARETO_FRONTIER: {
      label: 'Explore trade-offs',
      code: 'PARETO_FRONTIER',
      plainExplanation:
        'Surfaces the set of non-dominated policies where improving one objective (such as dry-year shortfall) requires accepting a trade-off in another (such as regret or irrigation withdrawal).',
      scientificExplanation:
        'Multi-objective Pareto non-dominance filter across worst-case ET shortfall, minimax regret, and mean water source withdrawal. Returns NO_UNIQUE_WINNER by design.',
    },
  },
  explorer: {
    title: 'Global Earth & Coverage Explorer',
    subtitle: 'Select a research site, define field boundaries, and inspect M4 per-capability source status.',
    coverageNotEvaluated: 'Coverage not yet evaluated for this location',
    demoSearchNotice: 'Offline Demo Search Index active (16 reference localities; live global geocoder not configured).',
    coordinateOrderNotice: 'Internal M4 contract coordinate order: [longitude, latitude] in WGS84 (EPSG:4326).',
    areaEstimateDisclaimer: 'Browser geodesic calculation is an uncertified estimate, not a legal land survey.',
  },
  statusCards: {
    SITE_NOT_FOUND: {
      title: 'Site Not Found in Repository — Fail-Closed',
      simpleTitle: 'We do not have a verified farm record for this location ID.',
    },
    MODEL_UNQUALIFIED: {
      title: 'Agronomic Decision & Crop Model Unqualified for Site — Fail-Closed',
      simpleTitle: 'Crop simulation models are not yet qualified for this region.',
    },
    BACKEND_NOT_CONNECTED: {
      title: 'Protected Scientific Backend Not Connected — Fail-Closed',
      simpleTitle: 'Live scientific model calculations require connecting the ASTRAGRON backend.',
    },
    SOURCE_NOT_PROVIDED: {
      title: 'Raw Recorded M14 Research Corpus Not Provided — Fail-Closed',
      simpleTitle: 'Recorded research source tables are not bundled inside this public showcase.',
    },
    ANALYSIS_NOT_RUN_FOR_INPUT_REVISION: {
      title: 'Analysis Not Run for Modified Input Revision — Fail-Closed',
      simpleTitle: 'Your field changes are saved. This demonstration has not analyzed your updated farm.',
    },
    NO_EVIDENCE_FOR_SITE: {
      title: 'No Site-Scoped Evidence Bundled — Fail-Closed',
      simpleTitle: 'No verified evidence records are bundled for this location yet.',
    },
    OK_COVERAGE_ONLY: {
      title: 'Source Coverage Inspection Only',
      simpleTitle: 'Satellite source coverage is available to inspect, without crop yield forecasts.',
    },
    OK_RECORDED_RESEARCH: {
      title: 'Verified Recorded M14 Research Archive (Read-Only)',
      simpleTitle: 'You are viewing the frozen historical M14 research benchmark for Uppsala (field recommendations remain blocked).',
    },
    OK_SYNTHETIC_DEMO: {
      title: 'Synthetic Interface Demonstration Active',
      simpleTitle: 'You are viewing the synthetic demonstration dataset for Uppsala.',
    },
  },
  explorerSearch: {
    remoteLookupAction: 'Query global address search',
    remoteLookupPending: 'Querying configured geocoder…',
    notConfigured: 'Global address search not configured (local 16-site gazetteer & WGS84 coordinates active).',
    remoteSectionHeading: 'Remote Geocoder Results',
  },
  recordedUi: {
    activeBadge: 'VERIFIED_READ_ONLY',
    activeReadOnlyBadge: 'ACTIVE · READ_ONLY',
    fixtureBadge: 'DEMO_FIXTURE',
    unavailableBadge: 'SOURCE_NOT_PROVIDED',
    recordedTag: 'RECORDED M14 RESEARCH ARTIFACT (READ-ONLY · NOT A FIELD RECOMMENDATION)',
    recordedWatermark: 'RECORDED SCIENTIFIC ARCHIVE (READ-ONLY) — NOT LIVE COMPUTATION',
    recordedQualifier:
      'Verified M14/M4 source bundle (SE_UPPSALA / M4) · Field recommendation blocked · Not field-validated',
    liveWatermark: 'LIVE SCIENTIFIC BACKEND MODE — DISCONNECTED FAIL-CLOSED',
    liveQualifier: 'Requires authenticated scientific compute API · Fail-closed when disconnected',
    noUniversalPlanBanner:
      'Recorded M14 audit (SE_UPPSALA): 0 of 16 tested rye/pea/wheat/barley sequences satisfy <=100 mm crop ET deficit across all 9 scenarios. Field recommendation status: BLOCKED.',
    noModeledEtNote:
      'Observed NASA POWER daily PRECTOTCORR & T2M (2006/2012/2018 Apr 05–Sep 22) loaded. Daily ET0/ETc curves are marked unmodeled (null) because only raw POWER inputs and M14 harvest summaries exist in the verified bundle.',
  },
} as const;

export type EnMessages = typeof enMessages;
