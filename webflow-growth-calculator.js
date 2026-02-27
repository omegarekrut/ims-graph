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
    weeklyRevenue0: 100,
    weeklyGrowthRate: 0.0353,
    grossMargin: 1,
    weeklyFixedExpenses: 1600,
    yearsMin: 1,
    yearsMax: 9
  };

  // Legacy Y-axis maxima by active unit.
  const Y_MAX_BY_UNIT = {
    week: 10000000,
    month: 30000000,
    quarter: 100000000,
    year: 1000000000
  };
  const Y_HEADROOM_FACTOR = 1.08;
  const MAX_FINITE_FLOW = Number.MAX_VALUE;
  const PROJECTION_SOFT_CAP_WEEKLY = 1e15;
  const MIN_WEEKLY_LOG_FLOOR = 1e-9;
  const MIN_DISPLAY_Y_FLOOR_BY_UNIT = {
    week: 1,
    month: 1,
    quarter: 1,
    year: 1
  };
  const MIN_Y_TICK_GAP = 14;
  const AXIS_LABEL_TOP_CLEARANCE = 12;
  const MIN_X_YEAR_LABEL_GAP = 28;
  const RIGHT_LINE_LABEL_MIN_GAP = 14;
  const UNIT_TOKEN_BY_ID = {
    week: 'WoW',
    month: 'MoM',
    quarter: 'QoQ',
    year: 'YoY'
  };
  const MIN_TOTAL_LINE_SEGMENTS = 120;
  const MAX_TOTAL_LINE_SEGMENTS = 320;
  const TOTAL_LINE_PIXELS_PER_SEGMENT = 5;

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

  /**
   * Formats money for axes and labels with compact suffixes.
   */
  function formatMoney(value) {
    if (!isFiniteNumber(value)) {
      return '$0';
    }

    let abs = Math.abs(value);
    let suffix = '';
    let scaled = abs;

    let scales = [
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
    return (value < 0 ? '-$' : '$') + text + suffix;
  }

  /**
   * Formats a money value for input text.
   */
  function formatInputMoney(value) {
    if (!isFiniteNumber(value)) {
      return '$0';
    }
    return '$' + Math.max(0, value).toFixed(0);
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
   * Generates "nice" log ticks (bases 1/2.5/5).
   * Kept as a fallback in the current version.
   */
  function createNiceTicks(minValue, maxValue, targetCount) {
    let min = Math.max(1, minValue);
    let max = Math.max(min * 1.01, maxValue);
    let bases = [1, 2.5, 5];
    let ticks = [];

    let minExp = Math.floor(Math.log10(min)) - 1;
    let maxExp = Math.ceil(Math.log10(max)) + 1;

    for (let exp = minExp; exp <= maxExp; exp += 1) {
      let scale = Math.pow(10, exp);
      for (let i = 0; i < bases.length; i += 1) {
        let tick = bases[i] * scale;
        if (tick >= min * 0.98 && tick <= max * 1.02) {
          ticks.push(tick);
        }
      }
    }

    return normalizeTicks(ticks, min, max, targetCount);
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
        '.igc__radios{display:flex;gap:16px;align-items:center;flex-wrap:wrap;font-size:14px;line-height:1.4;}' +
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
        if (unit.id === self.state.units) {
          input.checked = true;
        }

        let text = document.createElement('span');
        text.textContent = unit.label;

        label.appendChild(input);
        label.appendChild(text);
        radios.appendChild(label);
      });

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
        '<div class="igc__field"><label class="igc__field-label">Revenue</label><input class="igc__input" data-key="revenue" type="text" /></div>' +
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
        yMin: flowToWeekly(Y_TICKS_BY_UNIT[this.state.units][0], this.state.units),
        yMax: flowToWeekly(Y_MAX_BY_UNIT[this.state.units] || Y_MAX_BY_UNIT.year, this.state.units),
        ticksY: []
      };
    };

    /**
     * Binds UI and chart events (radio/input/drag).
     */
    _bind() {
      let self = this;

      this.nodes.radios.querySelectorAll('input[type="radio"]').forEach(function (radio) {
        radio.addEventListener('change', function () {
          if (radio.checked) {
            self.state.units = radio.value;
            self.render();
          }
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
        let displayValue = parseMoney(text);
        if (!isFiniteNumber(displayValue)) {
          return;
        }

        self.state.weeklyRevenue0 = clamp(flowToWeekly(displayValue, self.state.units), 1 / WEEKS_PER_YEAR, 1e12);
      });

      bindInput(this.nodes.inputGrossMargin, function (text) {
        let value = parsePercent(text);
        if (!isFiniteNumber(value)) {
          return;
        }
        self.state.grossMargin = clamp(value, 0, 1);
      });

      bindInput(this.nodes.inputFixed, function (text) {
        let displayValue = parseMoney(text);
        if (!isFiniteNumber(displayValue)) {
          return;
        }

        self.state.weeklyFixedExpenses = clamp(flowToWeekly(displayValue, self.state.units), 0, 1e12);
      });

      bindInput(this.nodes.inputGrowth, function (text) {
        let displayValue = parsePercent(text);
        if (!isFiniteNumber(displayValue) || displayValue <= -0.99) {
          return;
        }

        self.state.weeklyGrowthRate = clamp(growthToWeekly(displayValue, self.state.units), -0.9, 10);
      });

      this.nodes.svg.addEventListener('pointerdown', function (event) {
        let target = event.target;
        if (!target || !target.dataset || !target.dataset.handle) {
          return;
        }

        self.drag = {
          handle: target.dataset.handle,
          domain: {
            yMinLock: self.chart.yMin,
            yMaxLock: self.chart.yMax,
            ticksYLock: self.chart.ticksY.slice()
          }
        };
        self.nodes.svg.setPointerCapture(event.pointerId);
      });

      this.nodes.svg.addEventListener('pointermove', function (event) {
        if (!self.drag) {
          return;
        }
        let hasStateUpdate = self._handleDrag(event);
        if (!hasStateUpdate) {
          return;
        }
        self.render();
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

    /**
     * Updates state while dragging a specific handle.
     */
    _handleDrag(event) {
      let coords = this._eventToChart(event);
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
        case 'revenue-start':
          this.state.weeklyRevenue0 = clamp(value, 1 / WEEKS_PER_YEAR, 1e12);
          return true;
        case 'growth': {
          let anchorT = clamp(t, 0.75, tMax);
          // Convert handle position to weekly growth via inverse exponential math.
          let anchorWeeks = anchorT * WEEKS_PER_YEAR;
          let ratio = clamp(value / this.state.weeklyRevenue0, 1e-6, 1e9);
          let weeklyGrowth = Math.pow(ratio, 1 / anchorWeeks) - 1;
          this.state.weeklyGrowthRate = clamp(weeklyGrowth, -0.9, 10);
          return true;
        }
        case 'fixed':
          this.state.weeklyFixedExpenses = clamp(value, 0, 1e12);
          return true;
        case 'variable': {
          let revAtEnd = this._revenueAt(tMax);
          if (revAtEnd <= 0) {
            return false;
          }
          // Variable handle controls variable/revenue ratio.
          let variableRatio = clamp(value / revAtEnd, 0, 1);
          this.state.grossMargin = clamp(1 - variableRatio, 0, 1);
          return true;
        }
        default:
          return false;
      }
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

    _visibleValuesForYDomain() {
      let tEnd = this.chart.tMax - this.chart.tMin;
      let candidateValues = [
        this._revenueAt(0),
        this._revenueAt(tEnd),
        this._variableAt(0),
        this._variableAt(tEnd),
        this._totalAt(0),
        this._totalAt(tEnd),
        this.state.weeklyFixedExpenses
      ];

      return candidateValues.filter(function (value) {
        return isFiniteNumber(value) && value > 0;
      });
    };

    _resolveDisplayDomain(displayUnit, displayFloor, fallbackYMaxDisplay, visibleValues) {
      let yMinDisplayCandidate = displayFloor;
      let yMaxDisplayCandidate = fallbackYMaxDisplay;

      if (visibleValues.length) {
        let minVisible = Math.min.apply(null, visibleValues);
        let maxVisible = Math.max.apply(null, visibleValues);
        let minVisibleDisplay = flowFromWeekly(minVisible, displayUnit);
        let hasMinVisibleDisplay = isFiniteNumber(minVisibleDisplay) && minVisibleDisplay > 0;
        yMinDisplayCandidate = hasMinVisibleDisplay ? minVisibleDisplay / 10 : yMinDisplayCandidate;

        let yMaxCandidateWeekly = this._clampForProjection(maxVisible * Y_HEADROOM_FACTOR);
        let yMaxCandidateDisplay = flowFromWeekly(yMaxCandidateWeekly, displayUnit);
        let hasMaxDisplay = isFiniteNumber(yMaxCandidateDisplay) && yMaxCandidateDisplay > 0;
        yMaxDisplayCandidate = hasMaxDisplay ? yMaxCandidateDisplay : yMaxDisplayCandidate;
      }

      let yMinDisplay = Math.max(displayFloor, yMinDisplayCandidate);
      let yMaxDisplay = yMaxDisplayCandidate;
      let invalidDomain = !isFiniteNumber(yMinDisplay) || !isFiniteNumber(yMaxDisplay) || yMinDisplay <= 0;
      if (invalidDomain) {
        yMinDisplay = displayFloor;
        yMaxDisplay = Math.max(yMinDisplay * 1.2, fallbackYMaxDisplay);
      }
      if (yMaxDisplay <= yMinDisplay) {
        yMaxDisplay = yMinDisplay * 1.2;
      }

      return {
        yMinDisplay: yMinDisplay,
        yMaxDisplay: yMaxDisplay
      };
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

    _buildDisplayTicks(baselineDisplayTicks, yMinDisplay, yMaxDisplay) {
      let targetCount = this._targetYTickCount();
      let hasBaselineTicks = baselineDisplayTicks.length > 0;
      let ticksDisplay = hasBaselineTicks ? baselineDisplayTicks.slice() : createOneThreeTicks(yMinDisplay, yMaxDisplay, targetCount);
      let baselineMax = hasBaselineTicks ? baselineDisplayTicks[baselineDisplayTicks.length - 1] : NaN;
      let shouldExtendBaseline = hasBaselineTicks && isFiniteNumber(baselineMax) && yMaxDisplay > baselineMax;
      if (shouldExtendBaseline) {
        let extension = createOneThreeTicks(Math.max(yMinDisplay, baselineMax), yMaxDisplay, targetCount * 2);
        ticksDisplay = ticksDisplay.concat(extension.filter(function (tick) {
          return tick > baselineMax * 1.001;
        }));
      }

      ticksDisplay = ticksDisplay
        .filter(function (tick) {
          return isFiniteNumber(tick) && tick >= yMinDisplay * 0.99 && tick <= yMaxDisplay * 1.01;
        })
        .sort(function (a, b) {
          return a - b;
        })
        .filter(function (tick, idx, arr) {
          return idx === 0 || Math.abs(tick - arr[idx - 1]) > 1e-9;
        });

      if (!ticksDisplay.length) {
        return createOneThreeTicks(yMinDisplay, yMaxDisplay, targetCount).filter(function (tick) {
          return isFiniteNumber(tick) && tick > 0;
        });
      }

      return ticksDisplay;
    };

    _setTicksFromDisplayDomain(displayUnit, baselineDisplayTicks, yMinDisplay, yMaxDisplay) {
      let ticksDisplay = this._buildDisplayTicks(baselineDisplayTicks, yMinDisplay, yMaxDisplay);
      this.chart.ticksY = this._filterYTicksByGap(
        ticksDisplay.map(function (tick) {
          return flowToWeekly(tick, displayUnit);
        }),
        MIN_Y_TICK_GAP,
        [
          this.chart.height - this.chart.paddingBottom,
          this.chart.paddingTop + AXIS_LABEL_TOP_CLEARANCE
        ]
      );

      if (!this.chart.ticksY.length) {
        let safeMinDisplay = isFiniteNumber(yMinDisplay) && yMinDisplay > 0 ? yMinDisplay : 1;
        let safeMaxDisplay = isFiniteNumber(yMaxDisplay) && yMaxDisplay > safeMinDisplay ? yMaxDisplay : safeMinDisplay * 10;
        let midDisplay = Math.sqrt(safeMinDisplay * safeMaxDisplay);
        this.chart.ticksY = [flowToWeekly(clamp(midDisplay, safeMinDisplay, safeMaxDisplay), displayUnit)];
      }
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

      this.nodes.radios.querySelectorAll('input[type="radio"]').forEach(function (radio) {
        radio.checked = radio.value === this.state.units;
      }, this);
    };

    /**
     * Updates dynamic log-scale Y domain and ticks for the active unit.
     */
    _updateYDomain() {
      let dragDomain = this.drag && this.drag.domain ? this.drag.domain : null;
      let hasValidDragTicks = Boolean(dragDomain && Array.isArray(dragDomain.ticksYLock) && dragDomain.ticksYLock.length);
      let hasValidDragRange = Boolean(
        dragDomain &&
        isFiniteNumber(dragDomain.yMinLock) &&
        isFiniteNumber(dragDomain.yMaxLock) &&
        dragDomain.yMaxLock > dragDomain.yMinLock
      );
      if (hasValidDragRange && hasValidDragTicks) {
        this.chart.yMin = dragDomain.yMinLock;
        this.chart.yMax = dragDomain.yMaxLock;
        this.chart.ticksY = dragDomain.ticksYLock.slice();
        return;
      }

      let displayUnit = this.state.units;
      let displayFloor = MIN_DISPLAY_Y_FLOOR_BY_UNIT[displayUnit] || 1;
      let baselineDisplayTicks = Y_TICKS_BY_UNIT[displayUnit] || Y_TICKS_BY_UNIT.year || [];

      if (hasValidDragRange) {
        this.chart.yMin = dragDomain.yMinLock;
        this.chart.yMax = dragDomain.yMaxLock;
        let lockedDomain = {
          yMinDisplay: flowFromWeekly(this.chart.yMin, displayUnit),
          yMaxDisplay: flowFromWeekly(this.chart.yMax, displayUnit)
        };
        this._setTicksFromDisplayDomain(displayUnit, baselineDisplayTicks, lockedDomain.yMinDisplay, lockedDomain.yMaxDisplay);
        return;
      }

      let fallbackYMaxDisplay = (Y_MAX_BY_UNIT[displayUnit] || Y_MAX_BY_UNIT.year) * Y_HEADROOM_FACTOR;
      let visibleValues = this._visibleValuesForYDomain();
      let displayDomain = this._resolveDisplayDomain(displayUnit, displayFloor, fallbackYMaxDisplay, visibleValues);
      let normalizedDomain = this._applyChartDomain(displayUnit, displayDomain.yMinDisplay, displayDomain.yMaxDisplay);
      this._setTicksFromDisplayDomain(displayUnit, baselineDisplayTicks, normalizedDomain.yMinDisplay, normalizedDomain.yMaxDisplay);
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

    /**
     * Generates a sampled polyline path for value-over-time functions.
     */
    _linePath(fn, segments) {
      let points = [];
      let sampleSegments = clamp(
        Math.round(isFiniteNumber(segments) ? segments : this._totalLineSegments()),
        2,
        MAX_TOTAL_LINE_SEGMENTS
      );
      let tSpan = this.chart.tMax - this.chart.tMin;

      for (let i = 0; i <= sampleSegments; i += 1) {
        let t = (i / sampleSegments) * tSpan;
        points.push(this._xFromTime(t) + ',' + this._yFromValue(fn.call(this, t)));
      }

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

    _rightLineLabelCandidates(tEnd) {
      return [
        {text: 'Revenue', color: COLORS.black, targetY: this._yFromValue(this._revenueAt(tEnd)), dy: 4},
        {text: 'Total expenses', color: COLORS.black, targetY: this._yFromValue(this._totalAt(tEnd)), dy: -6},
        {
          text: 'Fixed expenses',
          color: COLORS.black,
          targetY: this._yFromValue(this.state.weeklyFixedExpenses),
          dy: -4
        },
        {text: 'Variable expenses', color: COLORS.black, targetY: this._yFromValue(this._variableAt(tEnd)), dy: 10}
      ].filter(function (candidate) {
        return isFiniteNumber(candidate.targetY);
      });
    };

    _layoutRightLineLabels(candidates, minY, maxY, minGap) {
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
            text: candidate.text,
            color: candidate.color,
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

    _renderRightLineLabels(group, labels, xLabel, plotRightX) {
      labels.forEach(function (item) {
        let hasDisplacement = Math.abs(item.y - item.idealY) > 1;
        if (hasDisplacement) {
          let leader = createSvgEl('line');
          setAttrs(leader, {
            x1: plotRightX + 1,
            y1: item.leaderStartY,
            x2: xLabel - 2,
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
          x: xLabel,
          y: item.y,
          fill: item.color,
          'font-size': 10,
          'font-weight': 700,
          'text-anchor': 'start'
        });
        group.appendChild(text);
      });
    };

    _handleLabelText(handle) {
      if (handle === 'growth') {
        let unitToken = UNIT_TOKEN_BY_ID[this.state.units] || 'Growth';
        let displayGrowth = growthFromWeekly(this.state.weeklyGrowthRate, this.state.units);
        let growthText = formatInputPercent(displayGrowth);
        let growthPrefix = displayGrowth > 0 && growthText.charAt(0) !== '-' ? '+' : '';
        return unitToken + ' ' + growthPrefix + growthText;
      }

      if (handle === 'variable') {
        return formatInputPercent(this.state.grossMargin) + ' Gross Margin';
      }

      if (handle === 'fixed') {
        let fixedDisplayValue = flowFromWeekly(this.state.weeklyFixedExpenses, this.state.units);
        return formatMoney(fixedDisplayValue) + ' Fixed Expenses';
      }

      return '';
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
        layout.x = flipToRight ? point.x + 12 : leftOffsetX;
        layout.y = point.y - 8;
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
        fill: COLORS.black,
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

      gGrid.innerHTML = '';
      gAxes.innerHTML = '';
      gLines.innerHTML = '';
      gLabels.innerHTML = '';
      gHandles.innerHTML = '';

      let self = this;
      let plotRightX = this.chart.width - this.chart.paddingRight;
      let plotTopY = this.chart.paddingTop;
      let plotBottomY = this.chart.height - this.chart.paddingBottom;

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
       * Draws a visible stroke and a wide invisible hit layer for stable tooltips.
       */
      function addLine(config) {
        let points = config.points;
        let stroke = config.stroke;
        let width = config.width;
        let titleText = config.title;
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
        if (config.dasharray) {
          visible.setAttribute('stroke-dasharray', String(config.dasharray));
        }
        gLines.appendChild(visible);

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

        gLines.appendChild(hit);
      }

      addLine({
        points: this._lineSegmentPath(this._revenueAt),
        stroke: COLORS.revenue,
        width: 3,
        title: 'Revenue',
        strokeOpacity: 1
      });
      addLine({
        points: this._lineSegmentPath(this._variableAt),
        stroke: COLORS.variableLight,
        width: 2.5,
        title: 'Variable expenses',
        dasharray: '2 4',
        strokeOpacity: 0.6
      });
      addLine({
        points: this._lineSegmentPath(function () {
          return this.state.weeklyFixedExpenses;
        }),
        stroke: COLORS.fixedLight,
        width: 2.5,
        title: 'Fixed expenses',
        dasharray: '2 4',
        strokeOpacity: 0.6
      });
      addLine({
        points: this._linePath(this._totalAt),
        stroke: COLORS.total,
        width: 3.5,
        title: 'Total expenses',
        strokeOpacity: 1
      });

      let tEnd = this.chart.tMax - this.chart.tMin;
      let xLabel = this._xFromTime(tEnd) + 6;
      let rightLabelPositions = this._layoutRightLineLabels(
        this._rightLineLabelCandidates(tEnd),
        plotTopY + AXIS_LABEL_TOP_CLEARANCE,
        plotBottomY - 2,
        RIGHT_LINE_LABEL_MIN_GAP
      );
      this._renderRightLineLabels(gLabels, rightLabelPositions, xLabel, plotRightX);

      let drawMetrics = metrics || this._computeMetrics();
      if (isFiniteNumber(drawMetrics.breakevenYears) && drawMetrics.breakevenYears <= tEnd) {
        let bx = this._xFromTime(drawMetrics.breakevenYears);
        let by = this._yFromValue(this._revenueAt(drawMetrics.breakevenYears));

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
        const visualW = 22;
        const visualH = 16;
        const hitPad = 8;

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

      let growthT = tEnd * 0.55;
      let handlePoints = {
        'revenue-start': {
          x: this._xFromTime(0),
          y: this._yFromValue(this._revenueAt(0))
        },
        fixed: {
          x: this._xFromTime(0),
          y: this._yFromValue(this.state.weeklyFixedExpenses)
        },
        variable: {
          x: this._xFromTime(tEnd),
          y: this._yFromValue(this._variableAt(tEnd))
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

      let activeHandle = this.drag && this.drag.handle ? this.drag.handle : '';
      this._renderActiveHandleLabel(gHandles, activeHandle, handlePoints, {
        minX: this.chart.paddingLeft + 8,
        maxX: plotRightX - 8,
        minY: plotTopY + AXIS_LABEL_TOP_CLEARANCE,
        maxY: plotBottomY - 6
      });
    };

    /**
     * Main update cycle: input -> domain -> draw -> KPI.
     */
    render() {
      this._updateInputs();
      this._updateYDomain();
      let metrics = this._computeMetrics();
      this._draw(metrics);
      this.nodes.summaryBreakeven.textContent = this._formatTime(metrics.breakevenYears);
      this.nodes.summaryBillion.textContent = this._formatTime(metrics.billionYears);
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
