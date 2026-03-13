export interface LegacyGoldenFixture {
  id: string;
  options: Record<string, unknown>;
  metrics: {
    breakevenYears: number;
    billionYears: number;
    fundingNeeded: number | null;
  };
  summary: {
    breakeven: string;
    billion: string;
    funding: string;
  };
  inputs: {
    revenue: string;
    grossMargin: string;
    fixed: string;
    growth: string;
  };
  yDomain: {
    tickCount: number;
    firstTick: number;
    lastTick: number;
  };
}

export const LEGACY_GOLDEN_FIXTURES: LegacyGoldenFixture[] = [
  {
    id: 'default-weekly',
    options: {},
    metrics: {
      breakevenYears: 1.531730516193526,
      billionYears: 6.719755671503592,
      fundingNeeded: 84632.08103258976,
    },
    summary: {
      breakeven: 'year 1.5',
      billion: 'year 6.7',
      funding: '$84.63K',
    },
    inputs: {
      revenue: '$100',
      grossMargin: '100%',
      fixed: '$1,600',
      growth: '3.53%',
    },
    yDomain: {
      tickCount: 12,
      firstTick: 100,
      lastTick: 30000000,
    },
  },
  {
    id: 'monthly-custom',
    options: {
      units: 'month',
      weeklyRevenue0: 250,
      weeklyGrowthRate: 0.02,
      grossMargin: 0.55,
      weeklyFixedExpenses: 4000,
      yearsMin: 2,
      yearsMax: 12,
    },
    metrics: {
      breakevenYears: 3.261960368113654,
      billionYears: 10.885203281324252,
      fundingNeeded: 485747.55785867735,
    },
    summary: {
      breakeven: 'year 3.3',
      billion: 'year 11',
      funding: '$485.7K',
    },
    inputs: {
      revenue: '$1,087',
      grossMargin: '55%',
      fixed: '$17,393',
      growth: '8.99%',
    },
    yDomain: {
      tickCount: 11,
      firstTick: 68.99525657611038,
      lastTick: 6899525.657611039,
    },
  },
];
