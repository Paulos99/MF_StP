// Класс для визуализации схем
class SchemeVisualizer {
    constructor(canvasId, scale = 50) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.scale = scale;
        this.dpr = Math.max(window.devicePixelRatio || 1, 1);
        this.rotation = 0;
        this.zoom = 1.0;
        this.currentPanels = [];
        this.currentRoom = null;
        
        // Параметры перемещения (pan)
        this.panX = 0;
        this.panY = 0;
        this.isDragging = false;
        this.dragStartX = 0;
        this.dragStartY = 0;
        this.lastPanX = 0;
        this.lastPanY = 0;
        
        // Инициализация событий перемещения
        this.initPanEvents();
    }

    setScale(scale) {
        this.scale = scale;
    }

    setPanels(panels) {
        this.currentPanels = panels;
    }

    setRoom(room) {
        this.currentRoom = room;
    }

    // Очистка canvas
    clear() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }

    // Автоматический расчет оптимального масштаба для помещения
    calculateOptimalScale() {
        if (!this.currentRoom) return this.scale;
        
        const width = Math.max(this.currentRoom.mainLength, this.currentRoom.legLength);
        const height = this.currentRoom.mainWidth + this.currentRoom.legWidth;
        
        // Проверяем, мобильное ли устройство
        const isMobile = window.matchMedia && window.matchMedia('(max-width: 768px)').matches;
        
        // Максимальные размеры canvas в пикселях
        const maxCanvasWidth = isMobile ? 400 : 800;  // Меньше для мобильных
        const maxCanvasHeight = isMobile ? 400 : 800; // Меньше для мобильных
        const padding = isMobile ? 80 : 100; // Меньше отступы на мобильных
        
        // Вычисляем необходимый масштаб, чтобы помещение поместилось
        const scaleByWidth = (maxCanvasWidth - padding) / width;
        const scaleByHeight = (maxCanvasHeight - padding) / height;
        
        // Выбираем минимальный масштаб, чтобы всё поместилось
        let optimalScale = Math.min(scaleByWidth, scaleByHeight);
        
        // Ограничиваем масштаб разумными пределами
        // На мобильных увеличиваем минимальный масштаб для лучшей видимости
        const minScale = isMobile ? 15 : 10;
        const maxScale = isMobile ? 60 : 50;
        optimalScale = Math.max(minScale, Math.min(maxScale, optimalScale));
        
        return optimalScale;
    }

    // Установка размера canvas
    resize() {
        if (!this.currentRoom) return;
        
        // Используем адаптивный масштаб для больших помещений
        const adaptiveScale = this.calculateOptimalScale();
        
        const width = Math.max(this.currentRoom.mainLength, this.currentRoom.legLength);
        const height = this.currentRoom.mainWidth + this.currentRoom.legWidth;
        
        // Базовый размер БЕЗ zoom - canvas всегда одного размера в DOM
        const baseWidth = width * adaptiveScale + 100;
        const baseHeight = height * adaptiveScale + 100;
        
        // Canvas ФИКСИРОВАННОГО размера в CSS (в DOM не растет)
        this.canvas.style.width = baseWidth + 'px';
        this.canvas.style.height = baseHeight + 'px';
        
        // Применяем CSS transform для визуального увеличения (не влияет на layout!)
        this.canvas.style.transform = `scale(${this.zoom})`;
        this.canvas.style.transformOrigin = 'center center';
        this.canvas.style.position = 'relative';

        // Реальный буфер в ВЫСОКОМ разрешении для четкости
        const bufferScale = 3; // Высокий буфер для качества при любом zoom
        this.canvas.width = Math.floor(baseWidth * this.dpr * bufferScale);
        this.canvas.height = Math.floor(baseHeight * this.dpr * bufferScale);

        // Сбрасываем трансформации и масштабируем контекст
        this.ctx.setTransform(this.dpr * bufferScale, 0, 0, this.dpr * bufferScale, 0, 0);
        
        // Сохраняем текущий адаптивный масштаб для использования в отрисовке
        this.currentScale = adaptiveScale;
    }

    // Поворот canvas
    rotate(angle) {
        this.rotation += angle;
        if (this.rotation >= 360) this.rotation -= 360;
        if (this.rotation < 0) this.rotation += 360;
    }

    // Масштабирование (используется извне через свойство zoom)
    setZoom(zoomValue) {
        this.zoom = zoomValue;
        if (this.zoom < 0.5) this.zoom = 0.5;
        if (this.zoom > 5) this.zoom = 5; // Увеличиваем максимальный zoom до 5x
    }
    
    // Инициализация событий перемещения (pan)
    initPanEvents() {
        if (!this.canvas) return;
        
        // Мышь - начало перетаскивания (только при zoom > 1)
        this.canvas.addEventListener('mousedown', (e) => {
            if (this.zoom <= 1) return; // Отключаем drag при zoom = 1
            this.isDragging = true;
            this.dragStartX = e.clientX - this.panX * this.zoom;
            this.dragStartY = e.clientY - this.panY * this.zoom;
            this.canvas.style.cursor = 'grabbing';
            e.preventDefault();
        });
        
        // Мышь - перетаскивание
        window.addEventListener('mousemove', (e) => {
            if (this.isDragging) {
                // Учитываем zoom при перемещении
                this.panX = (e.clientX - this.dragStartX) / this.zoom;
                this.panY = (e.clientY - this.dragStartY) / this.zoom;
                this.render(
                    document.getElementById('showGrid')?.checked ?? true,
                    document.getElementById('showNumbers')?.checked ?? true
                );
            }
        });
        
        // Мышь - конец перетаскивания
        window.addEventListener('mouseup', () => {
            if (this.isDragging) {
                this.isDragging = false;
                this.canvas.style.cursor = 'grab';
            }
        });
        
        // Тач - начало (только при zoom > 1)
        this.canvas.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1 && this.zoom > 1) { // Только при zoom > 1
                this.isDragging = true;
                const touch = e.touches[0];
                this.dragStartX = touch.clientX - this.panX * this.zoom;
                this.dragStartY = touch.clientY - this.panY * this.zoom;
                e.preventDefault();
            }
        }, { passive: false });
        
        // Тач - перемещение
        window.addEventListener('touchmove', (e) => {
            if (this.isDragging && e.touches.length === 1) {
                const touch = e.touches[0];
                // Учитываем zoom при перемещении
                this.panX = (touch.clientX - this.dragStartX) / this.zoom;
                this.panY = (touch.clientY - this.dragStartY) / this.zoom;
                this.render(
                    document.getElementById('showGrid')?.checked ?? true,
                    document.getElementById('showNumbers')?.checked ?? true
                );
                e.preventDefault();
            }
        }, { passive: false });
        
        // Тач - конец
        window.addEventListener('touchend', () => {
            if (this.isDragging) {
                this.isDragging = false;
            }
        });
        
        // Обновляем курсор в зависимости от zoom
        this.updateCursor();
    }
    
    // Обновление курсора в зависимости от zoom
    updateCursor() {
        if (!this.canvas) return;
        if (this.zoom > 1) {
            this.canvas.style.cursor = 'grab';
        } else {
            this.canvas.style.cursor = 'default';
        }
    }
    
    // Сброс позиции перемещения
    resetPan() {
        this.panX = 0;
        this.panY = 0;
    }

    // Рисование сетки
    drawGrid(showGrid) {
        return;
    }

    // Рисование помещения
    drawRoom() {
        if (!this.currentRoom) return;

        this.ctx.save();
        this.ctx.translate(50 + this.panX, 50 + this.panY);

        // Рисуем единый L‑образный контур без внутренней границы между основной частью и выступом
        const scale = (this.currentScale || this.scale);
        const mainL = this.currentRoom.mainLength * scale;
        const mainW = this.currentRoom.mainWidth * scale;
        const legL = this.currentRoom.legLength * scale;
        const legW = this.currentRoom.legWidth * scale;

        this.ctx.fillStyle = '#f5f5f5';
        this.ctx.strokeStyle = '#333333';
        this.ctx.lineWidth = 2;

        this.ctx.beginPath();
        // Старт в левом верхнем углу основной части
        this.ctx.moveTo(0, 0);
        // Вправо по верхней кромке основной части
        this.ctx.lineTo(mainL, 0);
        // Вниз по правой кромке основной части
        this.ctx.lineTo(mainL, mainW);
        if (legL > 0 && legW > 0) {
            // Влево до внутреннего угла (границы выступа)
            this.ctx.lineTo(legL, mainW);
            // Вниз по правой кромке выступа
            this.ctx.lineTo(legL, mainW + legW);
            // Влево до левого низа выступа
            this.ctx.lineTo(0, mainW + legW);
        } else {
            // Прямоугольная комната
            this.ctx.lineTo(0, mainW);
        }
        // Вверх по левой кромке до начала
        this.ctx.lineTo(0, 0);
        this.ctx.closePath();

        this.ctx.fill();
        this.ctx.stroke();

        this.ctx.restore();
    }

    // Создание пунктирного паттерна для подрезанных панелей
    createCutPanelPattern(baseColor) {
        if (!this._cutPatternCache) {
            this._cutPatternCache = {};
        }
        if (this._cutPatternCache[baseColor]) {
            return this._cutPatternCache[baseColor];
        }

        const tile = document.createElement('canvas');
        tile.width = 8;
        tile.height = 8;
        const tctx = tile.getContext('2d');
        tctx.fillStyle = baseColor;
        tctx.fillRect(0, 0, 8, 8);
        tctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
        tctx.lineWidth = 1.5;
        tctx.setLineDash([2, 3]);
        tctx.beginPath();
        tctx.moveTo(0, 8);
        tctx.lineTo(8, 0);
        tctx.stroke();
        tctx.setLineDash([]);

        const pattern = this.ctx.createPattern(tile, 'repeat');
        this._cutPatternCache[baseColor] = pattern;
        return pattern;
    }

    // Рисование панелей
    drawPanels(showNumbers) {
        this.ctx.save();
        this.ctx.translate(50 + this.panX, 50 + this.panY);

        const colors = {
            [Orientation.HORIZONTAL]: {
                fill: '#404449',
                stroke: '#2b2f33'
            },
            [Orientation.VERTICAL]: {
                fill: '#404449',
                stroke: '#2b2f33'
            }
        };

        const scale = (this.currentScale || this.scale);
        
        this.currentPanels.forEach(panel => {
            const color = colors[panel.orientation] || colors[Orientation.HORIZONTAL];
            
            const x = panel.x * scale;
            const y = panel.y * scale;
            const width = panel.width * scale;
            const height = panel.height * scale;

            if (panel.isCut) {
                const pattern = this.createCutPanelPattern(color.fill);
                this.ctx.fillStyle = pattern || color.fill;
            } else {
                this.ctx.fillStyle = color.fill;
            }
            this.ctx.strokeStyle = color.stroke;
            this.ctx.lineWidth = panel.isCut ? 1.5 : 1.2;
            
            if (panel.isCut) {
                this.ctx.setLineDash([4, 3]);
            } else {
                this.ctx.setLineDash([]);
            }

            this.ctx.fillRect(x, y, width, height);
            this.ctx.strokeRect(x, y, width, height);
            this.ctx.setLineDash([]);

            // Номер панели
            if (showNumbers) {
                const panelSize = Math.min(width, height);
                let fontSize = Math.max(7, Math.min(panelSize * 0.45, 18));
                
                this.ctx.fillStyle = '#ffffff';
                this.ctx.font = `bold ${fontSize}px Arial`;
                this.ctx.textAlign = 'center';
                this.ctx.textBaseline = 'middle';
                
                const text = panel.number.toString();
                
                this.ctx.fillText(
                    text,
                    x + width / 2,
                    y + height / 2
                );
            }
        });

        this.ctx.restore();
    }

    // Рисование размерных линий для Г‑образной комнаты
    drawDimensions() {
        const room = this.currentRoom;
        if (!room) return;

        const ctx = this.ctx;
        const scale = (this.currentScale || this.scale) * this.zoom;

        const mainW = room.mainWidth * scale;
        const mainL = room.mainLength * scale;
        const legL = room.legLength * scale;
        const legW = room.legWidth * scale;

        // Смещения
        const baseX = 50;
        const baseY = 50;
        const offset = 18;      // отступ от контура
        const arrowSize = 8 * Math.max(1, this.zoom);

        ctx.save();
        // Цвет стрелок и подписей — фирменный (как у заголовка)
        ctx.strokeStyle = '#01644f';
        ctx.fillStyle = '#01644f';
        ctx.lineWidth = 2;
        ctx.font = `bold ${Math.max(12, 14 * this.zoom)}px Arial`;

        // Линия размера со стрелками внутрь
        const drawDimLine = (x1, y1, x2, y2) => {
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
            const angle = Math.atan2(y2 - y1, x2 - x1);
            // стрелка в точке 1 (внутрь — в сторону x2,y2)
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x1 + arrowSize * Math.cos(angle + Math.PI / 6), y1 + arrowSize * Math.sin(angle + Math.PI / 6));
            ctx.moveTo(x1, y1);
            ctx.lineTo(x1 + arrowSize * Math.cos(angle - Math.PI / 6), y1 + arrowSize * Math.sin(angle - Math.PI / 6));
            // стрелка в точке 2 (внутрь — в сторону x1,y1)
            const back = angle + Math.PI;
            ctx.moveTo(x2, y2);
            ctx.lineTo(x2 + arrowSize * Math.cos(back + Math.PI / 6), y2 + arrowSize * Math.sin(back + Math.PI / 6));
            ctx.moveTo(x2, y2);
            ctx.lineTo(x2 + arrowSize * Math.cos(back - Math.PI / 6), y2 + arrowSize * Math.sin(back - Math.PI / 6));
            ctx.stroke();
        };

        // Общая ширина (по Y) слева
        const totalH = mainW + legW; // в пикселях
        const leftOffset = 10; // ближе к схеме
        const leftX = baseX - leftOffset;
        const topY = baseY;
        const bottomY = baseY + totalH;
        drawDimLine(leftX, topY, leftX, bottomY);

        // Подпись общей высоты с остатком
        const totalHeightMeters = (room.mainWidth + room.legWidth).toFixed(2);
        const leftLabel = `${totalHeightMeters} м`;
        ctx.save();
        ctx.translate(leftX - 8, baseY + totalH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.fillText(leftLabel, 0, 0);
        ctx.restore();

        // Общая длина (по X) сверху
        const topX1 = baseX;
        const topX2 = baseX + mainL;
        const topYDim = baseY - 14; // чуть ближе к схеме
        drawDimLine(topX1, topYDim, topX2, topYDim);

        const totalLengthMeters = room.mainLength.toFixed(2);
        const topLabel = `${totalLengthMeters} м`;
        ctx.textAlign = 'center';
        ctx.fillText(topLabel, (topX1 + topX2) / 2, topYDim - 6);

        // Размеры выступа (верхняя горизонтальная сторона)
        if (room.legLength > 0 && room.legWidth > 0) {
            // Горизонтальная сторона выступа: перенесена ниже выступа, чтобы не перекрываться
            const legBottomY = baseY + mainW + legW + offset;
            drawDimLine(baseX, legBottomY, baseX + legL, legBottomY);
            ctx.textAlign = 'center';
            ctx.fillText(`${room.legLength.toFixed(1)} м`, baseX + legL / 2, legBottomY + 14);

            // Вертикальная сторона выступа справа от выступа
            const rightDimX = baseX + legL + offset;
            const rightY1 = baseY + mainW; // верхняя грань выступа
            const rightY2 = baseY + mainW + legW; // нижняя грань выступа
            drawDimLine(rightDimX, rightY1, rightDimX, rightY2);
            ctx.save();
            ctx.translate(rightDimX + 16, (rightY1 + rightY2) / 2);
            ctx.rotate(-Math.PI / 2);
            ctx.textAlign = 'center';
            ctx.fillText(`${room.legWidth.toFixed(1)} м`, 0, 0);
            ctx.restore();
        }

        // Подпись оси Y убрана по требованию

        ctx.restore();
    }

    // Главная функция отрисовки
    render(showGrid = true, showNumbers = true) {
        this.clear();
        this.resize();
        
        // Применяем поворот, если есть
        if (this.rotation !== 0) {
            this.ctx.save();
            this.ctx.translate(this.canvas.width / 2, this.canvas.height / 2);
            this.ctx.rotate((this.rotation * Math.PI) / 180);
            this.ctx.translate(-this.canvas.width / 2, -this.canvas.height / 2);
        }

        this.drawGrid(showGrid);
        this.drawRoom();
        this.drawPanels(showNumbers);
        // Размерные линии рисуем последними, чтобы они были поверх всего
        this.drawDimensionsOverlay();

        if (this.rotation !== 0) {
            this.ctx.restore();
        }
    }
    
    // Отрисовка размерных линий поверх всего
    drawDimensionsOverlay() {
        const room = this.currentRoom;
        if (!room) return;

        const ctx = this.ctx;
        const scale = (this.currentScale || this.scale);

        const mainW = room.mainWidth * scale;
        const mainL = room.mainLength * scale;
        const legL = room.legLength * scale;
        const legW = room.legWidth * scale;

        // Смещения с учетом перемещения
        const baseX = 50 + this.panX;
        const baseY = 50 + this.panY;
        const offset = 18;
        const arrowSize = 8;

        ctx.save();
        ctx.strokeStyle = '#01644f';
        ctx.fillStyle = '#01644f';
        ctx.lineWidth = 2;
        ctx.font = `bold 14px Arial`;

        // Функция для рисования линии размера
        const drawDimLine = (x1, y1, x2, y2) => {
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x2, y2);
            ctx.stroke();
            const angle = Math.atan2(y2 - y1, x2 - x1);
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            ctx.lineTo(x1 + arrowSize * Math.cos(angle + Math.PI / 6), y1 + arrowSize * Math.sin(angle + Math.PI / 6));
            ctx.moveTo(x1, y1);
            ctx.lineTo(x1 + arrowSize * Math.cos(angle - Math.PI / 6), y1 + arrowSize * Math.sin(angle - Math.PI / 6));
            const back = angle + Math.PI;
            ctx.moveTo(x2, y2);
            ctx.lineTo(x2 + arrowSize * Math.cos(back + Math.PI / 6), y2 + arrowSize * Math.sin(back + Math.PI / 6));
            ctx.moveTo(x2, y2);
            ctx.lineTo(x2 + arrowSize * Math.cos(back - Math.PI / 6), y2 + arrowSize * Math.sin(back - Math.PI / 6));
            ctx.stroke();
        };

        // Общая ширина (по Y) слева
        const totalH = mainW + legW;
        const leftOffset = 10;
        const leftX = baseX - leftOffset;
        const topY = baseY;
        const bottomY = baseY + totalH;
        drawDimLine(leftX, topY, leftX, bottomY);

        const totalHeightMeters = (room.mainWidth + room.legWidth).toFixed(2);
        const leftLabel = `${totalHeightMeters} м`;
        ctx.save();
        ctx.translate(leftX - 8, baseY + totalH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = 'center';
        ctx.fillText(leftLabel, 0, 0);
        ctx.restore();

        // Общая длина (по X) сверху
        const topX1 = baseX;
        const topX2 = baseX + mainL;
        const topYDim = baseY - 14;
        drawDimLine(topX1, topYDim, topX2, topYDim);

        const totalLengthMeters = room.mainLength.toFixed(2);
        const topLabel = `${totalLengthMeters} м`;
        ctx.textAlign = 'center';
        ctx.fillText(topLabel, (topX1 + topX2) / 2, topYDim - 6);

        // Размеры выступа
        if (room.legLength > 0 && room.legWidth > 0) {
            const legBottomY = baseY + mainW + legW + offset;
            drawDimLine(baseX, legBottomY, baseX + legL, legBottomY);
            ctx.textAlign = 'center';
            ctx.fillText(`${room.legLength.toFixed(1)} м`, baseX + legL / 2, legBottomY + 14);

            const rightDimX = baseX + legL + offset;
            const rightY1 = baseY + mainW;
            const rightY2 = baseY + mainW + legW;
            drawDimLine(rightDimX, rightY1, rightDimX, rightY2);
            ctx.save();
            ctx.translate(rightDimX + 16, (rightY1 + rightY2) / 2);
            ctx.rotate(-Math.PI / 2);
            ctx.textAlign = 'center';
            ctx.fillText(`${room.legWidth.toFixed(1)} м`, 0, 0);
            ctx.restore();
        }

        ctx.restore();
    }

    // Экспорт в изображение
    exportToImage() {
        return this.canvas.toDataURL('image/png');
    }
}

