import {
  M14_RESPONSE_SCHEMA_ID,
  type M14DecisionDataset,
  type CandidatePolicyResult,
  type FieldYearPlanCell,
  type ScenarioStateOutcome,
} from '@/domain/contracts';

const SYNTHETIC_STATES: Array<{
  stateId: string;
  analogueYear: 2018 | 2006 | 2012;
  analogueLabel:
    | '2018 Dry Analogue Window (Synthetic Demo)'
    | '2006 Median Analogue Window (Synthetic Demo)'
    | '2012 Wet Analogue Window (Synthetic Demo)';
  waterResourceRegime: 'BASE_ALLOCATION' | 'WATER_LOW_RESTRICTION' | 'WATER_HIGH_BUFFER';
  calendarVariant: string;
}> = [
  {
    stateId: 'SYNTH_2018_BASE',
    analogueYear: 2018,
    analogueLabel: '2018 Dry Analogue Window (Synthetic Demo)',
    waterResourceRegime: 'BASE_ALLOCATION',
    calendarVariant: 'BASE Water Allocation (8,000 m³/yr · 80 m³/day)',
  },
  {
    stateId: 'SYNTH_2018_WATER_LOW',
    analogueYear: 2018,
    analogueLabel: '2018 Dry Analogue Window (Synthetic Demo)',
    waterResourceRegime: 'WATER_LOW_RESTRICTION',
    calendarVariant: 'WATER_LOW Restriction (5,600 m³/yr · 56 m³/day)',
  },
  {
    stateId: 'SYNTH_2018_WATER_HIGH',
    analogueYear: 2018,
    analogueLabel: '2018 Dry Analogue Window (Synthetic Demo)',
    waterResourceRegime: 'WATER_HIGH_BUFFER',
    calendarVariant: 'WATER_HIGH Buffer (10,400 m³/yr · 104 m³/day)',
  },
  {
    stateId: 'SYNTH_2006_BASE',
    analogueYear: 2006,
    analogueLabel: '2006 Median Analogue Window (Synthetic Demo)',
    waterResourceRegime: 'BASE_ALLOCATION',
    calendarVariant: 'BASE Water Allocation (8,000 m³/yr · 80 m³/day)',
  },
  {
    stateId: 'SYNTH_2006_WATER_LOW',
    analogueYear: 2006,
    analogueLabel: '2006 Median Analogue Window (Synthetic Demo)',
    waterResourceRegime: 'WATER_LOW_RESTRICTION',
    calendarVariant: 'WATER_LOW Restriction (5,600 m³/yr · 56 m³/day)',
  },
  {
    stateId: 'SYNTH_2006_WATER_HIGH',
    analogueYear: 2006,
    analogueLabel: '2006 Median Analogue Window (Synthetic Demo)',
    waterResourceRegime: 'WATER_HIGH_BUFFER',
    calendarVariant: 'WATER_HIGH Buffer (10,400 m³/yr · 104 m³/day)',
  },
  {
    stateId: 'SYNTH_2012_BASE',
    analogueYear: 2012,
    analogueLabel: '2012 Wet Analogue Window (Synthetic Demo)',
    waterResourceRegime: 'BASE_ALLOCATION',
    calendarVariant: 'BASE Water Allocation (8,000 m³/yr · 80 m³/day)',
  },
  {
    stateId: 'SYNTH_2012_WATER_LOW',
    analogueYear: 2012,
    analogueLabel: '2012 Wet Analogue Window (Synthetic Demo)',
    waterResourceRegime: 'WATER_LOW_RESTRICTION',
    calendarVariant: 'WATER_LOW Restriction (5,600 m³/yr · 56 m³/day)',
  },
  {
    stateId: 'SYNTH_2012_WATER_HIGH',
    analogueYear: 2012,
    analogueLabel: '2012 Wet Analogue Window (Synthetic Demo)',
    waterResourceRegime: 'WATER_HIGH_BUFFER',
    calendarVariant: 'WATER_HIGH Buffer (10,400 m³/yr · 104 m³/day)',
  },
];

