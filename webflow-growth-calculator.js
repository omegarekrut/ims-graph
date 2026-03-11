(() => {
  // Chart and UI color palette (aligned to reference visuals).
  const COLORS = {
    black: '#212125',
    darkGrey: '#73737F',
    grey: '#BFBFBF',
    white: '#FFFFFF',
    blue: '#0E64E0',
    revenue: '#63C56B',
    variable: '#D66B90',
    variableLight: '#E6A7BC',
    fixed: '#B8B8C5',
    fixedLight: '#D4D4DE',
    total: '#56566C',
    grid: '#E6E6EC',
  };

  const WEEKS_PER_YEAR = 52.1775;
  const WEEKS_PER_QUARTER = 13.044375;
  const WEEKS_PER_MONTH = WEEKS_PER_YEAR / 12;

  // Default widget values:
  // IMPORTANT: internal calculations run in weekly units (weekly core).
  const DEFAULTS = {
    units: 'week',
    expenseViz: 'bars',
    weeklyRevenue0: 100,
    weeklyGrowthRate: 0.0353,
    grossMargin: 1,
    weeklyFixedExpenses: 1600,
    yearsMin: 1,
    yearsMax: 9,
  };

  const MAX_FINITE_FLOW = Number.MAX_VALUE;
  const PROJECTION_SOFT_CAP_WEEKLY = 1e30;
  const MIN_WEEKLY_LOG_FLOOR = 1e-9;
  const MIN_DISPLAY_Y_FLOOR_BY_UNIT = {
    // Keep the "$0" baseline while compressing the first tick gap.
    // This makes the 0->first-tick interval feel consistent with the rest of the log scale.
    week: 30,
    month: 90,
    quarter: 900,
    year: 900,
  };
  const MIN_Y_TICK_GAP = 14;
  const AXIS_LABEL_TOP_CLEARANCE = 12;
  const MIN_X_YEAR_LABEL_GAP = 28;
  const RIGHT_LINE_LABEL_MIN_GAP = 14;
  const MIN_BAR_LABEL_SEGMENT_HEIGHT = 14;
  const UNIT_TOKEN_BY_ID = {
    week: 'WoW',
    month: 'MoM',
    quarter: 'QoQ',
    year: 'YoY',
  };
  const MIN_TOTAL_LINE_SEGMENTS = 120;
  const MAX_TOTAL_LINE_SEGMENTS = 320;
  const TOTAL_LINE_PIXELS_PER_SEGMENT = 5;
  const HANDLE_RECT_VISUAL_WIDTH = 22;
  const HANDLE_RECT_VISUAL_HEIGHT = 16;
  const HANDLE_RECT_HIT_PADDING = 8;
  const RIGHT_LABEL_INSIDE_PADDING_FROM_HANDLE = 15;
  const EXPENSE_SERIES_DASHARRAY = '1 6';
  const EXPENSE_SERIES_OPACITY = 0.5;
  const DRAG_RENDER_OPTIONS = Object.freeze({
    skipInputs: true,
    skipKpis: true,
    skipYDomain: true,
  });
  const DRAG_Y_EXPAND_TRIGGER_OFFSET = 2;
  const DRAG_Y_EXPAND_RESET_OFFSET = 16;

  // Baseline Y-axis ticks in display units.
  const Y_TICKS_BY_UNIT = {
    week: [100, 300, 1000, 3000, 10000, 30000, 100000, 300000, 1000000, 3000000, 10000000],
    month: [300, 1000, 3000, 10000, 30000, 100000, 300000, 1000000, 3000000, 10000000, 30000000],
    quarter: [3000, 10000, 30000, 100000, 300000, 1000000, 3000000, 10000000, 30000000, 100000000],
    year: [
      3000, 10000, 30000, 100000, 300000, 1000000, 3000000, 10000000, 30000000, 100000000,
      300000000, 1000000000,
    ],
  };

  /**
   * Returns how many weeks are in the selected unit.
   * Used for week <-> month/quarter/year conversions.
   */
  function unitWeeks(units) {
    if (units === 'week') {
      return 1;
    }
    if (units === 'month') {
      return WEEKS_PER_MONTH;
    }
    if (units === 'quarter') {
      return WEEKS_PER_QUARTER;
    }
    return WEEKS_PER_YEAR;
  }

  /**
   * Verifies that units is one of the allowed values.
   */
  function isValidUnit(units) {
    return units === 'week' || units === 'month' || units === 'quarter' || units === 'year';
  }

  function isValidExpenseViz(expenseViz) {
    return expenseViz === 'bars' || expenseViz === 'lines';
  }

  /**
   * Converts a monetary flow from the active unit to weekly.
   */
  function flowToWeekly(value, units) {
    return value / unitWeeks(units);
  }

  /**
   * Converts a monetary flow from weekly to the active unit.
   */
  function flowFromWeekly(value, units) {
    return value * unitWeeks(units);
  }

  /**
   * Converts growth rate from the selected unit to weekly.
   * Compound-growth formula: (1 + r_unit)^(1/n) - 1
   */
  function growthToWeekly(value, units) {
    if (value <= -0.999999) {
      return -0.999999;
    }
    return Math.exp(Math.log(1 + value) / unitWeeks(units)) - 1;
  }

  /**
   * Converts weekly growth into the display unit.
   * Compound-growth formula: (1 + r_week)^n - 1
   */
  function growthFromWeekly(value, units) {
    return Math.exp(Math.log(1 + value) * unitWeeks(units)) - 1;
  }

  /**
   * Clamps a value to the [min, max] interval.
   */
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  /**
   * Safe finite-number guard.
   */
  function isFiniteNumber(value) {
    return Number.isFinite(value) && !Number.isNaN(value);
  }

  /**
   * Overflow-safe exponentiation with an explicit finite cap.
   */
  function safePow(base, exponent, cap) {
    const maxResult = isFiniteNumber(cap) ? clamp(cap, 1, MAX_FINITE_FLOW) : MAX_FINITE_FLOW;
    if (!isFiniteNumber(base) || !isFiniteNumber(exponent) || base < 0) {
      return NaN;
    }

    if (base === 0 && exponent < 0) {
      return maxResult;
    }
    if (base === 0) {
      return exponent === 0 ? 1 : 0;
    }

    if (base === 1 || exponent === 0) {
      return 1;
    }

    const logResult = Math.log(base) * exponent;
    if (!isFiniteNumber(logResult)) {
      return logResult > 0 ? maxResult : 0;
    }

    if (logResult >= Math.log(maxResult)) {
      return maxResult;
    }

    if (logResult <= Math.log(Number.MIN_VALUE)) {
      return 0;
    }

    const value = Math.exp(logResult);
    if (!isFiniteNumber(value)) {
      return maxResult;
    }

    return Math.min(value, maxResult);
  }

  function formatIntegerStringWithCommas(integerDigits) {
    if (typeof integerDigits !== 'string' || integerDigits === '') {
      return '0';
    }
    if (!/^\d+$/.test(integerDigits)) {
      return '0';
    }
    return integerDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function splitMoneyDisplayParts(formattedMoney) {
    if (typeof formattedMoney !== 'string' || formattedMoney === '') {
      return null;
    }

    let source = formattedMoney;
    let signPrefix = '';
    if (source.indexOf('-$') === 0) {
      signPrefix = '-$';
      source = source.slice(2);
    } else if (source.indexOf('$') === 0) {
      signPrefix = '$';
      source = source.slice(1);
    } else {
      return null;
    }

    const dotIndex = source.indexOf('.');
    const integerPart = dotIndex < 0 ? source : source.slice(0, dotIndex);
    const normalizedIntegerPart = integerPart.replace(/,/g, '');
    if (!/^\d+$/.test(normalizedIntegerPart)) {
      return null;
    }
    if (dotIndex >= 0 && !/^\.\d+$/.test(source.slice(dotIndex))) {
      return null;
    }

    if (dotIndex < 0) {
      return {
        signPrefix: signPrefix,
        integerPart: normalizedIntegerPart,
        fractionalPart: '',
      };
    }

    return {
      signPrefix: signPrefix,
      integerPart: normalizedIntegerPart,
      fractionalPart: source.slice(dotIndex),
    };
  }

  function formatMoneyWithCommas(formattedMoney) {
    const parts = splitMoneyDisplayParts(formattedMoney);
    if (!parts) {
      return typeof formattedMoney === 'string' ? formattedMoney : '$0';
    }
    return (
      parts.signPrefix + formatIntegerStringWithCommas(parts.integerPart) + parts.fractionalPart
    );
  }

  /**
   * Formats money for axes and labels with compact suffixes.
   */
  function formatMoney(value) {
    if (!isFiniteNumber(value)) {
      return '$0';
    }

    const abs = Math.abs(value);
    if (abs >= 1e21) {
      const scientific = abs
        .toExponential(2)
        .replace('+', '')
        .replace(/(\.\d*[1-9])0+e/, '$1e')
        .replace(/\.0+e/, 'e');
      return (value < 0 ? '-$' : '$') + scientific;
    }

    let suffix = '';
    let scaled = abs;

    const scales = [
      { threshold: 999e15, suffix: 'Qi', divisor: 1e18 },
      { threshold: 999e12, suffix: 'Q', divisor: 1e15 },
      { threshold: 999e9, suffix: 'T', divisor: 1e12 },
      { threshold: 999e6, suffix: 'B', divisor: 1e9 },
      { threshold: 999e3, suffix: 'M', divisor: 1e6 },
      { threshold: 1e4, suffix: 'K', divisor: 1e3 },
    ];

    for (let i = 0; i < scales.length; i += 1) {
      const scale = scales[i];
      if (abs < scale.threshold) {
        continue;
      }
      suffix = scale.suffix;
      scaled = abs / scale.divisor;
      break;
    }

    const digits = scaled >= 1000 ? 0 : scaled >= 100 ? 1 : scaled >= 10 ? 2 : 2;
    const text = scaled
      .toFixed(digits)
      .replace(/\.0+$/, '')
      .replace(/(\.\d*[1-9])0+$/, '$1');
    const formattedMoney = (value < 0 ? '-$' : '$') + text + suffix;
    if (suffix) {
      return formattedMoney;
    }
    return formatMoneyWithCommas(formattedMoney);
  }

  function formatBarMoney(displayValue) {
    if (!isFiniteNumber(displayValue) || displayValue <= 0) {
      return '';
    }
    return formatMoney(displayValue).replace(/^\$/, '');
  }

  function formatBarMoneyFromWeekly(weeklyValue, units) {
    if (!isFiniteNumber(weeklyValue) || weeklyValue <= 0) {
      return '';
    }
    return formatBarMoney(flowFromWeekly(weeklyValue, units));
  }

  function formatIntegerWithCommas(intValue) {
    if (!isFiniteNumber(intValue)) {
      return '0';
    }
    const sign = intValue < 0 ? '-' : '';
    const digits = String(Math.trunc(Math.abs(intValue)));
    return sign + formatIntegerStringWithCommas(digits);
  }

  /**
   * Formats a money value for input text.
   */
  function formatInputMoney(value) {
    if (!isFiniteNumber(value)) {
      return '$0';
    }
    const clamped = Math.max(0, value);
    const rounded = Math.round(clamped);
    return '$' + formatIntegerWithCommas(rounded);
  }

  /**
   * Formats a percent value for input text.
   */
  function formatInputPercent(value) {
    if (!isFiniteNumber(value)) {
      return '0%';
    }
    return (
      (value * 100)
        .toFixed(2)
        .replace(/\.0+$/, '')
        .replace(/(\.\d*[1-9])0+$/, '$1') + '%'
    );
  }

  /**
   * Parses money text from an input field.
   */
  function parseMoney(text) {
    if (typeof text !== 'string') {
      return NaN;
    }
    const normalized = text.replace(/[^0-9.-]/g, '');
    return Number(normalized);
  }

  function sanitizeMoneyInputDisplayValue(value) {
    if (!isFiniteNumber(value)) {
      return NaN;
    }
    return Math.round(Math.max(0, value));
  }

  /**
   * Parses percent text from an input field (returns fraction, not percent).
   */
  function parsePercent(text) {
    if (typeof text !== 'string') {
      return NaN;
    }
    const normalized = text.replace(/[^0-9.-]/g, '');
    const raw = Number(normalized);
    if (!isFiniteNumber(raw)) {
      return NaN;
    }
    return raw / 100;
  }

  /**
   * Creates an SVG element by tag.
   */
  function createSvgEl(tag) {
    return document.createElementNS('http://www.w3.org/2000/svg', tag);
  }

  /**
   * Bulk-sets attributes on an SVG/DOM node.
   */
  function setAttrs(node, attrs) {
    Object.keys(attrs).forEach((key) => {
      node.setAttribute(key, String(attrs[key]));
    });
  }

  function normalizeTicks(ticks, min, max, targetCount) {
    const uniqueSorted = ticks
      .filter((tick) => isFiniteNumber(tick))
      .sort((a, b) => a - b)
      .filter((tick, idx, arr) => idx === 0 || Math.abs(tick - arr[idx - 1]) > 1e-9);

    if (uniqueSorted.length < 2) {
      return [min, max];
    }

    const safeTargetCount = Math.max(1, targetCount || 1);
    if (uniqueSorted.length <= safeTargetCount) {
      return uniqueSorted;
    }

    const step = Math.ceil(uniqueSorted.length / safeTargetCount);
    const trimmed = uniqueSorted.filter((_tick, idx) => idx % step === 0);

    const shouldAppendMax = trimmed[trimmed.length - 1] < max;
    return shouldAppendMax ? trimmed.concat([max]) : trimmed;
  }

  /**
   * Generates log ticks in a 1-3-10 style (closer to the reference chart).
   */
  function createOneThreeTicks(minValue, maxValue, targetCount) {
    const min = Math.max(1e-9, minValue);
    const max = Math.max(min * 1.01, maxValue);
    const ticks = [];
    const multipliers = [1, 3];

    const minExp = Math.floor(Math.log10(min)) - 1;
    const maxExp = Math.ceil(Math.log10(max)) + 1;

    for (let exp = minExp; exp <= maxExp; exp += 1) {
      const scale = 10 ** exp;
      for (let i = 0; i < multipliers.length; i += 1) {
        const tick = multipliers[i] * scale;
        if (tick >= min * 0.95 && tick <= max * 1.05) {
          ticks.push(tick);
        }
      }
    }

    return normalizeTicks(ticks, min, max, targetCount);
  }

  function snapUpOneThree(value) {
    if (!isFiniteNumber(value) || value <= 0) {
      return 1;
    }

    const exponent = Math.floor(Math.log10(value));
    const scale = 10 ** exponent;
    const normalized = value / scale;
    if (normalized <= 1) {
      return scale;
    }
    if (normalized <= 3) {
      return 3 * scale;
    }
    return 10 * scale;
  }

  function nextOneThreeTick(tick) {
    if (!isFiniteNumber(tick) || tick <= 0) {
      return 1;
    }

    const exponent = Math.floor(Math.log10(tick));
    const scale = 10 ** exponent;
    const normalized = tick / scale;
    if (normalized < 1.5) {
      return 3 * scale;
    }
    return 10 * scale;
  }

  function extendBaselineOneThreeTicks(baselineTicks, maxDisplay) {
    const ticks = (baselineTicks || [])
      .filter((tick) => isFiniteNumber(tick) && tick > 0)
      .sort((a, b) => a - b)
      .filter((tick, idx, arr) => idx === 0 || Math.abs(tick - arr[idx - 1]) > 1e-9);

    const safeMax = isFiniteNumber(maxDisplay) && maxDisplay > 0 ? maxDisplay : 1;
    if (!ticks.length) {
      return createOneThreeTicks(1, safeMax, 8);
    }

    const extended = ticks.slice();
    let guard = 0;
    while (extended[extended.length - 1] < safeMax && guard < 64) {
      extended.push(nextOneThreeTick(extended[extended.length - 1]));
      guard += 1;
    }
    return extended;
  }

  /**
   * Main chart class:
   * - keeps state
   * - renders SVG
   * - binds drag and input interactions
   */
  class GrowthCalculator {
    constructor(container, options) {
      this.container = container;
      this.state = Object.assign({}, DEFAULTS, options || {});
      const weeklyRevenue0 = isFiniteNumber(this.state.weeklyRevenue0)
        ? this.state.weeklyRevenue0
        : DEFAULTS.weeklyRevenue0;
      const weeklyFixedExpenses = isFiniteNumber(this.state.weeklyFixedExpenses)
        ? this.state.weeklyFixedExpenses
        : DEFAULTS.weeklyFixedExpenses;
      const grossMargin = isFiniteNumber(this.state.grossMargin)
        ? this.state.grossMargin
        : DEFAULTS.grossMargin;
      const weeklyGrowthRate = isFiniteNumber(this.state.weeklyGrowthRate)
        ? this.state.weeklyGrowthRate
        : DEFAULTS.weeklyGrowthRate;
      const yearsMinRaw = isFiniteNumber(this.state.yearsMin)
        ? this.state.yearsMin
        : DEFAULTS.yearsMin;
      const yearsMaxRaw = isFiniteNumber(this.state.yearsMax)
        ? this.state.yearsMax
        : DEFAULTS.yearsMax;
      const yearsMin = clamp(Math.round(yearsMinRaw), 1, 99);
      const yearsMax = clamp(Math.round(yearsMaxRaw), yearsMin + 1, 100);
      // Keep minimum revenue > 0 to avoid log(0) and chart degradation.
      this.state.weeklyRevenue0 = Math.max(1 / WEEKS_PER_YEAR, weeklyRevenue0);
      this.state.weeklyFixedExpenses = Math.max(0, weeklyFixedExpenses);
      this.state.grossMargin = clamp(grossMargin, 0, 1);
      this.state.weeklyGrowthRate = clamp(weeklyGrowthRate, -0.9, 10);
      this.state.yearsMin = yearsMin;
      this.state.yearsMax = yearsMax;
      this.state.units = isValidUnit(this.state.units) ? this.state.units : 'year';
      this.state.expenseViz = isValidExpenseViz(this.state.expenseViz)
        ? this.state.expenseViz
        : DEFAULTS.expenseViz;
      this._normalizeStateToUnitDomain();

      this.drag = null;
      this.nodes = {};

      this._injectStyles();
      this._build();
      this._bind();
      this.render();
    }

    /**
     * Injects widget styles (once per page).
     */
    _injectStyles() {
      if (document.getElementById('igc-styles')) {
        return;
      }

      const style = document.createElement('style');
      style.id = 'igc-styles';
      style.textContent =
        '' +
        '.igc{font-family:Inter,Segoe UI,Arial,sans-serif;color:' +
        COLORS.black +
        ';width:100%;display:flex;flex-direction:column;gap:32px;}' +
        '.igc *{box-sizing:border-box;}' +
        '.igc__radios{display:flex;flex-direction:column;gap:10px;font-size:14px;line-height:1.4;}' +
        '.igc__radios-row{display:flex;gap:16px;align-items:center;flex-wrap:wrap;}' +
        '.igc__radio{display:flex;gap:8px;align-items:center;color:' +
        COLORS.black +
        ';cursor:pointer;}' +
        '.igc__radio input{accent-color:' +
        COLORS.blue +
        ';}' +
        '.igc svg text{-webkit-user-select:none;user-select:none;}' +
        '.igc__chart-wrap{background:transparent;}' +
        '.igc__summary{display:flex;gap:32px;flex-wrap:wrap;align-items:baseline;line-height:1.4;}' +
        '.igc__summary-label{font-size:16px;color:' +
        COLORS.darkGrey +
        ';line-height:1.4;}' +
        '.igc__summary-value{font-size:18px;font-weight:600;color:' +
        COLORS.black +
        ';line-height:1.4;margin-left:8px;}' +
        '.igc__inputs{display:flex;gap:24px;flex-wrap:wrap;}' +
        '.igc__field{width:288px;flex:0 0 288px;}' +
        '.igc__field-label{font-size:12px;color:' +
        COLORS.darkGrey +
        ';line-height:1.4;margin-bottom:6px;display:block;}' +
        '.igc__input{width:100%;height:48px;border:1px solid ' +
        COLORS.grey +
        ';border-radius:4px;padding:10px 14px;font-size:16px;line-height:1.4;color:' +
        COLORS.black +
        ';}' +
        '.igc__input:focus{outline:2px solid rgba(14,100,224,.25);border-color:' +
        COLORS.blue +
        ';}' +
        '@media (max-width: 880px){' +
        '.igc{gap:24px;}.igc__summary-label{font-size:16px;}.igc__summary-value{font-size:18px;}.igc__field{width:100%;flex:1 1 100%;}' +
        '}';

      document.head.appendChild(style);
    }

    /**
     * Builds widget DOM structure and core nodes.
     */
    _build() {
      this.container.innerHTML = '';

      const root = document.createElement('div');
      root.className = 'igc';

      const radios = document.createElement('div');
      radios.className = 'igc__radios';
      const unitsRow = document.createElement('div');
      unitsRow.className = 'igc__radios-row';
      const expenseVizRow = document.createElement('div');
      expenseVizRow.className = 'igc__radios-row';

      const units = [
        { id: 'week', label: 'Weekly' },
        { id: 'month', label: 'Monthly' },
        { id: 'quarter', label: 'Quarterly' },
        { id: 'year', label: 'Yearly' },
      ];

      const unitRadioGroupName = 'igc-units-' + String(Math.random()).slice(2);
      units.forEach((unit) => {
        const label = document.createElement('label');
        label.className = 'igc__radio';

        const input = document.createElement('input');
        input.type = 'radio';
        input.name = unitRadioGroupName;
        input.value = unit.id;
        input.dataset.group = 'units';
        if (unit.id === this.state.units) {
          input.checked = true;
        }

        const text = document.createElement('span');
        text.textContent = unit.label;

        label.appendChild(input);
        label.appendChild(text);
        unitsRow.appendChild(label);
      });

      const expenseVizOptions = [
        { id: 'bars', label: 'Expenses: Bars' },
        { id: 'lines', label: 'Expenses: Lines' },
      ];
      const expenseVizRadioGroupName = 'igc-expense-viz-' + String(Math.random()).slice(2);
      expenseVizOptions.forEach((option) => {
        const label = document.createElement('label');
        label.className = 'igc__radio';

        const input = document.createElement('input');
        input.type = 'radio';
        input.name = expenseVizRadioGroupName;
        input.value = option.id;
        input.dataset.group = 'expenseViz';
        if (option.id === this.state.expenseViz) {
          input.checked = true;
        }

        const text = document.createElement('span');
        text.textContent = option.label;

        label.appendChild(input);
        label.appendChild(text);
        expenseVizRow.appendChild(label);
      });

      radios.appendChild(unitsRow);
      radios.appendChild(expenseVizRow);

      const chartWrap = document.createElement('div');
      chartWrap.className = 'igc__chart-wrap';

      const svg = createSvgEl('svg');
      setAttrs(svg, {
        viewBox: '0 0 1224 420',
        width: '100%',
        height: '420',
        preserveAspectRatio: 'none',
      });

      chartWrap.appendChild(svg);

      // KPI summary block under the chart.
      const summary = document.createElement('div');
      summary.className = 'igc__summary';
      summary.innerHTML =
        '' +
        '<div><span class="igc__summary-label">Profitable at:</span><span class="igc__summary-value" data-key="breakeven">-</span></div>' +
        '<div><span class="igc__summary-label">$1B/y revenue at:</span><span class="igc__summary-value" data-key="billion">-</span></div>';

      // User-editable model inputs.
      const inputs = document.createElement('div');
      inputs.className = 'igc__inputs';
      inputs.innerHTML =
        '' +
        '<div class="igc__field"><label class="igc__field-label">Starting Revenue</label><input class="igc__input" data-key="revenue" type="text" /></div>' +
        '<div class="igc__field"><label class="igc__field-label">Gross margin</label><input class="igc__input" data-key="grossMargin" type="text" /></div>' +
        '<div class="igc__field"><label class="igc__field-label">Fixed expenses</label><input class="igc__input" data-key="fixed" type="text" /></div>' +
        '<div class="igc__field"><label class="igc__field-label">Growth rate</label><input class="igc__input" data-key="growth" type="text" /></div>';

      root.appendChild(radios);
      root.appendChild(chartWrap);
      root.appendChild(summary);
      root.appendChild(inputs);

      this.container.appendChild(root);

      this.nodes.root = root;
      this.nodes.radios = radios;
      this.nodes.svg = svg;
      this.nodes.summaryBreakeven = summary.querySelector('[data-key="breakeven"]');
      this.nodes.summaryBillion = summary.querySelector('[data-key="billion"]');
      this.nodes.inputRevenue = inputs.querySelector('[data-key="revenue"]');
      this.nodes.inputGrossMargin = inputs.querySelector('[data-key="grossMargin"]');
      this.nodes.inputFixed = inputs.querySelector('[data-key="fixed"]');
      this.nodes.inputGrowth = inputs.querySelector('[data-key="growth"]');

      this._setupSvgLayers();
    }

    /**
     * Prepares SVG layers and base chart geometry.
     */
    _setupSvgLayers() {
      const svg = this.nodes.svg;
      svg.innerHTML = '';

      const groups = {
        grid: createSvgEl('g'),
        axes: createSvgEl('g'),
        lines: createSvgEl('g'),
        labels: createSvgEl('g'),
        handles: createSvgEl('g'),
      };

      Object.keys(groups).forEach((key) => {
        svg.appendChild(groups[key]);
      });

      this.nodes.svgGroups = groups;
      const displayUnit = this.state.units;
      const yMinDisplay = MIN_DISPLAY_Y_FLOOR_BY_UNIT[displayUnit] || 1;
      this.chart = {
        width: 1224,
        height: 420,
        paddingLeft: 66,
        paddingRight: 72,
        paddingTop: 8,
        paddingBottom: 48,
        // X axis always uses years.
        tMin: this.state.yearsMin,
        tMax: this.state.yearsMax,
        yMin: flowToWeekly(yMinDisplay, displayUnit),
        yMax: this._projectionMaxWeekly(),
        ticksY: [],
      };
    }

    /**
     * Binds UI and chart events (radio/input/drag).
     */
    _bind() {
      const self = this;

      this.nodes.radios
        .querySelectorAll('input[type="radio"][data-group="units"]')
        .forEach((radio) => {
          radio.addEventListener('change', () => {
            if (radio.checked) {
              self.state.units = radio.value;
              self._normalizeStateToUnitDomain();
              self.render();
            }
          });
        });

      this.nodes.radios
        .querySelectorAll('input[type="radio"][data-group="expenseViz"]')
        .forEach((radio) => {
          radio.addEventListener('change', () => {
            if (!radio.checked) {
              return;
            }
            const next = radio.value;
            const resolved = isValidExpenseViz(next) ? next : DEFAULTS.expenseViz;
            if (resolved === self.state.expenseViz) {
              return;
            }
            self.state.expenseViz = resolved;
            self.render();
          });
        });

      /**
       * Shared text-input binding with apply on blur/Enter.
       */
      function bindInput(input, onApply) {
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Enter') {
            input.blur();
          }
        });

        input.addEventListener('blur', () => {
          onApply(input.value);
          self.render();
        });
      }

      bindInput(this.nodes.inputRevenue, (text) => {
        const displayValue = sanitizeMoneyInputDisplayValue(parseMoney(text));
        if (!isFiniteNumber(displayValue)) {
          return;
        }

        const revenueMax = self._maxWeeklyRevenue0();
        self.state.weeklyRevenue0 = clamp(
          flowToWeekly(displayValue, self.state.units),
          1 / WEEKS_PER_YEAR,
          revenueMax
        );
      });

      bindInput(this.nodes.inputGrossMargin, (text) => {
        const value = parsePercent(text);
        if (!isFiniteNumber(value)) {
          return;
        }
        self.state.grossMargin = clamp(value, self._minGrossMargin(), 1);
      });

      bindInput(this.nodes.inputFixed, (text) => {
        const displayValue = sanitizeMoneyInputDisplayValue(parseMoney(text));
        if (!isFiniteNumber(displayValue)) {
          return;
        }

        const fixedMax = self._maxWeeklyFixedExpenses();
        self.state.weeklyFixedExpenses = clamp(
          flowToWeekly(displayValue, self.state.units),
          0,
          fixedMax
        );
      });

      bindInput(this.nodes.inputGrowth, (text) => {
        const displayValue = parsePercent(text);
        if (!isFiniteNumber(displayValue) || displayValue <= -0.99) {
          return;
        }

        const growthMax = self._maxWeeklyGrowthRate();
        self.state.weeklyGrowthRate = clamp(
          growthToWeekly(displayValue, self.state.units),
          -0.9,
          growthMax
        );
      });

      this.nodes.svg.addEventListener('pointerdown', (event) => {
        const target = event.target;
        if (!target || !target.dataset || !target.dataset.handle) {
          return;
        }
        const displayUnitLock = isValidUnit(self.state.units) ? self.state.units : 'year';

        self.drag = {
          handle: target.dataset.handle,
          domain: {
            yMinLockWeekly: self.chart.yMin,
            yMaxLockWeekly: self.chart.yMax,
            ticksYLockWeekly: self.chart.ticksY.slice(),
            displayUnitLock: displayUnitLock,
            yMaxLockDisplayTick: snapUpOneThree(flowFromWeekly(self.chart.yMax, displayUnitLock)),
            canExpandYMax: true,
          },
        };
        self.nodes.svg.setPointerCapture(event.pointerId);
      });

      this.nodes.svg.addEventListener('pointermove', (event) => {
        if (!self.drag) {
          return;
        }
        const coords = self._eventToChart(event);
        if (!coords) {
          return;
        }

        const hasDomainExpansion = self._maybeExpandDragYMax(coords);
        const hasStateUpdate = self._handleDragAt(coords);
        if (!hasDomainExpansion && !hasStateUpdate) {
          return;
        }
        self.render(DRAG_RENDER_OPTIONS);
      });

      /**
       * Ends the drag session and releases pointer capture.
       */
      function endDrag(event) {
        if (!self.drag) {
          return;
        }

        self.drag = null;
        if (self.nodes.svg.hasPointerCapture(event.pointerId)) {
          self.nodes.svg.releasePointerCapture(event.pointerId);
        }
        self.render();
      }

      this.nodes.svg.addEventListener('pointerup', endDrag);
      this.nodes.svg.addEventListener('pointercancel', endDrag);
    }

    _handleDragAt(coords) {
      if (!coords) {
        return false;
      }

      const t = this._xToTime(coords.x);
      const value = this._yToValue(coords.y);
      const hasFiniteDragValues =
        isFiniteNumber(coords.x) &&
        isFiniteNumber(coords.y) &&
        isFiniteNumber(t) &&
        isFiniteNumber(value);
      if (!hasFiniteDragValues) {
        return false;
      }

      const tMax = this.chart.tMax - this.chart.tMin;
      switch (this.drag.handle) {
        case 'revenue-start': {
          const revenueMax = this._maxWeeklyRevenue0();
          this.state.weeklyRevenue0 = clamp(value, 1 / WEEKS_PER_YEAR, revenueMax);
          return true;
        }
        case 'growth': {
          const anchorT = clamp(t, 0.75, tMax);
          // Convert handle position to weekly growth via inverse exponential math.
          const anchorWeeks = anchorT * WEEKS_PER_YEAR;
          const ratio = clamp(value / this.state.weeklyRevenue0, 1e-6, 1e9);
          const weeklyGrowth = ratio ** (1 / anchorWeeks) - 1;
          this.state.weeklyGrowthRate = clamp(weeklyGrowth, -0.9, this._maxWeeklyGrowthRate());
          return true;
        }
        case 'fixed':
          this.state.weeklyFixedExpenses = clamp(value, 0, this._maxWeeklyFixedExpenses());
          return true;
        case 'variable': {
          const revAtEnd = this._revenueAt(tMax);
          if (revAtEnd <= 0) {
            return false;
          }
          // Variable handle controls variable/revenue ratio.
          const variableRatio = clamp(value / revAtEnd, 0, 1);
          this.state.grossMargin = clamp(1 - variableRatio, this._minGrossMargin(), 1);
          return true;
        }
        default:
          return false;
      }
    }

    _applyDragDomainLock() {
      const hasDragDomain = this.drag && this.drag.domain;
      if (!hasDragDomain) {
        return false;
      }

      const yMinLockWeekly = this._clampForProjection(this.drag.domain.yMinLockWeekly);
      const yMaxLockWeekly = this._clampForProjection(this.drag.domain.yMaxLockWeekly);
      const hasFiniteBounds = isFiniteNumber(yMinLockWeekly) && isFiniteNumber(yMaxLockWeekly);
      if (!hasFiniteBounds) {
        return false;
      }

      const yMinWeekly = Math.min(yMinLockWeekly, yMaxLockWeekly);
      const yMaxWeekly = Math.max(yMinLockWeekly, yMaxLockWeekly);
      if (yMaxWeekly <= yMinWeekly) {
        return false;
      }

      this.drag.domain.yMinLockWeekly = yMinWeekly;
      this.drag.domain.yMaxLockWeekly = yMaxWeekly;
      const displayUnit = isValidUnit(this.drag.domain.displayUnitLock)
        ? this.drag.domain.displayUnitLock
        : this.state.units;
      this.drag.domain.displayUnitLock = displayUnit;
      this.drag.domain.yMaxLockDisplayTick = snapUpOneThree(
        flowFromWeekly(yMaxWeekly, displayUnit)
      );
      this.chart.yMin = yMinWeekly;
      this.chart.yMax = yMaxWeekly;
      const lockedTicks = Array.isArray(this.drag.domain.ticksYLockWeekly)
        ? this.drag.domain.ticksYLockWeekly.slice()
        : [];
      let filteredLockedTicks = lockedTicks.filter(
        (tick) => isFiniteNumber(tick) && tick > 0 && tick >= yMinWeekly && tick <= yMaxWeekly
      );
      if (!filteredLockedTicks.length) {
        const baselineDisplayTicks = Y_TICKS_BY_UNIT[displayUnit] || Y_TICKS_BY_UNIT.year || [];
        const normalizedDomain = {
          yMinDisplay: flowFromWeekly(yMinWeekly, displayUnit),
          yMaxDisplay: flowFromWeekly(yMaxWeekly, displayUnit),
        };
        filteredLockedTicks = this._domainTicksWeekly(
          displayUnit,
          baselineDisplayTicks,
          normalizedDomain
        );
      }
      this.chart.ticksY = filteredLockedTicks;
      this.drag.domain.ticksYLockWeekly = filteredLockedTicks.slice();
      return true;
    }

    _maybeExpandDragYMax(coords) {
      const hasDragDomain = this.drag && this.drag.domain;
      const hasCoords = coords && isFiniteNumber(coords.y);
      if (!hasDragDomain || !hasCoords) {
        return false;
      }
      if (coords.y > this.chart.paddingTop + DRAG_Y_EXPAND_RESET_OFFSET) {
        this.drag.domain.canExpandYMax = true;
        return false;
      }
      if (coords.y > this.chart.paddingTop + DRAG_Y_EXPAND_TRIGGER_OFFSET) {
        return false;
      }
      if (!this.drag.domain.canExpandYMax) {
        return false;
      }

      const displayUnit = isValidUnit(this.drag.domain.displayUnitLock)
        ? this.drag.domain.displayUnitLock
        : this.state.units;
      this.drag.domain.displayUnitLock = displayUnit;
      const yMinLockWeekly = this._clampForProjection(this.drag.domain.yMinLockWeekly);
      const yMaxLockWeekly = this._clampForProjection(this.drag.domain.yMaxLockWeekly);
      const hasFiniteBounds = isFiniteNumber(yMinLockWeekly) && isFiniteNumber(yMaxLockWeekly);
      if (!hasFiniteBounds || yMaxLockWeekly <= yMinLockWeekly) {
        return false;
      }

      const yMaxDisplayTick =
        isFiniteNumber(this.drag.domain.yMaxLockDisplayTick) &&
        this.drag.domain.yMaxLockDisplayTick > 0
          ? this.drag.domain.yMaxLockDisplayTick
          : snapUpOneThree(flowFromWeekly(yMaxLockWeekly, displayUnit));
      const nextYMaxDisplay = nextOneThreeTick(yMaxDisplayTick);
      const nextYMaxWeekly = this._clampForProjection(flowToWeekly(nextYMaxDisplay, displayUnit));
      if (!isFiniteNumber(nextYMaxWeekly) || nextYMaxWeekly <= yMaxLockWeekly) {
        return false;
      }

      this.drag.domain.yMinLockWeekly = yMinLockWeekly;
      this.drag.domain.yMaxLockWeekly = nextYMaxWeekly;
      this.drag.domain.yMaxLockDisplayTick = nextYMaxDisplay;
      this.drag.domain.canExpandYMax = false;
      this.chart.yMin = this.drag.domain.yMinLockWeekly;
      this.chart.yMax = this.drag.domain.yMaxLockWeekly;
      const baselineDisplayTicks = Y_TICKS_BY_UNIT[displayUnit] || Y_TICKS_BY_UNIT.year || [];
      const normalizedDomain = {
        yMinDisplay: flowFromWeekly(this.drag.domain.yMinLockWeekly, displayUnit),
        yMaxDisplay: flowFromWeekly(this.drag.domain.yMaxLockWeekly, displayUnit),
      };
      this.drag.domain.ticksYLockWeekly = this._domainTicksWeekly(
        displayUnit,
        baselineDisplayTicks,
        normalizedDomain
      );
      this._applyDragDomainLock();
      return true;
    }

    /**
     * Converts pointer-event coordinates to chart SVG coordinates.
     */
    _eventToChart(event) {
      const rect = this.nodes.svg.getBoundingClientRect();
      const hasValidRect = rect.width > 0 && rect.height > 0;
      if (!hasValidRect) {
        return null;
      }

      const scaleX = this.chart.width / rect.width;
      const scaleY = this.chart.height / rect.height;
      const hasValidScale =
        isFiniteNumber(scaleX) && isFiniteNumber(scaleY) && scaleX > 0 && scaleY > 0;
      if (!hasValidScale) {
        return null;
      }

      const x = (event.clientX - rect.left) * scaleX;
      const y = (event.clientY - rect.top) * scaleY;
      const hasValidCoords = isFiniteNumber(x) && isFiniteNumber(y);
      if (!hasValidCoords) {
        return null;
      }

      return {
        x: x,
        y: y,
      };
    }

    _projectionMaxWeekly() {
      const projectionMax = Math.min(PROJECTION_SOFT_CAP_WEEKLY, MAX_FINITE_FLOW);
      return Math.max(MIN_WEEKLY_LOG_FLOOR, projectionMax);
    }

    _clampForProjection(value) {
      const projectionMax = this._projectionMaxWeekly();
      if (Number.isNaN(value)) {
        return NaN;
      }
      if (!isFiniteNumber(value)) {
        return value > 0 ? projectionMax : MIN_WEEKLY_LOG_FLOOR;
      }
      return clamp(value, MIN_WEEKLY_LOG_FLOOR, projectionMax);
    }

    _finiteValueOrMax(value) {
      if (Number.isNaN(value)) {
        return NaN;
      }
      if (!isFiniteNumber(value)) {
        return value > 0 ? MAX_FINITE_FLOW : 0;
      }
      return clamp(value, 0, MAX_FINITE_FLOW);
    }

    /**
     * Target Y-label count based on plot height.
     */
    _targetYTickCount() {
      const plotHeight = this.chart.height - this.chart.paddingTop - this.chart.paddingBottom;
      return clamp(Math.round(plotHeight / 34), 4, 12);
    }

    /**
     * Filters projected Y ticks to avoid collisions.
     */
    _filterYTicksByGap(ticks, minGap, reservedYPositions) {
      const sorted = ticks
        .filter(function (tick) {
          return (
            isFiniteNumber(tick) && tick > 0 && tick >= this.chart.yMin && tick <= this.chart.yMax
          );
        }, this)
        .sort((a, b) => a - b);

      if (!sorted.length) {
        return [];
      }

      const keptDesc = [];
      let lastY = null;

      for (let i = sorted.length - 1; i >= 0; i -= 1) {
        const tick = sorted[i];
        const y = this._yFromValue(tick);
        if (!isFiniteNumber(y)) {
          continue;
        }

        const nearReserved = (reservedYPositions || []).some(
          (reservedY) => Math.abs(y - reservedY) < minGap
        );
        if (nearReserved) {
          continue;
        }

        if (lastY === null || Math.abs(y - lastY) >= minGap) {
          keptDesc.push(tick);
          lastY = y;
        }
      }

      const kept = keptDesc.sort((a, b) => a - b);

      if (kept.length >= 2) {
        return kept;
      }

      const fallback = [sorted[0], sorted[sorted.length - 1]].filter(
        (tick, idx, arr) => idx === 0 || Math.abs(tick - arr[idx - 1]) > 1e-9
      );

      return fallback.filter(function (tick) {
        const y = this._yFromValue(tick);
        const nearReserved = (reservedYPositions || []).some(
          (reservedY) => Math.abs(y - reservedY) < minGap
        );
        return !nearReserved;
      }, this);
    }

    _applyChartDomain(displayUnit, yMinDisplay, yMaxDisplay) {
      this.chart.yMin = this._clampForProjection(flowToWeekly(yMinDisplay, displayUnit));
      this.chart.yMax = this._clampForProjection(flowToWeekly(yMaxDisplay, displayUnit));
      if (this.chart.yMax <= this.chart.yMin) {
        this.chart.yMax = this._clampForProjection(this.chart.yMin * 1.2);
      }

      return {
        yMinDisplay: flowFromWeekly(this.chart.yMin, displayUnit),
        yMaxDisplay: flowFromWeekly(this.chart.yMax, displayUnit),
      };
    }

    _yMaxWeeklyForUnit(units) {
      const projectionMax = this._projectionMaxWeekly();
      return clamp(projectionMax, MIN_WEEKLY_LOG_FLOOR, MAX_FINITE_FLOW);
    }

    _visibleYMaxWeekly() {
      const tEndRaw = this.chart.tMax - this.chart.tMin;
      const tEnd = isFiniteNumber(tEndRaw) && tEndRaw > 0 ? tEndRaw : 0;
      let maxCandidate =
        isFiniteNumber(this.state.weeklyFixedExpenses) && this.state.weeklyFixedExpenses > 0
          ? this.state.weeklyFixedExpenses
          : 0;
      const sampleSegments = this._totalLineSegments();
      for (let i = 0; i <= sampleSegments; i += 1) {
        const t = (i / sampleSegments) * tEnd;
        const samples = [this._revenueAt(t), this._variableAt(t), this._totalAt(t)];
        maxCandidate = samples.reduce((maxValue, value) => {
          if (!isFiniteNumber(value) || value <= 0) {
            return maxValue;
          }
          return Math.max(maxValue, value);
        }, maxCandidate);
      }
      const safeCandidate = maxCandidate > 0 ? maxCandidate : MIN_WEEKLY_LOG_FLOOR;
      return this._clampForProjection(safeCandidate);
    }

    _tEndWeeks() {
      const yearsSpan = this.state.yearsMax - this.state.yearsMin;
      const safeYearsSpan = isFiniteNumber(yearsSpan) ? Math.max(0, yearsSpan) : 0;
      return safeYearsSpan * WEEKS_PER_YEAR;
    }

    _growthFactorEnd(weeklyGrowthRate, weeksEnd, maxResult) {
      if (
        !isFiniteNumber(weeklyGrowthRate) ||
        !isFiniteNumber(weeksEnd) ||
        weeksEnd < 0 ||
        weeklyGrowthRate <= -1
      ) {
        return NaN;
      }
      return safePow(1 + weeklyGrowthRate, weeksEnd, maxResult);
    }

    _revenueMaxFactor(weeklyGrowthRate) {
      const weeksEnd = this._tEndWeeks();
      const growthFactorEnd = this._growthFactorEnd(weeklyGrowthRate, weeksEnd, MAX_FINITE_FLOW);
      if (!isFiniteNumber(growthFactorEnd) || growthFactorEnd <= 0) {
        return NaN;
      }
      return Math.max(1, growthFactorEnd);
    }

    _revenueMaxOverSpan(weeklyRevenue0, weeklyGrowthRate) {
      const revenue0 = isFiniteNumber(weeklyRevenue0) ? Math.max(0, weeklyRevenue0) : NaN;
      const maxFactor = this._revenueMaxFactor(weeklyGrowthRate);
      if (!isFiniteNumber(revenue0) || !isFiniteNumber(maxFactor)) {
        return NaN;
      }
      return this._finiteValueOrMax(revenue0 * maxFactor);
    }

    _maxWeeklyRevenue0() {
      const minRevenue = 1 / WEEKS_PER_YEAR;
      const yMax = this._yMaxWeeklyForUnit(this.state.units);
      const fallbackMax = clamp(yMax, minRevenue, MAX_FINITE_FLOW);
      const maxFactor = this._revenueMaxFactor(this.state.weeklyGrowthRate);
      const variableRatio = clamp(1 - this.state.grossMargin, 0, 1);
      const fixed = clamp(this.state.weeklyFixedExpenses, 0, yMax);
      const validCore =
        isFiniteNumber(maxFactor) && maxFactor > 0 && isFiniteNumber(yMax) && yMax > 0;
      if (!validCore) {
        return fallbackMax;
      }

      const maxByRevenue = yMax / maxFactor;
      const maxByTotal =
        variableRatio > 0 ? (yMax - fixed) / (variableRatio * maxFactor) : MAX_FINITE_FLOW;
      const candidateMax = Math.min(maxByRevenue, maxByTotal);
      if (!isFiniteNumber(candidateMax)) {
        return fallbackMax;
      }
      return clamp(candidateMax, minRevenue, fallbackMax);
    }

    _maxWeeklyFixedExpenses() {
      const yMax = this._yMaxWeeklyForUnit(this.state.units);
      const fallbackMax = clamp(yMax, 0, MAX_FINITE_FLOW);
      const revenueMax = this._revenueMaxOverSpan(
        this.state.weeklyRevenue0,
        this.state.weeklyGrowthRate
      );
      const variableRatio = clamp(1 - this.state.grossMargin, 0, 1);
      if (!isFiniteNumber(yMax) || !isFiniteNumber(revenueMax)) {
        return fallbackMax;
      }
      return clamp(yMax - variableRatio * revenueMax, 0, fallbackMax);
    }

    _minGrossMargin() {
      const yMax = this._yMaxWeeklyForUnit(this.state.units);
      const revenueMax = this._revenueMaxOverSpan(
        this.state.weeklyRevenue0,
        this.state.weeklyGrowthRate
      );
      const fixed = clamp(this.state.weeklyFixedExpenses, 0, yMax);
      if (!isFiniteNumber(yMax) || !isFiniteNumber(revenueMax) || !isFiniteNumber(fixed)) {
        return 0;
      }

      const varRatioMax = revenueMax > 0 ? clamp((yMax - fixed) / revenueMax, 0, 1) : 1;
      const minGrossMargin = 1 - varRatioMax;
      if (!isFiniteNumber(minGrossMargin)) {
        return 0;
      }
      return clamp(minGrossMargin, 0, 1);
    }

    _maxWeeklyGrowthRate() {
      const weeksEnd = this._tEndWeeks();
      const yMax = this._yMaxWeeklyForUnit(this.state.units);
      const variableRatio = clamp(1 - this.state.grossMargin, 0, 1);
      const fixed = clamp(this.state.weeklyFixedExpenses, 0, yMax);
      const revenue0 = Math.max(1 / WEEKS_PER_YEAR, this.state.weeklyRevenue0);
      const hasFiniteCore =
        isFiniteNumber(yMax) && isFiniteNumber(fixed) && isFiniteNumber(revenue0) && revenue0 > 0;
      if (!hasFiniteCore) {
        return 10;
      }

      const revenueEndMax =
        variableRatio > 0 ? Math.min(yMax, (yMax - fixed) / variableRatio) : yMax;
      const growthFactorEndMax = clamp(
        revenueEndMax / revenue0,
        MIN_WEEKLY_LOG_FLOOR,
        MAX_FINITE_FLOW
      );
      const growthMax = growthFactorEndMax ** (1 / Math.max(1, weeksEnd)) - 1;
      if (!isFiniteNumber(growthMax)) {
        return 10;
      }
      return clamp(growthMax, -0.9, 10);
    }

    _normalizeStateToUnitDomain() {
      const yMax = this._yMaxWeeklyForUnit(this.state.units);

      this.state.weeklyFixedExpenses = clamp(this.state.weeklyFixedExpenses, 0, yMax);
      this.state.grossMargin = clamp(this.state.grossMargin, 0, 1);
      this.state.weeklyRevenue0 = clamp(this.state.weeklyRevenue0, 1 / WEEKS_PER_YEAR, yMax);
      this.state.weeklyGrowthRate = clamp(this.state.weeklyGrowthRate, -0.9, 10);

      for (let pass = 0; pass < 2; pass += 1) {
        const growthMax = this._maxWeeklyGrowthRate();
        this.state.weeklyGrowthRate = clamp(this.state.weeklyGrowthRate, -0.9, growthMax);

        const revenueMax = this._maxWeeklyRevenue0();
        this.state.weeklyRevenue0 = clamp(
          this.state.weeklyRevenue0,
          1 / WEEKS_PER_YEAR,
          revenueMax
        );

        const grossMin = this._minGrossMargin();
        this.state.grossMargin = clamp(this.state.grossMargin, grossMin, 1);

        const fixedMax = this._maxWeeklyFixedExpenses();
        this.state.weeklyFixedExpenses = clamp(this.state.weeklyFixedExpenses, 0, fixedMax);
      }
    }

    _domainTicksWeekly(displayUnit, baselineDisplayTicks, normalizedDomain) {
      const ticksDisplay = extendBaselineOneThreeTicks(
        baselineDisplayTicks,
        normalizedDomain.yMaxDisplay
      );
      const ticksWeekly = ticksDisplay
        .filter(
          (tick) =>
            isFiniteNumber(tick) &&
            tick >= normalizedDomain.yMinDisplay * 0.99 &&
            tick <= normalizedDomain.yMaxDisplay * 1.01
        )
        .map((tick) => flowToWeekly(tick, displayUnit));

      const filteredTicks = this._filterYTicksByGap(ticksWeekly, MIN_Y_TICK_GAP, [
        this.chart.height - this.chart.paddingBottom,
        this.chart.paddingTop + AXIS_LABEL_TOP_CLEARANCE,
      ]);

      if (filteredTicks.length) {
        return filteredTicks;
      }

      const safeMinDisplay =
        isFiniteNumber(normalizedDomain.yMinDisplay) && normalizedDomain.yMinDisplay > 0
          ? normalizedDomain.yMinDisplay
          : 1;
      const safeMaxDisplay =
        isFiniteNumber(normalizedDomain.yMaxDisplay) &&
        normalizedDomain.yMaxDisplay > safeMinDisplay
          ? normalizedDomain.yMaxDisplay
          : safeMinDisplay * 10;
      const midDisplay = Math.sqrt(safeMinDisplay * safeMaxDisplay);
      return [flowToWeekly(clamp(midDisplay, safeMinDisplay, safeMaxDisplay), displayUnit)];
    }

    _setDomainTicks(displayUnit, baselineDisplayTicks, normalizedDomain) {
      this.chart.ticksY = this._domainTicksWeekly(
        displayUnit,
        baselineDisplayTicks,
        normalizedDomain
      );
    }

    /**
     * Revenue in weekly core at time t (years from start).
     */
    _revenueAt(tYearsFromStart) {
      const weeks = tYearsFromStart * WEEKS_PER_YEAR;
      const growthBase = 1 + this.state.weeklyGrowthRate;
      const maxMultiplier =
        MAX_FINITE_FLOW / Math.max(this.state.weeklyRevenue0, MIN_WEEKLY_LOG_FLOOR);
      const growthFactor = safePow(growthBase, weeks, Math.max(1, maxMultiplier));
      return this._finiteValueOrMax(this.state.weeklyRevenue0 * growthFactor);
    }

    /**
     * Variable expenses = Revenue * (1 - Gross margin).
     */
    _variableAt(tYearsFromStart) {
      const revenue = this._revenueAt(tYearsFromStart);
      if (!isFiniteNumber(revenue)) {
        return NaN;
      }
      return this._finiteValueOrMax(revenue * (1 - this.state.grossMargin));
    }

    /**
     * Total expenses = Variable + Fixed.
     */
    _totalAt(tYearsFromStart) {
      const variable = this._variableAt(tYearsFromStart);
      const fixed = this._finiteValueOrMax(this.state.weeklyFixedExpenses);
      if (!isFiniteNumber(variable)) {
        return fixed;
      }
      return this._finiteValueOrMax(variable + fixed);
    }

    /**
     * Computes key metrics: breakeven and time to $1B annual revenue.
     */
    _computeMetrics() {
      const contributionPct = this.state.grossMargin;
      const rev0 = this.state.weeklyRevenue0;
      const fixed = this.state.weeklyFixedExpenses;
      const growth = this.state.weeklyGrowthRate;

      let breakevenYears = null;

      // If initial contribution already covers fixed costs, breakeven is immediate.
      if (contributionPct > 0 && rev0 * contributionPct >= fixed) {
        breakevenYears = 0;
      }

      const canSolveBreakeven =
        breakevenYears === null && contributionPct > 0 && growth > 0 && rev0 > 0 && fixed > 0;
      if (canSolveBreakeven) {
        // Solve the intersection analytically.
        const numerator = Math.log(fixed / (rev0 * contributionPct));
        const denominator = Math.log(1 + growth);
        const solvedWeeks = numerator / denominator;
        const hasSolvedBreakeven = isFiniteNumber(solvedWeeks) && solvedWeeks >= 0;
        breakevenYears = hasSolvedBreakeven ? solvedWeeks / WEEKS_PER_YEAR : breakevenYears;
      }

      let billionYears = null;
      // "$1B/y" target in weekly core units.
      const weeklyBillionTarget = 1e9 / WEEKS_PER_YEAR;
      if (rev0 >= weeklyBillionTarget) {
        billionYears = 0;
      }

      const canSolveBillion = billionYears === null && growth > 0 && rev0 > 0;
      if (canSolveBillion) {
        const solvedBillionWeeks = Math.log(weeklyBillionTarget / rev0) / Math.log(1 + growth);
        const hasSolvedBillion = isFiniteNumber(solvedBillionWeeks) && solvedBillionWeeks >= 0;
        billionYears = hasSolvedBillion ? solvedBillionWeeks / WEEKS_PER_YEAR : billionYears;
      }

      return {
        breakevenYears: breakevenYears,
        billionYears: billionYears,
      };
    }

    /**
     * Formats time for KPI blocks.
     * Requirement: always in years regardless of selected units.
     */
    _formatTime(yearsValue) {
      if (!isFiniteNumber(yearsValue)) {
        return 'never';
      }

      return 'year ' + yearsValue.toFixed(yearsValue < 10 ? 1 : 0);
    }

    /**
     * Syncs input values with current state.
     */
    _updateInputs() {
      this.nodes.inputRevenue.value = formatInputMoney(
        flowFromWeekly(this.state.weeklyRevenue0, this.state.units)
      );
      this.nodes.inputGrossMargin.value = formatInputPercent(this.state.grossMargin);
      this.nodes.inputFixed.value = formatInputMoney(
        flowFromWeekly(this.state.weeklyFixedExpenses, this.state.units)
      );

      // Show growth input in the user-selected unit.
      const displayGrowth = growthFromWeekly(this.state.weeklyGrowthRate, this.state.units);
      this.nodes.inputGrowth.value = formatInputPercent(displayGrowth);

      this.nodes.radios
        .querySelectorAll('input[type="radio"][data-group="units"]')
        .forEach(function (radio) {
          radio.checked = radio.value === this.state.units;
        }, this);

      this.nodes.radios
        .querySelectorAll('input[type="radio"][data-group="expenseViz"]')
        .forEach(function (radio) {
          radio.checked = radio.value === this.state.expenseViz;
        }, this);
    }

    /**
     * Updates log-scale Y domain and ticks for the active unit.
     */
    _updateYDomain() {
      if (this._applyDragDomainLock()) {
        return;
      }

      const displayUnit = this.state.units;
      const baselineDisplayTicks = Y_TICKS_BY_UNIT[displayUnit] || Y_TICKS_BY_UNIT.year || [];
      const yMinDisplay = MIN_DISPLAY_Y_FLOOR_BY_UNIT[displayUnit] || 1;
      const yMaxDisplayRaw = flowFromWeekly(this._visibleYMaxWeekly(), displayUnit);
      const yMaxDisplayHeadroom =
        isFiniteNumber(yMaxDisplayRaw) && yMaxDisplayRaw > 0
          ? yMaxDisplayRaw * 1.15
          : yMinDisplay * 1.2;
      const yMaxDisplaySnapped = snapUpOneThree(yMaxDisplayHeadroom);
      const yMaxDisplay = Math.max(yMinDisplay * 1.2, yMaxDisplaySnapped);
      const normalizedDomain = this._applyChartDomain(displayUnit, yMinDisplay, yMaxDisplay);
      this._setDomainTicks(displayUnit, baselineDisplayTicks, normalizedDomain);
    }

    /**
     * Projects time t (in years) to SVG X coordinate.
     */
    _xFromTime(tYearsFromStart) {
      const plotWidth = this.chart.width - this.chart.paddingLeft - this.chart.paddingRight;
      const totalSpan = this.chart.tMax - this.chart.tMin;
      return this.chart.paddingLeft + (tYearsFromStart / totalSpan) * plotWidth;
    }

    /**
     * Inverse projection from X coordinate to time t (years).
     */
    _xToTime(x) {
      const plotWidth = this.chart.width - this.chart.paddingLeft - this.chart.paddingRight;
      const clamped = clamp(x, this.chart.paddingLeft, this.chart.width - this.chart.paddingRight);
      const ratio = (clamped - this.chart.paddingLeft) / plotWidth;
      const totalSpan = this.chart.tMax - this.chart.tMin;
      return ratio * totalSpan;
    }

    /**
     * Projects a value to log-scale Y.
     */
    _yFromValue(value) {
      const projectionValue = this._clampForProjection(value);
      const safeValue = isFiniteNumber(projectionValue)
        ? clamp(projectionValue, this.chart.yMin, this.chart.yMax)
        : this.chart.yMin;
      const lnMin = Math.log(this.chart.yMin);
      const lnMax = Math.log(this.chart.yMax);
      const lnValue = Math.log(safeValue);
      const ratio = (lnValue - lnMin) / (lnMax - lnMin || 1);

      const plotHeight = this.chart.height - this.chart.paddingTop - this.chart.paddingBottom;
      return this.chart.height - this.chart.paddingBottom - ratio * plotHeight;
    }

    /**
     * Inverse projection from Y coordinate to flow value (log scale).
     */
    _yToValue(y) {
      const plotHeight = this.chart.height - this.chart.paddingTop - this.chart.paddingBottom;
      const clamped = clamp(y, this.chart.paddingTop, this.chart.height - this.chart.paddingBottom);
      const ratio = (this.chart.height - this.chart.paddingBottom - clamped) / plotHeight;
      const lnMin = Math.log(this.chart.yMin);
      const lnMax = Math.log(this.chart.yMax);
      return Math.exp(lnMin + ratio * (lnMax - lnMin));
    }

    _expenseBarTimes() {
      const span = this.chart.tMax - this.chart.tMin;
      if (!isFiniteNumber(span) || span < 0) {
        return [];
      }

      const yearsSpan = Math.max(0, Math.round(span));
      const times = [];
      for (let yearOffset = 0; yearOffset <= yearsSpan; yearOffset += 1) {
        times.push(yearOffset);
      }
      return times;
    }

    _yFromValueOrZero(value, plotBottomY) {
      const shouldUseBaseline = !isFiniteNumber(value) || value <= 0;
      if (shouldUseBaseline) {
        return plotBottomY;
      }
      return this._yFromValue(value);
    }

    _valueFromYOrZero(y, plotBottomY) {
      const hasFiniteInputs = isFiniteNumber(y) && isFiniteNumber(plotBottomY);
      if (!hasFiniteInputs) {
        return NaN;
      }

      // plotBottomY is the visual "$0" baseline for the log plot.
      if (y >= plotBottomY - 0.01) {
        return 0;
      }

      return this._finiteValueOrMax(this._yToValue(y));
    }

    _appendExpenseBarSegmentLabel(group, textValue, x, y, fillColor) {
      const hasTarget = group && textValue && isFiniteNumber(x) && isFiniteNumber(y);
      if (!hasTarget) {
        return;
      }

      const label = createSvgEl('text');
      const labelFill = fillColor || COLORS.black;
      label.textContent = textValue;
      setAttrs(label, {
        x: x,
        y: y,
        fill: labelFill,
        'font-size': 10,
        'font-weight': 700,
        'text-anchor': 'middle',
        'paint-order': 'stroke',
        stroke: COLORS.white,
        'stroke-width': 3,
        'stroke-linejoin': 'round',
        'pointer-events': 'none',
      });
      group.appendChild(label);
    }

    _drawExpenseBars(barGroup, labelGroup, plotBottomY, yearSpacing) {
      const hasTarget = barGroup && labelGroup && isFiniteNumber(plotBottomY);
      if (!hasTarget) {
        return;
      }

      const sampleTimes = this._expenseBarTimes();
      if (!sampleTimes.length) {
        return;
      }

      const span = this.chart.tMax - this.chart.tMin;
      if (!isFiniteNumber(span) || span <= 0) {
        return;
      }

      const yVariableStart = this._yFromValueOrZero(this._variableAt(0), plotBottomY);
      const yVariableEnd = this._yFromValueOrZero(this._variableAt(span), plotBottomY);
      const yTotalStart = this._yFromValueOrZero(this._totalAt(0), plotBottomY);
      const yTotalEnd = this._yFromValueOrZero(this._totalAt(span), plotBottomY);

      const spacing = isFiniteNumber(yearSpacing) ? yearSpacing : 18;
      const barWidth = clamp(spacing * 0.55, 10, 28);
      const yearsSpan = isFiniteNumber(span) && span >= 0 ? Math.max(0, Math.round(span)) : 0;
      const labelStep = Math.max(1, Math.ceil(44 / Math.max(1, spacing)));

      sampleTimes.forEach(function (tYearsFromStart) {
        const ratio = clamp(tYearsFromStart / span, 0, 1);
        const yVariableTop = yVariableStart + ratio * (yVariableEnd - yVariableStart);
        let yTotalTop = yTotalStart + ratio * (yTotalEnd - yTotalStart);
        yTotalTop = Math.min(yTotalTop, yVariableTop);

        const x = this._xFromTime(tYearsFromStart);
        const xLeft = clamp(
          x - barWidth / 2,
          this.chart.paddingLeft,
          this.chart.width - this.chart.paddingRight - barWidth
        );

        const variableTopY = Math.min(plotBottomY, yVariableTop);
        const variableHeight = Math.max(0, Math.abs(plotBottomY - yVariableTop));
        const fixedTopY = Math.min(yVariableTop, yTotalTop);
        const fixedHeight = Math.max(0, Math.abs(yVariableTop - yTotalTop));

        const variableRect = createSvgEl('rect');
        setAttrs(variableRect, {
          x: xLeft,
          y: variableTopY,
          width: barWidth,
          height: variableHeight,
          fill: COLORS.variableLight,
          opacity: EXPENSE_SERIES_OPACITY,
          'pointer-events': 'none',
        });
        barGroup.appendChild(variableRect);

        const fixedRect = createSvgEl('rect');
        setAttrs(fixedRect, {
          x: xLeft,
          y: fixedTopY,
          width: barWidth,
          height: fixedHeight,
          fill: COLORS.fixedLight,
          opacity: EXPENSE_SERIES_OPACITY,
          'pointer-events': 'none',
        });
        barGroup.appendChild(fixedRect);

        const shouldLabelThisBar =
          tYearsFromStart % labelStep === 0 ||
          tYearsFromStart === 0 ||
          tYearsFromStart === yearsSpan;
        if (!shouldLabelThisBar) {
          return;
        }

        const variableWeekly = this._valueFromYOrZero(yVariableTop, plotBottomY);
        const totalWeekly = this._valueFromYOrZero(yTotalTop, plotBottomY);
        const remainderWeekly =
          isFiniteNumber(totalWeekly) && isFiniteNumber(variableWeekly)
            ? Math.max(0, totalWeekly - variableWeekly)
            : NaN;

        const variableLabelText =
          variableHeight >= MIN_BAR_LABEL_SEGMENT_HEIGHT
            ? formatBarMoneyFromWeekly(variableWeekly, this.state.units)
            : '';
        const fixedLabelText =
          fixedHeight >= MIN_BAR_LABEL_SEGMENT_HEIGHT
            ? formatBarMoneyFromWeekly(remainderWeekly, this.state.units)
            : '';

        if (variableLabelText) {
          const variableBottomY = variableTopY + variableHeight;
          const variableLabelY = clamp(plotBottomY - 6, variableTopY + 10, variableBottomY - 4);
          this._appendExpenseBarSegmentLabel(
            labelGroup,
            variableLabelText,
            xLeft + barWidth / 2,
            variableLabelY,
            COLORS.variable
          );
        }

        if (!fixedLabelText) {
          return;
        }

        const fixedBottomY = fixedTopY + fixedHeight;
        const fixedLabelY = clamp(
          fixedTopY + fixedHeight / 2 + 4,
          fixedTopY + 10,
          fixedBottomY - 4
        );
        this._appendExpenseBarSegmentLabel(
          labelGroup,
          fixedLabelText,
          xLeft + barWidth / 2,
          fixedLabelY,
          COLORS.total
        );
      }, this);
    }

    /**
     * Generates a sampled polyline path for value-over-time functions.
     */
    _linePath(fn, segments, anchorTimes) {
      const points = [];
      const sampleSegments = clamp(
        Math.round(isFiniteNumber(segments) ? segments : this._totalLineSegments()),
        2,
        MAX_TOTAL_LINE_SEGMENTS
      );
      const tSpanRaw = this.chart.tMax - this.chart.tMin;
      const tSpan = isFiniteNumber(tSpanRaw) && tSpanRaw > 0 ? tSpanRaw : 0;
      const sampledTimes = [];
      for (let i = 0; i <= sampleSegments; i += 1) {
        sampledTimes.push((i / sampleSegments) * tSpan);
      }

      const extraAnchors = Array.isArray(anchorTimes) ? anchorTimes : [];
      extraAnchors.forEach((anchorTime) => {
        if (!isFiniteNumber(anchorTime)) {
          return;
        }
        sampledTimes.push(clamp(anchorTime, 0, tSpan));
      });

      const uniqueTimes = sampledTimes
        .sort((a, b) => a - b)
        .filter((value, idx, arr) => idx === 0 || Math.abs(value - arr[idx - 1]) > 1e-9);

      uniqueTimes.forEach(function (t) {
        points.push(this._xFromTime(t) + ',' + this._yFromValue(fn.call(this, t)));
      }, this);

      return points.join(' ');
    }

    _lineSegmentPath(fn) {
      const tStart = 0;
      const tEnd = this.chart.tMax - this.chart.tMin;
      const startPoint = this._xFromTime(tStart) + ',' + this._yFromValue(fn.call(this, tStart));
      const endPoint = this._xFromTime(tEnd) + ',' + this._yFromValue(fn.call(this, tEnd));
      return startPoint + ' ' + endPoint;
    }

    _totalLineSegments() {
      const plotWidth = this.chart.width - this.chart.paddingLeft - this.chart.paddingRight;
      return clamp(
        Math.round(plotWidth / TOTAL_LINE_PIXELS_PER_SEGMENT),
        MIN_TOTAL_LINE_SEGMENTS,
        MAX_TOTAL_LINE_SEGMENTS
      );
    }

    _formatSeriesEndLabel(title, endWeekly) {
      const displayValue = flowFromWeekly(endWeekly, this.state.units);
      const hasValidDisplayValue = isFiniteNumber(displayValue) && displayValue >= 0;
      if (!hasValidDisplayValue) {
        return '';
      }
      const valueText = formatMoney(displayValue);
      return title + ' ' + valueText;
    }

    _rightLineLabelCandidates(tEnd) {
      const isBarsMode = this.state.expenseViz === 'bars';
      const revenueEndWeekly = this._revenueAt(tEnd);
      const variableEndWeekly = this._variableAt(tEnd);
      const fixedEndWeekly = this.state.weeklyFixedExpenses;
      const totalEndWeekly = this._totalAt(tEnd);

      const candidates = [
        {
          key: 'revenue',
          title: 'Revenue',
          endWeekly: revenueEndWeekly,
          color: COLORS.revenue,
          column: 'outside',
          targetY: this._yFromValue(revenueEndWeekly),
          dy: 4,
        },
        {
          key: 'total',
          title: 'Total expenses',
          endWeekly: totalEndWeekly,
          color: COLORS.total,
          column: 'outside',
          targetY: this._yFromValue(totalEndWeekly),
          dy: -6,
        },
        {
          key: 'fixed',
          title: 'Fixed expenses',
          endWeekly: fixedEndWeekly,
          color: COLORS.darkGrey,
          column: 'inside',
          targetY: this._yFromValue(fixedEndWeekly),
          dy: -4,
        },
        {
          key: 'variable',
          title: 'Variable expenses',
          endWeekly: variableEndWeekly,
          color: COLORS.variable,
          column: 'inside',
          targetY: this._yFromValue(variableEndWeekly),
          dy: 10,
        },
      ];

      return candidates
        .filter((candidate) => {
          const isSeriesVisible = !isBarsMode || candidate.key !== 'fixed';
          return (
            isSeriesVisible &&
            isFiniteNumber(candidate.endWeekly) &&
            candidate.endWeekly >= 0 &&
            isFiniteNumber(candidate.targetY)
          );
        })
        .map(function (candidate) {
          return {
            key: candidate.key,
            text: this._formatSeriesEndLabel(candidate.title, candidate.endWeekly),
            color: candidate.color,
            column: candidate.column,
            targetY: candidate.targetY,
            dy: candidate.dy,
          };
        }, this)
        .filter((candidate) => Boolean(candidate.text));
    }

    _layoutLineLabelsY(candidates, minY, maxY, minGap) {
      if (!candidates.length) {
        return [];
      }

      const sorted = candidates
        .slice()
        .sort((a, b) => a.targetY - b.targetY)
        .map((candidate) => {
          const idealY = clamp(candidate.targetY + (candidate.dy || 0), minY, maxY);
          const leaderStartY = clamp(candidate.targetY, minY, maxY);
          return {
            key: candidate.key,
            text: candidate.text,
            color: candidate.color,
            column: candidate.column,
            targetY: candidate.targetY,
            idealY: idealY,
            leaderStartY: leaderStartY,
            y: idealY,
          };
        });

      const range = Math.max(0, maxY - minY);
      const effectiveGap = sorted.length < 2 ? 0 : Math.min(minGap, range / (sorted.length - 1));

      sorted.forEach((item, index) => {
        if (index === 0) {
          return;
        }
        item.y = Math.max(item.y, sorted[index - 1].y + effectiveGap);
      });

      for (let i = sorted.length - 2; i >= 0; i -= 1) {
        sorted[i].y = Math.min(sorted[i].y, sorted[i + 1].y - effectiveGap);
      }

      sorted.forEach((item) => {
        item.y = clamp(item.y, minY, maxY);
      });

      return sorted;
    }

    _layoutRightLineLabels(candidates, minY, maxY, minGap) {
      return this._layoutLineLabelsY(candidates, minY, maxY, minGap);
    }

    _positionRightLineLabels(labels, plotRightX) {
      const outsideX = this.chart.width - 8;
      const insideX =
        plotRightX - (HANDLE_RECT_VISUAL_WIDTH / 2 + RIGHT_LABEL_INSIDE_PADDING_FROM_HANDLE);

      return labels.map((item) => {
        const isInside = item.column === 'inside';
        return Object.assign({}, item, {
          x: isInside ? insideX : outsideX,
          anchor: 'end',
        });
      });
    }

    _renderRightLineLabels(group, labels, leaderStartX) {
      labels.forEach(function (item) {
        const x = isFiniteNumber(item.x) ? item.x : this.chart.width - 8;
        const anchor = item.anchor === 'start' ? 'start' : 'end';
        const hasDisplacement = Math.abs(item.y - item.idealY) > 1;
        if (hasDisplacement) {
          const leaderEndX = anchor === 'end' ? x + 2 : x - 2;
          const leader = createSvgEl('line');
          setAttrs(leader, {
            x1: leaderStartX,
            y1: item.leaderStartY,
            x2: leaderEndX,
            y2: item.y,
            stroke: item.color,
            'stroke-width': 1,
            opacity: 0.35,
          });
          group.appendChild(leader);
        }

        const text = createSvgEl('text');
        text.textContent = item.text;
        setAttrs(text, {
          x: x,
          y: item.y,
          fill: item.color,
          'font-size': 10,
          'font-weight': 700,
          'text-anchor': anchor,
          'paint-order': 'stroke',
          stroke: COLORS.white,
          'stroke-width': 3,
          'stroke-linejoin': 'round',
        });
        group.appendChild(text);
      }, this);
    }

    _handleLabelText(handle) {
      if (handle === 'growth') {
        const unitToken = UNIT_TOKEN_BY_ID[this.state.units] || 'Growth';
        const displayGrowth = growthFromWeekly(this.state.weeklyGrowthRate, this.state.units);
        const growthText = formatInputPercent(displayGrowth);
        return growthText + ' ' + unitToken;
      }

      if (handle === 'variable') {
        const tEndYears = this.state.yearsMax - this.state.yearsMin;
        const variableEndText = this._formatSeriesEndLabel(
          'Variable expenses',
          this._variableAt(tEndYears)
        );
        const grossMarginText = 'Gross margin ' + formatInputPercent(this.state.grossMargin);
        if (!variableEndText) {
          return grossMarginText;
        }
        return grossMarginText + ', ' + variableEndText;
      }

      if (handle === 'fixed') {
        const fixedDisplayValue = flowFromWeekly(this.state.weeklyFixedExpenses, this.state.units);
        return formatMoney(fixedDisplayValue) + ' Fixed Expenses';
      }

      return '';
    }

    _handleLabelColor(handle) {
      if (handle === 'growth') {
        return COLORS.revenue;
      }
      if (handle === 'variable') {
        return COLORS.variable;
      }
      if (handle === 'fixed') {
        return COLORS.fixed;
      }
      return COLORS.black;
    }

    _handleLabelLayout(handle, point, bounds) {
      const layout = {
        x: point.x,
        y: point.y,
        anchor: 'middle',
      };

      if (handle === 'growth') {
        layout.y = point.y - 14;
      }

      const isExpenseHandle = handle === 'fixed' || handle === 'variable';
      if (isExpenseHandle) {
        const leftOffsetX = point.x - 12;
        const flipToRight = leftOffsetX < bounds.minX + 24;
        const yOffset = handle === 'variable' ? 14 : -8;
        layout.x = flipToRight ? point.x + 12 : leftOffsetX;
        layout.y = point.y + yOffset;
        layout.anchor = flipToRight ? 'start' : 'end';
      }

      layout.x = clamp(layout.x, bounds.minX, bounds.maxX);
      layout.y = clamp(layout.y, bounds.minY, bounds.maxY);
      return layout;
    }

    _renderActiveHandleLabel(group, activeHandle, handlePoints, bounds) {
      const isSupportedHandle =
        activeHandle === 'growth' || activeHandle === 'variable' || activeHandle === 'fixed';
      if (!isSupportedHandle) {
        return;
      }

      const point = handlePoints[activeHandle];
      if (!point) {
        return;
      }

      const textValue = this._handleLabelText(activeHandle);
      if (!textValue) {
        return;
      }

      const layout = this._handleLabelLayout(activeHandle, point, bounds);
      const label = createSvgEl('text');
      label.textContent = textValue;
      setAttrs(label, {
        x: layout.x,
        y: layout.y,
        fill: this._handleLabelColor(activeHandle),
        'font-size': 10,
        'font-weight': 700,
        'text-anchor': layout.anchor,
        'paint-order': 'stroke',
        stroke: COLORS.white,
        'stroke-width': 3,
        'stroke-linejoin': 'round',
        'pointer-events': 'none',
      });
      group.appendChild(label);
    }

    /**
     * Full SVG render: grid, axes, lines, labels, markers, and handles.
     */
    _draw(metrics) {
      const gGrid = this.nodes.svgGroups.grid;
      const gAxes = this.nodes.svgGroups.axes;
      const gLines = this.nodes.svgGroups.lines;
      const gLabels = this.nodes.svgGroups.labels;
      const gHandles = this.nodes.svgGroups.handles;
      // Metrics contract: object => use for metric-dependent draw parts, null/undefined => skip them.
      const drawMetrics = metrics;

      gGrid.innerHTML = '';
      gAxes.innerHTML = '';
      gLines.innerHTML = '';
      gLabels.innerHTML = '';
      gHandles.innerHTML = '';

      const self = this;
      const plotRightX = this.chart.width - this.chart.paddingRight;
      const plotTopY = this.chart.paddingTop;
      const plotBottomY = this.chart.height - this.chart.paddingBottom;
      const gHover = createSvgEl('g');
      setAttrs(gHover, {
        'pointer-events': 'none',
      });

      this.chart.ticksY.forEach((tick) => {
        const y = self._yFromValue(tick);

        const line = createSvgEl('line');
        setAttrs(line, {
          x1: self.chart.paddingLeft,
          y1: y,
          x2: self.chart.width - self.chart.paddingRight,
          y2: y,
          stroke: COLORS.grid,
          'stroke-width': 1,
        });
        gGrid.appendChild(line);

        const label = createSvgEl('text');
        label.textContent = formatMoney(flowFromWeekly(tick, self.state.units));
        setAttrs(label, {
          x: self.chart.paddingLeft - 10,
          y: y + 4,
          fill: COLORS.black,
          'font-size': 10,
          'font-weight': 500,
          'text-anchor': 'end',
        });
        gAxes.appendChild(label);
      });

      // Visual "$0" baseline (excluded from log-domain calculations).
      const yZero = plotBottomY;
      const zeroLabel = createSvgEl('text');
      zeroLabel.textContent = '$0';
      setAttrs(zeroLabel, {
        x: this.chart.paddingLeft - 10,
        y: yZero + 4,
        fill: COLORS.black,
        'font-size': 10,
        'font-weight': 500,
        'text-anchor': 'end',
      });
      gAxes.appendChild(zeroLabel);

      const totalYearSpan = this.chart.tMax - this.chart.tMin;
      const plotWidth = this.chart.width - this.chart.paddingLeft - this.chart.paddingRight;
      const yearSpacing = plotWidth / Math.max(1, totalYearSpan);
      const yearLabelStep = Math.max(1, Math.ceil(MIN_X_YEAR_LABEL_GAP / Math.max(1, yearSpacing)));

      for (let year = this.chart.tMin; year <= this.chart.tMax; year += 1) {
        const t = year - this.chart.tMin;
        const x = this._xFromTime(t);

        const vLine = createSvgEl('line');
        setAttrs(vLine, {
          x1: x,
          y1: this.chart.paddingTop,
          x2: x,
          y2: plotBottomY,
          stroke: COLORS.grid,
          'stroke-width': 1,
        });
        gGrid.appendChild(vLine);

        const shouldShowYearLabel = t % yearLabelStep === 0 || year === this.chart.tMax;
        if (!shouldShowYearLabel) {
          continue;
        }

        const xTick = createSvgEl('text');
        xTick.textContent = String(year);
        setAttrs(xTick, {
          x: x,
          y: plotBottomY + 18,
          fill: COLORS.black,
          'font-size': 10,
          'font-weight': 500,
          'text-anchor': 'middle',
        });
        gAxes.appendChild(xTick);
      }

      const axisRevenueExpense = createSvgEl('text');
      axisRevenueExpense.textContent = 'Revenue/Expense';
      setAttrs(axisRevenueExpense, {
        x: this.chart.paddingLeft + 8,
        y: 14,
        fill: COLORS.black,
        'font-size': 10,
        'font-weight': 700,
        'text-anchor': 'start',
      });
      gAxes.appendChild(axisRevenueExpense);

      const axisYears = createSvgEl('text');
      axisYears.textContent = 'Years';
      setAttrs(axisYears, {
        x: this.chart.width - this.chart.paddingRight,
        y: this.chart.height - 8,
        fill: COLORS.black,
        'font-size': 10,
        'font-weight': 700,
        'text-anchor': 'end',
      });
      gAxes.appendChild(axisYears);

      /**
       * Draws a line and a wide invisible hit layer for stable tooltips.
       */
      function addLine(config) {
        const points = config.points;
        const stroke = config.stroke;
        const width = config.width;
        const hasHoverValue = typeof config.hoverValueAt === 'function';
        const titleText = hasHoverValue ? '' : config.title;
        const shouldDrawVisible = config.showVisible !== false;
        if (shouldDrawVisible) {
          const visible = createSvgEl('polyline');
          setAttrs(visible, {
            fill: 'none',
            points: points,
            stroke: stroke,
            'stroke-width': width,
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round',
            opacity: config.strokeOpacity == null ? 1 : config.strokeOpacity,
            'pointer-events': 'none',
          });
          config.dasharray && visible.setAttribute('stroke-dasharray', String(config.dasharray));
          gLines.appendChild(visible);
        }

        // Keep hit stroke solid/wide so line hover remains easy.
        const hit = createSvgEl('polyline');
        setAttrs(hit, {
          fill: 'none',
          points: points,
          stroke: 'rgba(0,0,0,0.001)',
          'stroke-width': Math.max(14, width + 8),
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
          'pointer-events': 'stroke',
          style: 'cursor:help',
        });

        if (titleText) {
          const title = createSvgEl('title');
          title.textContent = titleText;
          hit.appendChild(title);
        }

        if (hasHoverValue) {
          function clearHover() {
            gHover.innerHTML = '';
          }

          hit.addEventListener('pointerleave', clearHover);
          hit.addEventListener('pointercancel', clearHover);

          hit.addEventListener('pointermove', (event) => {
            const coords = self._eventToChart(event);
            if (!coords) {
              return;
            }

            const tEnd = self.chart.tMax - self.chart.tMin;
            const tRaw = self._xToTime(coords.x);
            const t = isFiniteNumber(tRaw) ? clamp(tRaw, 0, tEnd) : 0;
            const weeklyValue = config.hoverValueAt.call(self, t);
            if (!isFiniteNumber(weeklyValue) || weeklyValue < 0) {
              clearHover();
              return;
            }

            const displayValue = flowFromWeekly(weeklyValue, self.state.units);
            if (!isFiniteNumber(displayValue) || displayValue < 0) {
              clearHover();
              return;
            }

            const x = self._xFromTime(t);
            const y = self._yFromValue(weeklyValue);
            const textValue = formatMoney(displayValue);
            const textLabel = (config.hoverPrefix || '') + textValue;
            if (!textLabel) {
              clearHover();
              return;
            }

            let tooltipX = x + 10;
            let anchor = 'start';
            if (tooltipX > plotRightX - 8) {
              tooltipX = x - 10;
              anchor = 'end';
            }
            const tooltipY = clamp(y - 10, plotTopY + 14, plotBottomY - 6);

            gHover.innerHTML = '';
            const dot = createSvgEl('circle');
            setAttrs(dot, {
              cx: x,
              cy: y,
              r: 3.5,
              fill: COLORS.white,
              stroke: config.hoverColor || COLORS.black,
              'stroke-width': 2,
            });
            gHover.appendChild(dot);

            const text = createSvgEl('text');
            text.textContent = textLabel;
            setAttrs(text, {
              x: tooltipX,
              y: tooltipY,
              fill: config.hoverColor || COLORS.black,
              'font-size': 10,
              'font-weight': 700,
              'text-anchor': anchor,
              'paint-order': 'stroke',
              stroke: COLORS.white,
              'stroke-width': 3,
              'stroke-linejoin': 'round',
            });
            gHover.appendChild(text);
          });
        }

        gLines.appendChild(hit);
      }

      const tEnd = this.chart.tMax - this.chart.tMin;
      const isBarsMode = this.state.expenseViz === 'bars';
      const lineSegments = this._totalLineSegments();
      const lineAnchorTimes = [];
      const hasBreakevenInRange =
        drawMetrics &&
        isFiniteNumber(drawMetrics.breakevenYears) &&
        drawMetrics.breakevenYears >= 0 &&
        drawMetrics.breakevenYears <= tEnd;
      if (hasBreakevenInRange) {
        lineAnchorTimes.push(drawMetrics.breakevenYears);
      }
      if (isBarsMode) {
        this._drawExpenseBars(gLines, gLabels, plotBottomY, yearSpacing);
      }

      addLine({
        points: this._linePath(this._revenueAt, lineSegments, lineAnchorTimes),
        stroke: COLORS.revenue,
        width: 3,
        title: 'Revenue',
        hoverPrefix: 'Revenue ',
        hoverColor: COLORS.revenue,
        hoverValueAt: this._revenueAt,
        strokeOpacity: 1,
      });
      addLine({
        points: this._linePath(this._variableAt, lineSegments, lineAnchorTimes),
        stroke: COLORS.variableLight,
        width: 2.5,
        title: 'Variable expenses',
        dasharray: EXPENSE_SERIES_DASHARRAY,
        strokeOpacity: EXPENSE_SERIES_OPACITY,
        showVisible: !isBarsMode,
      });
      if (!isBarsMode) {
        addLine({
          points: this._lineSegmentPath(function () {
            return this.state.weeklyFixedExpenses;
          }),
          stroke: COLORS.fixed,
          width: 2.5,
          title: 'Fixed expenses',
          dasharray: EXPENSE_SERIES_DASHARRAY,
          strokeOpacity: EXPENSE_SERIES_OPACITY,
          showVisible: true,
        });
      }
      addLine({
        points: this._linePath(this._totalAt, lineSegments, lineAnchorTimes),
        stroke: COLORS.total,
        width: 3.5,
        title: 'Total expenses',
        strokeOpacity: 1,
      });

      const activeHandle = this.drag && this.drag.handle ? this.drag.handle : '';
      const labelMinY = plotTopY + AXIS_LABEL_TOP_CLEARANCE;
      const labelMaxY = plotBottomY - 2;

      const rightLabelCandidates = this._rightLineLabelCandidates(tEnd).filter((candidate) => {
        const isSuppressed =
          (activeHandle === 'fixed' && candidate.key === 'fixed') ||
          (activeHandle === 'variable' && candidate.key === 'variable');
        return !isSuppressed;
      });

      // Layout all right-edge labels together so inside/outside columns don't collide when values align.
      const laidOutRightLabels = this._layoutRightLineLabels(
        rightLabelCandidates,
        labelMinY,
        labelMaxY,
        RIGHT_LINE_LABEL_MIN_GAP
      );
      const positionedRightLabels = this._positionRightLineLabels(laidOutRightLabels, plotRightX);
      const rightLabelLeaderStartX = plotRightX - 1;
      this._renderRightLineLabels(gLabels, positionedRightLabels, rightLabelLeaderStartX);

      if (hasBreakevenInRange) {
        const bx = this._xFromTime(drawMetrics.breakevenYears);
        const by = this._yFromValue(this._totalAt(drawMetrics.breakevenYears));

        const marker = createSvgEl('circle');
        setAttrs(marker, {
          cx: bx,
          cy: by,
          r: 4,
          fill: COLORS.white,
          stroke: COLORS.total,
          'stroke-width': 2,
        });
        gLabels.appendChild(marker);
      }

      /**
       * Rectangular drag handle (revenue/fixed/variable).
       */
      function addHandleRect(name, x, y, color) {
        const visualW = HANDLE_RECT_VISUAL_WIDTH;
        const visualH = HANDLE_RECT_VISUAL_HEIGHT;
        const hitPad = HANDLE_RECT_HIT_PADDING;

        // Wider invisible hover area improves drag grab reliability.
        const hit = createSvgEl('rect');
        setAttrs(hit, {
          x: x - visualW / 2 - hitPad,
          y: y - visualH / 2 - hitPad,
          width: visualW + hitPad * 2,
          height: visualH + hitPad * 2,
          fill: 'rgba(0,0,0,0.001)',
          'data-handle': name,
          style: 'cursor:ns-resize',
        });
        gHandles.appendChild(hit);

        const rect = createSvgEl('rect');
        setAttrs(rect, {
          x: x - visualW / 2,
          y: y - visualH / 2,
          width: visualW,
          height: visualH,
          rx: 2,
          fill: COLORS.white,
          stroke: color,
          'stroke-width': 2,
          'data-handle': name,
          style: 'cursor:ns-resize',
        });
        gHandles.appendChild(rect);

        const centerLine1 = createSvgEl('line');
        setAttrs(centerLine1, {
          x1: x - 5,
          y1: y - 2.5,
          x2: x + 5,
          y2: y - 2.5,
          stroke: color,
          'stroke-width': 1.5,
          'data-handle': name,
          style: 'cursor:ns-resize',
        });
        gHandles.appendChild(centerLine1);

        const centerLine2 = createSvgEl('line');
        setAttrs(centerLine2, {
          x1: x - 5,
          y1: y + 2.5,
          x2: x + 5,
          y2: y + 2.5,
          stroke: color,
          'stroke-width': 1.5,
          'data-handle': name,
          style: 'cursor:ns-resize',
        });
        gHandles.appendChild(centerLine2);
      }

      /**
       * Circular drag handle for growth.
       */
      function addHandleCircle(name, x, y, color) {
        const visualR = 8;
        const hitR = 14;

        // Larger invisible radius makes dragging easier.
        const hit = createSvgEl('circle');
        setAttrs(hit, {
          cx: x,
          cy: y,
          r: hitR,
          fill: 'rgba(0,0,0,0.001)',
          'data-handle': name,
          style: 'cursor:move',
        });
        gHandles.appendChild(hit);

        const circle = createSvgEl('circle');
        setAttrs(circle, {
          cx: x,
          cy: y,
          r: visualR,
          fill: COLORS.white,
          stroke: color,
          'stroke-width': 3,
          'data-handle': name,
          style: 'cursor:move',
        });
        gHandles.appendChild(circle);
      }

      const startHandleT = 0;
      const endHandleT = tEnd;
      const growthT = tEnd * 0.55;
      const handlePoints = {
        'revenue-start': {
          x: this._xFromTime(startHandleT),
          y: this._yFromValue(this._revenueAt(startHandleT)),
        },
        fixed: {
          x: this._xFromTime(startHandleT),
          y: this._yFromValue(this.state.weeklyFixedExpenses),
        },
        variable: {
          x: this._xFromTime(endHandleT),
          y: this._yFromValue(this._variableAt(endHandleT)),
        },
        growth: {
          x: this._xFromTime(growthT),
          y: this._yFromValue(this._revenueAt(growthT)),
        },
      };

      addHandleRect(
        'revenue-start',
        handlePoints['revenue-start'].x,
        handlePoints['revenue-start'].y,
        COLORS.revenue
      );
      addHandleRect('fixed', handlePoints.fixed.x, handlePoints.fixed.y, COLORS.fixed);
      addHandleRect('variable', handlePoints.variable.x, handlePoints.variable.y, COLORS.variable);
      addHandleCircle('growth', handlePoints.growth.x, handlePoints.growth.y, COLORS.revenue);

      const handleLabelBounds = {
        minX: this.chart.paddingLeft + 8,
        maxX: plotRightX - 8,
        minY: plotTopY + AXIS_LABEL_TOP_CLEARANCE,
        maxY: plotBottomY - 6,
      };
      this._renderActiveHandleLabel(gHandles, 'growth', handlePoints, handleLabelBounds);

      const isExpenseHandleActive = activeHandle === 'fixed' || activeHandle === 'variable';
      isExpenseHandleActive &&
        this._renderActiveHandleLabel(gHandles, activeHandle, handlePoints, handleLabelBounds);

      gHandles.appendChild(gHover);
    }

    /**
     * Main update cycle: input -> domain -> draw -> KPI.
     */
    render(options) {
      const opts = options || {};
      if (!opts.skipInputs) {
        this._updateInputs();
      }
      if (!opts.skipYDomain) {
        this._updateYDomain();
      }
      const metrics = opts.skipKpis ? null : this._computeMetrics();
      this._draw(metrics);
      if (!opts.skipKpis && metrics !== null) {
        this.nodes.summaryBreakeven.textContent = this._formatTime(metrics.breakevenYears);
        this.nodes.summaryBillion.textContent = this._formatTime(metrics.billionYears);
      }
    }
  }

  /**
   * Initializes one instance by selector or DOM node.
   */
  function init(target, options) {
    let container = target;

    if (typeof target === 'string') {
      container = document.querySelector(target);
    }

    if (!container) {
      return null;
    }

    return new GrowthCalculator(container, options || {});
  }

  /**
   * Auto-initializes by container ID.
   */
  function autoInit() {
    const nodes = document.querySelectorAll('#ims-growth-calc');
    if (!nodes.length) {
      return [];
    }

    const instances = [];
    nodes.forEach((node) => {
      instances.push(new GrowthCalculator(node));
    });
    return instances;
  }

  // Public API for external embedding (for example, Webflow custom code).
  window.ImsGrowthCalculator = {
    init: init,
    autoInit: autoInit,
  };

  const shouldAutoInit = !(window.__IMS_GRAPH_DISABLE_LEGACY_AUTO_INIT === true);
  if (!shouldAutoInit) {
    return;
  }

  // Auto-start after DOM is ready.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      autoInit();
    });
    return;
  }

  autoInit();
})();
