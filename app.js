// Константы валидации
const VALIDATION = {
    MIN_ROOM_SIZE: 0.1,
    MAX_ROOM_SIZE: 100,
    MIN_PRICE: 0,
    MAX_PRICE: 1000000,
    MIN_TOTAL_AREA: 0.1,
    MAX_TOTAL_AREA: 10000 // м²
};

const PANEL_PRICE_RUB = 2396;
const PANEL_PRICE_PER_M2 = 5990;
const PANEL_EFFECTIVE_LENGTH = 0.735;
const PANEL_EFFECTIVE_WIDTH = 0.535;
const PANEL_COVERAGE_AREA = +(PANEL_EFFECTIVE_LENGTH * PANEL_EFFECTIVE_WIDTH).toFixed(6);
const PANEL_SIZE_DISPLAY = '0,75×0,55 м';
const PANEL_COVERAGE_DISPLAY = 0.4;

const CALC_MODES = {
    NONE: 'none',
    PARAMS: 'params',
    AREA: 'area'
};

const ICON_PARAMS = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="flex-shrink: 0;">
            <rect x="3" y="3" width="7" height="7" rx="1" fill="currentColor"/>
            <rect x="14" y="3" width="7" height="7" rx="1" fill="currentColor" opacity="0.8"/>
            <rect x="3" y="14" width="7" height="7" rx="1" fill="currentColor" opacity="0.8"/>
            <rect x="14" y="14" width="7" height="7" rx="1" fill="currentColor"/>
        </svg>`;

const ICON_AREA = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="flex-shrink: 0;">
            <path d="M13 2L3 14h8l-1 8 10-12h-8l1-8z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`;

const DEFAULT_RESULTS_MESSAGE = 'Выберите тип расчёта и нажмите «Рассчитать».';

// Утилита: корректный парсинг чисел с запятой или точкой
function parseLocaleNumber(value) {
    if (typeof value === 'number') return value;
    if (value === null || value === undefined) return NaN;
    const s = String(value).trim().replace(',', '.');
    return Number(s);
}

// Функция валидации числа
function validateNumber(value, min, max, fieldName) {
    if (value === '' || value === null || value === undefined) {
        return { valid: false, message: `Поле "${fieldName}" обязательно для заполнения` };
    }
    
    const num = parseLocaleNumber(value);
    
    if (isNaN(num)) {
        return { valid: false, message: `Поле "${fieldName}" должно содержать число` };
    }
    
    if (num < min) {
        return { valid: false, message: `Минимальное значение: ${min}` };
    }
    
    if (num > max) {
        return { valid: false, message: `Максимальное значение: ${max}` };
    }
    
    return { valid: true, value: num };
}

// Показ ошибки валидации
function showFieldError(fieldId, message) {
    const field = document.getElementById(fieldId);
    const errorEl = document.getElementById(fieldId + 'Error');
    
    if (field) {
        field.classList.add('error');
    }
    
    if (errorEl) {
        errorEl.textContent = message || '';
    }
}

// Очистка ошибки валидации
function clearFieldError(fieldId) {
    const field = document.getElementById(fieldId);
    const errorEl = document.getElementById(fieldId + 'Error');
    
    if (field) {
        field.classList.remove('error');
    }
    
    if (errorEl) {
        errorEl.textContent = '';
    }
}

// Валидация всех полей формы
function validateForm() {
    let isValid = true;
    
    // Основные размеры
    const mainLengthVal = validateNumber(
        document.getElementById('mainLength').value,
        VALIDATION.MIN_ROOM_SIZE,
        VALIDATION.MAX_ROOM_SIZE,
        'Длина помещения'
    );
    if (!mainLengthVal.valid) {
        showFieldError('mainLength', mainLengthVal.message);
        isValid = false;
    } else {
        clearFieldError('mainLength');
    }
    
    const mainWidthVal = validateNumber(
        document.getElementById('mainWidth').value,
        VALIDATION.MIN_ROOM_SIZE,
        VALIDATION.MAX_ROOM_SIZE,
        'Ширина помещения'
    );
    if (!mainWidthVal.valid) {
        showFieldError('mainWidth', mainWidthVal.message);
        isValid = false;
    } else {
        clearFieldError('mainWidth');
    }
    
    // Размеры выступа (если выбран)
    const hasLeg = document.getElementById('hasLeg').checked;
    // Объявляем заранее, чтобы использовать ниже без ReferenceError
    let legLengthVal = { valid: true, value: 0 };
    let legWidthVal = { valid: true, value: 0 };
    if (hasLeg) {
        legLengthVal = validateNumber(
            document.getElementById('legLength').value,
            VALIDATION.MIN_ROOM_SIZE,
            VALIDATION.MAX_ROOM_SIZE,
            'Длина выступа'
        );
        if (!legLengthVal.valid) {
            showFieldError('legLength', legLengthVal.message);
            isValid = false;
        } else {
            clearFieldError('legLength');
        }
        
        legWidthVal = validateNumber(
            document.getElementById('legWidth').value,
            VALIDATION.MIN_ROOM_SIZE,
            VALIDATION.MAX_ROOM_SIZE,
            'Ширина выступа'
        );
        if (!legWidthVal.valid) {
            showFieldError('legWidth', legWidthVal.message);
            isValid = false;
        } else {
            clearFieldError('legWidth');
        }
        
        // Проверка логики: выступ не должен быть больше основной части
        if (mainLengthVal.valid && legLengthVal.valid && legLengthVal.value > mainLengthVal.value) {
            showFieldError('legLength', 'Длина выступа не может быть больше длины помещения');
            isValid = false;
        }
    }
    
    // Проверка общей площади
    if (mainLengthVal.valid && mainWidthVal.valid) {
        let totalArea = mainLengthVal.value * mainWidthVal.value;
        if (hasLeg && legLengthVal.valid && legWidthVal.valid) {
            totalArea += legLengthVal.value * legWidthVal.value;
        }
        
        if (totalArea < VALIDATION.MIN_TOTAL_AREA) {
            showFieldError('mainLength', `Общая площадь слишком мала (минимум ${VALIDATION.MIN_TOTAL_AREA} м²)`);
            isValid = false;
        }
        
        if (totalArea > VALIDATION.MAX_TOTAL_AREA) {
            showFieldError('mainLength', `Общая площадь слишком большая (максимум ${VALIDATION.MAX_TOTAL_AREA} м²)`);
            isValid = false;
        }
    }
    
    return isValid;
}

// Инициализация приложения
let calculator = null;
let currentRoom = null;
let currentCalcMode = CALC_MODES.NONE;
let currentAreaResult = null;
let lastPanelStats = null;
let isParamsExpanded = false;
let isAreaExpanded = false;
let lastActiveMode = CALC_MODES.NONE;

// Инициализация визуализаторов
function initializeVisualizers() {
    // Визуализатор сам рассчитает оптимальный масштаб
    visualizers.bestScheme = new SchemeVisualizer('canvas1', 50);
}

