(function () {
  'use strict';

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
    grid: '#E6E6EC'
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
    yearsMax: 9
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
    year: 900
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
    year: 'YoY'
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
    skipYDomain: true
  });
  const DRAG_Y_EXPAND_TRIGGER_OFFSET = 2;
  const DRAG_Y_EXPAND_RESET_OFFSET = 16;

  // Baseline Y-axis ticks in display units.
  const Y_TICKS_BY_UNIT = {
    week: [100, 300, 1000, 3000, 10000, 30000, 100000, 300000, 1000000, 3000000, 10000000],
    month: [300, 1000, 3000, 10000, 30000, 100000, 300000, 1000000, 3000000, 10000000, 30000000],
    quarter: [3000, 10000, 30000, 100000, 300000, 1000000, 3000000, 10000000, 30000000, 100000000],
    year: [3000, 10000, 30000, 100000, 300000, 1000000, 3000000, 10000000, 30000000, 100000000, 300000000, 1000000000]
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
    let maxResult = isFiniteNumber(cap) ? clamp(cap, 1, MAX_FINITE_FLOW) : MAX_FINITE_FLOW;
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

    let logResult = Math.log(base) * exponent;
    if (!isFiniteNumber(logResult)) {
      return logResult > 0 ? maxResult : 0;
    }

    if (logResult >= Math.log(maxResult)) {
      return maxResult;
    }

    if (logResult <= Math.log(Number.MIN_VALUE)) {
      return 0;
    }

    let value = Math.exp(logResult);
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

    let dotIndex = source.indexOf('.');
    let integerPart = dotIndex < 0 ? source : source.slice(0, dotIndex);
    let normalizedIntegerPart = integerPart.replace(/,/g, '');
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
        fractionalPart: ''
      };
    }

    return {
      signPrefix: signPrefix,
      integerPart: normalizedIntegerPart,
      fractionalPart: source.slice(dotIndex)
    };
  }

  function formatMoneyWithCommas(formattedMoney) {
    let parts = splitMoneyDisplayParts(formattedMoney);
    if (!parts) {
      return typeof formattedMoney === 'string' ? formattedMoney : '$0';
    }
    return parts.signPrefix + formatIntegerStringWithCommas(parts.integerPart) + parts.fractionalPart;
  }

  /**
   * Formats money for axes and labels with compact suffixes.
   */
  function formatMoney(value) {
    if (!isFiniteNumber(value)) {
      return '$0';
    }

    let abs = Math.abs(value);
    if (abs >= 1e21) {
      let scientific = abs
        .toExponential(2)
        .replace('+', '')
        .replace(/(\.\d*[1-9])0+e/, '$1e')
        .replace(/\.0+e/, 'e');
      return (value < 0 ? '-$' : '$') + scientific;
    }

    let suffix = '';
    let scaled = abs;

    let scales = [
      {threshold: 999e15, suffix: 'Qi', divisor: 1e18},
      {threshold: 999e12, suffix: 'Q', divisor: 1e15},
      {threshold: 999e9, suffix: 'T', divisor: 1e12},
      {threshold: 999e6, suffix: 'B', divisor: 1e9},
      {threshold: 999e3, suffix: 'M', divisor: 1e6},
      {threshold: 1e4, suffix: 'K', divisor: 1e3}
    ];

    for (let i = 0; i < scales.length; i += 1) {
      let scale = scales[i];
      if (abs < scale.threshold) {
        continue;
      }
      suffix = scale.suffix;
      scaled = abs / scale.divisor;
      break;
    }

    let digits = scaled >= 1000 ? 0 : scaled >= 100 ? 1 : scaled >= 10 ? 2 : 2;
    let text = scaled.toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
    let formattedMoney = (value < 0 ? '-$' : '$') + text + suffix;
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
    let sign = intValue < 0 ? '-' : '';
    let digits = String(Math.trunc(Math.abs(intValue)));
    return sign + formatIntegerStringWithCommas(digits);
  }

  /**
   * Formats a money value for input text.
   */
  function formatInputMoney(value) {
    if (!isFiniteNumber(value)) {
      return '$0';
    }
    let clamped = Math.max(0, value);
    let rounded = Math.round(clamped);
    return '$' + formatIntegerWithCommas(rounded);
  }

  /**
   * Formats a percent value for input text.
   */
  function formatInputPercent(value) {
    if (!isFiniteNumber(value)) {
      return '0%';
    }
    return (value * 100).toFixed(2).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1') + '%';
  }

  /**
   * Parses money text from an input field.
   */
  function parseMoney(text) {
    if (typeof text !== 'string') {
      return NaN;
    }
    let normalized = text.replace(/[^0-9.\-]/g, '');
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
    let normalized = text.replace(/[^0-9.\-]/g, '');
    let raw = Number(normalized);
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
    Object.keys(attrs).forEach(function (key) {
      node.setAttribute(key, String(attrs[key]));
    });
  }

  function normalizeTicks(ticks, min, max, targetCount) {
    let uniqueSorted = ticks
      .filter(function (tick) {
        return isFiniteNumber(tick);
      })
      .sort(function (a, b) {
        return a - b;
      })
      .filter(function (tick, idx, arr) {
        return idx === 0 || Math.abs(tick - arr[idx - 1]) > 1e-9;
      });

    if (uniqueSorted.length < 2) {
      return [min, max];
    }

    let safeTargetCount = Math.max(1, targetCount || 1);
    if (uniqueSorted.length <= safeTargetCount) {
      return uniqueSorted;
    }

    let step = Math.ceil(uniqueSorted.length / safeTargetCount);
    let trimmed = uniqueSorted.filter(function (_tick, idx) {
      return idx % step === 0;
    });

    let shouldAppendMax = trimmed[trimmed.length - 1] < max;
    return shouldAppendMax ? trimmed.concat([max]) : trimmed;
  }

  /**
   * Generates log ticks in a 1-3-10 style (closer to the reference chart).
   */
  function createOneThreeTicks(minValue, maxValue, targetCount) {
    let min = Math.max(1e-9, minValue);
    let max = Math.max(min * 1.01, maxValue);
    let ticks = [];
    let multipliers = [1, 3];

    let minExp = Math.floor(Math.log10(min)) - 1;
    let maxExp = Math.ceil(Math.log10(max)) + 1;

    for (let exp = minExp; exp <= maxExp; exp += 1) {
      let scale = Math.pow(10, exp);
      for (let i = 0; i < multipliers.length; i += 1) {
        let tick = multipliers[i] * scale;
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

    let exponent = Math.floor(Math.log10(value));
    let scale = Math.pow(10, exponent);
    let normalized = value / scale;
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

    let exponent = Math.floor(Math.log10(tick));
    let scale = Math.pow(10, exponent);
    let normalized = tick / scale;
    if (normalized < 1.5) {
      return 3 * scale;
    }
    return 10 * scale;
  }

  function extendBaselineOneThreeTicks(baselineTicks, maxDisplay) {
    let ticks = (baselineTicks || [])
      .filter(function (tick) {
        return isFiniteNumber(tick) && tick > 0;
      })
      .sort(function (a, b) {
        return a - b;
      })
      .filter(function (tick, idx, arr) {
        return idx === 0 || Math.abs(tick - arr[idx - 1]) > 1e-9;
      });

    let safeMax = isFiniteNumber(maxDisplay) && maxDisplay > 0 ? maxDisplay : 1;
    if (!ticks.length) {
      return createOneThreeTicks(1, safeMax, 8);
    }

    let extended = ticks.slice();
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
      const weeklyRevenue0 = isFiniteNumber(this.state.weeklyRevenue0) ? this.state.weeklyRevenue0 : DEFAULTS.weeklyRevenue0;
      const weeklyFixedExpenses = isFiniteNumber(this.state.weeklyFixedExpenses) ? this.state.weeklyFixedExpenses : DEFAULTS.weeklyFixedExpenses;
      const grossMargin = isFiniteNumber(this.state.grossMargin) ? this.state.grossMargin : DEFAULTS.grossMargin;
      const weeklyGrowthRate = isFiniteNumber(this.state.weeklyGrowthRate) ? this.state.weeklyGrowthRate : DEFAULTS.weeklyGrowthRate;
      const yearsMinRaw = isFiniteNumber(this.state.yearsMin) ? this.state.yearsMin : DEFAULTS.yearsMin;
      const yearsMaxRaw = isFiniteNumber(this.state.yearsMax) ? this.state.yearsMax : DEFAULTS.yearsMax;
      let yearsMin = clamp(Math.round(yearsMinRaw), 1, 99);
      let yearsMax = clamp(Math.round(yearsMaxRaw), yearsMin + 1, 100);
      // Keep minimum revenue > 0 to avoid log(0) and chart degradation.
      this.state.weeklyRevenue0 = Math.max(1 / WEEKS_PER_YEAR, weeklyRevenue0);
      this.state.weeklyFixedExpenses = Math.max(0, weeklyFixedExpenses);
      this.state.grossMargin = clamp(grossMargin, 0, 1);
      this.state.weeklyGrowthRate = clamp(weeklyGrowthRate, -0.9, 10);
      this.state.yearsMin = yearsMin;
      this.state.yearsMax = yearsMax;
      this.state.units = isValidUnit(this.state.units) ? this.state.units : 'year';
      this.state.expenseViz = isValidExpenseViz(this.state.expenseViz) ? this.state.expenseViz : DEFAULTS.expenseViz;
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

      let style = document.createElement('style');
      style.id = 'igc-styles';
      style.textContent = '' +
        '.igc{font-family:Inter,Segoe UI,Arial,sans-serif;color:' + COLORS.black + ';width:100%;display:flex;flex-direction:column;gap:32px;}' +
        '.igc *{box-sizing:border-box;}' +
        '.igc__radios{display:flex;flex-direction:column;gap:10px;font-size:14px;line-height:1.4;}' +
        '.igc__radios-row{display:flex;gap:16px;align-items:center;flex-wrap:wrap;}' +
        '.igc__radio{display:flex;gap:8px;align-items:center;color:' + COLORS.black + ';cursor:pointer;}' +
        '.igc__radio input{accent-color:' + COLORS.blue + ';}' +
        '.igc svg text{-webkit-user-select:none;user-select:none;}' +
        '.igc__chart-wrap{background:transparent;}' +
        '.igc__summary{display:flex;gap:32px;flex-wrap:wrap;align-items:baseline;line-height:1.4;}' +
        '.igc__summary-label{font-size:16px;color:' + COLORS.darkGrey + ';line-height:1.4;}' +
        '.igc__summary-value{font-size:18px;font-weight:600;color:' + COLORS.black + ';line-height:1.4;margin-left:8px;}' +
        '.igc__inputs{display:flex;gap:24px;flex-wrap:wrap;}' +
        '.igc__field{width:288px;flex:0 0 288px;}' +
        '.igc__field-label{font-size:12px;color:' + COLORS.darkGrey + ';line-height:1.4;margin-bottom:6px;display:block;}' +
        '.igc__input{width:100%;height:48px;border:1px solid ' + COLORS.grey + ';border-radius:4px;padding:10px 14px;font-size:16px;line-height:1.4;color:' + COLORS.black + ';}' +
        '.igc__input:focus{outline:2px solid rgba(14,100,224,.25);border-color:' + COLORS.blue + ';}' +
        '@media (max-width: 880px){' +
        '.igc{gap:24px;}.igc__summary-label{font-size:16px;}.igc__summary-value{font-size:18px;}.igc__field{width:100%;flex:1 1 100%;}' +
        '}';

      document.head.appendChild(style);
    };

    /**
     * Builds widget DOM structure and core nodes.
     */
    _build() {
      this.container.innerHTML = '';

      let root = document.createElement('div');
      root.className = 'igc';

      let radios = document.createElement('div');
      radios.className = 'igc__radios';
      let unitsRow = document.createElement('div');
      unitsRow.className = 'igc__radios-row';
      let expenseVizRow = document.createElement('div');
      expenseVizRow.className = 'igc__radios-row';

      let units = [
        {id: 'week', label: 'Weekly'},
        {id: 'month', label: 'Monthly'},
        {id: 'quarter', label: 'Quarterly'},
        {id: 'year', label: 'Yearly'}
      ];

      let self = this;
      let unitRadioGroupName = 'igc-units-' + String(Math.random()).slice(2);
      units.forEach(function (unit) {
        let label = document.createElement('label');
        label.className = 'igc__radio';

        let input = document.createElement('input');
        input.type = 'radio';
        input.name = unitRadioGroupName;
        input.value = unit.id;
        input.dataset.group = 'units';
        if (unit.id === self.state.units) {
          input.checked = true;
        }

        let text = document.createElement('span');
        text.textContent = unit.label;

        label.appendChild(input);
        label.appendChild(text);
        unitsRow.appendChild(label);
      });

      let expenseVizOptions = [
        {id: 'bars', label: 'Expenses: Bars'},
        {id: 'lines', label: 'Expenses: Lines'}
      ];
      let expenseVizRadioGroupName = 'igc-expense-viz-' + String(Math.random()).slice(2);
      expenseVizOptions.forEach(function (option) {
        let label = document.createElement('label');
        label.className = 'igc__radio';

        let input = document.createElement('input');
        input.type = 'radio';
        input.name = expenseVizRadioGroupName;
        input.value = option.id;
        input.dataset.group = 'expenseViz';
        if (option.id === self.state.expenseViz) {
          input.checked = true;
        }

        let text = document.createElement('span');
        text.textContent = option.label;

        label.appendChild(input);
        label.appendChild(text);
        expenseVizRow.appendChild(label);
      });

      radios.appendChild(unitsRow);
      radios.appendChild(expenseVizRow);

      let chartWrap = document.createElement('div');
      chartWrap.className = 'igc__chart-wrap';

      let svg = createSvgEl('svg');
      setAttrs(svg, {
        viewBox: '0 0 1224 420',
        width: '100%',
        height: '420',
        preserveAspectRatio: 'none'
      });

      chartWrap.appendChild(svg);

      // KPI summary block under the chart.
      let summary = document.createElement('div');
      summary.className = 'igc__summary';
      summary.innerHTML = '' +
        '<div><span class="igc__summary-label">Profitable at:</span><span class="igc__summary-value" data-key="breakeven">-</span></div>' +
        '<div><span class="igc__summary-label">$1B/y revenue at:</span><span class="igc__summary-value" data-key="billion">-</span></div>';

      // User-editable model inputs.
      let inputs = document.createElement('div');
      inputs.className = 'igc__inputs';
      inputs.innerHTML = '' +
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
    };

    /**
     * Prepares SVG layers and base chart geometry.
     */
    _setupSvgLayers() {
      let svg = this.nodes.svg;
      svg.innerHTML = '';

      let groups = {
        grid: createSvgEl('g'),
        axes: createSvgEl('g'),
        lines: createSvgEl('g'),
        labels: createSvgEl('g'),
        handles: createSvgEl('g')
      };

      Object.keys(groups).forEach(function (key) {
        svg.appendChild(groups[key]);
      });

      this.nodes.svgGroups = groups;
      let displayUnit = this.state.units;
      let yMinDisplay = MIN_DISPLAY_Y_FLOOR_BY_UNIT[displayUnit] || 1;
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
        ticksY: []
      };
    };

    /**
     * Binds UI and chart events (radio/input/drag).
     */
    _bind() {
      let self = this;

      this.nodes.radios.querySelectorAll('input[type="radio"][data-group="units"]').forEach(function (radio) {
        radio.addEventListener('change', function () {
          if (radio.checked) {
            self.state.units = radio.value;
            self._normalizeStateToUnitDomain();
            self.render();
          }
        });
      });

      this.nodes.radios.querySelectorAll('input[type="radio"][data-group="expenseViz"]').forEach(function (radio) {
        radio.addEventListener('change', function () {
          if (!radio.checked) {
            return;
          }
          let next = radio.value;
          let resolved = isValidExpenseViz(next) ? next : DEFAULTS.expenseViz;
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
        input.addEventListener('keydown', function (event) {
          if (event.key === 'Enter') {
            input.blur();
          }
        });

        input.addEventListener('blur', function () {
          onApply(input.value);
          self.render();
        });
      }

      bindInput(this.nodes.inputRevenue, function (text) {
        let displayValue = sanitizeMoneyInputDisplayValue(parseMoney(text));
        if (!isFiniteNumber(displayValue)) {
          return;
        }

        let revenueMax = self._maxWeeklyRevenue0();
        self.state.weeklyRevenue0 = clamp(flowToWeekly(displayValue, self.state.units), 1 / WEEKS_PER_YEAR, revenueMax);
      });

      bindInput(this.nodes.inputGrossMargin, function (text) {
        let value = parsePercent(text);
        if (!isFiniteNumber(value)) {
          return;
        }
        self.state.grossMargin = clamp(value, self._minGrossMargin(), 1);
      });

      bindInput(this.nodes.inputFixed, function (text) {
        let displayValue = sanitizeMoneyInputDisplayValue(parseMoney(text));
        if (!isFiniteNumber(displayValue)) {
          return;
        }

        let fixedMax = self._maxWeeklyFixedExpenses();
        self.state.weeklyFixedExpenses = clamp(flowToWeekly(displayValue, self.state.units), 0, fixedMax);
      });

      bindInput(this.nodes.inputGrowth, function (text) {
        let displayValue = parsePercent(text);
        if (!isFiniteNumber(displayValue) || displayValue <= -0.99) {
          return;
        }

        let growthMax = self._maxWeeklyGrowthRate();
        self.state.weeklyGrowthRate = clamp(growthToWeekly(displayValue, self.state.units), -0.9, growthMax);
      });

      this.nodes.svg.addEventListener('pointerdown', function (event) {
        let target = event.target;
        if (!target || !target.dataset || !target.dataset.handle) {
          return;
        }
        let displayUnitLock = isValidUnit(self.state.units) ? self.state.units : 'year';

        self.drag = {
          handle: target.dataset.handle,
          domain: {
            yMinLockWeekly: self.chart.yMin,
            yMaxLockWeekly: self.chart.yMax,
            ticksYLockWeekly: self.chart.ticksY.slice(),
            displayUnitLock: displayUnitLock,
            yMaxLockDisplayTick: snapUpOneThree(flowFromWeekly(self.chart.yMax, displayUnitLock)),
            canExpandYMax: true
          }
        };
        self.nodes.svg.setPointerCapture(event.pointerId);
      });

      this.nodes.svg.addEventListener('pointermove', function (event) {
        if (!self.drag) {
          return;
        }
        let coords = self._eventToChart(event);
        if (!coords) {
          return;
        }

        let hasDomainExpansion = self._maybeExpandDragYMax(coords);
        let hasStateUpdate = self._handleDragAt(coords);
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
    };

    _handleDragAt(coords) {
      if (!coords) {
        return false;
      }

      let t = this._xToTime(coords.x);
      let value = this._yToValue(coords.y);
      let hasFiniteDragValues = isFiniteNumber(coords.x) && isFiniteNumber(coords.y) && isFiniteNumber(t) && isFiniteNumber(value);
      if (!hasFiniteDragValues) {
        return false;
      }

      let tMax = this.chart.tMax - this.chart.tMin;
      switch (this.drag.handle) {
        case 'revenue-start': {
          let revenueMax = this._maxWeeklyRevenue0();
          this.state.weeklyRevenue0 = clamp(value, 1 / WEEKS_PER_YEAR, revenueMax);
          return true;
        }
        case 'growth': {
          let anchorT = clamp(t, 0.75, tMax);
          // Convert handle position to weekly growth via inverse exponential math.
          let anchorWeeks = anchorT * WEEKS_PER_YEAR;
          let ratio = clamp(value / this.state.weeklyRevenue0, 1e-6, 1e9);
          let weeklyGrowth = Math.pow(ratio, 1 / anchorWeeks) - 1;
          this.state.weeklyGrowthRate = clamp(weeklyGrowth, -0.9, this._maxWeeklyGrowthRate());
          return true;
        }
        case 'fixed':
          this.state.weeklyFixedExpenses = clamp(value, 0, this._maxWeeklyFixedExpenses());
          return true;
        case 'variable': {
          let revAtEnd = this._revenueAt(tMax);
          if (revAtEnd <= 0) {
            return false;
          }
          // Variable handle controls variable/revenue ratio.
          let variableRatio = clamp(value / revAtEnd, 0, 1);
          this.state.grossMargin = clamp(1 - variableRatio, this._minGrossMargin(), 1);
          return true;
        }
        default:
          return false;
      }
    };

    _applyDragDomainLock() {
      let hasDragDomain = this.drag && this.drag.domain;
      if (!hasDragDomain) {
        return false;
      }

      let yMinLockWeekly = this._clampForProjection(this.drag.domain.yMinLockWeekly);
      let yMaxLockWeekly = this._clampForProjection(this.drag.domain.yMaxLockWeekly);
      let hasFiniteBounds = isFiniteNumber(yMinLockWeekly) && isFiniteNumber(yMaxLockWeekly);
      if (!hasFiniteBounds) {
        return false;
      }

      let yMinWeekly = Math.min(yMinLockWeekly, yMaxLockWeekly);
      let yMaxWeekly = Math.max(yMinLockWeekly, yMaxLockWeekly);
      if (yMaxWeekly <= yMinWeekly) {
        return false;
      }

      this.drag.domain.yMinLockWeekly = yMinWeekly;
      this.drag.domain.yMaxLockWeekly = yMaxWeekly;
      let displayUnit = isValidUnit(this.drag.domain.displayUnitLock) ? this.drag.domain.displayUnitLock : this.state.units;
      this.drag.domain.displayUnitLock = displayUnit;
      this.drag.domain.yMaxLockDisplayTick = snapUpOneThree(flowFromWeekly(yMaxWeekly, displayUnit));
      this.chart.yMin = yMinWeekly;
      this.chart.yMax = yMaxWeekly;
      let lockedTicks = Array.isArray(this.drag.domain.ticksYLockWeekly)
        ? this.drag.domain.ticksYLockWeekly.slice()
        : [];
      let filteredLockedTicks = lockedTicks.filter(function (tick) {
        return isFiniteNumber(tick) && tick > 0 && tick >= yMinWeekly && tick <= yMaxWeekly;
      });
      if (!filteredLockedTicks.length) {
        let baselineDisplayTicks = Y_TICKS_BY_UNIT[displayUnit] || Y_TICKS_BY_UNIT.year || [];
        let normalizedDomain = {
          yMinDisplay: flowFromWeekly(yMinWeekly, displayUnit),
          yMaxDisplay: flowFromWeekly(yMaxWeekly, displayUnit)
        };
        filteredLockedTicks = this._domainTicksWeekly(displayUnit, baselineDisplayTicks, normalizedDomain);
      }
      this.chart.ticksY = filteredLockedTicks;
      this.drag.domain.ticksYLockWeekly = filteredLockedTicks.slice();
      return true;
    };

    _maybeExpandDragYMax(coords) {
      let hasDragDomain = this.drag && this.drag.domain;
      let hasCoords = coords && isFiniteNumber(coords.y);
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

      let displayUnit = isValidUnit(this.drag.domain.displayUnitLock) ? this.drag.domain.displayUnitLock : this.state.units;
      this.drag.domain.displayUnitLock = displayUnit;
      let yMinLockWeekly = this._clampForProjection(this.drag.domain.yMinLockWeekly);
      let yMaxLockWeekly = this._clampForProjection(this.drag.domain.yMaxLockWeekly);
      let hasFiniteBounds = isFiniteNumber(yMinLockWeekly) && isFiniteNumber(yMaxLockWeekly);
      if (!hasFiniteBounds || yMaxLockWeekly <= yMinLockWeekly) {
        return false;
      }

      let yMaxDisplayTick = isFiniteNumber(this.drag.domain.yMaxLockDisplayTick) && this.drag.domain.yMaxLockDisplayTick > 0
        ? this.drag.domain.yMaxLockDisplayTick
        : snapUpOneThree(flowFromWeekly(yMaxLockWeekly, displayUnit));
      let nextYMaxDisplay = nextOneThreeTick(yMaxDisplayTick);
      let nextYMaxWeekly = this._clampForProjection(flowToWeekly(nextYMaxDisplay, displayUnit));
      if (!isFiniteNumber(nextYMaxWeekly) || nextYMaxWeekly <= yMaxLockWeekly) {
        return false;
      }

      this.drag.domain.yMinLockWeekly = yMinLockWeekly;
      this.drag.domain.yMaxLockWeekly = nextYMaxWeekly;
      this.drag.domain.yMaxLockDisplayTick = nextYMaxDisplay;
      this.drag.domain.canExpandYMax = false;
      this.chart.yMin = this.drag.domain.yMinLockWeekly;
      this.chart.yMax = this.drag.domain.yMaxLockWeekly;
      let baselineDisplayTicks = Y_TICKS_BY_UNIT[displayUnit] || Y_TICKS_BY_UNIT.year || [];
      let normalizedDomain = {
        yMinDisplay: flowFromWeekly(this.drag.domain.yMinLockWeekly, displayUnit),
        yMaxDisplay: flowFromWeekly(this.drag.domain.yMaxLockWeekly, displayUnit)
      };
      this.drag.domain.ticksYLockWeekly = this._domainTicksWeekly(displayUnit, baselineDisplayTicks, normalizedDomain);
      this._applyDragDomainLock();
      return true;
    };

    /**
     * Converts pointer-event coordinates to chart SVG coordinates.
     */
    _eventToChart(event) {
      let rect = this.nodes.svg.getBoundingClientRect();
      let hasValidRect = rect.width > 0 && rect.height > 0;
      if (!hasValidRect) {
        return null;
      }

      let scaleX = this.chart.width / rect.width;
      let scaleY = this.chart.height / rect.height;
      let hasValidScale = isFiniteNumber(scaleX) && isFiniteNumber(scaleY) && scaleX > 0 && scaleY > 0;
      if (!hasValidScale) {
        return null;
      }

      let x = (event.clientX - rect.left) * scaleX;
      let y = (event.clientY - rect.top) * scaleY;
      let hasValidCoords = isFiniteNumber(x) && isFiniteNumber(y);
      if (!hasValidCoords) {
        return null;
      }

      return {
        x: x,
        y: y
      };
    };

    _projectionMaxWeekly() {
      let projectionMax = Math.min(PROJECTION_SOFT_CAP_WEEKLY, MAX_FINITE_FLOW);
      return Math.max(MIN_WEEKLY_LOG_FLOOR, projectionMax);
    };

    _clampForProjection(value) {
      let projectionMax = this._projectionMaxWeekly();
      if (Number.isNaN(value)) {
        return NaN;
      }
      if (!isFiniteNumber(value)) {
        return value > 0 ? projectionMax : MIN_WEEKLY_LOG_FLOOR;
      }
      return clamp(value, MIN_WEEKLY_LOG_FLOOR, projectionMax);
    };

    _finiteValueOrMax(value) {
      if (Number.isNaN(value)) {
        return NaN;
      }
      if (!isFiniteNumber(value)) {
        return value > 0 ? MAX_FINITE_FLOW : 0;
      }
      return clamp(value, 0, MAX_FINITE_FLOW);
    };

    /**
     * Target Y-label count based on plot height.
     */
    _targetYTickCount() {
      let plotHeight = this.chart.height - this.chart.paddingTop - this.chart.paddingBottom;
      return clamp(Math.round(plotHeight / 34), 4, 12);
    };

    /**
     * Filters projected Y ticks to avoid collisions.
     */
    _filterYTicksByGap(ticks, minGap, reservedYPositions) {
      let sorted = ticks
        .filter(function (tick) {
          return isFiniteNumber(tick) && tick > 0 && tick >= this.chart.yMin && tick <= this.chart.yMax;
        }, this)
        .sort(function (a, b) {
          return a - b;
        });

      if (!sorted.length) {
        return [];
      }

      let keptDesc = [];
      let lastY = null;

      for (let i = sorted.length - 1; i >= 0; i -= 1) {
        let tick = sorted[i];
        let y = this._yFromValue(tick);
        if (!isFiniteNumber(y)) {
          continue;
        }

        let nearReserved = (reservedYPositions || []).some(function (reservedY) {
          return Math.abs(y - reservedY) < minGap;
        });
        if (nearReserved) {
          continue;
        }

        if (lastY === null || Math.abs(y - lastY) >= minGap) {
          keptDesc.push(tick);
          lastY = y;
        }
      }

      let kept = keptDesc.sort(function (a, b) {
        return a - b;
      });

      if (kept.length >= 2) {
        return kept;
      }

      let fallback = [sorted[0], sorted[sorted.length - 1]].filter(function (tick, idx, arr) {
        return idx === 0 || Math.abs(tick - arr[idx - 1]) > 1e-9;
      });

      return fallback.filter(function (tick) {
        let y = this._yFromValue(tick);
        let nearReserved = (reservedYPositions || []).some(function (reservedY) {
          return Math.abs(y - reservedY) < minGap;
        });
        return !nearReserved;
      }, this);
    };

    _applyChartDomain(displayUnit, yMinDisplay, yMaxDisplay) {
      this.chart.yMin = this._clampForProjection(flowToWeekly(yMinDisplay, displayUnit));
      this.chart.yMax = this._clampForProjection(flowToWeekly(yMaxDisplay, displayUnit));
      if (this.chart.yMax <= this.chart.yMin) {
        this.chart.yMax = this._clampForProjection(this.chart.yMin * 1.2);
      }

      return {
        yMinDisplay: flowFromWeekly(this.chart.yMin, displayUnit),
        yMaxDisplay: flowFromWeekly(this.chart.yMax, displayUnit)
      };
    };

    _yMaxWeeklyForUnit(units) {
      let projectionMax = this._projectionMaxWeekly();
      return clamp(projectionMax, MIN_WEEKLY_LOG_FLOOR, MAX_FINITE_FLOW);
    };

    _visibleYMaxWeekly() {
      let tEndRaw = this.chart.tMax - this.chart.tMin;
      let tEnd = isFiniteNumber(tEndRaw) && tEndRaw > 0 ? tEndRaw : 0;
      let maxCandidate = isFiniteNumber(this.state.weeklyFixedExpenses) && this.state.weeklyFixedExpenses > 0
        ? this.state.weeklyFixedExpenses
        : 0;
      let sampleSegments = this._totalLineSegments();
      for (let i = 0; i <= sampleSegments; i += 1) {
        let t = (i / sampleSegments) * tEnd;
        let samples = [this._revenueAt(t), this._variableAt(t), this._totalAt(t)];
        maxCandidate = samples.reduce(function (maxValue, value) {
          if (!isFiniteNumber(value) || value <= 0) {
            return maxValue;
          }
          return Math.max(maxValue, value);
        }, maxCandidate);
      }
      let safeCandidate = maxCandidate > 0 ? maxCandidate : MIN_WEEKLY_LOG_FLOOR;
      return this._clampForProjection(safeCandidate);
    };

    _tEndWeeks() {
      let yearsSpan = this.state.yearsMax - this.state.yearsMin;
      let safeYearsSpan = isFiniteNumber(yearsSpan) ? Math.max(0, yearsSpan) : 0;
      return safeYearsSpan * WEEKS_PER_YEAR;
    };

    _growthFactorEnd(weeklyGrowthRate, weeksEnd, maxResult) {
      if (!isFiniteNumber(weeklyGrowthRate) || !isFiniteNumber(weeksEnd) || weeksEnd < 0 || weeklyGrowthRate <= -1) {
        return NaN;
      }
      return safePow(1 + weeklyGrowthRate, weeksEnd, maxResult);
    };

    _revenueMaxFactor(weeklyGrowthRate) {
      let weeksEnd = this._tEndWeeks();
      let growthFactorEnd = this._growthFactorEnd(weeklyGrowthRate, weeksEnd, MAX_FINITE_FLOW);
      if (!isFiniteNumber(growthFactorEnd) || growthFactorEnd <= 0) {
        return NaN;
      }
      return Math.max(1, growthFactorEnd);
    };

    _revenueMaxOverSpan(weeklyRevenue0, weeklyGrowthRate) {
      let revenue0 = isFiniteNumber(weeklyRevenue0) ? Math.max(0, weeklyRevenue0) : NaN;
      let maxFactor = this._revenueMaxFactor(weeklyGrowthRate);
      if (!isFiniteNumber(revenue0) || !isFiniteNumber(maxFactor)) {
        return NaN;
      }
      return this._finiteValueOrMax(revenue0 * maxFactor);
    };

    _maxWeeklyRevenue0() {
      let minRevenue = 1 / WEEKS_PER_YEAR;
      let yMax = this._yMaxWeeklyForUnit(this.state.units);
      let fallbackMax = clamp(yMax, minRevenue, MAX_FINITE_FLOW);
      let maxFactor = this._revenueMaxFactor(this.state.weeklyGrowthRate);
      let variableRatio = clamp(1 - this.state.grossMargin, 0, 1);
      let fixed = clamp(this.state.weeklyFixedExpenses, 0, yMax);
      let validCore = isFiniteNumber(maxFactor) && maxFactor > 0 && isFiniteNumber(yMax) && yMax > 0;
      if (!validCore) {
        return fallbackMax;
      }

      let maxByRevenue = yMax / maxFactor;
      let maxByTotal = variableRatio > 0 ? (yMax - fixed) / (variableRatio * maxFactor) : MAX_FINITE_FLOW;
      let candidateMax = Math.min(maxByRevenue, maxByTotal);
      if (!isFiniteNumber(candidateMax)) {
        return fallbackMax;
      }
      return clamp(candidateMax, minRevenue, fallbackMax);
    };

    _maxWeeklyFixedExpenses() {
      let yMax = this._yMaxWeeklyForUnit(this.state.units);
      let fallbackMax = clamp(yMax, 0, MAX_FINITE_FLOW);
      let revenueMax = this._revenueMaxOverSpan(this.state.weeklyRevenue0, this.state.weeklyGrowthRate);
      let variableRatio = clamp(1 - this.state.grossMargin, 0, 1);
      if (!isFiniteNumber(yMax) || !isFiniteNumber(revenueMax)) {
        return fallbackMax;
      }
      return clamp(yMax - variableRatio * revenueMax, 0, fallbackMax);
    };

    _minGrossMargin() {
      let yMax = this._yMaxWeeklyForUnit(this.state.units);
      let revenueMax = this._revenueMaxOverSpan(this.state.weeklyRevenue0, this.state.weeklyGrowthRate);
      let fixed = clamp(this.state.weeklyFixedExpenses, 0, yMax);
      if (!isFiniteNumber(yMax) || !isFiniteNumber(revenueMax) || !isFiniteNumber(fixed)) {
        return 0;
      }

      let varRatioMax = revenueMax > 0 ? clamp((yMax - fixed) / revenueMax, 0, 1) : 1;
      let minGrossMargin = 1 - varRatioMax;
      if (!isFiniteNumber(minGrossMargin)) {
        return 0;
      }
      return clamp(minGrossMargin, 0, 1);
    };

    _maxWeeklyGrowthRate() {
      let weeksEnd = this._tEndWeeks();
      let yMax = this._yMaxWeeklyForUnit(this.state.units);
      let variableRatio = clamp(1 - this.state.grossMargin, 0, 1);
      let fixed = clamp(this.state.weeklyFixedExpenses, 0, yMax);
      let revenue0 = Math.max(1 / WEEKS_PER_YEAR, this.state.weeklyRevenue0);
      let hasFiniteCore = isFiniteNumber(yMax) && isFiniteNumber(fixed) && isFiniteNumber(revenue0) && revenue0 > 0;
      if (!hasFiniteCore) {
        return 10;
      }

      let revenueEndMax = variableRatio > 0 ? Math.min(yMax, (yMax - fixed) / variableRatio) : yMax;
      let growthFactorEndMax = clamp(revenueEndMax / revenue0, MIN_WEEKLY_LOG_FLOOR, MAX_FINITE_FLOW);
      let growthMax = Math.pow(growthFactorEndMax, 1 / Math.max(1, weeksEnd)) - 1;
      if (!isFiniteNumber(growthMax)) {
        return 10;
      }
      return clamp(growthMax, -0.9, 10);
    };

    _normalizeStateToUnitDomain() {
      let yMax = this._yMaxWeeklyForUnit(this.state.units);

      this.state.weeklyFixedExpenses = clamp(this.state.weeklyFixedExpenses, 0, yMax);
      this.state.grossMargin = clamp(this.state.grossMargin, 0, 1);
      this.state.weeklyRevenue0 = clamp(this.state.weeklyRevenue0, 1 / WEEKS_PER_YEAR, yMax);
      this.state.weeklyGrowthRate = clamp(this.state.weeklyGrowthRate, -0.9, 10);

      for (let pass = 0; pass < 2; pass += 1) {
        let growthMax = this._maxWeeklyGrowthRate();
        this.state.weeklyGrowthRate = clamp(this.state.weeklyGrowthRate, -0.9, growthMax);

        let revenueMax = this._maxWeeklyRevenue0();
        this.state.weeklyRevenue0 = clamp(this.state.weeklyRevenue0, 1 / WEEKS_PER_YEAR, revenueMax);

        let grossMin = this._minGrossMargin();
        this.state.grossMargin = clamp(this.state.grossMargin, grossMin, 1);

        let fixedMax = this._maxWeeklyFixedExpenses();
        this.state.weeklyFixedExpenses = clamp(this.state.weeklyFixedExpenses, 0, fixedMax);
      }
    };

    _domainTicksWeekly(displayUnit, baselineDisplayTicks, normalizedDomain) {
      let ticksDisplay = extendBaselineOneThreeTicks(baselineDisplayTicks, normalizedDomain.yMaxDisplay);
      let ticksWeekly = ticksDisplay
        .filter(function (tick) {
          return isFiniteNumber(tick) && tick >= normalizedDomain.yMinDisplay * 0.99 && tick <= normalizedDomain.yMaxDisplay * 1.01;
        })
        .map(function (tick) {
          return flowToWeekly(tick, displayUnit);
        });

      let filteredTicks = this._filterYTicksByGap(
        ticksWeekly,
        MIN_Y_TICK_GAP,
        [
          this.chart.height - this.chart.paddingBottom,
          this.chart.paddingTop + AXIS_LABEL_TOP_CLEARANCE
        ]
      );

      if (filteredTicks.length) {
        return filteredTicks;
      }

      let safeMinDisplay = isFiniteNumber(normalizedDomain.yMinDisplay) && normalizedDomain.yMinDisplay > 0 ? normalizedDomain.yMinDisplay : 1;
      let safeMaxDisplay = isFiniteNumber(normalizedDomain.yMaxDisplay) && normalizedDomain.yMaxDisplay > safeMinDisplay ? normalizedDomain.yMaxDisplay : safeMinDisplay * 10;
      let midDisplay = Math.sqrt(safeMinDisplay * safeMaxDisplay);
      return [flowToWeekly(clamp(midDisplay, safeMinDisplay, safeMaxDisplay), displayUnit)];
    };

    _setDomainTicks(displayUnit, baselineDisplayTicks, normalizedDomain) {
      this.chart.ticksY = this._domainTicksWeekly(displayUnit, baselineDisplayTicks, normalizedDomain);
    };

    /**
     * Revenue in weekly core at time t (years from start).
     */
    _revenueAt(tYearsFromStart) {
      let weeks = tYearsFromStart * WEEKS_PER_YEAR;
      let growthBase = 1 + this.state.weeklyGrowthRate;
      let maxMultiplier = MAX_FINITE_FLOW / Math.max(this.state.weeklyRevenue0, MIN_WEEKLY_LOG_FLOOR);
      let growthFactor = safePow(growthBase, weeks, Math.max(1, maxMultiplier));
      return this._finiteValueOrMax(this.state.weeklyRevenue0 * growthFactor);
    };

    /**
     * Variable expenses = Revenue * (1 - Gross margin).
     */
    _variableAt(tYearsFromStart) {
      let revenue = this._revenueAt(tYearsFromStart);
      if (!isFiniteNumber(revenue)) {
        return NaN;
      }
      return this._finiteValueOrMax(revenue * (1 - this.state.grossMargin));
    };

    /**
     * Total expenses = Variable + Fixed.
     */
    _totalAt(tYearsFromStart) {
      let variable = this._variableAt(tYearsFromStart);
      let fixed = this._finiteValueOrMax(this.state.weeklyFixedExpenses);
      if (!isFiniteNumber(variable)) {
        return fixed;
      }
      return this._finiteValueOrMax(variable + fixed);
    };

    /**
     * Computes key metrics: breakeven and time to $1B annual revenue.
     */
    _computeMetrics() {
      let contributionPct = this.state.grossMargin;
      let rev0 = this.state.weeklyRevenue0;
      let fixed = this.state.weeklyFixedExpenses;
      let growth = this.state.weeklyGrowthRate;

      let breakevenYears = null;

      // If initial contribution already covers fixed costs, breakeven is immediate.
      if (contributionPct > 0 && rev0 * contributionPct >= fixed) {
        breakevenYears = 0;
      }

      let canSolveBreakeven = breakevenYears === null && contributionPct > 0 && growth > 0 && rev0 > 0 && fixed > 0;
      if (canSolveBreakeven) {
        // Solve the intersection analytically.
        let numerator = Math.log(fixed / (rev0 * contributionPct));
        let denominator = Math.log(1 + growth);
        let solvedWeeks = numerator / denominator;
        let hasSolvedBreakeven = isFiniteNumber(solvedWeeks) && solvedWeeks >= 0;
        breakevenYears = hasSolvedBreakeven ? solvedWeeks / WEEKS_PER_YEAR : breakevenYears;
      }

      let billionYears = null;
      // "$1B/y" target in weekly core units.
      let weeklyBillionTarget = 1e9 / WEEKS_PER_YEAR;
      if (rev0 >= weeklyBillionTarget) {
        billionYears = 0;
      }

      let canSolveBillion = billionYears === null && growth > 0 && rev0 > 0;
      if (canSolveBillion) {
        let solvedBillionWeeks = Math.log(weeklyBillionTarget / rev0) / Math.log(1 + growth);
        let hasSolvedBillion = isFiniteNumber(solvedBillionWeeks) && solvedBillionWeeks >= 0;
        billionYears = hasSolvedBillion ? solvedBillionWeeks / WEEKS_PER_YEAR : billionYears;
      }

      return {
        breakevenYears: breakevenYears,
        billionYears: billionYears
      };
    };

    /**
     * Formats time for KPI blocks.
     * Requirement: always in years regardless of selected units.
     */
    _formatTime(yearsValue) {
      if (!isFiniteNumber(yearsValue)) {
        return 'never';
      }

      return 'year ' + yearsValue.toFixed(yearsValue < 10 ? 1 : 0);
    };

    /**
     * Syncs input values with current state.
     */
    _updateInputs() {
      this.nodes.inputRevenue.value = formatInputMoney(flowFromWeekly(this.state.weeklyRevenue0, this.state.units));
      this.nodes.inputGrossMargin.value = formatInputPercent(this.state.grossMargin);
      this.nodes.inputFixed.value = formatInputMoney(flowFromWeekly(this.state.weeklyFixedExpenses, this.state.units));

      // Show growth input in the user-selected unit.
      let displayGrowth = growthFromWeekly(this.state.weeklyGrowthRate, this.state.units);
      this.nodes.inputGrowth.value = formatInputPercent(displayGrowth);

      this.nodes.radios.querySelectorAll('input[type="radio"][data-group="units"]').forEach(function (radio) {
        radio.checked = radio.value === this.state.units;
      }, this);

      this.nodes.radios.querySelectorAll('input[type="radio"][data-group="expenseViz"]').forEach(function (radio) {
        radio.checked = radio.value === this.state.expenseViz;
      }, this);
    };

    /**
     * Updates log-scale Y domain and ticks for the active unit.
     */
    _updateYDomain() {
      if (this._applyDragDomainLock()) {
        return;
      }

      let displayUnit = this.state.units;
      let baselineDisplayTicks = Y_TICKS_BY_UNIT[displayUnit] || Y_TICKS_BY_UNIT.year || [];
      let yMinDisplay = MIN_DISPLAY_Y_FLOOR_BY_UNIT[displayUnit] || 1;
      let yMaxDisplayRaw = flowFromWeekly(this._visibleYMaxWeekly(), displayUnit);
      let yMaxDisplayHeadroom = isFiniteNumber(yMaxDisplayRaw) && yMaxDisplayRaw > 0 ? yMaxDisplayRaw * 1.15 : yMinDisplay * 1.2;
      let yMaxDisplaySnapped = snapUpOneThree(yMaxDisplayHeadroom);
      let yMaxDisplay = Math.max(yMinDisplay * 1.2, yMaxDisplaySnapped);
      let normalizedDomain = this._applyChartDomain(displayUnit, yMinDisplay, yMaxDisplay);
      this._setDomainTicks(displayUnit, baselineDisplayTicks, normalizedDomain);
    };

    /**
     * Projects time t (in years) to SVG X coordinate.
     */
    _xFromTime(tYearsFromStart) {
      let plotWidth = this.chart.width - this.chart.paddingLeft - this.chart.paddingRight;
      let totalSpan = this.chart.tMax - this.chart.tMin;
      return this.chart.paddingLeft + (tYearsFromStart / totalSpan) * plotWidth;
    };

    /**
     * Inverse projection from X coordinate to time t (years).
     */
    _xToTime(x) {
      let plotWidth = this.chart.width - this.chart.paddingLeft - this.chart.paddingRight;
      let clamped = clamp(x, this.chart.paddingLeft, this.chart.width - this.chart.paddingRight);
      let ratio = (clamped - this.chart.paddingLeft) / plotWidth;
      let totalSpan = this.chart.tMax - this.chart.tMin;
      return ratio * totalSpan;
    };

    /**
     * Projects a value to log-scale Y.
     */
    _yFromValue(value) {
      let projectionValue = this._clampForProjection(value);
      let safeValue = isFiniteNumber(projectionValue) ? clamp(projectionValue, this.chart.yMin, this.chart.yMax) : this.chart.yMin;
      let lnMin = Math.log(this.chart.yMin);
      let lnMax = Math.log(this.chart.yMax);
      let lnValue = Math.log(safeValue);
      let ratio = (lnValue - lnMin) / (lnMax - lnMin || 1);

      let plotHeight = this.chart.height - this.chart.paddingTop - this.chart.paddingBottom;
      return this.chart.height - this.chart.paddingBottom - ratio * plotHeight;
    };

    /**
     * Inverse projection from Y coordinate to flow value (log scale).
     */
    _yToValue(y) {
      let plotHeight = this.chart.height - this.chart.paddingTop - this.chart.paddingBottom;
      let clamped = clamp(y, this.chart.paddingTop, this.chart.height - this.chart.paddingBottom);
      let ratio = (this.chart.height - this.chart.paddingBottom - clamped) / plotHeight;
      let lnMin = Math.log(this.chart.yMin);
      let lnMax = Math.log(this.chart.yMax);
      return Math.exp(lnMin + ratio * (lnMax - lnMin));
    };

    _expenseBarTimes() {
      let span = this.chart.tMax - this.chart.tMin;
      if (!isFiniteNumber(span) || span < 0) {
        return [];
      }

      let yearsSpan = Math.max(0, Math.round(span));
      let times = [];
      for (let yearOffset = 0; yearOffset <= yearsSpan; yearOffset += 1) {
        times.push(yearOffset);
      }
      return times;
    };

    _yFromValueOrZero(value, plotBottomY) {
      let shouldUseBaseline = !isFiniteNumber(value) || value <= 0;
      if (shouldUseBaseline) {
        return plotBottomY;
      }
      return this._yFromValue(value);
    };

    _valueFromYOrZero(y, plotBottomY) {
      let hasFiniteInputs = isFiniteNumber(y) && isFiniteNumber(plotBottomY);
      if (!hasFiniteInputs) {
        return NaN;
      }

      // plotBottomY is the visual "$0" baseline for the log plot.
      if (y >= plotBottomY - 0.01) {
        return 0;
      }

      return this._finiteValueOrMax(this._yToValue(y));
    };

    _appendExpenseBarSegmentLabel(group, textValue, x, y, fillColor) {
      let hasTarget = group && textValue && isFiniteNumber(x) && isFiniteNumber(y);
      if (!hasTarget) {
        return;
      }

      let label = createSvgEl('text');
      let labelFill = fillColor || COLORS.black;
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
        'pointer-events': 'none'
      });
      group.appendChild(label);
    };

    _drawExpenseBars(barGroup, labelGroup, plotBottomY, yearSpacing) {
      let hasTarget = barGroup && labelGroup && isFiniteNumber(plotBottomY);
      if (!hasTarget) {
        return;
      }

      let sampleTimes = this._expenseBarTimes();
      if (!sampleTimes.length) {
        return;
      }

      let span = this.chart.tMax - this.chart.tMin;
      if (!isFiniteNumber(span) || span <= 0) {
        return;
      }

      let yVariableStart = this._yFromValueOrZero(this._variableAt(0), plotBottomY);
      let yVariableEnd = this._yFromValueOrZero(this._variableAt(span), plotBottomY);
      let yTotalStart = this._yFromValueOrZero(this._totalAt(0), plotBottomY);
      let yTotalEnd = this._yFromValueOrZero(this._totalAt(span), plotBottomY);

      let spacing = isFiniteNumber(yearSpacing) ? yearSpacing : 18;
      let barWidth = clamp(spacing * 0.55, 10, 28);
      let yearsSpan = isFiniteNumber(span) && span >= 0 ? Math.max(0, Math.round(span)) : 0;
      let labelStep = Math.max(1, Math.ceil(44 / Math.max(1, spacing)));

      sampleTimes.forEach(function (tYearsFromStart) {
        let ratio = clamp(tYearsFromStart / span, 0, 1);
        let yVariableTop = yVariableStart + ratio * (yVariableEnd - yVariableStart);
        let yTotalTop = yTotalStart + ratio * (yTotalEnd - yTotalStart);
        yTotalTop = Math.min(yTotalTop, yVariableTop);

        let x = this._xFromTime(tYearsFromStart);
        let xLeft = clamp(x - barWidth / 2, this.chart.paddingLeft, this.chart.width - this.chart.paddingRight - barWidth);

        let variableTopY = Math.min(plotBottomY, yVariableTop);
        let variableHeight = Math.max(0, Math.abs(plotBottomY - yVariableTop));
        let fixedTopY = Math.min(yVariableTop, yTotalTop);
        let fixedHeight = Math.max(0, Math.abs(yVariableTop - yTotalTop));

        let variableRect = createSvgEl('rect');
        setAttrs(variableRect, {
          x: xLeft,
          y: variableTopY,
          width: barWidth,
          height: variableHeight,
          fill: COLORS.variableLight,
          opacity: EXPENSE_SERIES_OPACITY,
          'pointer-events': 'none'
        });
        barGroup.appendChild(variableRect);

        let fixedRect = createSvgEl('rect');
        setAttrs(fixedRect, {
          x: xLeft,
          y: fixedTopY,
          width: barWidth,
          height: fixedHeight,
          fill: COLORS.fixedLight,
          opacity: EXPENSE_SERIES_OPACITY,
          'pointer-events': 'none'
        });
        barGroup.appendChild(fixedRect);

        let shouldLabelThisBar = (tYearsFromStart % labelStep === 0) || tYearsFromStart === 0 || tYearsFromStart === yearsSpan;
        if (!shouldLabelThisBar) {
          return;
        }

        let variableWeekly = this._valueFromYOrZero(yVariableTop, plotBottomY);
        let totalWeekly = this._valueFromYOrZero(yTotalTop, plotBottomY);
        let remainderWeekly = (isFiniteNumber(totalWeekly) && isFiniteNumber(variableWeekly))
          ? Math.max(0, totalWeekly - variableWeekly)
          : NaN;

        let variableLabelText = variableHeight >= MIN_BAR_LABEL_SEGMENT_HEIGHT
          ? formatBarMoneyFromWeekly(variableWeekly, this.state.units)
          : '';
        let fixedLabelText = fixedHeight >= MIN_BAR_LABEL_SEGMENT_HEIGHT
          ? formatBarMoneyFromWeekly(remainderWeekly, this.state.units)
          : '';

        if (variableLabelText) {
          let variableBottomY = variableTopY + variableHeight;
          let variableLabelY = clamp(
            plotBottomY - 6,
            variableTopY + 10,
            variableBottomY - 4
          );
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

        let fixedBottomY = fixedTopY + fixedHeight;
        let fixedLabelY = clamp(
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
    };

    /**
     * Generates a sampled polyline path for value-over-time functions.
     */
    _linePath(fn, segments, anchorTimes) {
      let points = [];
      let sampleSegments = clamp(
        Math.round(isFiniteNumber(segments) ? segments : this._totalLineSegments()),
        2,
        MAX_TOTAL_LINE_SEGMENTS
      );
      let tSpanRaw = this.chart.tMax - this.chart.tMin;
      let tSpan = isFiniteNumber(tSpanRaw) && tSpanRaw > 0 ? tSpanRaw : 0;
      let sampledTimes = [];
      for (let i = 0; i <= sampleSegments; i += 1) {
        sampledTimes.push((i / sampleSegments) * tSpan);
      }

      let extraAnchors = Array.isArray(anchorTimes) ? anchorTimes : [];
      extraAnchors.forEach(function (anchorTime) {
        if (!isFiniteNumber(anchorTime)) {
          return;
        }
        sampledTimes.push(clamp(anchorTime, 0, tSpan));
      });

      let uniqueTimes = sampledTimes
        .sort(function (a, b) {
          return a - b;
        })
        .filter(function (value, idx, arr) {
          return idx === 0 || Math.abs(value - arr[idx - 1]) > 1e-9;
        });

      uniqueTimes.forEach(function (t) {
        points.push(this._xFromTime(t) + ',' + this._yFromValue(fn.call(this, t)));
      }, this);

      return points.join(' ');
    };

    _lineSegmentPath(fn) {
      let tStart = 0;
      let tEnd = this.chart.tMax - this.chart.tMin;
      let startPoint = this._xFromTime(tStart) + ',' + this._yFromValue(fn.call(this, tStart));
      let endPoint = this._xFromTime(tEnd) + ',' + this._yFromValue(fn.call(this, tEnd));
      return startPoint + ' ' + endPoint;
    };

    _totalLineSegments() {
      let plotWidth = this.chart.width - this.chart.paddingLeft - this.chart.paddingRight;
      return clamp(
        Math.round(plotWidth / TOTAL_LINE_PIXELS_PER_SEGMENT),
        MIN_TOTAL_LINE_SEGMENTS,
        MAX_TOTAL_LINE_SEGMENTS
      );
    };

    _formatSeriesEndLabel(title, endWeekly) {
      let displayValue = flowFromWeekly(endWeekly, this.state.units);
      let hasValidDisplayValue = isFiniteNumber(displayValue) && displayValue >= 0;
      if (!hasValidDisplayValue) {
        return '';
      }
      let valueText = formatMoney(displayValue);
      return title + ' ' + valueText;
    };

    _rightLineLabelCandidates(tEnd) {
      let isBarsMode = this.state.expenseViz === 'bars';
      let revenueEndWeekly = this._revenueAt(tEnd);
      let variableEndWeekly = this._variableAt(tEnd);
      let fixedEndWeekly = this.state.weeklyFixedExpenses;
      let totalEndWeekly = this._totalAt(tEnd);

      let candidates = [
        {
          key: 'revenue',
          title: 'Revenue',
          endWeekly: revenueEndWeekly,
          color: COLORS.revenue,
          column: 'outside',
          targetY: this._yFromValue(revenueEndWeekly),
          dy: 4
        },
        {
          key: 'total',
          title: 'Total expenses',
          endWeekly: totalEndWeekly,
          color: COLORS.total,
          column: 'outside',
          targetY: this._yFromValue(totalEndWeekly),
          dy: -6
        },
        {
          key: 'fixed',
          title: 'Fixed expenses',
          endWeekly: fixedEndWeekly,
          color: COLORS.darkGrey,
          column: 'inside',
          targetY: this._yFromValue(fixedEndWeekly),
          dy: -4
        },
        {
          key: 'variable',
          title: 'Variable expenses',
          endWeekly: variableEndWeekly,
          color: COLORS.variable,
          column: 'inside',
          targetY: this._yFromValue(variableEndWeekly),
          dy: 10
        }
      ];

      return candidates
        .filter(function (candidate) {
          let isSeriesVisible = !isBarsMode || candidate.key !== 'fixed';
          return isSeriesVisible && isFiniteNumber(candidate.endWeekly) && candidate.endWeekly >= 0 && isFiniteNumber(candidate.targetY);
        })
        .map(function (candidate) {
          return {
            key: candidate.key,
            text: this._formatSeriesEndLabel(candidate.title, candidate.endWeekly),
            color: candidate.color,
            column: candidate.column,
            targetY: candidate.targetY,
            dy: candidate.dy
          };
        }, this)
        .filter(function (candidate) {
          return Boolean(candidate.text);
        });
    };

    _layoutLineLabelsY(candidates, minY, maxY, minGap) {
      if (!candidates.length) {
        return [];
      }

      let sorted = candidates
        .slice()
        .sort(function (a, b) {
          return a.targetY - b.targetY;
        })
        .map(function (candidate) {
          let idealY = clamp(candidate.targetY + (candidate.dy || 0), minY, maxY);
          let leaderStartY = clamp(candidate.targetY, minY, maxY);
          return {
            key: candidate.key,
            text: candidate.text,
            color: candidate.color,
            column: candidate.column,
            targetY: candidate.targetY,
            idealY: idealY,
            leaderStartY: leaderStartY,
            y: idealY
          };
        });

      let range = Math.max(0, maxY - minY);
      let effectiveGap = sorted.length < 2 ? 0 : Math.min(minGap, range / (sorted.length - 1));

      sorted.forEach(function (item, index) {
        if (index === 0) {
          return;
        }
        item.y = Math.max(item.y, sorted[index - 1].y + effectiveGap);
      });

      for (let i = sorted.length - 2; i >= 0; i -= 1) {
        sorted[i].y = Math.min(sorted[i].y, sorted[i + 1].y - effectiveGap);
      }

      sorted.forEach(function (item) {
        item.y = clamp(item.y, minY, maxY);
      });

      return sorted;
    };

    _layoutRightLineLabels(candidates, minY, maxY, minGap) {
      return this._layoutLineLabelsY(candidates, minY, maxY, minGap);
    };

    _positionRightLineLabels(labels, plotRightX) {
      let outsideX = this.chart.width - 8;
      let insideX = plotRightX - (HANDLE_RECT_VISUAL_WIDTH / 2 + RIGHT_LABEL_INSIDE_PADDING_FROM_HANDLE);

      return labels.map(function (item) {
        let isInside = item.column === 'inside';
        return Object.assign({}, item, {
          x: isInside ? insideX : outsideX,
          anchor: 'end'
        });
      });
    };

    _renderRightLineLabels(group, labels, leaderStartX) {
      labels.forEach(function (item) {
        let x = isFiniteNumber(item.x) ? item.x : this.chart.width - 8;
        let anchor = item.anchor === 'start' ? 'start' : 'end';
        let hasDisplacement = Math.abs(item.y - item.idealY) > 1;
        if (hasDisplacement) {
          let leaderEndX = anchor === 'end' ? x + 2 : x - 2;
          let leader = createSvgEl('line');
          setAttrs(leader, {
            x1: leaderStartX,
            y1: item.leaderStartY,
            x2: leaderEndX,
            y2: item.y,
            stroke: item.color,
            'stroke-width': 1,
            opacity: 0.35
          });
          group.appendChild(leader);
        }

        let text = createSvgEl('text');
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
          'stroke-linejoin': 'round'
        });
        group.appendChild(text);
      }, this);
    };

    _handleLabelText(handle) {
      if (handle === 'growth') {
        let unitToken = UNIT_TOKEN_BY_ID[this.state.units] || 'Growth';
        let displayGrowth = growthFromWeekly(this.state.weeklyGrowthRate, this.state.units);
        let growthText = formatInputPercent(displayGrowth);
        return growthText + ' ' + unitToken;
      }

      if (handle === 'variable') {
        let tEndYears = this.state.yearsMax - this.state.yearsMin;
        let variableEndText = this._formatSeriesEndLabel('Variable expenses', this._variableAt(tEndYears));
        let grossMarginText = 'Gross margin ' + formatInputPercent(this.state.grossMargin);
        if (!variableEndText) {
          return grossMarginText;
        }
        return grossMarginText + ', ' + variableEndText;
      }

      if (handle === 'fixed') {
        let fixedDisplayValue = flowFromWeekly(this.state.weeklyFixedExpenses, this.state.units);
        return formatMoney(fixedDisplayValue) + ' Fixed Expenses';
      }

      return '';
    };

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
    };

    _handleLabelLayout(handle, point, bounds) {
      let layout = {
        x: point.x,
        y: point.y,
        anchor: 'middle'
      };

      if (handle === 'growth') {
        layout.y = point.y - 14;
      }

      let isExpenseHandle = handle === 'fixed' || handle === 'variable';
      if (isExpenseHandle) {
        let leftOffsetX = point.x - 12;
        let flipToRight = leftOffsetX < bounds.minX + 24;
        let yOffset = handle === 'variable' ? 14 : -8;
        layout.x = flipToRight ? point.x + 12 : leftOffsetX;
        layout.y = point.y + yOffset;
        layout.anchor = flipToRight ? 'start' : 'end';
      }

      layout.x = clamp(layout.x, bounds.minX, bounds.maxX);
      layout.y = clamp(layout.y, bounds.minY, bounds.maxY);
      return layout;
    };

    _renderActiveHandleLabel(group, activeHandle, handlePoints, bounds) {
      let isSupportedHandle = activeHandle === 'growth' || activeHandle === 'variable' || activeHandle === 'fixed';
      if (!isSupportedHandle) {
        return;
      }

      let point = handlePoints[activeHandle];
      if (!point) {
        return;
      }

      let textValue = this._handleLabelText(activeHandle);
      if (!textValue) {
        return;
      }

      let layout = this._handleLabelLayout(activeHandle, point, bounds);
      let label = createSvgEl('text');
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
        'pointer-events': 'none'
      });
      group.appendChild(label);
    };

    /**
     * Full SVG render: grid, axes, lines, labels, markers, and handles.
     */
    _draw(metrics) {
      let gGrid = this.nodes.svgGroups.grid;
      let gAxes = this.nodes.svgGroups.axes;
      let gLines = this.nodes.svgGroups.lines;
      let gLabels = this.nodes.svgGroups.labels;
      let gHandles = this.nodes.svgGroups.handles;
      // Metrics contract: object => use for metric-dependent draw parts, null/undefined => skip them.
      let drawMetrics = metrics;

      gGrid.innerHTML = '';
      gAxes.innerHTML = '';
      gLines.innerHTML = '';
      gLabels.innerHTML = '';
      gHandles.innerHTML = '';

      let self = this;
      let plotRightX = this.chart.width - this.chart.paddingRight;
      let plotTopY = this.chart.paddingTop;
      let plotBottomY = this.chart.height - this.chart.paddingBottom;
      let gHover = createSvgEl('g');
      setAttrs(gHover, {
        'pointer-events': 'none'
      });

      this.chart.ticksY.forEach(function (tick) {
        let y = self._yFromValue(tick);

        let line = createSvgEl('line');
        setAttrs(line, {
          x1: self.chart.paddingLeft,
          y1: y,
          x2: self.chart.width - self.chart.paddingRight,
          y2: y,
          stroke: COLORS.grid,
          'stroke-width': 1
        });
        gGrid.appendChild(line);

        let label = createSvgEl('text');
        label.textContent = formatMoney(flowFromWeekly(tick, self.state.units));
        setAttrs(label, {
          x: self.chart.paddingLeft - 10,
          y: y + 4,
          fill: COLORS.black,
          'font-size': 10,
          'font-weight': 500,
          'text-anchor': 'end'
        });
        gAxes.appendChild(label);
      });

      // Visual "$0" baseline (excluded from log-domain calculations).
      let yZero = plotBottomY;
      let zeroLabel = createSvgEl('text');
      zeroLabel.textContent = '$0';
      setAttrs(zeroLabel, {
        x: this.chart.paddingLeft - 10,
        y: yZero + 4,
        fill: COLORS.black,
        'font-size': 10,
        'font-weight': 500,
        'text-anchor': 'end'
      });
      gAxes.appendChild(zeroLabel);

      let totalYearSpan = this.chart.tMax - this.chart.tMin;
      let plotWidth = this.chart.width - this.chart.paddingLeft - this.chart.paddingRight;
      let yearSpacing = plotWidth / Math.max(1, totalYearSpan);
      let yearLabelStep = Math.max(1, Math.ceil(MIN_X_YEAR_LABEL_GAP / Math.max(1, yearSpacing)));

      for (let year = this.chart.tMin; year <= this.chart.tMax; year += 1) {
        let t = year - this.chart.tMin;
        let x = this._xFromTime(t);

        let vLine = createSvgEl('line');
        setAttrs(vLine, {
          x1: x,
          y1: this.chart.paddingTop,
          x2: x,
          y2: plotBottomY,
          stroke: COLORS.grid,
          'stroke-width': 1
        });
        gGrid.appendChild(vLine);

        let shouldShowYearLabel = (t % yearLabelStep === 0) || year === this.chart.tMax;
        if (!shouldShowYearLabel) {
          continue;
        }

        let xTick = createSvgEl('text');
        xTick.textContent = String(year);
        setAttrs(xTick, {
          x: x,
          y: plotBottomY + 18,
          fill: COLORS.black,
          'font-size': 10,
          'font-weight': 500,
          'text-anchor': 'middle'
        });
        gAxes.appendChild(xTick);
      }

      let axisRevenueExpense = createSvgEl('text');
      axisRevenueExpense.textContent = 'Revenue/Expense';
      setAttrs(axisRevenueExpense, {
        x: this.chart.paddingLeft + 8,
        y: 14,
        fill: COLORS.black,
        'font-size': 10,
        'font-weight': 700,
        'text-anchor': 'start'
      });
      gAxes.appendChild(axisRevenueExpense);

      let axisYears = createSvgEl('text');
      axisYears.textContent = 'Years';
      setAttrs(axisYears, {
        x: this.chart.width - this.chart.paddingRight,
        y: this.chart.height - 8,
        fill: COLORS.black,
        'font-size': 10,
        'font-weight': 700,
        'text-anchor': 'end'
      });
      gAxes.appendChild(axisYears);

      /**
       * Draws a line and a wide invisible hit layer for stable tooltips.
       */
      function addLine(config) {
        let points = config.points;
        let stroke = config.stroke;
        let width = config.width;
        let hasHoverValue = typeof config.hoverValueAt === 'function';
        let titleText = hasHoverValue ? '' : config.title;
        let shouldDrawVisible = config.showVisible !== false;
        if (shouldDrawVisible) {
          let visible = createSvgEl('polyline');
          setAttrs(visible, {
            fill: 'none',
            points: points,
            stroke: stroke,
            'stroke-width': width,
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round',
            opacity: config.strokeOpacity == null ? 1 : config.strokeOpacity,
            'pointer-events': 'none'
          });
          config.dasharray && visible.setAttribute('stroke-dasharray', String(config.dasharray));
          gLines.appendChild(visible);
        }

        // Keep hit stroke solid/wide so line hover remains easy.
        let hit = createSvgEl('polyline');
        setAttrs(hit, {
          fill: 'none',
          points: points,
          stroke: 'rgba(0,0,0,0.001)',
          'stroke-width': Math.max(14, width + 8),
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
          'pointer-events': 'stroke',
          style: 'cursor:help'
        });

        if (titleText) {
          let title = createSvgEl('title');
          title.textContent = titleText;
          hit.appendChild(title);
        }

        if (hasHoverValue) {
          function clearHover() {
            gHover.innerHTML = '';
          }

          hit.addEventListener('pointerleave', clearHover);
          hit.addEventListener('pointercancel', clearHover);

          hit.addEventListener('pointermove', function (event) {
            let coords = self._eventToChart(event);
            if (!coords) {
              return;
            }

            let tEnd = self.chart.tMax - self.chart.tMin;
            let tRaw = self._xToTime(coords.x);
            let t = isFiniteNumber(tRaw) ? clamp(tRaw, 0, tEnd) : 0;
            let weeklyValue = config.hoverValueAt.call(self, t);
            if (!isFiniteNumber(weeklyValue) || weeklyValue < 0) {
              clearHover();
              return;
            }

            let displayValue = flowFromWeekly(weeklyValue, self.state.units);
            if (!isFiniteNumber(displayValue) || displayValue < 0) {
              clearHover();
              return;
            }

            let x = self._xFromTime(t);
            let y = self._yFromValue(weeklyValue);
            let textValue = formatMoney(displayValue);
            let textLabel = (config.hoverPrefix || '') + textValue;
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
            let tooltipY = clamp(y - 10, plotTopY + 14, plotBottomY - 6);

            gHover.innerHTML = '';
            let dot = createSvgEl('circle');
            setAttrs(dot, {
              cx: x,
              cy: y,
              r: 3.5,
              fill: COLORS.white,
              stroke: config.hoverColor || COLORS.black,
              'stroke-width': 2
            });
            gHover.appendChild(dot);

            let text = createSvgEl('text');
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
              'stroke-linejoin': 'round'
            });
            gHover.appendChild(text);
          });
        }

        gLines.appendChild(hit);
      }

      let tEnd = this.chart.tMax - this.chart.tMin;
      let isBarsMode = this.state.expenseViz === 'bars';
      let lineSegments = this._totalLineSegments();
      let lineAnchorTimes = [];
      let hasBreakevenInRange = drawMetrics &&
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
        strokeOpacity: 1
      });
      addLine({
        points: this._linePath(this._variableAt, lineSegments, lineAnchorTimes),
        stroke: COLORS.variableLight,
        width: 2.5,
        title: 'Variable expenses',
        dasharray: EXPENSE_SERIES_DASHARRAY,
        strokeOpacity: EXPENSE_SERIES_OPACITY,
        showVisible: !isBarsMode
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
          showVisible: true
        });
      }
      addLine({
        points: this._linePath(this._totalAt, lineSegments, lineAnchorTimes),
        stroke: COLORS.total,
        width: 3.5,
        title: 'Total expenses',
        strokeOpacity: 1
      });

      let activeHandle = this.drag && this.drag.handle ? this.drag.handle : '';
      let labelMinY = plotTopY + AXIS_LABEL_TOP_CLEARANCE;
      let labelMaxY = plotBottomY - 2;

      let rightLabelCandidates = this._rightLineLabelCandidates(tEnd).filter(function (candidate) {
        let isSuppressed = (activeHandle === 'fixed' && candidate.key === 'fixed') ||
          (activeHandle === 'variable' && candidate.key === 'variable');
        return !isSuppressed;
      });

      // Layout all right-edge labels together so inside/outside columns don't collide when values align.
      let laidOutRightLabels = this._layoutRightLineLabels(rightLabelCandidates, labelMinY, labelMaxY, RIGHT_LINE_LABEL_MIN_GAP);
      let positionedRightLabels = this._positionRightLineLabels(laidOutRightLabels, plotRightX);
      let rightLabelLeaderStartX = plotRightX - 1;
      this._renderRightLineLabels(gLabels, positionedRightLabels, rightLabelLeaderStartX);

      if (hasBreakevenInRange) {
        let bx = this._xFromTime(drawMetrics.breakevenYears);
        let by = this._yFromValue(this._totalAt(drawMetrics.breakevenYears));

        let marker = createSvgEl('circle');
        setAttrs(marker, {
          cx: bx,
          cy: by,
          r: 4,
          fill: COLORS.white,
          stroke: COLORS.total,
          'stroke-width': 2
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
        let hit = createSvgEl('rect');
        setAttrs(hit, {
          x: x - visualW / 2 - hitPad,
          y: y - visualH / 2 - hitPad,
          width: visualW + hitPad * 2,
          height: visualH + hitPad * 2,
          fill: 'rgba(0,0,0,0.001)',
          'data-handle': name,
          style: 'cursor:ns-resize'
        });
        gHandles.appendChild(hit);

        let rect = createSvgEl('rect');
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
          style: 'cursor:ns-resize'
        });
        gHandles.appendChild(rect);

        let centerLine1 = createSvgEl('line');
        setAttrs(centerLine1, {
          x1: x - 5,
          y1: y - 2.5,
          x2: x + 5,
          y2: y - 2.5,
          stroke: color,
          'stroke-width': 1.5,
          'data-handle': name,
          style: 'cursor:ns-resize'
        });
        gHandles.appendChild(centerLine1);

        let centerLine2 = createSvgEl('line');
        setAttrs(centerLine2, {
          x1: x - 5,
          y1: y + 2.5,
          x2: x + 5,
          y2: y + 2.5,
          stroke: color,
          'stroke-width': 1.5,
          'data-handle': name,
          style: 'cursor:ns-resize'
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
        let hit = createSvgEl('circle');
        setAttrs(hit, {
          cx: x,
          cy: y,
          r: hitR,
          fill: 'rgba(0,0,0,0.001)',
          'data-handle': name,
          style: 'cursor:move'
        });
        gHandles.appendChild(hit);

        let circle = createSvgEl('circle');
        setAttrs(circle, {
          cx: x,
          cy: y,
          r: visualR,
          fill: COLORS.white,
          stroke: color,
          'stroke-width': 3,
          'data-handle': name,
          style: 'cursor:move'
        });
        gHandles.appendChild(circle);
      }

      let startHandleT = 0;
      let endHandleT = tEnd;
      let growthT = tEnd * 0.55;
      let handlePoints = {
        'revenue-start': {
          x: this._xFromTime(startHandleT),
          y: this._yFromValue(this._revenueAt(startHandleT))
        },
        fixed: {
          x: this._xFromTime(startHandleT),
          y: this._yFromValue(this.state.weeklyFixedExpenses)
        },
        variable: {
          x: this._xFromTime(endHandleT),
          y: this._yFromValue(this._variableAt(endHandleT))
        },
        growth: {
          x: this._xFromTime(growthT),
          y: this._yFromValue(this._revenueAt(growthT))
        }
      };

      addHandleRect('revenue-start', handlePoints['revenue-start'].x, handlePoints['revenue-start'].y, COLORS.revenue);
      addHandleRect('fixed', handlePoints.fixed.x, handlePoints.fixed.y, COLORS.fixed);
      addHandleRect('variable', handlePoints.variable.x, handlePoints.variable.y, COLORS.variable);
      addHandleCircle('growth', handlePoints.growth.x, handlePoints.growth.y, COLORS.revenue);

      let handleLabelBounds = {
        minX: this.chart.paddingLeft + 8,
        maxX: plotRightX - 8,
        minY: plotTopY + AXIS_LABEL_TOP_CLEARANCE,
        maxY: plotBottomY - 6
      };
      this._renderActiveHandleLabel(gHandles, 'growth', handlePoints, handleLabelBounds);

      let isExpenseHandleActive = activeHandle === 'fixed' || activeHandle === 'variable';
      isExpenseHandleActive && this._renderActiveHandleLabel(gHandles, activeHandle, handlePoints, handleLabelBounds);

      gHandles.appendChild(gHover);
    };

    /**
     * Main update cycle: input -> domain -> draw -> KPI.
     */
    render(options) {
      let opts = options || {};
      if (!opts.skipInputs) {
        this._updateInputs();
      }
      if (!opts.skipYDomain) {
        this._updateYDomain();
      }
      let metrics = opts.skipKpis ? null : this._computeMetrics();
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
    let nodes = document.querySelectorAll('#ims-growth-calc');
    if (!nodes.length) {
      return [];
    }

    let instances = [];
    nodes.forEach(function (node) {
      instances.push(new GrowthCalculator(node));
    });
    return instances;
  }

  // Public API for external embedding (for example, Webflow custom code).
  window.ImsGrowthCalculator = {
    init: init,
    autoInit: autoInit
  };

  // Auto-start after DOM is ready.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      autoInit();
    });
  } else {
    autoInit();
  }
})();