function buildSyntheticScenarioOutcomes(
  isCalendarValid: boolean,
  worstShortfallM3: number | null,
  maxRegretM3: number | null,
  meanWithdrawalM3: number | null
): ScenarioStateOutcome[] {
  if (!isCalendarValid || worstShortfallM3 === null || maxRegretM3 === null || meanWithdrawalM3 === null) {
    return SYNTHETIC_STATES.map((st) => ({
      stateId: st.stateId,
      analogueYear: st.analogueYear,
      analogueLabel: st.analogueLabel,
      waterResourceRegime: st.waterResourceRegime,
      calendarVariant: st.calendarVariant,
      isNumericValid: false,
      invalidReason:
        'CALENDAR_OVERLAP:F3:Y3 — Winter Rye sowing window (Sep 10) precedes Starch Potato harvest completion (Sep 24) on Field F3 Year 3. Excluded from comparable ranking.',
      passesServiceCriterion: null,
      totalEtShortfallM3Eq: null,
      regretM3Eq: null,
      sourceWithdrawalM3: null,
      bindingFieldId: null,
      bindingFieldDeficitMm: null,
      earliestFailureDate: null,
    }));
  }

  return SYNTHETIC_STATES.map((st, idx) => {
    const isDry2018 = st.analogueYear === 2018;
    const isMedian2006 = st.analogueYear === 2006;

    if (isDry2018) {
      const regimeMultiplier =
        st.waterResourceRegime === 'WATER_LOW_RESTRICTION'
          ? 1.0
          : st.waterResourceRegime === 'BASE_ALLOCATION'
          ? 0.94
          : 0.89;
      const shortfall = Number((worstShortfallM3 * regimeMultiplier).toFixed(2));
      const regret =
        st.waterResourceRegime === 'WATER_LOW_RESTRICTION'
          ? maxRegretM3
          : Number((maxRegretM3 * (0.76 + idx * 0.08)).toFixed(2));
      const withdrawalCap =
        st.waterResourceRegime === 'WATER_LOW_RESTRICTION'
          ? Math.min(5600, Number((meanWithdrawalM3 * 0.88).toFixed(1)))
          : st.waterResourceRegime === 'BASE_ALLOCATION'
          ? Math.min(8000, Number((meanWithdrawalM3 * 1.12).toFixed(1)))
          : Math.min(10400, Number((meanWithdrawalM3 * 1.28).toFixed(1)));

      return {
        stateId: st.stateId,
        analogueYear: st.analogueYear,
        analogueLabel: st.analogueLabel,
        waterResourceRegime: st.waterResourceRegime,
        calendarVariant: st.calendarVariant,
        isNumericValid: true,
        passesServiceCriterion: false,
        totalEtShortfallM3Eq: shortfall,
        regretM3Eq: regret,
        sourceWithdrawalM3: withdrawalCap,
        bindingFieldId: 'F1',
        bindingFieldDeficitMm: 142.5,
        earliestFailureDate: '2018-07-12',
      };
    }

    if (isMedian2006) {
      const shortfall = Number((worstShortfallM3 * (0.28 + (idx - 3) * 0.02)).toFixed(2));
      const regret = Number((maxRegretM3 * (0.42 + (idx - 3) * 0.07)).toFixed(2));
      return {
        stateId: st.stateId,
        analogueYear: st.analogueYear,
        analogueLabel: st.analogueLabel,
        waterResourceRegime: st.waterResourceRegime,
        calendarVariant: st.calendarVariant,
        isNumericValid: true,
        passesServiceCriterion: true,
        totalEtShortfallM3Eq: shortfall,
        regretM3Eq: regret,
        sourceWithdrawalM3: Number((meanWithdrawalM3 * 0.78).toFixed(1)),
        bindingFieldId: 'F1',
        bindingFieldDeficitMm: 64.2,
        earliestFailureDate: null,
      };
    }

    // 2012 Wet Analogue
    const shortfall = Number((worstShortfallM3 * (0.1 + (idx - 6) * 0.015)).toFixed(2));
    const regret = Number((maxRegretM3 * (0.16 + (idx - 6) * 0.05)).toFixed(2));
    return {
      stateId: st.stateId,
      analogueYear: st.analogueYear,
      analogueLabel: st.analogueLabel,
      waterResourceRegime: st.waterResourceRegime,
      calendarVariant: st.calendarVariant,
      isNumericValid: true,
      passesServiceCriterion: true,
      totalEtShortfallM3Eq: shortfall,
      regretM3Eq: regret,
      sourceWithdrawalM3: Number((meanWithdrawalM3 * 0.45).toFixed(1)),
      bindingFieldId: 'F1',
      bindingFieldDeficitMm: 26.8,
      earliestFailureDate: null,
    };
  });
}