// Глобальные функции для управления canvas
const canvasStates = {
    bestScheme: { rotation: 0, zoom: 1.0 }
};

const visualizers = {
    bestScheme: null
};

function rotateCanvas(schemeId, angle) {
    const state = canvasStates[schemeId] || canvasStates.bestScheme;
    if (!state) return;
    
    state.rotation += angle;
    if (state.rotation >= 360) state.rotation -= 360;
    if (state.rotation < 0) state.rotation += 360;
    
    const visualizer = visualizers[schemeId] || visualizers.bestScheme;
    if (visualizer) {
        visualizer.rotation = state.rotation;
        renderScheme(schemeId || 'bestScheme');
    }
}

function zoomCanvas(schemeId, factor) {
    const state = canvasStates[schemeId] || canvasStates.bestScheme;
    if (!state) return;
    
    state.zoom *= factor;
    if (state.zoom < 0.5) state.zoom = 0.5;
    if (state.zoom > 5) state.zoom = 5;
    
    const visualizer = visualizers[schemeId] || visualizers.bestScheme;
    if (visualizer) {
        visualizer.zoom = state.zoom;
        visualizer.updateCursor(); // Обновляем курсор при изменении zoom
        renderScheme(schemeId || 'bestScheme');
    }
}

function resetCanvasView(schemeId) {
    const state = canvasStates[schemeId] || canvasStates.bestScheme;
    if (!state) return;
    
    state.zoom = 1.0;
    
    const visualizer = visualizers[schemeId] || visualizers.bestScheme;
    if (visualizer) {
        visualizer.zoom = 1.0;
        visualizer.resetPan();
        renderScheme(schemeId || 'bestScheme');
    }
}

function saveCanvas(schemeId) {
    // Старая функция сохранения PNG, теперь используется saveToPDF
    if (window.saveToPDF) {
        saveToPDF();
    }
}

function renderScheme(schemeId) {
    const visualizer = visualizers[schemeId] || visualizers.bestScheme;
    if (!visualizer) return;
    
    // Применяем zoom из состояния
    const state = canvasStates[schemeId] || canvasStates.bestScheme;
    if (state) {
        visualizer.zoom = state.zoom;
        visualizer.rotation = state.rotation;
    }
    
    const showGrid = document.getElementById('showGrid').checked;
    const showNumbers = document.getElementById('showNumbers').checked;
    
    visualizer.render(showGrid, showNumbers);
}

// Экспорт функций в window для использования в HTML
window.zoomCanvas = zoomCanvas;
window.resetCanvasView = resetCanvasView;

