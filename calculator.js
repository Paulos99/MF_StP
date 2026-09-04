// Классы для работы с данными
class LShapedRoom {
    constructor(mainLength, mainWidth, legLength, legWidth) {
        this.mainLength = mainLength;
        this.mainWidth = mainWidth;
        this.legLength = legLength;
        this.legWidth = legWidth;
    }

    getTotalArea() {
        const mainArea = this.mainLength * this.mainWidth;
        const legArea = this.legLength * this.legWidth;
        return mainArea + legArea;
    }
}

class Orientation {
    static HORIZONTAL = 'HORIZONTAL';
    static VERTICAL = 'VERTICAL';
}

class Panel {
    constructor(x, y, width, height, orientation, number, isCut = false) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
        this.orientation = orientation;
        this.number = number;
        this.isCut = isCut;
    }

    getArea() {
        return this.width * this.height;
    }
}

// Константы размеров панелей
const DISPLAY_PANEL_LENGTH = 0.75;   // м - полный размер панели (для отображения)
const DISPLAY_PANEL_WIDTH  = 0.55;   // м - полный размер панели (для отображения)
const EFFECTIVE_PANEL_LENGTH = 0.735; // м - эффективный размер с учётом шип-паз (для укладки и расчёта)
const EFFECTIVE_PANEL_WIDTH  = 0.535; // м - эффективный размер с учётом шип-паз (для укладки и расчёта)

// Основной класс калькулятора
class PanelCalculator {
    constructor(room) {
        this.room = room;
        // Для укладки используем ЭФФЕКТИВНЫЕ размеры (с учётом шип-паз)
        this.panelLength = EFFECTIVE_PANEL_LENGTH;
        this.panelWidth = EFFECTIVE_PANEL_WIDTH;
    }

    // Проверка, находится ли точка внутри Г-образной комнаты
    isPointInsideRoom(x, y) {
        // Основная часть
        if (x >= 0 && x <= this.room.mainLength && 
            y >= 0 && y <= this.room.mainWidth) {
            return true;
        }
        
        // Выступ (если есть)
        if (this.room.legLength > 0 && this.room.legWidth > 0) {
            if (x >= 0 && x <= this.room.legLength && 
                y >= this.room.mainWidth && y <= this.room.mainWidth + this.room.legWidth) {
                return true;
            }
        }
        
        return false;
    }

    isFullHorizontalPanel(width, height) {
        return Math.abs(width - this.panelLength) < 1e-6 && Math.abs(height - this.panelWidth) < 1e-6;
    }

    isFullVerticalPanel(width, height) {
        return Math.abs(width - this.panelWidth) < 1e-6 && Math.abs(height - this.panelLength) < 1e-6;
    }

    getMaxXForRow(y) {
        if (y < this.room.mainWidth) {
            return this.room.mainLength;
        }
        return this.room.legLength;
    }

    getMaxYForColumn(x) {
        const maxY = this.room.mainWidth + this.room.legWidth;
        if (x < this.room.legLength && x < this.room.mainLength) {
            return maxY;
        }
        if (x < this.room.mainLength) {
            return this.room.mainWidth;
        }
        if (x < this.room.legLength) {
            return maxY;
        }
        return 0;
    }

    tryPlacePanel(panels, x, y, width, height, orientation, isCut) {
        if (width < 1e-6 || height < 1e-6) return null;

        const panel = new Panel(x, y, width, height, orientation, 0, isCut);
        if (!this.isPanelInsideRoom(panel.x, panel.y, panel.width, panel.height)) {
            return null;
        }
        if (this.checkPanelCollision(panel, panels)) {
            return null;
        }
        panels.push(panel);
        return panel;
    }

    fillHorizontalLayout(panels, startY = 0) {
        const maxY = this.room.mainWidth + this.room.legWidth;
        let y = startY;

        while (y < maxY - 1e-6) {
            const rowHeight = Math.min(this.panelWidth, maxY - y);
            const crossesMainLegBoundary = (
                this.room.legLength > 0 &&
                this.room.legWidth > 0 &&
                y < this.room.mainWidth - 1e-6 &&
                y + rowHeight > this.room.mainWidth + 1e-6
            );

            if (crossesMainLegBoundary) {
                const upperHeight = this.room.mainWidth - y;
                if (upperHeight > 1e-6) {
                    this.fillHorizontalRow(panels, y, upperHeight, this.room.mainLength);
                }
                const lowerHeight = rowHeight - upperHeight;
                if (lowerHeight > 1e-6) {
                    this.fillHorizontalRow(panels, this.room.mainWidth, lowerHeight, this.room.legLength);
                }
            } else {
                this.fillHorizontalRow(panels, y, rowHeight, this.getMaxXForRow(y));
            }

            y += rowHeight;
        }

        return this.renumberPanels(panels);
    }

