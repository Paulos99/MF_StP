// Яндекс.Метрика (по желанию). Номер счётчика вшивается при сборке (scripts/build-esbuild.mjs → window.MF_YM_ID).
// Нет номера — модуль ничего не делает: ни скрипта Метрики, ни баннера согласия, страница не меняется.
// Скрипт Метрики загружается только после согласия посетителя; отказ запоминается.
// На проверочном стенде (*.github.io) и на localhost Метрика не включается никогда.

const CONSENT_KEY = 'mf_calc_ym_consent';

function counterId() {
    const n = Number(typeof window !== 'undefined' ? window.MF_YM_ID : 0);
    return Number.isInteger(n) && n > 0 ? n : null;
}

function hostAllowed() {
    const host = String(location.hostname || '').toLowerCase();
    return !(host === 'localhost' || host === '127.0.0.1' || host.endsWith('.github.io'));
}

function readConsent() {
    try {
        return localStorage.getItem(CONSENT_KEY);
    } catch {
        return null;
    }
}

function writeConsent(value) {
    try {
        localStorage.setItem(CONSENT_KEY, value);
    } catch {
        /* хранилище недоступно: выбор действует до закрытия страницы */
    }
}

let loaded = false;

function loadMetrika(id) {
    if (loaded) return;
    loaded = true;
    if (!window.ym) {
        const ym = function (...args) {
            (ym.a = ym.a || []).push(args);
        };
        ym.l = Date.now();
        window.ym = ym;
    }
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://mc.yandex.ru/metrika/tag.js';
    document.head.appendChild(script);
    window.ym(id, 'init', {
        clickmap: true,
        trackLinks: true,
        accurateTrackBounce: true,
        webvisor: false,
    });
}

function showBanner(onChoice) {
    const box = document.createElement('div');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-label', 'Статистика посещений');
    box.style.cssText =
        'position:fixed;left:12px;right:12px;bottom:12px;z-index:2147483000;max-width:520px;margin:0 auto;' +
        'padding:12px 14px;background:#fff;color:#152018;border:1px solid #cfd8d3;border-radius:12px;' +
        'box-shadow:0 6px 24px rgba(0,0,0,.18);font:14px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;';
    const text = document.createElement('p');
    text.style.cssText = 'margin:0 0 10px';
    text.textContent =
        'Сайт собирает обезличенную статистику посещений (Яндекс.Метрика, файлы cookie). Это можно отклонить.';
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap';
    const make = (label, primary, value) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.style.cssText =
            'cursor:pointer;border-radius:8px;padding:8px 14px;font:inherit;border:1px solid #01644f;' +
            (primary ? 'background:#01644f;color:#fff' : 'background:#fff;color:#01644f');
        b.addEventListener('click', () => {
            box.remove();
            onChoice(value);
        });
        return b;
    };
    row.append(make('Отказаться', false, 'declined'), make('Принять', true, 'accepted'));
    box.append(text, row);
    document.body.appendChild(box);
}

export function initCalcMetrika() {
    const id = counterId();
    if (id == null || !hostAllowed()) return;
    const consent = readConsent();
    if (consent === 'accepted') {
        loadMetrika(id);
    } else if (consent !== 'declined') {
        showBanner((value) => {
            writeConsent(value);
            if (value === 'accepted') loadMetrika(id);
        });
    }
}