function updateVisualizationMode() {
    const body = document.body;
    const areaWrapper = document.getElementById('areaSchemeWrapper');
    const bestWrapper = document.getElementById('bestScheme');
    const titleEl = document.getElementById('selectedSchemeTitle');
    const placeholder = document.getElementById('schemePlaceholder');

    if (!body) return;

    const hasAreaResult = Boolean(currentAreaResult);
    const hasParamResult = Boolean(currentRoom && window.currentBestScheme && lastPanelStats);

    const displayMode = currentCalcMode !== CALC_MODES.NONE
        ? currentCalcMode
        : (lastActiveMode !== CALC_MODES.NONE
            ? lastActiveMode
            : (hasParamResult ? CALC_MODES.PARAMS : hasAreaResult ? CALC_MODES.AREA : CALC_MODES.NONE));

    const showArea = displayMode === CALC_MODES.AREA && hasAreaResult;
    const showParams = displayMode === CALC_MODES.PARAMS && hasParamResult;

    body.classList.toggle('area-mode', showArea);

    if (areaWrapper) {
        areaWrapper.classList.toggle('hidden', !showArea);
    }

    if (bestWrapper) {
        bestWrapper.classList.toggle('hidden', !showParams);
    }

    if (placeholder) {
        const showPlaceholder = !showArea && !showParams;
        placeholder.classList.toggle('hidden', !showPlaceholder);
    }

    if (titleEl) {
        titleEl.textContent = showArea ? 'Схема по площади (условно)' : 'Схема монтажа';
    }

    updateStatLabels();
}