    fillHorizontalRow(panels, y, rowHeight, maxX) {
        let x = 0;
        while (x < maxX - 1e-6) {
            const remainingX = maxX - x;
            const panelWidth = remainingX >= this.panelLength - 1e-6
                ? this.panelLength
                : remainingX;
            const isCut = !this.isFullHorizontalPanel(panelWidth, rowHeight);

            this.tryPlacePanel(
                panels, x, y, panelWidth, rowHeight,
                Orientation.HORIZONTAL, isCut
            );

            x += panelWidth;
        }
    }

    fillVerticalLayout(panels) {
        const maxX = Math.max(this.room.mainLength, this.room.legLength);
        let x = 0;

        while (x < maxX - 1e-6) {
            const colWidth = Math.min(this.panelWidth, maxX - x);
            const crossesVerticalBoundary = (
                this.room.legLength > 0 &&
                this.room.legWidth > 0 &&
                this.room.legLength !== this.room.mainLength &&
                x < Math.min(this.room.legLength, this.room.mainLength) - 1e-6 &&
                x + colWidth > Math.min(this.room.legLength, this.room.mainLength) + 1e-6
            );

            if (crossesVerticalBoundary) {
                const boundaryX = Math.min(this.room.legLength, this.room.mainLength);
                const leftWidth = boundaryX - x;
                if (leftWidth > 1e-6) {
                    this.fillVerticalColumn(panels, x, leftWidth, 0, this.room.mainWidth + this.room.legWidth);
                }
                const rightWidth = colWidth - leftWidth;
                if (rightWidth > 1e-6) {
                    const rightStartY = x + leftWidth >= this.room.mainLength - 1e-6
                        ? this.room.mainWidth
                        : 0;
                    const rightMaxY = this.getMaxYForColumn(x + leftWidth);
                    this.fillVerticalColumn(panels, x + leftWidth, rightWidth, rightStartY, rightMaxY);
                }
            } else {
                let startY = 0;
                if (x >= this.room.mainLength - 1e-6 && x < this.room.legLength - 1e-6) {
                    startY = this.room.mainWidth;
                }
                this.fillVerticalColumn(panels, x, colWidth, startY, this.getMaxYForColumn(x));
            }

            x += colWidth;
        }

        return this.renumberPanels(panels);
    }

    fillVerticalColumn(panels, x, colWidth, startY, maxY) {
        let y = startY;
        while (y < maxY - 1e-6) {
            const remainingY = maxY - y;
            const panelHeight = remainingY >= this.panelLength - 1e-6
                ? this.panelLength
                : remainingY;
            const isCut = !this.isFullVerticalPanel(colWidth, panelHeight);

            this.tryPlacePanel(
                panels, x, y, colWidth, panelHeight,
                Orientation.VERTICAL, isCut
            );

            y += panelHeight;
        }
    }

    // Проверка, находится ли панель полностью внутри комнаты
    isPanelInsideRoom(x, y, width, height) {
        // Проверяем все четыре угла панели
        const corners = [
            { x: x, y: y },                    // верхний левый
            { x: x + width, y: y },            // верхний правый
            { x: x, y: y + height },           // нижний левый
            { x: x + width, y: y + height }    // нижний правый
        ];
        
        for (const corner of corners) {
            if (!this.isPointInsideRoom(corner.x, corner.y)) {
                return false;
            }
        }
        return true;
    }

    // Проверка коллизий панелей (пересечение)
    checkPanelCollision(panel, panels) {
        for (const existingPanel of panels) {
            if (this.rectanglesOverlap(
                panel.x, panel.y, panel.x + panel.width, panel.y + panel.height,
                existingPanel.x, existingPanel.y, 
                existingPanel.x + existingPanel.width, existingPanel.y + existingPanel.height
            )) {
                return true;
            }
        }
        return false;
    }

    rectanglesOverlap(x1, y1, x2, y2, x3, y3, x4, y4) {
        return !(x2 <= x3 || x4 <= x1 || y2 <= y3 || y4 <= y1);
    }

