import type { ClimateWaterDataset, DailyClimateSeriesPoint } from '@/domain/contracts';

function buildSyntheticAnalogueSeries(analogueYear: 2018 | 2006 | 2012): DailyClimateSeriesPoint[] {
  const monthDays = [
    { m: '04', d: '05', doy: 95 },
    { m: '04', d: '18', doy: 108 },
    { m: '05', d: '01', doy: 121 },
    { m: '05', d: '15', doy: 135 },
    { m: '05', d: '28', doy: 148 },
    { m: '06', d: '10', doy: 161 },
    { m: '06', d: '22', doy: 173 },
    { m: '07', d: '04', doy: 185 },
    { m: '07', d: '12', doy: 193 },
    { m: '07', d: '24', doy: 205 },
    { m: '08', d: '05', doy: 217 },
    { m: '08', d: '16', doy: 228 },
    { m: '08', d: '28', doy: 240 },
    { m: '09', d: '10', doy: 253 },
    { m: '09', d: '22', doy: 265 },
  ];

  return monthDays.map((md, idx) => {
    const date = `${analogueYear}-${md.m}-${md.d}`;
    // Explicit missing observation on index 10 in 2006 to demonstrate honest null-gap rendering (never coerced to zero)
    if (analogueYear === 2006 && idx === 10) {
      return {
        date,
        dayOfYear: md.doy,
        analogueYear,
        precipMm: null,
        t2mMinC: 12.4,
        t2mMaxC: 22.1,
        et0Mm: null,
        etcMm: null,
        etaMm: null,
        rootZoneDeficitMm: null,
        deliveredIrrigationMm: null,
      };
    }

    if (analogueYear === 2018) {
      const precipTable = [1.8, 1.2, 0.6, 0.0, 0.0, 0.4, 0.0, 0.0, 0.0, 0.2, 1.5, 2.8, 3.1, 2.4, 1.9];
      const tMinTable = [1.2, 3.8, 6.4, 9.8, 11.5, 12.8, 13.4, 15.2, 16.4, 16.9, 14.8, 12.6, 10.4, 8.2, 6.1];
      const tMaxTable = [9.4, 13.5, 17.8, 23.4, 25.8, 26.9, 24.5, 28.6, 30.2, 31.1, 27.4, 23.1, 20.4, 17.2, 14.3];
      const et0Table = [1.6, 2.3, 3.4, 4.6, 5.2, 5.6, 5.1, 5.9, 6.2, 6.0, 4.9, 3.8, 3.1, 2.2, 1.5];
      const etcTable = [1.1, 1.8, 3.1, 4.5, 5.4, 5.9, 5.5, 6.1, 6.3, 5.8, 4.2, 2.9, 2.0, 1.3, 0.9];
      const etaTable = [1.1, 1.8, 3.0, 4.1, 4.3, 4.0, 3.4, 3.1, 2.8, 2.6, 2.5, 2.2, 1.8, 1.2, 0.9];
      // Synthetic dry-window deficit on non-irrigable F1 reaching 142.50 mm peak
      const deficitTable = [7.5, 13.2, 22.4, 38.0, 58.2, 76.4, 91.0, 104.2, 118.6, 132.4, 142.5, 136.0, 122.4, 108.0, 94.5];
      const irrigF3Table = [0.0, 0.0, 1.2, 2.8, 3.8, 4.2, 4.0, 4.5, 4.5, 4.2, 2.8, 1.2, 0.0, 0.0, 0.0];

      return {
        date,
        dayOfYear: md.doy,
        analogueYear,
        precipMm: precipTable[idx]!,
        t2mMinC: tMinTable[idx]!,
        t2mMaxC: tMaxTable[idx]!,
        et0Mm: et0Table[idx]!,
        etcMm: etcTable[idx]!,
        etaMm: etaTable[idx]!,
        rootZoneDeficitMm: deficitTable[idx]!,
        deliveredIrrigationMm: irrigF3Table[idx]!,
      };
    }

    if (analogueYear === 2006) {
      const precipTable = [2.4, 2.8, 3.1, 2.6, 1.9, 1.8, 2.2, 1.5, 1.4, 2.1, 2.8, 3.6, 3.9, 3.2, 2.7];
      const tMinTable = [0.8, 2.9, 5.4, 7.8, 9.2, 11.4, 12.6, 13.8, 14.2, 14.0, 12.4, 11.2, 9.5, 7.4, 5.2];
      const tMaxTable = [8.2, 11.8, 15.2, 18.4, 20.1, 22.6, 23.8, 25.1, 25.8, 24.9, 22.1, 20.8, 18.9, 15.8, 13.1];
      const et0Table = [1.4, 2.0, 2.8, 3.5, 3.9, 4.4, 4.6, 4.8, 4.9, 4.5, 3.9, 3.3, 2.6, 1.9, 1.3];
      const etcTable = [1.0, 1.6, 2.5, 3.4, 4.0, 4.6, 4.8, 4.9, 4.8, 4.2, 3.4, 2.5, 1.7, 1.1, 0.8];
      const etaTable = [1.0, 1.6, 2.5, 3.3, 3.8, 4.2, 4.3, 4.3, 4.1, 3.8, 3.2, 2.4, 1.7, 1.1, 0.8];
      const deficitTable = [4.8, 8.6, 13.4, 20.2, 29.0, 38.6, 46.2, 54.8, 61.0, 64.2, 60.0, 51.0, 40.5, 32.0, 24.0];
      const irrigF3Table = [0.0, 0.0, 0.0, 1.0, 1.8, 2.4, 2.6, 2.8, 2.6, 1.9, 0.8, 0.0, 0.0, 0.0, 0.0];

      return {
        date,
        dayOfYear: md.doy,
        analogueYear,
        precipMm: precipTable[idx]!,
        t2mMinC: tMinTable[idx]!,
        t2mMaxC: tMaxTable[idx]!,
        et0Mm: et0Table[idx]!,
        etcMm: etcTable[idx]!,
        etaMm: etaTable[idx]!,
        rootZoneDeficitMm: deficitTable[idx]!,
        deliveredIrrigationMm: irrigF3Table[idx]!,
      };
    }

    // 2012 Wet Analogue
    const precipTable = [3.6, 4.2, 4.8, 5.4, 6.1, 8.2, 6.4, 4.9, 9.3, 7.8, 6.2, 5.5, 4.9, 4.1, 3.8];
    const tMinTable = [0.5, 2.4, 4.8, 6.9, 8.4, 10.1, 11.2, 12.4, 12.9, 12.5, 11.8, 10.4, 8.8, 6.9, 4.8];
    const tMaxTable = [7.4, 10.2, 13.8, 16.2, 17.9, 19.4, 20.2, 21.6, 21.2, 20.8, 19.9, 18.6, 17.1, 14.5, 12.0];
    const et0Table = [1.2, 1.7, 2.3, 2.9, 3.2, 3.5, 3.7, 3.9, 3.6, 3.5, 3.1, 2.7, 2.1, 1.6, 1.1];
    const etcTable = [0.9, 1.4, 2.1, 2.8, 3.3, 3.6, 3.8, 3.9, 3.5, 3.3, 2.7, 2.1, 1.4, 1.0, 0.7];
    const etaTable = [0.9, 1.4, 2.1, 2.8, 3.3, 3.6, 3.8, 3.9, 3.5, 3.3, 2.7, 2.1, 1.4, 1.0, 0.7];
    const deficitTable = [1.8, 3.8, 6.2, 9.4, 13.2, 16.8, 20.5, 24.6, 26.8, 22.4, 18.0, 14.0, 10.5, 7.5, 4.5];
    const irrigF3Table = [0.0, 0.0, 0.0, 0.0, 0.4, 0.7, 0.9, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];

    return {
      date,
      dayOfYear: md.doy,
      analogueYear,
      precipMm: precipTable[idx]!,
      t2mMinC: tMinTable[idx]!,
      t2mMaxC: tMaxTable[idx]!,
      et0Mm: et0Table[idx]!,
      etcMm: etcTable[idx]!,
      etaMm: etaTable[idx]!,
      rootZoneDeficitMm: deficitTable[idx]!,
      deliveredIrrigationMm: irrigF3Table[idx]!,
    };
  });
}