function renderAreaScheme(area) {
    const canvas = document.getElementById('areaCanvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    // Адаптивные размеры для мобильной версии
    const isMobile = window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
    const width = isMobile ? Math.min(620, window.innerWidth - 80) : 620;
    const height = isMobile ? Math.min(280, width * 0.45) : 420;
    const hasArea = typeof area === 'number' && !isNaN(area) && area > 0;

    canvas.width = width;
    canvas.height = height;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    canvas.style.maxWidth = '100%';
    canvas.style.maxHeight = isMobile ? '280px' : '420px';

    ctx.clearRect(0, 0, width, height);

    // Адаптивные отступы для прямоугольника
    const rectPadding = isMobile ? 30 : 40;
    const rectX = rectPadding;
    const rectY = rectPadding;
    const rectWidth = width - rectPadding * 2;
    const rectHeight = height - rectPadding * 2;

    ctx.fillStyle = '#e5e7eb';
    ctx.fillRect(rectX, rectY, rectWidth, rectHeight);

    ctx.strokeStyle = '#b3bac2';
    ctx.lineWidth = isMobile ? 2 : 3;
    ctx.setLineDash([12, 8]);
    ctx.strokeRect(rectX, rectY, rectWidth, rectHeight);
    ctx.setLineDash([]);

    // Адаптивные размеры шрифтов и отступов
    const fontSize = isMobile ? 24 : 36;
    const smallFontSize = isMobile ? 18 : 28;
    const padding = isMobile ? 30 : 40;
    const textY = height / 2;
    const labelX = width / 2;
    const labelY = isMobile ? 25 : 30;
    
    ctx.fillStyle = '#4b5563';
    ctx.font = `600 ${fontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(hasArea ? `${area.toFixed(2)} м²` : 'Введите площадь', labelX, textY);

    ctx.font = `500 ${smallFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;
    ctx.fillStyle = '#636d78';
    ctx.fillText('? м', labelX, labelY);
    ctx.save();
    ctx.translate(padding - 5, textY);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('? м', 0, 0);
    ctx.restore();

}

function setCalculationMode(mode) {
    if (![CALC_MODES.PARAMS, CALC_MODES.AREA, CALC_MODES.NONE].includes(mode)) return;

    if (mode === CALC_MODES.PARAMS) {
        isParamsExpanded = true;
        isAreaExpanded = false;
    } else if (mode === CALC_MODES.AREA) {
        isParamsExpanded = false;
        isAreaExpanded = true;
    } else {
        isParamsExpanded = false;
        isAreaExpanded = false;
    }

    currentCalcMode = mode;

    const paramsButton = document.getElementById('toggleParamsCalc');
    const quickButton = document.getElementById('toggleQuickCalc');
    const paramsCard = document.getElementById('paramsCalcCard');
    const quickCard = document.getElementById('quickCalcCard');
    const paramsGroup = document.getElementById('paramsGroup');
    const areaGroup = document.getElementById('areaGroup');
    const inputPanel = document.querySelector('.input-panel');
    const resultsEl = document.getElementById('resultsText');

    if (paramsButton) {
        paramsButton.classList.toggle('expanded-btn', isParamsExpanded);
        const indicator = paramsButton.querySelector('.toggle-indicator');
        const icon = ICON_PARAMS;
        paramsButton.innerHTML = `<svg class="toggle-indicator" width="10" height="10" viewBox="0 0 6 6" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 0L6 6H0L3 0Z" fill="currentColor" opacity="0.5"/></svg>${icon} Расчёт по параметрам`;
    }

    if (quickButton) {
        quickButton.classList.toggle('expanded-btn', isAreaExpanded);
        const indicator = quickButton.querySelector('.toggle-indicator');
        const icon = ICON_AREA;
        quickButton.innerHTML = `<svg class="toggle-indicator" width="10" height="10" viewBox="0 0 6 6" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 0L6 6H0L3 0Z" fill="currentColor" opacity="0.5"/></svg>${icon} Расчёт по площади`;
    }

    if (paramsCard) paramsCard.classList.toggle('expanded', isParamsExpanded);
    if (quickCard) quickCard.classList.toggle('expanded', isAreaExpanded);

    const paramsHint = paramsGroup ? paramsGroup.querySelector('.calc-mode-hint') : null;
    const areaHint = areaGroup ? areaGroup.querySelector('.calc-mode-hint') : null;
    if (paramsHint) {
        paramsHint.classList.toggle('hint-expanded', isParamsExpanded);
    }
    if (areaHint) {
        areaHint.classList.toggle('hint-expanded', isAreaExpanded);
    }

    // Не меняем порядок блоков: кнопки остаются на своих местах

    if (!isParamsExpanded && !isAreaExpanded && resultsEl && !lastPanelStats && !currentAreaResult) {
        resultsEl.textContent = DEFAULT_RESULTS_MESSAGE;
    }

    updateVisualizationMode();
    updateURL();
}

function resetCalculationState() {
    currentAreaResult = null;
    lastPanelStats = null;
    calculator = null;
    currentRoom = null;
    window.currentBestScheme = null;
    window.currentParams = null;
    lastActiveMode = CALC_MODES.NONE;

    updateStatisticsSummary({
        panelsText: '—',
        coverageText: '—',
        costText: '—'
    });

    const resultsEl = document.getElementById('resultsText');
    if (resultsEl) {
        resultsEl.textContent = DEFAULT_RESULTS_MESSAGE;
    }
    setCalculationMode(CALC_MODES.NONE);
    renderAreaScheme(null);
    updateVisualizationMode();
    updateStatLabels();
    updateURL();
}

// Получение параметров из формы с валидацией
function getInputParameters() {
    const mainLength = parseLocaleNumber(document.getElementById('mainLength').value);
    const mainWidth = parseLocaleNumber(document.getElementById('mainWidth').value);
    const hasLeg = document.getElementById('hasLeg').checked;
    const legLength = hasLeg ? parseLocaleNumber(document.getElementById('legLength').value) : 0;
    const legWidth = hasLeg ? parseLocaleNumber(document.getElementById('legWidth').value) : 0;
    
    // Проверка на валидность значений
    if (isNaN(mainLength) || isNaN(mainWidth) || 
        (hasLeg && (isNaN(legLength) || isNaN(legWidth)))) {
        throw new Error('Некорректные значения в форме. Проверьте все поля.');
    }
    
    return {
        room: new LShapedRoom(mainLength, mainWidth, legLength, legWidth),
        pricePerM2: PANEL_PRICE_PER_M2,
        hasLeg
    };
}

// Расчет всех схем и выбор лучшей
function calculateAllSchemes() {
    if (currentCalcMode !== CALC_MODES.PARAMS) {
        if (currentCalcMode === CALC_MODES.AREA) {
            return calculateAreaEstimation();
        }
        return;
    }

    // Очистка предыдущих ошибок
    ['mainLength', 'mainWidth', 'legLength', 'legWidth'].forEach(id => {
        clearFieldError(id);
    });
    
    // Валидация формы
    if (!validateForm()) {
        showUserMessage('Пожалуйста, исправьте ошибки в форме перед расчётом.', 'error');
        return;
    }
    
    try {
        const params = getInputParameters();
        
        if (!params || !params.room) {
            throw new Error('Не удалось получить параметры помещения');
        }
        
        // Проверка на экстремальные значения
        const totalArea = params.room.getTotalArea();
        if (totalArea > VALIDATION.MAX_TOTAL_AREA) {
            throw new Error(`Площадь помещения слишком большая (${totalArea.toFixed(2)} м²). Максимальное значение: ${VALIDATION.MAX_TOTAL_AREA} м²`);
        }
        
        if (totalArea < VALIDATION.MIN_TOTAL_AREA) {
            throw new Error(`Площадь помещения слишком мала (${totalArea.toFixed(2)} м²). Минимальное значение: ${VALIDATION.MIN_TOTAL_AREA} м²`);
        }
        
        currentRoom = params.room;
        
        // Создаем калькулятор
        calculator = new PanelCalculator(params.room);
        
        // Рассчитываем все схемы
        const scheme1Panels = calculator.calculateScheme1();
        const scheme2Panels = calculator.calculateScheme2();
        const scheme3Panels = calculator.calculateScheme3();
        
        // Выбираем лучшую схему по площади покрытия (эффективной)
        const stats1 = applyPanelPricing(calculator.getStatistics(scheme1Panels, params.pricePerM2));
        const stats2 = applyPanelPricing(calculator.getStatistics(scheme2Panels, params.pricePerM2));
        const stats3 = applyPanelPricing(calculator.getStatistics(scheme3Panels, params.pricePerM2));
        
        const schemes = [
            { name: 'Горизонтальная', panels: scheme1Panels, stats: stats1, coverage: parseFloat(stats1.coverageArea) },
            { name: 'Вертикальная', panels: scheme2Panels, stats: stats2, coverage: parseFloat(stats2.coverageArea) },
            { name: 'Комбинированная', panels: scheme3Panels, stats: stats3, coverage: parseFloat(stats3.coverageArea) }
        ];
        
        // Выбираем схему с минимальным количеством панелей (все дают ~100% покрытие)
        schemes.sort((a, b) => {
            if (a.stats.total !== b.stats.total) return a.stats.total - b.stats.total;
            return b.stats.cutPanels - a.stats.cutPanels;
        });
        const bestScheme = schemes[0];
        
        // Обновляем заголовок
        document.getElementById('selectedSchemeTitle').textContent = 'Схема монтажа';
        
        // Обновляем визуализатор
        if (!visualizers.bestScheme) {
            visualizers.bestScheme = new SchemeVisualizer('canvas1', 50);
        }
        
        // Сбрасываем позицию и zoom при новом расчёте
        visualizers.bestScheme.resetPan();
        visualizers.bestScheme.zoom = 1.0;
        canvasStates.bestScheme.zoom = 1.0;
        
        // Устанавливаем данные - масштаб рассчитается автоматически
        visualizers.bestScheme.setRoom(params.room);
        visualizers.bestScheme.setPanels(bestScheme.panels);
        
        // Сохраняем текущую лучшую схему для PDF
        window.currentBestScheme = bestScheme;
        window.currentParams = params;
        lastActiveMode = CALC_MODES.PARAMS;
        
        // Отрисовываем лучшую схему
        renderScheme('bestScheme');
        
        // Обновляем статистику
        lastPanelStats = applyPanelPricing(calculator.getStatistics(bestScheme.panels, params.pricePerM2));
        updateStatisticsPanelMode(lastPanelStats, params.room.getTotalArea());
        updateResultsTextForParams(params, lastPanelStats, bestScheme.name);
        currentAreaResult = null;
        
        // Обновляем URL в адресной строке
        updateURL();
        updateVisualizationMode();
        updateStatLabels();
        
    } catch (error) {
        console.error('Ошибка при расчете:', error);
        const errorMessage = error instanceof Error ? error.message : 'Произошла ошибка при расчете. Проверьте введённые данные.';
        showUserMessage(errorMessage, 'error');
    }
}

// Показ сообщения пользователю
function showUserMessage(message, type = 'info') {
    // Удаляем предыдущее сообщение, если есть
    const existingMsg = document.querySelector('.user-message');
    if (existingMsg) {
        existingMsg.remove();
    }
    
    const messageEl = document.createElement('div');
    messageEl.className = `user-message user-message-${type}`;
    messageEl.textContent = message;
    messageEl.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 16px 20px;
        background: ${type === 'error' ? '#e53e3e' : '#01644f'};
        color: white;
        border-radius: 12px;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.3);
        z-index: 10000;
        max-width: 400px;
        animation: slideIn 0.3s ease;
    `;
    
    document.body.appendChild(messageEl);
    
    // Автоматическое удаление через 5 секунд
    setTimeout(() => {
        messageEl.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => messageEl.remove(), 300);
    }, 5000);
}

// Отрисовка схемы
function renderAllSchemes() {
    renderScheme('bestScheme');
}

function formatCurrency(value) {
    return Math.round(value).toLocaleString('ru-RU');
}

function applyPanelPricing(stats) {
    if (!stats) return stats;
    const costWithoutReserve = stats.total * PANEL_PRICE_RUB;
    const costWithReserve = stats.withReserve * PANEL_PRICE_RUB;
    stats.totalCostWithoutReserve = costWithoutReserve;
    stats.totalCostWithReserve = costWithReserve;
    stats.totalCost = costWithReserve;
    return stats;
}

function getCoverageDisplay(stats, roomArea) {
    const coverageFromStats = stats && stats.coverageArea !== undefined
        ? Number(stats.coverageArea)
        : NaN;
    const rawArea = !Number.isNaN(coverageFromStats)
        ? coverageFromStats
        : stats.total * PANEL_COVERAGE_AREA;
    const areaValue = Math.min(rawArea, roomArea);
    const percentFromStats = stats && stats.coveragePercent !== undefined
        ? Number(stats.coveragePercent)
        : NaN;
    const percent = !Number.isNaN(percentFromStats)
        ? Math.min(100, percentFromStats)
        : (roomArea > 0 ? Math.min(100, (areaValue / roomArea) * 100) : 0);
    return {
        area: areaValue,
        percent,
        areaText: areaValue.toFixed(2),
        percentText: percent.toFixed(1)
    };
}

function updateStatisticsSummary({ panelsText, coverageText, costText }) {
    const panelsEl = document.getElementById('totalPanels');
    const coverageEl = document.getElementById('coverageArea');
    const costEl = document.getElementById('totalCost');

    if (panelsEl) panelsEl.textContent = panelsText;
    if (coverageEl) coverageEl.textContent = coverageText;
    if (costEl) costEl.textContent = costText;
}

function updateStatLabels() {
    const panelsLabelEl = document.querySelector('[data-stat="panels"] .stat-label');
    const coverageLabelEl = document.querySelector('[data-stat="coverage"] .stat-label');

    if (panelsLabelEl) {
        panelsLabelEl.textContent = 'Всего панелей (с запасом)';
    }

    if (coverageLabelEl) {
        coverageLabelEl.textContent = currentCalcMode === CALC_MODES.AREA ? 'Площадь помещения' : 'Площадь покрытия';
        if (currentCalcMode !== CALC_MODES.AREA) {
            coverageLabelEl.setAttribute('title', 'Эффективная площадь покрытия одной панели с учётом шип-паз соединения равна 0,39 м²');
        } else {
            coverageLabelEl.removeAttribute('title');
        }
    }
}

function updateStatisticsPanelMode(stats, roomArea) {
    if (!stats || !roomArea) return;
    const coverage = getCoverageDisplay(stats, roomArea);

    updateStatisticsSummary({
        panelsText: `${stats.withReserve} шт.`,
        coverageText: `${coverage.areaText} м² (${coverage.percentText}%)`,
        costText: `${formatCurrency(stats.totalCost)} ₽`
    });
}

function updateStatisticsAreaMode(areaStats) {
    if (!areaStats) return;

    updateStatisticsSummary({
        panelsText: `${areaStats.panelsWithReserve || areaStats.panels} шт.`,
        coverageText: `${areaStats.coverageArea.toFixed(2)} м²`,
        costText: `${formatCurrency(areaStats.totalCost)} ₽`
    });
}

function updateResultsTextForParams(params, stats, schemeName) {
    if (!calculator || !params || !stats) return;

    const resultsEl = document.getElementById('resultsText');
    if (!resultsEl) return;

    const roomArea = params.room.getTotalArea();
    const coverage = getCoverageDisplay(stats, roomArea);

    const lines = [];
    lines.push(`Размер панели: ${PANEL_SIZE_DISPLAY}`);
    lines.push(`Площадь покрытия панели: ${PANEL_COVERAGE_DISPLAY.toFixed(2)} м²`);
    lines.push(`РРЦ панели: ${formatCurrency(PANEL_PRICE_RUB)} ₽ | РРЦ за м²: ${formatCurrency(PANEL_PRICE_PER_M2)} ₽`);
    if (params.hasLeg) {
        lines.push(`Размер помещения: ${params.room.mainLength.toFixed(2)}×${params.room.mainWidth.toFixed(2)} м (осн.) + ${params.room.legLength.toFixed(2)}×${params.room.legWidth.toFixed(2)} м (выступ)`);
    } else {
        lines.push(`Размер помещения: ${params.room.mainLength.toFixed(2)}×${params.room.mainWidth.toFixed(2)} м`);
    }
    lines.push(`Площадь помещения: ${roomArea.toFixed(2)} м²`);
    lines.push('');
    lines.push(`Всего панелей: ${stats.total} (${stats.fullPanels} целых + ${stats.cutPanels} с подрезкой)`);
    lines.push(`К закупке: ${stats.panelsToPurchase} шт. (каждая подрезанная = 1 целая панель, обрезок не используется)`);
    lines.push(`С 5% запасом: ${stats.withReserve} шт.`);
    lines.push(`Площадь покрытия: ${coverage.areaText} м² (${coverage.percentText}%)`);
    lines.push(`Дюбель-гвозди: ${stats.dowels.withReserve} шт. (с запасом 15%)`);
    lines.push(`Ориентировочное время монтажа: ${stats.workTime.formatted}`);
    lines.push(`Общая стоимость панелей: ${formatCurrency(stats.totalCost)} ₽`);

    const text = lines.join('\n');
    resultsEl.innerHTML = text.replace(/Общая стоимость панелей:/g, '<strong>Общая стоимость панелей:</strong>');
}

function updateResultsTextForArea(areaStats) {
    const resultsEl = document.getElementById('resultsText');
    if (!resultsEl || !areaStats) return;

    const lines = [];
    lines.push(`Размер панели: ${PANEL_SIZE_DISPLAY}`);
    lines.push(`Площадь покрытия панели: ${PANEL_COVERAGE_DISPLAY.toFixed(2)} м²`);
    lines.push(`РРЦ панели: ${formatCurrency(PANEL_PRICE_RUB)} ₽ | РРЦ за м²: ${formatCurrency(PANEL_PRICE_PER_M2)} ₽`);
    lines.push(`Площадь помещения: ${areaStats.area.toFixed(2)} м²`);
    lines.push('');
    lines.push(`Всего панелей: ${areaStats.panels} | с 5% запасом: ${areaStats.panelsWithReserve || areaStats.panels}`);
    lines.push(`Площадь покрытия панелями: ${areaStats.coverageArea.toFixed(2)} м²`);
    lines.push(`Дюбель-гвозди: ${areaStats.dowelsWithReserve} шт. (с запасом 15%)`);
    lines.push(`Ориентировочное время монтажа: ${areaStats.workTimeFormatted}`);
    lines.push(`Общая стоимость панелей: ${formatCurrency(areaStats.totalCost)} ₽`);

    const text = lines.join('\n');
    resultsEl.innerHTML = text.replace(/Общая стоимость панелей:/g, '<strong>Общая стоимость панелей:</strong>');
}

// Управление чекбоксом выступа
function setupLegToggle() {
    const hasLegCheckbox = document.getElementById('hasLeg');
    const legFields = document.getElementById('legFields');
    const legLengthInput = document.getElementById('legLength');
    const legWidthInput = document.getElementById('legWidth');

    const ensureLegDefaults = () => {
        // Если значения пустые или нечисловые — подставляем минимум
        if (!legLengthInput.value || isNaN(parseLocaleNumber(legLengthInput.value))) {
            legLengthInput.value = VALIDATION.MIN_ROOM_SIZE.toFixed(2);
        }
        if (!legWidthInput.value || isNaN(parseLocaleNumber(legWidthInput.value))) {
            legWidthInput.value = VALIDATION.MIN_ROOM_SIZE.toFixed(2);
        }
        // Снимаем ошибки, если были
        clearFieldError('legLength');
        clearFieldError('legWidth');
    };
    
    hasLegCheckbox.addEventListener('change', () => {
        if (hasLegCheckbox.checked) {
            legFields.style.display = 'block';
            ensureLegDefaults();
        } else {
            legFields.style.display = 'none';
        }
    });

    const recalcIfLegEnabled = () => {
        if (hasLegCheckbox.checked) {
            // Поддержим валидность на лету
            ensureLegDefaults();
        }
    };
    if (legLengthInput) {
        legLengthInput.addEventListener('blur', recalcIfLegEnabled);
        legLengthInput.addEventListener('change', recalcIfLegEnabled);
    }
    if (legWidthInput) {
        legWidthInput.addEventListener('blur', recalcIfLegEnabled);
        legWidthInput.addEventListener('change', recalcIfLegEnabled);
    }
}

// Обработчики событий
function setupEventListeners() {
    // Кнопка расчета
    const calculateBtn = document.getElementById('calculateBtn');
    calculateBtn.addEventListener('click', triggerCalculation);
    
    // Клавиатурные сокращения: Enter для расчёта
    document.addEventListener('keydown', (e) => {
        // Enter запускает расчёт, если фокус не на текстовом поле (textarea)
        if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
            const activeElement = document.activeElement;
            // Если фокус на поле ввода или кнопке, выполняем расчёт
            if (activeElement.tagName === 'INPUT' || activeElement === calculateBtn) {
                e.preventDefault();
                triggerCalculation();
            }
        }
    });

    const inputs = ['mainLength', 'mainWidth', 'legLength', 'legWidth'];
    inputs.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            // Форматирование чисел с двумя знаками после запятой для размерных полей (кроме цены)
            const isSizeField = (id === 'mainLength' || id === 'mainWidth' || id === 'legLength' || id === 'legWidth');
            
            // Форматирование значения при изменении через стрелки или потере фокуса
            const formatValue = () => {
                if (isSizeField && element.value !== '') {
                    const numValue = parseLocaleNumber(element.value);
                    if (!isNaN(numValue)) {
                        element.value = numValue.toFixed(2);
                    }
                }
            };
            
            // Валидация при вводе
            element.addEventListener('input', () => {
                // Очищаем ошибку при начале ввода
                clearFieldError(id);
            });
            
            // Валидация при потере фокуса
            element.addEventListener('blur', () => {
                const value = element.value;
                let isValid = true;
                
                if (value !== '') {
                    if (id === 'mainLength' || id === 'mainWidth' || id === 'legLength' || id === 'legWidth') {
                        const val = validateNumber(value, VALIDATION.MIN_ROOM_SIZE, VALIDATION.MAX_ROOM_SIZE, '');
                        if (!val.valid) {
                            showFieldError(id, val.message);
                            isValid = false;
                        } else {
                            // Форматируем значение с двумя знаками после запятой
                            formatValue();
                        }
                    }
                }
                
                if (isValid) {
                    clearFieldError(id);
                }
            });
            
            // Форматирование при изменении через стрелки (событие change)
            element.addEventListener('change', () => {
                // Форматируем значение для размерных полей
                if (isSizeField) {
                    formatValue();
                }
            });
        }
    });
    
    // Переключение сетки и номеров
    document.getElementById('showGrid').addEventListener('change', renderAllSchemes);
    document.getElementById('showNumbers').addEventListener('change', renderAllSchemes);
}

async function saveAreaPdf() {
    if (!currentAreaResult) {
        alert('Сначала выполните расчёт по площади');
        return;
    }

    try {
        renderAreaScheme(currentAreaResult.area);

        const areaCanvas = document.getElementById('areaCanvas');
        const areaImage = areaCanvas ? areaCanvas.toDataURL('image/png') : '';

        const pdfContainer = document.createElement('div');
        pdfContainer.style.cssText = `
            position: fixed;
            left: -10000px;
            top: 0;
            width: 210mm;
            background: white;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            color: #333;
            box-sizing: border-box;
        `;

        const brandColor = '#01644f';

        pdfContainer.innerHTML = `
            <div style="position: relative; min-height: 297mm; display: flex; flex-direction: column; padding-bottom: 20px;">
                <div>
                    <div style="background: ${brandColor}; color: white; padding: 18px; text-align: left; position: relative;">
                        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 6px;">
                            <div style="font-size: 30px; font-weight: bold;">StP MultiFRAME</div>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 14px; border-top: 1px solid rgba(255,255,255,0.5); padding-top: 8px;">
                            <div>Звукоизоляционная система для потолка</div>
                            <div style="font-size: 14px; color: rgba(255,255,255,0.7); font-weight: normal;">
                                by STANDARTPLAST
                            </div>
                        </div>
                    </div>
                    
                    <div style="padding: 22px; display: flex; flex-direction: column;">
                        <h1 style="text-align: center; font-size: 22px; font-weight: bold; margin: 0 0 22px 0; color: #333;">
                            ПРИБЛИЗИТЕЛЬНЫЙ РАСЧЁТ ПО ПЛОЩАДИ
                        </h1>
                        
                        <div style="margin-bottom: 18px;">
                            <h2 style="color: ${brandColor}; font-size: 16px; font-weight: bold; margin: 0 0 10px 0;">
                                Исходные данные:
                            </h2>
                            <div style="font-size: 12px; line-height: 1.6; color: #444; padding-left: 10px;">
                                <div>Площадь помещения: ${currentAreaResult.area.toFixed(2)} м²</div>
                                <div>Размер панели: ${PANEL_SIZE_DISPLAY}</div>
                                <div>Площадь покрытия панели: ${PANEL_COVERAGE_DISPLAY.toFixed(2)} м²</div>
                                <div>РРЦ панели: ${formatCurrency(PANEL_PRICE_RUB)} ₽</div>
                                <div>РРЦ за м²: ${formatCurrency(PANEL_PRICE_PER_M2)} ₽</div>
                            </div>
                        </div>
                        
                        <div style="margin-bottom: 18px;">
                            <h2 style="color: ${brandColor}; font-size: 16px; font-weight: bold; margin: 0 0 10px 0;">
                                Результаты расчёта:
                            </h2>
                            <div style="font-size: 12px; line-height: 1.6; color: #444; padding-left: 10px;">
                                <div>Всего панелей: ${currentAreaResult.panels} шт. (с 5% запасом: ${currentAreaResult.panelsWithReserve || currentAreaResult.panels} шт.)</div>
                                <div>Площадь покрытия панелями: ${currentAreaResult.coverageArea.toFixed(2)} м²</div>
                                <div>Дюбель-гвозди: ${currentAreaResult.dowelsWithReserve} шт. (с запасом 15%)</div>
                                <div>Ориентировочное время монтажа: ${currentAreaResult.workTimeFormatted}</div>
                                <div style="font-weight: bold; color: ${brandColor}; font-size: 14px; margin-top: 6px;">
                                    Общая стоимость панелей: ${formatCurrency(currentAreaResult.totalCost)} ₽
                                </div>
                            </div>
                        </div>
                        
                        <div style="margin-bottom: 14px;">
                            <h2 style="color: ${brandColor}; font-size: 16px; font-weight: bold; margin: 0 0 10px 0;">
                                Условная схема:
                            </h2>
                            <div style="text-align: center; display: flex; justify-content: center; max-height: 500px;">
                                <img id="areaPdfImage" src="${areaImage}" alt="Схема площади" style="max-width: 520px; border: 1px solid #e1e5e8; border-radius: 10px; background: #ffffff;" />
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(pdfContainer);

        await new Promise(resolve => setTimeout(resolve, 200));

        const canvasImg = await html2canvas(pdfContainer, {
            scale: 2,
            useCORS: true,
            allowTaint: false,
            foreignObjectRendering: false,
            logging: false,
            backgroundColor: '#ffffff',
            width: pdfContainer.offsetWidth,
            height: pdfContainer.offsetHeight,
            windowHeight: pdfContainer.scrollHeight
        });

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();

        const imgData = canvasImg.toDataURL('image/jpeg', 0.85);
        const imgWidth = pageWidth;
        const imgHeight = (canvasImg.height * pageWidth) / canvasImg.width;
        const fittedHeight = Math.min(imgHeight, pageHeight);
        doc.addImage(imgData, 'JPEG', 0, 0, imgWidth, fittedHeight, undefined, 'FAST');

        document.body.removeChild(pdfContainer);

        const now = new Date();
        const day = String(now.getDate()).padStart(2, '0');
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const year = String(now.getFullYear()).slice(-2);
        const dateStr = `${day}.${month}.${year}`;

        const areaRounded = Math.round(currentAreaResult.area);
        const fileName = `MultiFrame_area_${areaRounded}m2_${dateStr}.pdf`;
        doc.save(fileName);
    } catch (error) {
        console.error('Ошибка при сохранении PDF:', error);
        const errorMessage = error instanceof Error ? error.message : 'Не удалось сохранить PDF файл.';
        showUserMessage(errorMessage, 'error');
    }
}

