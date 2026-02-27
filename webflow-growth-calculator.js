(function () {
  'use strict';

  // Палитра графика и UI (подогнана под референс/макет).
  const COLORS = {
    black: '#212125',
    darkGrey: '#73737F',
    grey: '#BFBFBF',
    white: '#FFFFFF',
    blue: '#0E64E0',
    revenue: '#63C56B',
    variable: '#D66B90',
    fixed: '#B8B8C5',
    total: '#56566C',
    grid: '#E6E6EC'
  };

  const WEEKS_PER_YEAR = 52.1775;
  const WEEKS_PER_QUARTER = 13.044375;
  const WEEKS_PER_MONTH = WEEKS_PER_YEAR / 12;

  // Стартовые значения виджета:
  // ВАЖНО: внутренние расчеты выполняются в недельных единицах (weekly core).
  const DEFAULTS = {
    units: 'week',
    weeklyRevenue0: 100,
    weeklyGrowthRate: 0.0353,
    grossMargin: 1,
    weeklyFixedExpenses: 1600,
    yearsMin: 1,
    yearsMax: 9
  };

  // Фиксированные максимумы оси Y в зависимости от активного unit.
  const Y_MAX_BY_UNIT = {
    week: 10000000,
    month: 30000000,
    quarter: 100000000,
    year: 1000000000
  };
  const Y_HEADROOM_FACTOR = 1.08;

  // Фиксированные тики оси Y (в display-единицах) под референсные скрины.
  const Y_TICKS_BY_UNIT = {
    week: [100, 300, 1000, 3000, 10000, 30000, 100000, 300000, 1000000, 3000000, 10000000],
    month: [300, 1000, 3000, 10000, 30000, 100000, 300000, 1000000, 3000000, 10000000, 30000000],
    quarter: [3000, 10000, 30000, 100000, 300000, 1000000, 3000000, 10000000, 30000000, 100000000],
    year: [3000, 10000, 30000, 100000, 300000, 1000000, 3000000, 10000000, 30000000, 100000000, 300000000, 1000000000]
  };

  /**
   * Возвращает, сколько недель в выбранной единице времени.
   * Нужен для конвертаций week <-> month/quarter/year.
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
   * Проверяет, что units входит в допустимый список.
   */
  function isValidUnit(units) {
    return units === 'week' || units === 'month' || units === 'quarter' || units === 'year';
  }

  /**
   * Конвертирует денежный поток из текущей единицы в weekly.
   */
  function flowToWeekly(value, units) {
    return value / unitWeeks(units);
  }

  /**
   * Конвертирует денежный поток из weekly в текущую единицу.
   */
  function flowFromWeekly(value, units) {
    return value * unitWeeks(units);
  }

  /**
   * Конвертирует темп роста из выбранной единицы в weekly.
   * Формула сложного роста: (1 + r_unit)^(1/n) - 1
   */
  function growthToWeekly(value, units) {
    if (value <= -0.999999) {
      return -0.999999;
    }
    return Math.exp(Math.log(1 + value) / unitWeeks(units)) - 1;
  }

  /**
   * Конвертирует weekly growth в отображаемую единицу времени.
   * Формула сложного роста: (1 + r_week)^n - 1
   */
  function growthFromWeekly(value, units) {
    return Math.exp(Math.log(1 + value) * unitWeeks(units)) - 1;
  }

  /**
   * Ограничивает значение интервалом [min, max].
   */
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  /**
   * Безопасная проверка числа.
   */
  function isFiniteNumber(value) {
    return Number.isFinite(value) && !Number.isNaN(value);
  }

  /**
   * Форматирование денег для осей/лейблов с суффиксами K/M/B/T.
   */
  function formatMoney(value) {
    if (!isFiniteNumber(value)) {
      return '$0';
    }

    let abs = Math.abs(value);
    let suffix = '';
    let scaled = abs;

    if (abs >= 999e9) {
      suffix = 'T';
      scaled = abs / 1e12;
    } else if (abs >= 999e6) {
      suffix = 'B';
      scaled = abs / 1e9;
    } else if (abs >= 999e3) {
      suffix = 'M';
      scaled = abs / 1e6;
    } else if (abs >= 1e4) {
      suffix = 'K';
      scaled = abs / 1e3;
    }

    let digits = scaled >= 1000 ? 0 : scaled >= 100 ? 1 : scaled >= 10 ? 2 : 2;
    let text = scaled.toFixed(digits).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
    return (value < 0 ? '-$' : '$') + text + suffix;
  }

  /**
   * Форматирование денежного значения в текст инпута.
   */
  function formatInputMoney(value) {
    if (!isFiniteNumber(value)) {
      return '$0';
    }
    return '$' + Math.max(0, value).toFixed(0);
  }

  /**
   * Форматирование процента в текст инпута.
   */
  function formatInputPercent(value) {
    if (!isFiniteNumber(value)) {
      return '0%';
    }
    return (value * 100).toFixed(2).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1') + '%';
  }

  /**
   * Парсинг денежной строки из инпута.
   */
  function parseMoney(text) {
    if (typeof text !== 'string') {
      return NaN;
    }
    let normalized = text.replace(/[^0-9.\-]/g, '');
    return Number(normalized);
  }

  /**
   * Парсинг процентной строки из инпута (возвращает долю, а не проценты).
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
   * Создает SVG-элемент по тегу.
   */
  function createSvgEl(tag) {
    return document.createElementNS('http://www.w3.org/2000/svg', tag);
  }

  /**
   * Массовая установка атрибутов для SVG/DOM узла.
   */
  function setAttrs(node, attrs) {
    Object.keys(attrs).forEach(function (key) {
      node.setAttribute(key, String(attrs[key]));
    });
  }

  /**
   * Генерация "красивых" лог-меток (базы 1/2.5/5).
   * В текущей версии оставлена как запасной вариант.
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

    ticks = ticks.filter(function (v, idx, arr) {
      if (idx === 0) {
        return true;
      }
      return Math.abs(v - arr[idx - 1]) > 1e-9;
    });

    if (ticks.length < 2) {
      ticks = [min, max];
    }

    if (ticks.length > targetCount) {
      let step = Math.ceil(ticks.length / targetCount);
      ticks = ticks.filter(function (_v, idx) {
        return idx % step === 0;
      });
      if (ticks[ticks.length - 1] < max) {
        ticks.push(max);
      }
    }

    ticks.sort(function (a, b) {
      return a - b;
    });

    return ticks;
  }

  /**
   * Генерация лог-тиков в стиле 1-3-10 (ближе к референсному графику).
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

    ticks.sort(function (a, b) {
      return a - b;
    });

    if (ticks.length < 2) {
      ticks = [min, max];
    }

    if (ticks.length > targetCount) {
      let step = Math.ceil(ticks.length / targetCount);
      ticks = ticks.filter(function (_v, idx) {
        return idx % step === 0;
      });
      if (ticks[ticks.length - 1] < max) {
        ticks.push(max);
      }
    }

    return ticks;
  }

  /**
   * Основной класс графика:
   * - хранит состояние
   * - рендерит SVG
   * - связывает drag и input-управление
   */
  class GrowthCalculator {
    constructor(container, options) {
    this.container = container;
    this.state = Object.assign({}, DEFAULTS, options || {});
    // Минимальный revenue > 0, чтобы избежать log(0) и деградации графика.
    this.state.weeklyRevenue0 = Math.max(1 / WEEKS_PER_YEAR, this.state.weeklyRevenue0);
    this.state.weeklyFixedExpenses = Math.max(0, this.state.weeklyFixedExpenses);
    this.state.grossMargin = clamp(this.state.grossMargin, 0, 1);
    this.state.weeklyGrowthRate = clamp(this.state.weeklyGrowthRate, -0.9, 10);
    this.state.units = isValidUnit(this.state.units) ? this.state.units : 'year';

    this.drag = null;
    this.nodes = {};

    this._injectStyles();
    this._build();
    this._bind();
    this.render();
  }

  /**
   * Инъекция стилей виджета (один раз на страницу).
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
   * Создание DOM-структуры виджета и базовых узлов.
   */
  _build() {
    this.container.innerHTML = '';

    let root = document.createElement('div');
    root.className = 'igc';

    let radios = document.createElement('div');
    radios.className = 'igc__radios';

    let units = [
      { id: 'week', label: 'Weekly' },
      { id: 'month', label: 'Monthly' },
      { id: 'quarter', label: 'Quarterly' },
      { id: 'year', label: 'Yearly' }
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

    // Блок ключевых KPI под графиком.
    let summary = document.createElement('div');
    summary.className = 'igc__summary';
    summary.innerHTML = '' +
      '<div><span class="igc__summary-label">Profitable at:</span><span class="igc__summary-value" data-key="breakeven">-</span></div>' +
      '<div><span class="igc__summary-label">$1B/y revenue at:</span><span class="igc__summary-value" data-key="billion">-</span></div>';

    // Ввод параметров модели пользователем.
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
   * Подготавливает SVG-слои и базовую геометрию графика.
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
      // Ось X всегда в годах.
      tMin: this.state.yearsMin,
      tMax: this.state.yearsMax,
      yMin: flowToWeekly(Y_TICKS_BY_UNIT[this.state.units][0], this.state.units),
      yMax: flowToWeekly(Y_MAX_BY_UNIT[this.state.units] || Y_MAX_BY_UNIT.year, this.state.units),
      ticksY: []
    };
  };

  /**
   * Подписка на события UI и графика (radio/input/drag).
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
     * Унифицированная обвязка текстовых инпутов.
     * Применение значения выполняется на blur/Enter.
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

      self.drag = { handle: target.dataset.handle };
      self.nodes.svg.setPointerCapture(event.pointerId);
    });

    this.nodes.svg.addEventListener('pointermove', function (event) {
      if (!self.drag) {
        return;
      }
      self._handleDrag(event);
      self.render();
    });

    /**
     * Завершает drag-сессию и снимает pointer capture.
     */
    function endDrag(event) {
      if (!self.drag) {
        return;
      }
      self.drag = null;
      if (self.nodes.svg.hasPointerCapture(event.pointerId)) {
        self.nodes.svg.releasePointerCapture(event.pointerId);
      }
    }

    this.nodes.svg.addEventListener('pointerup', endDrag);
    this.nodes.svg.addEventListener('pointercancel', endDrag);
  };

  /**
   * Логика изменения state при перетаскивании конкретной ручки.
   */
  _handleDrag(event) {
    let coords = this._eventToChart(event);
    let t = this._xToTime(coords.x);
    let value = this._yToValue(coords.y);

    let tMax = this.chart.tMax - this.chart.tMin;

    if (this.drag.handle === 'revenue-start') {
      this.state.weeklyRevenue0 = clamp(value, 1 / WEEKS_PER_YEAR, 1e12);
      return;
    }

    if (this.drag.handle === 'growth') {
      let anchorT = clamp(t, 0.75, tMax);
      // Переводим позицию ручки в weekly-growth через обратную формулу экспоненты.
      let anchorWeeks = anchorT * WEEKS_PER_YEAR;
      let ratio = clamp(value / this.state.weeklyRevenue0, 1e-6, 1e9);
      let weeklyGrowth = Math.pow(ratio, 1 / anchorWeeks) - 1;
      this.state.weeklyGrowthRate = clamp(weeklyGrowth, -0.9, 10);
      return;
    }

    if (this.drag.handle === 'fixed') {
      this.state.weeklyFixedExpenses = clamp(value, 0, 1e12);
      return;
    }

    if (this.drag.handle === 'variable') {
      let revAtEnd = this._revenueAt(tMax);
      if (revAtEnd <= 0) {
        return;
      }
      // Ручка variable управляет долей variable/revenue.
      let variableRatio = clamp(value / revAtEnd, 0, 1);
      this.state.grossMargin = clamp(1 - variableRatio, 0, 1);
    }
  };

  /**
   * Переводит координаты pointer-события в систему координат SVG-графика.
   */
  _eventToChart(event) {
    let rect = this.nodes.svg.getBoundingClientRect();
    let scaleX = this.chart.width / rect.width;
    let scaleY = this.chart.height / rect.height;

    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY
    };
  };

  /**
   * Revenue в weekly-ядре на момент t (t в годах от старта).
   */
  _revenueAt(tYearsFromStart) {
    let weeks = tYearsFromStart * WEEKS_PER_YEAR;
    return this.state.weeklyRevenue0 * Math.pow(1 + this.state.weeklyGrowthRate, weeks);
  };

  /**
   * Variable expenses = Revenue * (1 - Gross margin).
   */
  _variableAt(tYearsFromStart) {
    return this._revenueAt(tYearsFromStart) * (1 - this.state.grossMargin);
  };

  /**
   * Total expenses = Variable + Fixed.
   */
  _totalAt(tYearsFromStart) {
    return this._variableAt(tYearsFromStart) + this.state.weeklyFixedExpenses;
  };

  /**
   * Считает ключевые метрики: breakeven и достижение $1B/годовой выручки.
   */
  _computeMetrics() {
    let contributionPct = this.state.grossMargin;
    let rev0 = this.state.weeklyRevenue0;
    let fixed = this.state.weeklyFixedExpenses;
    let growth = this.state.weeklyGrowthRate;

    let breakevenYears = null;

    // Если на старте contribution покрывает fixed — прибыльность уже достигнута.
    if (contributionPct > 0 && rev0 * contributionPct >= fixed) {
      breakevenYears = 0;
    } else if (contributionPct > 0 && growth > 0 && rev0 > 0 && fixed > 0) {
      // Решаем уравнение пересечения аналитически.
      let numerator = Math.log(fixed / (rev0 * contributionPct));
      let denominator = Math.log(1 + growth);
      let solvedWeeks = numerator / denominator;
      if (isFiniteNumber(solvedWeeks) && solvedWeeks >= 0) {
        breakevenYears = solvedWeeks / WEEKS_PER_YEAR;
      }
    }

    let billionYears = null;
    // Целевая отметка "$1B/y" в weekly-базе.
    let weeklyBillionTarget = 1e9 / WEEKS_PER_YEAR;
    if (rev0 >= weeklyBillionTarget) {
      billionYears = 0;
    } else if (growth > 0 && rev0 > 0) {
      let solvedBillionWeeks = Math.log(weeklyBillionTarget / rev0) / Math.log(1 + growth);
      if (isFiniteNumber(solvedBillionWeeks) && solvedBillionWeeks >= 0) {
        billionYears = solvedBillionWeeks / WEEKS_PER_YEAR;
      }
    }

    return {
      breakevenYears: breakevenYears,
      billionYears: billionYears
    };
  };

  /**
   * Форматирует время для KPI-блоков.
   * По требованию — всегда в годах, независимо от выбранных units.
   */
  _formatTime(yearsValue) {
    if (!isFiniteNumber(yearsValue)) {
      return 'never';
    }

    return 'year ' + yearsValue.toFixed(yearsValue < 10 ? 1 : 0);
  };

  /**
   * Синхронизирует значения инпутов с текущим state.
   */
  _updateInputs() {
    this.nodes.inputRevenue.value = formatInputMoney(flowFromWeekly(this.state.weeklyRevenue0, this.state.units));
    this.nodes.inputGrossMargin.value = formatInputPercent(this.state.grossMargin);
    this.nodes.inputFixed.value = formatInputMoney(flowFromWeekly(this.state.weeklyFixedExpenses, this.state.units));

    // Growth в инпуте показываем в выбранной пользователем единице.
    let displayGrowth = growthFromWeekly(this.state.weeklyGrowthRate, this.state.units);
    this.nodes.inputGrowth.value = formatInputPercent(displayGrowth);

    this.nodes.radios.querySelectorAll('input[type="radio"]').forEach(function (radio) {
      radio.checked = radio.value === this.state.units;
    }, this);
  };

  /**
   * Обновляет фиксированный лог-диапазон Y и тики по активному unit.
   */
  _updateYDomain() {
    let displayUnit = this.state.units;
    let displayTicks = Y_TICKS_BY_UNIT[displayUnit] || Y_TICKS_BY_UNIT.year;
    let yMaxDisplay = Y_MAX_BY_UNIT[displayUnit] || Y_MAX_BY_UNIT.year;
    let yMinDisplayPositive = Math.max(1, displayTicks[0] / 10);

    // Для лог-шкалы ноль невозможен математически, поэтому используем маленький положительный floor,
    // но визуально показываем ось "от 0" отдельной подписью внизу.
    this.chart.yMin = flowToWeekly(yMinDisplayPositive, displayUnit);
    // Небольшой запас сверху, чтобы линии/подписи не прилипали к потолку.
    this.chart.yMax = flowToWeekly(yMaxDisplay * Y_HEADROOM_FACTOR, displayUnit);
    this.chart.ticksY = displayTicks.map(function (tick) {
      return flowToWeekly(tick, displayUnit);
    });
  };

  /**
   * Проекция времени t (в годах) в X-координату SVG.
   */
  _xFromTime(tYearsFromStart) {
    let plotWidth = this.chart.width - this.chart.paddingLeft - this.chart.paddingRight;
    let totalSpan = this.chart.tMax - this.chart.tMin;
    return this.chart.paddingLeft + (tYearsFromStart / totalSpan) * plotWidth;
  };

  /**
   * Обратная проекция X-координаты в время t (годы).
   */
  _xToTime(x) {
    let plotWidth = this.chart.width - this.chart.paddingLeft - this.chart.paddingRight;
    let clamped = clamp(x, this.chart.paddingLeft, this.chart.width - this.chart.paddingRight);
    let ratio = (clamped - this.chart.paddingLeft) / plotWidth;
    let totalSpan = this.chart.tMax - this.chart.tMin;
    return ratio * totalSpan;
  };

  /**
   * Проекция значения потока в Y по логарифмической шкале.
   */
  _yFromValue(value) {
    let safeValue = clamp(value, this.chart.yMin, this.chart.yMax);
    let lnMin = Math.log(this.chart.yMin);
    let lnMax = Math.log(this.chart.yMax);
    let lnValue = Math.log(safeValue);
    let ratio = (lnValue - lnMin) / (lnMax - lnMin || 1);

    let plotHeight = this.chart.height - this.chart.paddingTop - this.chart.paddingBottom;
    return this.chart.height - this.chart.paddingBottom - ratio * plotHeight;
  };

  /**
   * Обратная проекция Y-координаты в значение потока (лог-шкала).
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
   * Генерирует polyline path (набор точек) для функции значения от времени.
   */
  _linePath(fn) {
    let points = [];
    let samples = 120;
    let tSpan = this.chart.tMax - this.chart.tMin;

    for (let i = 0; i <= samples; i += 1) {
      let t = (i / samples) * tSpan;
      points.push(this._xFromTime(t) + ',' + this._yFromValue(fn.call(this, t)));
    }

    return points.join(' ');
  };

  /**
   * Полный SVG-рендер: сетка, оси, линии, подписи, маркеры и ручки.
   */
  _draw() {
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

    // Визуальная нижняя граница "0" (не участвует в лог-расчетах).
    let yZero = this.chart.height - this.chart.paddingBottom;
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

    for (let year = this.chart.tMin; year <= this.chart.tMax; year += 1) {
      let t = year - this.chart.tMin;
      let x = this._xFromTime(t);

      let vLine = createSvgEl('line');
      setAttrs(vLine, {
        x1: x,
        y1: this.chart.paddingTop,
        x2: x,
        y2: this.chart.height - this.chart.paddingBottom,
        stroke: COLORS.grid,
        'stroke-width': 1
      });
      gGrid.appendChild(vLine);

      let xTick = createSvgEl('text');
      xTick.textContent = String(year);
      setAttrs(xTick, {
        x: x,
        y: this.chart.height - this.chart.paddingBottom + 18,
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
     * Рисует видимую линию + невидимый hover-hit слой для стабильного tooltip.
     */
    function addLine(points, stroke, width, opacity, titleText) {
      let visible = createSvgEl('polyline');
      setAttrs(visible, {
        fill: 'none',
        points: points,
        stroke: stroke,
        'stroke-width': width,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        opacity: opacity == null ? 1 : opacity,
        'pointer-events': 'none'
      });
      gLines.appendChild(visible);

      // Широкий невидимый stroke нужен, чтобы легче попадать мышью в линию.
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

    addLine(this._linePath(this._revenueAt), COLORS.revenue, 3, 1, 'Revenue');
    addLine(this._linePath(this._variableAt), COLORS.variable, 2.5, 0.9, 'Variable expenses');
    addLine(this._linePath(function () { return this.state.weeklyFixedExpenses; }), COLORS.fixed, 2.5, 0.95, 'Fixed expenses');
    addLine(this._linePath(this._totalAt), COLORS.total, 3.5, 1, 'Total expenses');

    let tEnd = this.chart.tMax - this.chart.tMin;
    let xLabel = this._xFromTime(tEnd) + 6;

    /**
     * Подпись линии справа от графика.
     */
    function addLineLabel(textValue, y, color, dy) {
      let text = createSvgEl('text');
      text.textContent = textValue;
      setAttrs(text, {
        x: xLabel,
        y: y + (dy || 0),
        fill: color,
        'font-size': 10,
        'font-weight': 700,
        'text-anchor': 'start'
      });
      gLabels.appendChild(text);
    }

    addLineLabel('Revenue', this._yFromValue(this._revenueAt(tEnd)), COLORS.black, 4);
    addLineLabel('Total expenses', this._yFromValue(this._totalAt(tEnd)), COLORS.black, -6);
    addLineLabel('Fixed expenses', this._yFromValue(this.state.weeklyFixedExpenses), COLORS.black, -4);
    addLineLabel('Variable expenses', this._yFromValue(this._variableAt(tEnd)), COLORS.black, 10);

    let metrics = this._computeMetrics();
    if (isFiniteNumber(metrics.breakevenYears) && metrics.breakevenYears <= tEnd) {
      let bx = this._xFromTime(metrics.breakevenYears);
      let by = this._yFromValue(this._revenueAt(metrics.breakevenYears));

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
     * Прямоугольная drag-ручка (revenue/fixed/variable).
     */
    function addHandleRect(name, x, y, color) {
      const visualW = 22;
      const visualH = 16;
      const hitPad = 8;

      // Широкая невидимая зона наведения для уверенного захвата мышью.
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
     * Круглая drag-ручка для изменения growth.
     */
    function addHandleCircle(name, x, y, color) {
      const visualR = 8;
      const hitR = 14;

      // Невидимый увеличенный радиус для более удобного drag.
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

    addHandleRect('revenue-start', this._xFromTime(0), this._yFromValue(this._revenueAt(0)), COLORS.revenue);
    addHandleRect('fixed', this._xFromTime(0), this._yFromValue(this.state.weeklyFixedExpenses), COLORS.fixed);
    addHandleRect('variable', this._xFromTime(tEnd), this._yFromValue(this._variableAt(tEnd)), COLORS.variable);

    let growthT = tEnd * 0.55;
    addHandleCircle('growth', this._xFromTime(growthT), this._yFromValue(this._revenueAt(growthT)), COLORS.revenue);
  };

  /**
   * Основной цикл обновления: input -> domain -> draw -> KPI.
   */
  render() {
    this._updateInputs();
    this._updateYDomain();
    this._draw();

    let metrics = this._computeMetrics();
    this.nodes.summaryBreakeven.textContent = this._formatTime(metrics.breakevenYears);
    this.nodes.summaryBillion.textContent = this._formatTime(metrics.billionYears);
  }

  }

  /**
   * Инициализация одного экземпляра по селектору или DOM-узлу.
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
   * Автоинициализация по data-атрибуту/ID контейнера.
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

  // Публичный API для внешнего подключения (например, из Webflow custom code).
  window.ImsGrowthCalculator = {
    init: init,
    autoInit: autoInit
  };

  // Автостарт после готовности DOM.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      autoInit();
    });
  } else {
    autoInit();
  }
})();