function buildSyntheticFieldYearMatrix(
  cropsByField: Record<'F1' | 'F2' | 'F3', Array<{ code: string; name: string; plant: string; harvest: string }>>,
  isCalendarValid: boolean,
  f3DryDeficitBase: number
): FieldYearPlanCell[] {
  const fields: Array<{ id: 'F1' | 'F2' | 'F3'; label: string; irrigationAccess: 'YES' | 'NO' }> = [
    { id: 'F1', label: 'Field F1 (Non-Irrigable Rainfed, 6.0 ha)', irrigationAccess: 'NO' },
    { id: 'F2', label: 'Field F2 (Non-Irrigable Rainfed, 8.0 ha)', irrigationAccess: 'NO' },
    { id: 'F3', label: 'Field F3 (Irrigable Shared Delivery, 10.0 ha)', irrigationAccess: 'YES' },
  ];

  const cells: FieldYearPlanCell[] = [];

  for (const field of fields) {
    const seq = cropsByField[field.id];
    for (let yr = 1; yr <= 5; yr++) {
      const crop = seq[yr - 1]!;
      const isInvalidCell = !isCalendarValid && field.id === 'F3' && yr === 3;

      if (!isCalendarValid) {
        cells.push({
          fieldId: field.id,
          fieldLabel: field.label,
          irrigationAccess: field.irrigationAccess,
          harvestYear: yr,
          yearLabel: `Year ${yr} (H${yr})`,
          cropCode: crop.code,
          cropName: crop.name,
          plantingWindow: crop.plant,
          harvestWindow: crop.harvest,
          calendarValid: !isInvalidCell,
          calendarInvalidReason: isInvalidCell
            ? 'CALENDAR_OVERLAP:F3:Y3 — Winter Rye sowing (Sep 10) overlaps Starch Potato harvest (Sep 24) by 14 days.'
            : 'Policy excluded due to CALENDAR_OVERLAP:F3:Y3.',
          worstStateDeficitMm: null,
          medianStateDeficitMm: null,
          wetStateDeficitMm: null,
          serviceThresholdMm: 100.0,
          passesServiceCriterionAllStates: null,
          firstFailureDate: null,
          firstFailureAnalogueYear: null,
          evidenceIds: ['syn-ev-uppsala-water-assumption'],
        });
        continue;
      }

      const isRainfed = field.id === 'F1' || field.id === 'F2';
      const worstDeficit =
        field.id === 'F1'
          ? yr === 2 || yr === 4
            ? 142.5
            : Number((124.0 + yr * 3.2).toFixed(2))
          : field.id === 'F2'
          ? Number((118.4 + yr * 2.8).toFixed(2))
          : Number((f3DryDeficitBase + yr * 3.5).toFixed(2));

      const medianDeficit = isRainfed
        ? Number((58.0 + yr * 1.4).toFixed(2))
        : Number((21.0 + yr * 1.6).toFixed(2));

      const wetDeficit = isRainfed
        ? Number((22.0 + yr * 1.0).toFixed(2))
        : Number((7.5 + yr * 0.8).toFixed(2));

      const passesAll = worstDeficit <= 100.0;

      cells.push({
        fieldId: field.id,
        fieldLabel: field.label,
        irrigationAccess: field.irrigationAccess,
        harvestYear: yr,
        yearLabel: `Year ${yr} (H${yr})`,
        cropCode: crop.code,
        cropName: crop.name,
        plantingWindow: crop.plant,
        harvestWindow: crop.harvest,
        calendarValid: true,
        worstStateDeficitMm: worstDeficit,
        medianStateDeficitMm: medianDeficit,
        wetStateDeficitMm: wetDeficit,
        serviceThresholdMm: 100.0,
        passesServiceCriterionAllStates: passesAll,
        firstFailureDate: passesAll ? null : '2018-07-12',
        firstFailureAnalogueYear: passesAll ? null : 2018,
        evidenceIds: ['syn-ev-uppsala-weather-2018', 'syn-ev-uppsala-water-assumption'],
      });
    }
  }

  return cells;
}

const SYNTHETIC_CROPS = {
  RYE: { code: 'W_RYE', name: 'Winter Rye', plant: 'Sep 10 – Sep 22', harvest: 'Aug 04 – Aug 16' },
  PEA: { code: 'G_PEA', name: 'Grain Pea', plant: 'Apr 22 – May 05', harvest: 'Aug 08 – Aug 20' },
  POTATO: { code: 'S_POT', name: 'Starch Potato', plant: 'May 02 – May 14', harvest: 'Sep 12 – Sep 24' },
  BARLEY: { code: 'S_BAR', name: 'Spring Barley', plant: 'Apr 18 – May 02', harvest: 'Aug 14 – Aug 26' },
  OATS: { code: 'S_OAT', name: 'Spring Oats', plant: 'Apr 20 – May 04', harvest: 'Aug 18 – Aug 30' },
  LEY: { code: 'F_LEY', name: 'Forage Grass-Clover Ley', plant: 'Apr 10 – Apr 24', harvest: 'Jun 15 & Aug 10' },
};