    // Поиск доступного номера панели
    findAvailablePanelNumber(panels) {
        // Просто возвращаем следующий номер на основе количества панелей
        // Это гарантирует последовательную нумерацию без пропусков
        return panels.length + 1;
    }

    // Перенумерация панелей для последовательной нумерации
    renumberPanels(panels) {
        // Сортируем панели по позиции: сначала по Y (сверху вниз), затем по X (слева направо)
        const sortedPanels = [...panels].sort((a, b) => {
            const yDiff = a.y - b.y;
            if (Math.abs(yDiff) > 1e-6) {
                return yDiff;
            }
            return a.x - b.x;
        });
        
        // Перенумеровываем последовательно от 1
        sortedPanels.forEach((panel, index) => {
            panel.number = index + 1;
        });
        
        return sortedPanels;
    }

    // Схема 1: Горизонтальная укладка (100% покрытие с подрезкой)
    calculateScheme1() {
        return this.fillHorizontalLayout([]);
    }

    // Схема 2: Вертикальная укладка (100% покрытие с подрезкой)
    calculateScheme2() {
        return this.fillVerticalLayout([]);
    }

    // Схема 3: Комбинированная (вертикальная полоса сверху + горизонтальные ниже)
    calculateScheme3() {
        const panels = [];
        const maxXForTop = Math.max(this.room.mainLength, this.room.legLength);

        // 1) Верхняя вертикальная полоса
        let x = 0;
        while (x < maxXForTop - 1e-6) {
            const colWidth = Math.min(this.panelWidth, maxXForTop - x);
            const maxYForColumn = this.getMaxYForColumn(x);
            const stripHeight = Math.min(this.panelLength, maxYForColumn);

            if (stripHeight > 1e-6) {
                const isCut = !this.isFullVerticalPanel(colWidth, stripHeight);
                this.tryPlacePanel(
                    panels, x, 0, colWidth, stripHeight,
                    Orientation.VERTICAL, isCut
                );
            }
            x += colWidth;
        }

        // 2) Горизонтальные ряды ниже вертикальной полосы
        return this.fillHorizontalLayout(panels, this.panelLength);
    }

    // Получение расширенной статистики
    getStatistics(panels, pricePerM2 = 0) {
        const horizontal = panels.filter(p => p.orientation === Orientation.HORIZONTAL).length;
        const vertical = panels.filter(p => p.orientation === Orientation.VERTICAL).length;
        const fullPanels = panels.filter(p => !p.isCut).length;
        const cutPanels = panels.filter(p => p.isCut).length;
        const totalPanels = panels.length;

        const roomArea = this.room.getTotalArea();
        let coverageAreaActual = 0;
        panels.forEach(p => { coverageAreaActual += p.getArea(); });
        coverageAreaActual = Math.min(coverageAreaActual, roomArea);

        // Каждая подрезанная панель на схеме = 1 целая панель к закупке (обратная сторона с шип-пазом не используется)
        const panelsToPurchase = totalPanels;
        const totalCost = panelsToPurchase * (pricePerM2 > 0 ? (EFFECTIVE_PANEL_LENGTH * EFFECTIVE_PANEL_WIDTH * pricePerM2) : 0);

        const reserve5 = Math.ceil(panelsToPurchase * 1.05);
        const dowelsBase = totalPanels * 2;
        const dowelsWithReserve = Math.ceil(dowelsBase * 1.15);
        const workTimeSeconds = totalPanels * 60;
        const workTimeMinutes = Math.round(workTimeSeconds / 60);
        const workTimeHours = Math.floor(workTimeMinutes / 60);
        const workTimeRemainingMinutes = workTimeMinutes % 60;

        const coveragePercent = roomArea > 0
            ? Math.min(100, (coverageAreaActual / roomArea) * 100)
            : 0;

        return {
            total: totalPanels,
            fullPanels,
            cutPanels,
            panelsToPurchase,
            horizontal,
            vertical,
            coverageArea: coverageAreaActual.toFixed(2),
            coveragePercent: coveragePercent.toFixed(1),
            totalCost: Math.round(totalCost),
            withReserve: reserve5,
            dowels: {
                base: dowelsBase,
                withReserve: dowelsWithReserve
            },
            workTime: {
                seconds: workTimeSeconds,
                minutes: workTimeMinutes,
                hours: workTimeHours,
                remainingMinutes: workTimeRemainingMinutes,
                formatted: workTimeHours > 0
                    ? `${workTimeHours} ч ${workTimeRemainingMinutes} мин`
                    : `${workTimeMinutes} мин`
            }
        };
    }
}