// Экспорт в PDF
async function saveToPDF() {
    if (currentCalcMode === CALC_MODES.AREA) {
        return saveAreaPdf();
    }

    if (!window.currentBestScheme || !window.currentParams) {
        alert('Сначала выполните расчет');
        return;
    }
    
    try {
        // Создаем временный контейнер для PDF
        const pdfContainer = document.createElement('div');
        pdfContainer.style.cssText = `
            position: fixed;
            left: -10000px;
            top: 0;
            width: 210mm;
            background: white;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            color: #333;
            box-sizing: border-box;
        `;
        
        const brandColor = '#01644f';
        const roomArea = window.currentParams.room.getTotalArea();
        const stats = window.currentBestScheme.stats;
        const coverage = getCoverageDisplay(stats, roomArea);
        
        pdfContainer.innerHTML = `
            <div style="position: relative; height: 297mm; display: flex; flex-direction: column; padding-bottom: 20px;">
                <div>
                    <div style="background: ${brandColor}; color: white; padding: 18px; text-align: left; position: relative;">
                        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 6px;">
                            <div style="font-size: 30px; font-weight: bold;">StP MultiFRAME</div>
                        </div>
                        <div style="display: flex; justify-content: space-between; align-items: center; font-size: 14px; border-top: 1px solid rgba(255,255,255,0.5); padding-top: 8px;">
                            <div>Звукоизоляционная система для потолка</div>
                            <div style="font-size: 14px; color: rgba(255,255,255,0.7); font-weight: normal;">
                                by STANDARTPLAST
                            </div>
                        </div>
                    </div>
                    
                    <div style="padding: 22px; display: flex; flex-direction: column;">
                        <h1 style="text-align: center; font-size: 22px; font-weight: bold; margin: 0 0 22px 0; color: #333;">
                            РАСЧЁТ СХЕМЫ МОНТАЖА
                        </h1>
                        
                        <div style="margin-bottom: 18px;">
                            <h2 style="color: ${brandColor}; font-size: 16px; font-weight: bold; margin: 0 0 10px 0;">
                                Параметры помещения:
                            </h2>
                            <div style="font-size: 12px; line-height: 1.6; color: #444; padding-left: 10px;">
                                <div>Размеры: ${window.currentParams.room.mainLength.toFixed(2)} × ${window.currentParams.room.mainWidth.toFixed(2)} м${window.currentParams.hasLeg ? ' (основное)' : ''}</div>
                                ${window.currentParams.hasLeg ? '<div>+ ' + window.currentParams.room.legLength.toFixed(2) + ' × ' + window.currentParams.room.legWidth.toFixed(2) + ' м (выступ)</div>' : ''}
                                <div>Площадь помещения: ${roomArea.toFixed(2)} м²</div>
                                <div>Размер панели: ${PANEL_SIZE_DISPLAY}</div>
                                <div>Площадь покрытия панели: ${PANEL_COVERAGE_DISPLAY.toFixed(2)} м²</div>
                                <div>РРЦ панели: ${formatCurrency(PANEL_PRICE_RUB)} ₽</div>
                                <div>РРЦ за м²: ${formatCurrency(PANEL_PRICE_PER_M2)} ₽</div>
                            </div>
                        </div>
                        
                        <div style="margin-bottom: 18px;">
                            <h2 style="color: ${brandColor}; font-size: 16px; font-weight: bold; margin: 0 0 10px 0;">
                                Результаты расчёта:
                            </h2>
                            <div style="font-size: 12px; line-height: 1.6; color: #444; padding-left: 10px;">
                                <div>Всего панелей: ${stats.total} шт. (с запасом 5%: ${stats.withReserve} шт.)</div>
                                <div>Площадь покрытия: ${coverage.areaText} м² (${coverage.percentText}%)</div>
                                <div>Дюбель-гвозди: ${stats.dowels.withReserve} шт. (с запасом 15%)</div>
                                <div>Ориентировочное время монтажа: ${stats.workTime.formatted}</div>
                                <div>РРЦ панели: ${formatCurrency(PANEL_PRICE_RUB)} ₽ | РРЦ за м²: ${formatCurrency(PANEL_PRICE_PER_M2)} ₽</div>
                                <div style="font-weight: bold; color: ${brandColor}; font-size: 14px; margin-top: 6px;">
                                    Общая стоимость панелей: ${formatCurrency(stats.totalCost)} ₽
                                </div>
                            </div>
                        </div>
                        
                        <div style="margin-bottom: 14px;">
                            <h2 style="color: ${brandColor}; font-size: 16px; font-weight: bold; margin: 0 0 10px 0;">
                                Схема монтажа:
                            </h2>
                            <div id="pdfCanvasWrapper" style="text-align: center; display: flex; justify-content: center; max-height: 500px;">
                                <!-- Canvas будет скопирован сюда -->
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        document.body.appendChild(pdfContainer);
        
        // Создаём специальный canvas для PDF с оптимальным масштабом
        const canvasWrapper = pdfContainer.querySelector('#pdfCanvasWrapper');
        if (canvasWrapper) {
            // Создаем временный canvas с фиксированным размером для PDF
            const pdfCanvas = document.createElement('canvas');
            pdfCanvas.id = 'pdfCanvas';
            pdfCanvas.style.maxHeight = '500px';
            pdfCanvas.style.width = 'auto';
            pdfCanvas.style.border = '1px solid #e1e5e8';
            pdfCanvas.style.borderRadius = '10px';
            pdfCanvas.style.background = '#ffffff';
            
            canvasWrapper.appendChild(pdfCanvas);
            
            // Создаём временный визуализатор с адаптивным масштабом для PDF
            const pdfVisualizer = new SchemeVisualizer('pdfCanvas', 50);
            pdfVisualizer.setRoom(window.currentParams.room);
            pdfVisualizer.setPanels(window.currentBestScheme.panels);
            
            // Отрисовываем схему на временном canvas
            const showGrid = document.getElementById('showGrid').checked;
            const showNumbers = document.getElementById('showNumbers').checked;
            pdfVisualizer.render(showGrid, showNumbers);
        }
        
        // Ждем загрузки изображений
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Конвертируем в canvas через html2canvas с высоким качеством
        const canvasImg = await html2canvas(pdfContainer, {
            scale: 2,
            useCORS: true,
            allowTaint: false,
            foreignObjectRendering: false,
            logging: false,
            backgroundColor: '#ffffff',
            width: pdfContainer.offsetWidth,
            height: pdfContainer.offsetHeight,
            windowHeight: pdfContainer.scrollHeight
        });
        
        // Создаем PDF
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        
        // Вычисляем размеры изображения для PDF
        const imgData = canvasImg.toDataURL('image/jpeg', 0.85);
        const imgWidth = pageWidth;
        const imgHeight = (canvasImg.height * pageWidth) / canvasImg.width;
        
        // Вписываем в одну страницу без добавления дополнительных страниц
        const yPos = 0;
        const fittedHeight = Math.min(imgHeight, pageHeight);
        doc.addImage(imgData, 'JPEG', 0, yPos, imgWidth, fittedHeight, undefined, 'FAST');
        
        // Удаляем временный контейнер
        document.body.removeChild(pdfContainer);
        
        // Формируем имя файла с размерами и датой
        const room = window.currentParams.room;
        const hasLeg = window.currentParams.hasLeg;
        
        // Размеры (округляем до целых для краткости)
        const mainSize = `${Math.round(room.mainLength)}х${Math.round(room.mainWidth)}м`;
        const legSize = hasLeg ? `(${Math.round(room.legLength)}х${Math.round(room.legWidth)}м)` : '';
        
        // Текущая дата в формате дд.мм.гг
        const now = new Date();
        const day = String(now.getDate()).padStart(2, '0');
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const year = String(now.getFullYear()).slice(-2);
        const dateStr = `${day}.${month}.${year}`;
        
        // Собираем имя файла
        const fileName = `MultiFrame_${mainSize}${legSize}_${dateStr}.pdf`;
        doc.save(fileName);
        
    } catch (error) {
        console.error('Ошибка при сохранении PDF:', error);
        const errorMessage = error instanceof Error ? error.message : 'Не удалось сохранить PDF файл.';
        showUserMessage(errorMessage, 'error');
    }
}

// Функция расчёта по площади
function calculateAreaEstimation() {
    const areaInput = document.getElementById('quickArea');
    
    if (!areaInput) return;
    
    const area = parseLocaleNumber(areaInput.value);

    if (currentCalcMode !== CALC_MODES.AREA) {
        setCalculationMode(CALC_MODES.AREA);
    }
    
    if (isNaN(area) || area < VALIDATION.MIN_TOTAL_AREA || area > VALIDATION.MAX_TOTAL_AREA) {
        currentAreaResult = null;
        renderAreaScheme(null);
        updateVisualizationMode();
        updateStatisticsSummary({
            panelsText: '—',
            coverageText: '—',
            costText: '—'
        });
        const resultsEl = document.getElementById('resultsText');
        if (resultsEl) {
            resultsEl.textContent = 'Введите площадь и нажмите «Рассчитать», чтобы получить приблизительные результаты.';
        }
        showUserMessage('Введите площадь и нажмите «Рассчитать», чтобы получить приблизительные результаты.', 'error');
        updateURL();
        return;
    }
    
    // Логика: площадь / 0.4 = количество панелей, затем добавляем 5% запас и округляем
    const panelsWithoutReserve = Math.max(1, Math.ceil(area / PANEL_COVERAGE_DISPLAY));
    const panelsWithReserve = Math.round(panelsWithoutReserve * 1.05);
    const panels = panelsWithReserve; // Используем количество с запасом для расчёта стоимости
    const coverageArea = panelsWithoutReserve * PANEL_COVERAGE_DISPLAY;
    const dowelsWithReserve = Math.ceil(panelsWithoutReserve * 2 * 1.15);
    
    const workTimeMinutes = Math.round((panelsWithoutReserve * 60) / 60);
    const workTimeHours = Math.floor(workTimeMinutes / 60);
    const workTimeRemainingMinutes = workTimeMinutes % 60;
    const workTimeFormatted = workTimeHours > 0 
        ? `${workTimeHours} ч ${workTimeRemainingMinutes} мин`
        : `${workTimeMinutes} мин`;
    
    const totalCost = panelsWithReserve * PANEL_PRICE_RUB;
    
    currentAreaResult = {
        area,
        panels: panelsWithoutReserve,
        panelsWithReserve: panelsWithReserve,
        coverageArea,
        totalCost,
        dowelsWithReserve,
        workTimeFormatted
    };
    window.currentBestScheme = null;
    window.currentParams = null;
    calculator = null;
    currentRoom = null;
    lastActiveMode = CALC_MODES.AREA;
    
    updateStatisticsAreaMode(currentAreaResult);
    updateResultsTextForArea(currentAreaResult);
    renderAreaScheme(area);
    updateVisualizationMode();
    updateStatLabels();
    updateURL();
    
}

function triggerCalculation() {
    if (currentCalcMode === CALC_MODES.AREA) {
        calculateAreaEstimation();
    } else if (currentCalcMode === CALC_MODES.PARAMS) {
        calculateAllSchemes();
    } else {
        showUserMessage('Выберите тип расчёта и заполните данные перед запуском.', 'error');
    }
}

// Функция обновления URL без перезагрузки страницы
function updateURL() {
    const params = new URLSearchParams();

    const modeForUrl = currentCalcMode !== CALC_MODES.NONE ? currentCalcMode : lastActiveMode;

    if (modeForUrl === CALC_MODES.AREA && currentAreaResult) {
        params.append('mode', 'area');
        params.append('area', currentAreaResult.area.toFixed(2));
    } else if (modeForUrl === CALC_MODES.PARAMS && window.currentParams && window.currentParams.room) {
        const room = window.currentParams.room;
        params.append('mode', 'params');
        params.append('l', room.mainLength.toFixed(2));
        params.append('w', room.mainWidth.toFixed(2));
        if (window.currentParams.hasLeg && room.legLength && room.legWidth) {
            params.append('ll', room.legLength.toFixed(2));
            params.append('lw', room.legWidth.toFixed(2));
        }
    }

    const query = params.toString();
    const newUrl = query ? `${window.location.pathname}?${query}` : window.location.pathname;
    window.history.replaceState({}, '', newUrl);
}

// Функция генерации ссылки для sharing
function generateShareLink() {
    if (currentCalcMode === CALC_MODES.AREA) {
        if (!currentAreaResult) {
            showUserMessage('Сначала выполните расчёт по площади', 'error');
            return;
        }

        updateURL();
        const shareUrl = window.location.href;
        const coveragePercent = Math.min(100, (currentAreaResult.coverageArea / currentAreaResult.area) * 100).toFixed(1);

        const messageArea = `🔇 StP MultiFRAME
Звукоизоляционная система для потолка
от компании Стандартпласт

📐 ПРИБЛИЗИТЕЛЬНЫЙ РАСЧЁТ ПО ПЛОЩАДИ

Исходные данные:
• Площадь помещения: ${currentAreaResult.area.toFixed(2)} м²
• Размер панели: ${PANEL_SIZE_DISPLAY}
• Площадь покрытия панели: ${PANEL_COVERAGE_DISPLAY.toFixed(2)} м²
• РРЦ панели: ${formatCurrency(PANEL_PRICE_RUB)} ₽ | РРЦ за м²: ${formatCurrency(PANEL_PRICE_PER_M2)} ₽

Результаты:
• Всего панелей: ${currentAreaResult.panels} шт. | с 5% запасом: ${currentAreaResult.panelsWithReserve || currentAreaResult.panels} шт.
• Площадь покрытия: ${currentAreaResult.coverageArea.toFixed(2)} м² (${coveragePercent}%)
• Дюбель-гвозди: ${currentAreaResult.dowelsWithReserve} шт.
• Время монтажа: ${currentAreaResult.workTimeFormatted}
• Общая стоимость панелей: ${formatCurrency(currentAreaResult.totalCost)} ₽

🔗 Посмотреть калькулятор:
${shareUrl}`;

        shareMessage(messageArea);
        return;
    }

    if (!calculator || !currentRoom || !window.currentParams || !window.currentBestScheme) {
        showUserMessage('Сначала выполните расчёт', 'error');
        return;
    }
    
    updateURL();
    const shareUrl = window.location.href;
    const params = window.currentParams;
    const bestScheme = window.currentBestScheme;
    const stats = applyPanelPricing(calculator.getStatistics(bestScheme.panels, params.pricePerM2));
    const roomArea = params.room.getTotalArea();
    const coverage = getCoverageDisplay(stats, roomArea);
    
    let roomDimensions = `${params.room.mainLength.toFixed(2)}×${params.room.mainWidth.toFixed(2)} м`;
    if (params.hasLeg) {
        roomDimensions += ` + ${params.room.legLength.toFixed(2)}×${params.room.legWidth.toFixed(2)} м (выступ)`;
    }
    
    const message = `🔇 StP MultiFRAME
Звукоизоляционная система для потолка
от компании Стандартпласт

📐 РАСЧЁТ СХЕМЫ МОНТАЖА

Параметры помещения:
• Размеры: ${roomDimensions}
• Площадь: ${roomArea.toFixed(2)} м²
• Размер панели: ${PANEL_SIZE_DISPLAY}
• Площадь покрытия панели: ${PANEL_COVERAGE_DISPLAY.toFixed(2)} м²
• РРЦ панели: ${formatCurrency(PANEL_PRICE_RUB)} ₽ | РРЦ за м²: ${formatCurrency(PANEL_PRICE_PER_M2)} ₽

Результаты расчёта:
• Всего панелей: ${stats.total} шт. (${stats.fullPanels} целых + ${stats.cutPanels} с подрезкой)
• К закупке: ${stats.panelsToPurchase} шт. | с запасом 5%: ${stats.withReserve} шт.
• Площадь покрытия: ${coverage.areaText} м² (${coverage.percentText}%)
• Дюбель-гвозди: ${stats.dowels.withReserve} шт. (с запасом 15%)
• Время монтажа: ${stats.workTime.formatted}
• Общая стоимость панелей: ${formatCurrency(stats.totalCost)} ₽

🔗 Посмотреть схему монтажа:
${shareUrl}`;
    
    shareMessage(message);
}

function shareMessage(message) {
    // Определяем, является ли устройство мобильным (улучшенная проверка)
    const isMobile = typeof navigator !== 'undefined' && (
        /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
        (navigator.maxTouchPoints && navigator.maxTouchPoints > 2) ||
        (window.matchMedia && window.matchMedia('(max-width: 768px)').matches)
    );
    
    // Используем Web Share API только на мобильных устройствах
    if (isMobile && typeof navigator !== 'undefined' && navigator.share) {
        // Используем нативное окно "Поделиться" на мобильных
        // Передаём только text, так как ссылка уже включена в текст
        navigator.share({
            title: 'StP MultiFRAME - Расчёт монтажа',
            text: message
        }).then(() => {
            showUserMessage('Спасибо за использование функции "Поделиться"!', 'info');
        }).catch(err => {
            // Пользователь отменил или произошла ошибка
            if (err.name !== 'AbortError') {
                console.error('Ошибка при попытке поделиться:', err);
                // Fallback на копирование в буфер
                copyToClipboard(message);
            }
        });
    } else {
        // Для десктопа - всегда копируем в буфер обмена
        copyToClipboard(message);
    }
}

// Вспомогательная функция для копирования в буфер обмена
function copyToClipboard(text) {
    // Проверка доступности Clipboard API
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            showUserMessage('Расчёт скопирован в буфер обмена!', 'info');
        }).catch(err => {
            // Fallback для старых браузеров
            fallbackCopyToClipboard(text);
        });
    } else {
        // Fallback для старых браузеров
        fallbackCopyToClipboard(text);
    }
}

// Fallback метод копирования для старых браузеров
function fallbackCopyToClipboard(text) {
    try {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        
        if (successful) {
            showUserMessage('Расчёт скопирован в буфер обмена!', 'info');
        } else {
            showUserMessage('Не удалось скопировать. Скопируйте вручную.', 'error');
        }
    } catch (err) {
        console.error('Ошибка при копировании:', err);
        showUserMessage('Не удалось скопировать. Скопируйте вручную.', 'error');
    }
}

// Функция загрузки параметров из URL
function loadFromURL() {
    const urlParams = new URLSearchParams(window.location.search);
    let hasParams = false;
    const modeParam = urlParams.get('mode');

    if (modeParam === 'area' && urlParams.has('area')) {
        const areaValue = parseFloat(urlParams.get('area'));
        if (!isNaN(areaValue)) {
            document.getElementById('quickArea').value = areaValue.toFixed(2);
            setCalculationMode(CALC_MODES.AREA);
            calculateAreaEstimation();
            return;
        }
    }
    
    if (urlParams.has('l')) {
        document.getElementById('mainLength').value = parseFloat(urlParams.get('l')).toFixed(2);
        hasParams = true;
    }
    if (urlParams.has('w')) {
        document.getElementById('mainWidth').value = parseFloat(urlParams.get('w')).toFixed(2);
        hasParams = true;
    }
    if (urlParams.has('ll') && urlParams.has('lw')) {
        document.getElementById('hasLeg').checked = true;
        document.getElementById('legFields').style.display = 'block';
        document.getElementById('legLength').value = parseFloat(urlParams.get('ll')).toFixed(2);
        document.getElementById('legWidth').value = parseFloat(urlParams.get('lw')).toFixed(2);
        hasParams = true;
    }
    if (hasParams) {
        setCalculationMode(CALC_MODES.PARAMS);
        calculateAllSchemes();
    } else {
        setCalculationMode(CALC_MODES.NONE);
    }
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
    initializeVisualizers();
    setupLegToggle();
    setupEventListeners();
    
    // Убираем фокус при клике вне полей ввода, чтобы не появлялся курсор ввода
    document.addEventListener('mousedown', (e) => {
        const target = e.target;
        // Если клик не на поле ввода, textarea или contenteditable элементе, убираем фокус
        if (target.tagName !== 'INPUT' && 
            target.tagName !== 'TEXTAREA' && 
            !target.hasAttribute('contenteditable')) {
            // Убираем фокус с активного элемента, если это не поле ввода
            if (document.activeElement && 
                document.activeElement.tagName !== 'INPUT' && 
                document.activeElement.tagName !== 'TEXTAREA' &&
                !document.activeElement.hasAttribute('contenteditable')) {
                document.activeElement.blur();
            }
        }
    });
    
    renderAreaScheme(null);
    updateVisualizationMode();
    updateStatisticsSummary({
        panelsText: '—',
        coverageText: '—',
        costText: '—'
    });
    const resultsEl = document.getElementById('resultsText');
    if (resultsEl) {
        resultsEl.textContent = DEFAULT_RESULTS_MESSAGE;
    }

    // Загружаем параметры из URL (если есть)
    loadFromURL();

    // Форматирование начальных значений полей с размерностями (с двумя знаками после запятой)
    const sizeFields = ['mainLength', 'mainWidth', 'legLength', 'legWidth'];
    sizeFields.forEach(id => {
        const element = document.getElementById(id);
        if (element && element.value !== '') {
            const numValue = parseLocaleNumber(element.value);
            if (!isNaN(numValue)) {
                element.value = numValue.toFixed(2);
            }
        }
    });
    // Тема: загрузка и обработчик для переключателя checkbox
    // По умолчанию всегда светлая тема при первой загрузке
    try {
        const savedTheme = localStorage.getItem('mf_theme');
        const isDark = savedTheme === 'dark';
        
        // Применяем тёмную тему только если пользователь явно выбрал её ранее
        // По умолчанию всегда светлая тема
        if (isDark) {
            document.body.classList.add('theme-dark');
        } else {
            // Убеждаемся, что тёмная тема не применена
            document.body.classList.remove('theme-dark');
        }

        const switchEl = document.getElementById('themeSwitch');
        if (switchEl) {
            switchEl.checked = isDark;
            switchEl.addEventListener('change', () => {
                const dark = switchEl.checked;
                document.body.classList.toggle('theme-dark', dark);
                localStorage.setItem('mf_theme', dark ? 'dark' : 'light');
            });
        }
    } catch (e) {
        // localStorage может быть недоступен в приватных режимах — безопасно игнорируем
        // Убеждаемся, что тёмная тема не применена
        document.body.classList.remove('theme-dark');
    }
    
});

// Функция переключения блока расчёта по параметрам
function toggleParamsCalc() {
    if (currentCalcMode === CALC_MODES.PARAMS) {
        setCalculationMode(CALC_MODES.NONE);
    } else {
        setCalculationMode(CALC_MODES.PARAMS);
    }
}

// Функция переключения блока быстрого расчёта
function toggleQuickCalc() {
    if (currentCalcMode === CALC_MODES.AREA) {
        setCalculationMode(CALC_MODES.NONE);
    } else {
        setCalculationMode(CALC_MODES.AREA);
    }
}

// Глобальные функции
window.saveToPDF = saveToPDF;
window.renderScheme = renderScheme;
window.quickCalculate = calculateAreaEstimation;
window.generateShareLink = generateShareLink;
window.toggleQuickCalc = toggleQuickCalc;
window.toggleParamsCalc = toggleParamsCalc;