const SYNTHETIC_POLICIES_CONFIG: Array<{
  policyId: string;
  shortLabel: string;
  rotationSummary: string;
  isComparable: boolean;
  worstEtShortfallM3Eq: number | null;
  maxRegretM3Eq: number | null;
  meanSourceWithdrawalM3: number | null;
  isParetoNonDominated: boolean;
  rankByWorstShortfall: number | null;
  rankByMinimaxRegret: number | null;
  highlightTag?: CandidatePolicyResult['highlightTag'];
  f3DryDeficitBase: number;
  crops: Record<'F1' | 'F2' | 'F3', Array<{ code: string; name: string; plant: string; harvest: string }>>;
}> = [
  {
    policyId: 'SYNTH-POL-01',
    shortLabel: 'Synthetic Policy 01 · Drought-Buffered Rye/Ley/Barley Sequence',
    rotationSummary: 'F1 (6ha rainfed): Rye–Ley–Ley–Barley–Oats · F2 (8ha rainfed): Pea–Rye–Barley–Oats–Rye · F3 (10ha irrigable): Potato–Barley–Pea–Potato–Barley',
    isComparable: true,
    worstEtShortfallM3Eq: 38420.5,
    maxRegretM3Eq: 910.4,
    meanSourceWithdrawalM3: 6420.0,
    isParetoNonDominated: true,
    rankByWorstShortfall: 1,
    rankByMinimaxRegret: 2,
    highlightTag: 'LEAST_WORST_SHORTFALL',
    f3DryDeficitBase: 54.0,
    crops: {
      F1: [SYNTHETIC_CROPS.RYE, SYNTHETIC_CROPS.LEY, SYNTHETIC_CROPS.LEY, SYNTHETIC_CROPS.BARLEY, SYNTHETIC_CROPS.OATS],
      F2: [SYNTHETIC_CROPS.PEA, SYNTHETIC_CROPS.RYE, SYNTHETIC_CROPS.BARLEY, SYNTHETIC_CROPS.OATS, SYNTHETIC_CROPS.RYE],
      F3: [SYNTHETIC_CROPS.POTATO, SYNTHETIC_CROPS.BARLEY, SYNTHETIC_CROPS.PEA, SYNTHETIC_CROPS.POTATO, SYNTHETIC_CROPS.BARLEY],
    },
  },
  {
    policyId: 'SYNTH-POL-02',
    shortLabel: 'Synthetic Policy 02 · Minimax-Regret Balanced Rye/Pea/Potato Matrix',
    rotationSummary: 'F1 (6ha rainfed): Oats–Barley–Ley–Rye–Barley · F2 (8ha rainfed): Rye–Pea–Barley–Ley–Oats · F3 (10ha irrigable): Barley–Potato–Pea–Barley–Potato',
    isComparable: true,
    worstEtShortfallM3Eq: 39110.2,
    maxRegretM3Eq: 640.25,
    meanSourceWithdrawalM3: 6180.0,
    isParetoNonDominated: true,
    rankByWorstShortfall: 2,
    rankByMinimaxRegret: 1,
    highlightTag: 'MINIMAX_REGRET_SELECTION',
    f3DryDeficitBase: 57.5,
    crops: {
      F1: [SYNTHETIC_CROPS.OATS, SYNTHETIC_CROPS.BARLEY, SYNTHETIC_CROPS.LEY, SYNTHETIC_CROPS.RYE, SYNTHETIC_CROPS.BARLEY],
      F2: [SYNTHETIC_CROPS.RYE, SYNTHETIC_CROPS.PEA, SYNTHETIC_CROPS.BARLEY, SYNTHETIC_CROPS.LEY, SYNTHETIC_CROPS.OATS],
      F3: [SYNTHETIC_CROPS.BARLEY, SYNTHETIC_CROPS.POTATO, SYNTHETIC_CROPS.PEA, SYNTHETIC_CROPS.BARLEY, SYNTHETIC_CROPS.POTATO],
    },
  },
  {
    policyId: 'SYNTH-POL-03',
    shortLabel: 'Synthetic Policy 03 · Low-Withdrawal Grain Pea & Rye Focus',
    rotationSummary: 'F1–F2: Rainfed Ley/Rye/Barley · F3: Reduced starch potato frequency to lower F3 irrigation withdrawal',
    isComparable: true,
    worstEtShortfallM3Eq: 39850.0,
    maxRegretM3Eq: 1120.8,
    meanSourceWithdrawalM3: 5120.0,
    isParetoNonDominated: true,
    rankByWorstShortfall: 3,
    rankByMinimaxRegret: 3,
    highlightTag: 'PARETO_ALTERNATIVE',
    f3DryDeficitBase: 60.2,
    crops: {
      F1: [SYNTHETIC_CROPS.LEY, SYNTHETIC_CROPS.LEY, SYNTHETIC_CROPS.RYE, SYNTHETIC_CROPS.OATS, SYNTHETIC_CROPS.BARLEY],
      F2: [SYNTHETIC_CROPS.BARLEY, SYNTHETIC_CROPS.PEA, SYNTHETIC_CROPS.RYE, SYNTHETIC_CROPS.BARLEY, SYNTHETIC_CROPS.OATS],
      F3: [SYNTHETIC_CROPS.PEA, SYNTHETIC_CROPS.RYE, SYNTHETIC_CROPS.POTATO, SYNTHETIC_CROPS.BARLEY, SYNTHETIC_CROPS.PEA],
    },
  },
  {
    policyId: 'SYNTH-POL-04',
    shortLabel: 'Synthetic Policy 04 · Conservative Water-Cap Cereal Rotation',
    rotationSummary: 'F1–F3: Emphasis on autumn-established Winter Rye to capture spring snowmelt moisture',
    isComparable: true,
    worstEtShortfallM3Eq: 40620.4,
    maxRegretM3Eq: 1480.0,
    meanSourceWithdrawalM3: 4890.0,
    isParetoNonDominated: true,
    rankByWorstShortfall: 4,
    rankByMinimaxRegret: 4,
    highlightTag: 'PARETO_ALTERNATIVE',
    f3DryDeficitBase: 62.4,
    crops: {
      F1: [SYNTHETIC_CROPS.RYE, SYNTHETIC_CROPS.BARLEY, SYNTHETIC_CROPS.PEA, SYNTHETIC_CROPS.RYE, SYNTHETIC_CROPS.OATS],
      F2: [SYNTHETIC_CROPS.OATS, SYNTHETIC_CROPS.RYE, SYNTHETIC_CROPS.LEY, SYNTHETIC_CROPS.LEY, SYNTHETIC_CROPS.BARLEY],
      F3: [SYNTHETIC_CROPS.RYE, SYNTHETIC_CROPS.PEA, SYNTHETIC_CROPS.BARLEY, SYNTHETIC_CROPS.POTATO, SYNTHETIC_CROPS.BARLEY],
    },
  },
  {
    policyId: 'SYNTH-POL-05',
    shortLabel: 'Synthetic Policy 05 · Spring Cereal & Grain Pea Alternation',
    rotationSummary: 'F1–F3: Alternating Spring Barley, Grain Pea, and Spring Oats',
    isComparable: true,
    worstEtShortfallM3Eq: 41490.0,
    maxRegretM3Eq: 1890.5,
    meanSourceWithdrawalM3: 6550.0,
    isParetoNonDominated: false,
    rankByWorstShortfall: 5,
    rankByMinimaxRegret: 5,
    f3DryDeficitBase: 65.0,
    crops: {
      F1: [SYNTHETIC_CROPS.BARLEY, SYNTHETIC_CROPS.PEA, SYNTHETIC_CROPS.BARLEY, SYNTHETIC_CROPS.OATS, SYNTHETIC_CROPS.BARLEY],
      F2: [SYNTHETIC_CROPS.PEA, SYNTHETIC_CROPS.BARLEY, SYNTHETIC_CROPS.OATS, SYNTHETIC_CROPS.PEA, SYNTHETIC_CROPS.BARLEY],
      F3: [SYNTHETIC_CROPS.POTATO, SYNTHETIC_CROPS.BARLEY, SYNTHETIC_CROPS.PEA, SYNTHETIC_CROPS.OATS, SYNTHETIC_CROPS.POTATO],
    },
  },
  {
    policyId: 'SYNTH-POL-06',
    shortLabel: 'Synthetic Policy 06 · Starch Potato Intensive Schedule A',
    rotationSummary: 'Elevated late-summer irrigation demand on Field F3 during tuber bulking',
    isComparable: true,
    worstEtShortfallM3Eq: 42310.8,
    maxRegretM3Eq: 2340.2,
    meanSourceWithdrawalM3: 7120.0,
    isParetoNonDominated: false,
    rankByWorstShortfall: 6,
    rankByMinimaxRegret: 6,
    f3DryDeficitBase: 68.5,
    crops: {
      F1: [SYNTHETIC_CROPS.RYE, SYNTHETIC_CROPS.OATS, SYNTHETIC_CROPS.BARLEY, SYNTHETIC_CROPS.RYE, SYNTHETIC_CROPS.BARLEY],
      F2: [SYNTHETIC_CROPS.BARLEY, SYNTHETIC_CROPS.RYE, SYNTHETIC_CROPS.PEA, SYNTHETIC_CROPS.BARLEY, SYNTHETIC_CROPS.OATS],
      F3: [SYNTHETIC_CROPS.POTATO, SYNTHETIC_CROPS.PEA, SYNTHETIC_CROPS.POTATO, SYNTHETIC_CROPS.BARLEY, SYNTHETIC_CROPS.POTATO],
    },
  },
  {
    policyId: 'SYNTH-POL-07',
    shortLabel: 'Synthetic Policy 07 · Extended Forage Ley Sequence',
    rotationSummary: 'Multi-cut grass-clover ley on F1 and F2 with high mid-summer ETc demand',
    isComparable: true,
    worstEtShortfallM3Eq: 43180.0,
    maxRegretM3Eq: 2890.0,
    meanSourceWithdrawalM3: 7240.0,
    isParetoNonDominated: false,
    rankByWorstShortfall: 7,
    rankByMinimaxRegret: 7,
    f3DryDeficitBase: 71.0,
    crops: {
      F1: [SYNTHETIC_CROPS.LEY, SYNTHETIC_CROPS.LEY, SYNTHETIC_CROPS.BARLEY, SYNTHETIC_CROPS.RYE, SYNTHETIC_CROPS.OATS],
      F2: [SYNTHETIC_CROPS.LEY, SYNTHETIC_CROPS.LEY, SYNTHETIC_CROPS.RYE, SYNTHETIC_CROPS.PEA, SYNTHETIC_CROPS.BARLEY],
      F3: [SYNTHETIC_CROPS.BARLEY, SYNTHETIC_CROPS.POTATO, SYNTHETIC_CROPS.BARLEY, SYNTHETIC_CROPS.PEA, SYNTHETIC_CROPS.POTATO],
    },
  },
  {
    policyId: 'SYNTH-POL-08',
    shortLabel: 'Synthetic Policy 08 · Synchronized Spring Sowing Stress Case',
    rotationSummary: 'Simultaneous May–July peak transpiration across all 3 fields',
    isComparable: true,
    worstEtShortfallM3Eq: 44050.6,
    maxRegretM3Eq: 3420.7,
    meanSourceWithdrawalM3: 7490.0,
    isParetoNonDominated: false,
    rankByWorstShortfall: 8,
    rankByMinimaxRegret: 8,
    f3DryDeficitBase: 74.2,
    crops: {
      F1: [SYNTHETIC_CROPS.OATS, SYNTHETIC_CROPS.BARLEY, SYNTHETIC_CROPS.PEA, SYNTHETIC_CROPS.OATS, SYNTHETIC_CROPS.BARLEY],
      F2: [SYNTHETIC_CROPS.OATS, SYNTHETIC_CROPS.BARLEY, SYNTHETIC_CROPS.PEA, SYNTHETIC_CROPS.OATS, SYNTHETIC_CROPS.BARLEY],
      F3: [SYNTHETIC_CROPS.POTATO, SYNTHETIC_CROPS.OATS, SYNTHETIC_CROPS.POTATO, SYNTHETIC_CROPS.BARLEY, SYNTHETIC_CROPS.PEA],
    },
  },
  {
    policyId: 'SYNTH-POL-09',
    shortLabel: 'Synthetic Policy 09 · Grain Pea Mid-Summer Flowering Test',
    rotationSummary: 'High Grain Pea frequency on non-irrigable parcels F1 and F2',
    isComparable: true,
    worstEtShortfallM3Eq: 44920.0,
    maxRegretM3Eq: 4010.0,
    meanSourceWithdrawalM3: 7610.0,
    isParetoNonDominated: false,
    rankByWorstShortfall: 9,
    rankByMinimaxRegret: 9,
    f3DryDeficitBase: 77.0,
    crops: {
      F1: [SYNTHETIC_CROPS.PEA, SYNTHETIC_CROPS.BARLEY, SYNTHETIC_CROPS.PEA, SYNTHETIC_CROPS.OATS, SYNTHETIC_CROPS.RYE],
      F2: [SYNTHETIC_CROPS.PEA, SYNTHETIC_CROPS.OATS, SYNTHETIC_CROPS.PEA, SYNTHETIC_CROPS.BARLEY, SYNTHETIC_CROPS.RYE],
      F3: [SYNTHETIC_CROPS.BARLEY, SYNTHETIC_CROPS.POTATO, SYNTHETIC_CROPS.PEA, SYNTHETIC_CROPS.POTATO, SYNTHETIC_CROPS.BARLEY],
    },
  },
  {
    policyId: 'SYNTH-POL-10',
    shortLabel: 'Synthetic Policy 10 · High-Canopy Demand Baseline A',
    rotationSummary: 'Dense canopy sequence testing WATER_LOW daily delivery cap (56 m³/day)',
    isComparable: true,
    worstEtShortfallM3Eq: 45840.2,
    maxRegretM3Eq: 4680.4,
    meanSourceWithdrawalM3: 7780.0,
    isParetoNonDominated: false,
    rankByWorstShortfall: 10,
    rankByMinimaxRegret: 10,
    f3DryDeficitBase: 80.5,
    crops: {
      F1: [SYNTHETIC_CROPS.BARLEY, SYNTHETIC_CROPS.LEY, SYNTHETIC_CROPS.LEY, SYNTHETIC_CROPS.OATS, SYNTHETIC_CROPS.BARLEY],
      F2: [SYNTHETIC_CROPS.RYE, SYNTHETIC_CROPS.LEY, SYNTHETIC_CROPS.LEY, SYNTHETIC_CROPS.BARLEY, SYNTHETIC_CROPS.PEA],
      F3: [SYNTHETIC_CROPS.POTATO, SYNTHETIC_CROPS.BARLEY, SYNTHETIC_CROPS.POTATO, SYNTHETIC_CROPS.PEA, SYNTHETIC_CROPS.POTATO],
    },
  },
  {
    policyId: 'SYNTH-POL-11',
    shortLabel: 'Synthetic Policy 11 · High-Canopy Demand Baseline B',
    rotationSummary: 'Upper-bound evapotranspiration stress test across all 3 fields',
    isComparable: true,
    worstEtShortfallM3Eq: 46790.0,
    maxRegretM3Eq: 5390.0,
    meanSourceWithdrawalM3: 7940.0,
    isParetoNonDominated: false,
    rankByWorstShortfall: 11,
    rankByMinimaxRegret: 11,
    f3DryDeficitBase: 84.0,
    crops: {
      F1: [SYNTHETIC_CROPS.LEY, SYNTHETIC_CROPS.LEY, SYNTHETIC_CROPS.OATS, SYNTHETIC_CROPS.BARLEY, SYNTHETIC_CROPS.OATS],
      F2: [SYNTHETIC_CROPS.LEY, SYNTHETIC_CROPS.LEY, SYNTHETIC_CROPS.BARLEY, SYNTHETIC_CROPS.OATS, SYNTHETIC_CROPS.BARLEY],
      F3: [SYNTHETIC_CROPS.POTATO, SYNTHETIC_CROPS.BARLEY, SYNTHETIC_CROPS.POTATO, SYNTHETIC_CROPS.OATS, SYNTHETIC_CROPS.POTATO],
    },
  },
  {
    policyId: 'SYNTH-POL-12',
    shortLabel: 'Synthetic Policy 12 · Calendar-Invalid Transition Witness (Excluded)',
    rotationSummary: 'CALENDAR_OVERLAP:F3:Y3 — Starch Potato harvest (Sep 24) overlaps Winter Rye sowing (Sep 10) on Field F3 Year 3',
    isComparable: false,
    worstEtShortfallM3Eq: null,
    maxRegretM3Eq: null,
    meanSourceWithdrawalM3: null,
    isParetoNonDominated: false,
    rankByWorstShortfall: null,
    rankByMinimaxRegret: null,
    highlightTag: 'CALENDAR_EXCLUDED',
    f3DryDeficitBase: 0,
    crops: {
      F1: [SYNTHETIC_CROPS.RYE, SYNTHETIC_CROPS.BARLEY, SYNTHETIC_CROPS.OATS, SYNTHETIC_CROPS.RYE, SYNTHETIC_CROPS.BARLEY],
      F2: [SYNTHETIC_CROPS.PEA, SYNTHETIC_CROPS.RYE, SYNTHETIC_CROPS.BARLEY, SYNTHETIC_CROPS.OATS, SYNTHETIC_CROPS.PEA],
      F3: [
        SYNTHETIC_CROPS.BARLEY,
        SYNTHETIC_CROPS.POTATO,
        SYNTHETIC_CROPS.RYE,
        SYNTHETIC_CROPS.PEA,
        SYNTHETIC_CROPS.BARLEY,
      ],
    },
  },
];

