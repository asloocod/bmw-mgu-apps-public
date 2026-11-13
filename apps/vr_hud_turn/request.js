'use strict';
/*
 * request.js - one line to the vr-hud-turn service's socket, its one-line answer back, and what to show for it.
 * The service draws the arrows and reads this app's settings; the app never touches the car or the HUD.
 */
const SOCK = '/run/vr-hud-turn/ctl.sock';

/* 'ok sport' | 'ok normal' | 'moving' | 'rec on|off <s> <bytes>' | 'share <address>' | 'error <why>' from the service,
 * or 'nosocket' / 'denied' / 'timeout' */
function request(line, connect, timeoutMs) {
    return new Promise((resolve) => {
        let buf = '', done = false, conn;
        const finish = (reply) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            try { conn.destroy(); } catch (e) { /* closed */ }
            resolve(reply);
        };
        const timer = setTimeout(() => finish('timeout'), timeoutMs);
        try { conn = connect(SOCK); } catch (e) { finish('nosocket'); return; }
        conn.on('connect', () => conn.write(line + '\n'));
        conn.on('data', (d) => {
            buf += d;
            const nl = buf.indexOf('\n');
            if (nl >= 0) finish(buf.slice(0, nl));
        });
        conn.on('end', () => finish(buf.trim() || 'error no answer'));
        conn.on('error', (e) => {
            const code = e && e.code;
            finish(code === 'ENOENT' || code === 'ECONNREFUSED' ? 'nosocket' : code === 'EACCES' ? 'denied' : 'error ' + (code || e));
        });
    });
}

const TEXT = {
    'ok normal': 'Стрелки горят 15 с',
    'ok sport': 'Стрелки горят 15 с на высоте Sport',
    moving: 'Сохранено. Стрелки показываются только на стоянке',
    nosocket: 'Сервис vr-hud-turn не установлен или не запущен',
    denied: 'Сервис ещё не видит приложение, попробуйте через минуту',
    timeout: 'Сервис не ответил',
};

/* the status line for an answer */
function statusText(reply) {
    if (Object.prototype.hasOwnProperty.call(TEXT, reply)) return TEXT[reply];
    const on = /^rec on (\d+) \d+$/.exec(reply);
    if (on) return 'Идёт запись лога, ' + Math.floor(Number(on[1]) / 60) + ' мин. Покатайтесь с поворотниками, потом остановите';
    const off = /^rec off \d+ (\d+)$/.exec(reply);
    if (off) {
        const kb = Math.max(1, Math.round(Number(off[1]) / 1024));
        return Number(off[1]) > 0 ? 'Лог записан, ' + kb + ' КБ. Нажмите «Отдать лог на телефон»' : 'Запись лога не идёт';
    }
    if (/^share \S+$/.test(reply)) return 'Подключите телефон к точке доступа машины и откройте адрес ниже. Он работает 10 минут';
    if (reply === 'error no hotspot') return 'Точка доступа машины выключена. Включите её и подключите телефон';
    return 'Ошибка: ' + String(reply).replace(/^error /, '');
}

/* the address line: the log page's address, or nothing */
function urlText(reply) {
    const m = /^share (\S+)$/.exec(reply);
    return m ? m[1] : '';
}

/* what a changed setting asks for: Sport's offset is shown at Sport's height, whatever the mode now */
function commandFor(key) {
    return key === 'up_sport' ? 'show sport' : 'show';
}

module.exports = { SOCK, request, statusText, urlText, commandFor };