export const SYNTHETIC_UPPSALA_CLIMATE_FIXTURE: ClimateWaterDataset = {
  siteId: 'uppsala-demo',
  locationLabel: 'Uppsala, Sweden (59.8586°N, 17.6389°E)',
  datasetMode: 'SYNTHETIC_UI_DEMO',
  syntheticDisclosure:
    'SYNTHETIC INTERFACE DEMONSTRATION — NOT RECORDED SCIENTIFIC RESULTS. Series below are illustrative UI fixtures modeled on boreal seasonal patterns.',
  analogueYearsNote:
    'Synthetic weather analogue series (2018 dry, 2006 median, 2012 wet) illustrate historical stress-test windows in the UI, NOT meteorological forecasts for 2027–2031.',
  timeWindowLabel: 'April 05 – September 22 Boreal Cropping Window (Synthetic UI Demo Series)',
  units: {
    precipitation: 'mm/day',
    temperature: '°C',
    evapotranspiration: 'mm/day',
    deficit: 'mm',
    volume: 'm³ equivalent',
  },
  analogueSummaries: [
    {
      analogueYear: 2018,
      classification: 'DRY_ANALOGUE',
      label: '2018 Dry Analogue Window (Synthetic Demo)',
      seasonalPrecipMm: 138.4,
      seasonalEt0Mm: 542.8,
      peakF1DeficitMm: 142.5,
      firstThresholdBreachDate: '2018-07-04',
      meanTempC: 18.4,
      evidenceId: 'syn-ev-uppsala-weather-2018',
    },
    {
      analogueYear: 2006,
      classification: 'MEDIAN_ANALOGUE',
      label: '2006 Median Analogue Window (Synthetic Demo · Includes Null Gap)',
      seasonalPrecipMm: 284.6,
      seasonalEt0Mm: 438.2,
      peakF1DeficitMm: 64.2,
      firstThresholdBreachDate: null,
      meanTempC: 15.6,
      evidenceId: 'syn-ev-uppsala-weather-2006',
    },
    {
      analogueYear: 2012,
      classification: 'WET_ANALOGUE',
      label: '2012 Wet Analogue Window (Synthetic Demo)',
      seasonalPrecipMm: 462.1,
      seasonalEt0Mm: 361.5,
      peakF1DeficitMm: 26.8,
      firstThresholdBreachDate: null,
      meanTempC: 13.9,
      evidenceId: 'syn-ev-uppsala-weather-2012',
    },
  ],
  seriesByAnalogue: {
    '2018': buildSyntheticAnalogueSeries(2018),
    '2006': buildSyntheticAnalogueSeries(2006),
    '2012': buildSyntheticAnalogueSeries(2012),
  },
};

export const UPPSALA_CLIMATE_WATER_FIXTURE = SYNTHETIC_UPPSALA_CLIMATE_FIXTURE;