export const SYNTHETIC_DECISION_DATASET: M14DecisionDataset = {
  schemaId: M14_RESPONSE_SCHEMA_ID,
  datasetMode: 'SYNTHETIC_UI_DEMO',
  syntheticDisclosure:
    'SYNTHETIC INTERFACE DEMONSTRATION — NOT RECORDED SCIENTIFIC RESULTS. All policy IDs (SYNTH-POL-*), field deficits, and scenario matrices in this view are self-contained synthetic UI fixtures.',
  fieldValidated: false,
  caseId: 'synth-demo-uppsala-12x9',
  caseTitle: 'Uppsala Synthetic UI Demo Evaluation (12 Synthetic Policies × 9 Climate/Water States)',
  siteId: 'uppsala-demo',
  evaluatedAt: '2026-11-12T00:00:00Z',
  serviceCriterionFeasibility: 'ALL_CANDIDATES_FAIL_UNIVERSAL_CRITERION',
  fieldRecommendationEligibility: 'BLOCKED',
  fieldRecommendationBlockedReasons: [
    'SYNTHETIC_UI_DEMO mode: This dataset is an illustrative interface fixture and is NOT a recorded M14 research output.',
    'Zero tested synthetic policies (0 of 12) satisfy the assumed 100.0 mm per field/harvest-year water-service criterion across all 9 climate/water states.',
    'Non-irrigable rainfed Fields F1 (6.0 ha) and F2 (8.0 ha) exceed the assumed 100.0 mm deficit ceiling under the 2018 dry analogue window (F1 reaches 142.50 mm).',
    'Local mineral nitrogen (NO3-N / NH4-N) calibration and legal water extraction rights are unverified.',
  ],
  portfolioSummary: {
    totalPolicies: 12,
    totalPoliciesTested: 12,
    totalScenarioStates: 9,
    totalPolicyStateCases: 108,
    numericValidCases: 99,
    calendarInvalidCases: 9,
    numericPassCases: 66,
    numericFailCases: 33,
    policiesPassingAllStates: 0,
    universalPassPoliciesCount: 0,
    comparablePoliciesCount: 11,
    excludedCalendarPoliciesCount: 1,
  },
  referenceSelections: {
    leastWorstShortfallPolicyId: 'SYNTH-POL-01',
    leastWorstShortfallValueM3Eq: 38420.5,
    minimaxRegretPolicyId: 'SYNTH-POL-02',
    minimaxRegretValueM3Eq: 640.25,
    nonIrrigableFieldId: 'F1',
    nonIrrigableDryDeficitMm: 142.5,
    assumedServiceThresholdMm: 100.0,
  },
  policies: SYNTHETIC_POLICIES_CONFIG.map((cfg) => ({
    policyId: cfg.policyId,
    shortLabel: cfg.shortLabel,
    rotationSummary: cfg.rotationSummary,
    isComparable: cfg.isComparable,
    calendarInvalidCount: cfg.isComparable ? 0 : 9,
    calendarInvalidReason: cfg.isComparable
      ? undefined
      : 'CALENDAR_OVERLAP:F3:Y3 — Winter Rye sowing (Sep 10) precedes Starch Potato harvest (Sep 24) on Field F3 Year 3 across all 9 states.',
    numericStatesEvaluated: cfg.isComparable ? 9 : 0,
    statesPassedCount: cfg.isComparable ? 6 : 0,
    statesFailedCount: cfg.isComparable ? 3 : 0,
    passesAllTestedScenarios: false,
    worstEtShortfallM3Eq: cfg.worstEtShortfallM3Eq,
    maxRegretM3Eq: cfg.maxRegretM3Eq,
    meanSourceWithdrawalM3: cfg.meanSourceWithdrawalM3,
    isParetoNonDominated: cfg.isParetoNonDominated,
    rankByWorstShortfall: cfg.rankByWorstShortfall,
    rankByMinimaxRegret: cfg.rankByMinimaxRegret,
    highlightTag: cfg.highlightTag,
    fieldYearMatrix: buildSyntheticFieldYearMatrix(cfg.crops, cfg.isComparable, cfg.f3DryDeficitBase),
    scenarioOutcomes: buildSyntheticScenarioOutcomes(
      cfg.isComparable,
      cfg.worstEtShortfallM3Eq,
      cfg.maxRegretM3Eq,
      cfg.meanSourceWithdrawalM3
    ),
    evidenceIds: [
      'syn-ev-uppsala-weather-2018',
      'syn-ev-uppsala-weather-2006',
      'syn-ev-uppsala-weather-2012',
      'syn-ev-uppsala-water-assumption',
    ],
  })),
};

// Export aliases for internal adapter & test consumption
export const M14_DECISION_DATASET = SYNTHETIC_DECISION_DATASET;
export const SYNTHETIC_UPPSALA_DECISION_FIXTURE = SYNTHETIC_DECISION_DATASET;
