// ==UserScript==
// @name         气象培训平台自动学习助手
// @namespace    https://pxkckj-cmatc.cma.cn/
// @version      2.0.0
// @description  自动弹窗点击确定、静音页面、监控视频播放进度、视频结束后自动切换下一个未完成课件
// @author       OpenClaw
// @match        https://pxkckj-cmatc.cma.cn/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/puzzixlife/cma-auto-learn/main/cma-auto-learn.user.js
// @downloadURL  https://raw.githubusercontent.com/puzzixlife/cma-auto-learn/main/cma-auto-learn.user.js
// ==/UserScript==

(function () {
    'use strict';

    // === 只在顶层窗口运行，iframe 内只做弹窗拦截+静音 ===
    if (window.self !== window.top) {
        function initIframe() {
            window.alert = function () {};
            window.confirm = function () { return true; };
            window.prompt = function () { return ''; };
            document.querySelectorAll('video, audio').forEach(el => {
                el.muted = true; el.volume = 0;
            });
            new MutationObserver(() => {
                document.querySelectorAll('video, audio').forEach(el => {
                    if (!el.muted) { el.muted = true; el.volume = 0; }
                });
            }).observe(document.body || document.documentElement, { childList: true, subtree: true });
        }
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', initIframe);
        } else {
            initIframe();
        }
        return;
    }

    // ==================== 配置 ====================
    const CONFIG = {
        CHECK_INTERVAL: 500,
        VIDEO_END_THRESHOLD: 3,
        NEXT_COURSE_DELAY: 2000,
        POPUP_CHECK_INTERVAL: 800,
        LOG_MAX: 50,
        MAX_WAIT: 60000, // 最长等待元素加载时间
    };

    const state = {
        currentVideo: null,
        videoEnded: false,
        panel: null,
        logLines: [],
        scanAttempts: 0,
        elementsFound: false,
        startTime: Date.now(),
        popupClickCount: 0,
        lastClickedItemId: null,
        originallyDone: new Set(),
        scriptSwitchedTo: null,
        scriptVisited: new Set(), // 脚本已访问过的所有课件 ID
    };

    // ==================== 日志 ====================
    function log(msg) {
        const time = new Date().toLocaleTimeString('zh-CN');
        state.logLines.push(`[${time}] ${msg}`);
        if (state.logLines.length > CONFIG.LOG_MAX) state.logLines.shift();
        console.log(`[CMA助手] ${msg}`);
        if (state.panel) updatePanel();
    }

    // ==================== 调试: 扫描页面结构 ====================
    function scanPageStructure() {
        const info = {
            url: location.href,
            iframe: !!document.getElementById('mainFrame'),
            sPoints: document.querySelectorAll('.s_point').length,
            videos: document.querySelectorAll('video').length,
            learnMenu: !!document.getElementById('learnMenu'),
            bodyChildren: document.body?.children?.length || 0,
        };

        // 尝试各种可能的选择器
        const selectors = ['.s_point', '.s_learnlist', '.s_chapter', '.s_section',
                          '#learnMenu', '#mainFrame', 'video', '.course-item',
                          '.courseware-item', '.learn-item', '.resource-item',
                          '[itemtype]', '[completestate]'];
        selectors.forEach(sel => {
            const count = document.querySelectorAll(sel).length;
            if (count > 0) info[sel] = count;
        });

        // 检查 iframe 中的内容
        document.querySelectorAll('iframe').forEach((iframe, i) => {
            try {
                const src = iframe.getAttribute('src') || '';
                const id = iframe.id || `iframe_${i}`;
                info[`iframe#${id}`] = src.substring(0, 60);
                if (iframe.contentDocument) {
                    const vids = iframe.contentDocument.querySelectorAll('video').length;
                    const pts = iframe.contentDocument.querySelectorAll('.s_point').length;
                    info[`iframe#${id}_video`] = vids;
                    info[`iframe#${id}_sPoint`] = pts;
                }
            } catch (e) {}
        });

        return info;
    }

    // ==================== 等待元素出现 ====================
    function waitForElements(callback) {
        const startTime = Date.now();

        function check() {
            const sPoints = document.querySelectorAll('.s_point').length;
            const video = document.querySelector('video');
            const learnMenu = document.getElementById('learnMenu');

            // 也在所有 iframe 中找
            let iframeVideo = null;
            let iframeSPoints = 0;
            let iframeDoc = null;

            document.querySelectorAll('iframe').forEach(iframe => {
                try {
                    const doc = iframe.contentDocument;
                    if (!doc) return;
                    const v = doc.querySelector('video');
                    if (v) iframeVideo = v;
                    const pts = doc.querySelectorAll('.s_point').length;
                    if (pts > iframeSPoints) {
                        iframeSPoints = pts;
                        iframeDoc = doc;
                    }
                } catch (e) {}
            });

            const totalSPoints = Math.max(sPoints, iframeSPoints);
            const foundVideo = video || iframeVideo;

            if (totalSPoints > 0 || foundVideo || learnMenu) {
                state.elementsFound = true;
                // 记录启动时已完成的课件
                const { points } = findSPoints();
                points.forEach(p => {
                    if (isItemDone(p)) state.originallyDone.add(p.id);
                });
                log(`✅ 元素就绪: s_point=${totalSPoints}, 已完成=${state.originallyDone.size}, video=${!!foundVideo}`);
                callback({
                    video: foundVideo,
                    sPointCount: totalSPoints,
                    doc: iframeDoc || document,
                    isIframe: !!iframeDoc,
                });
                return;
            }

            if (Date.now() - startTime > CONFIG.MAX_WAIT) {
                log('⚠️ 等待超时，打印页面结构:');
                const info = scanPageStructure();
                Object.entries(info).forEach(([k, v]) => log(`  ${k}: ${v}`));
                // 仍然启动监控，后续可能会加载
                callback(null);
                return;
            }

            setTimeout(check, 500);
        }

        check();
    }

    // ==================== 获取页面学习时长 ====================
    function getPageStudyTime() {
        const regex = /学习时长[：:]\s*(\d+:\d+:\d+)/;
        const ids = ['studyTime', 'learnDuration', 'courseStudyTime', 'study_time', 'learnTime'];
        for (const id of ids) {
            const el = document.getElementById(id);
            if (el) {
                const m = el.textContent.match(regex);
                if (m) return `学习时长:${m[1]}`;
            }
        }
        const allEls = document.querySelectorAll('span, div, p, td');
        for (const el of allEls) {
            const m = el.textContent.match(regex);
            if (m) return `学习时长:${m[1]}`;
        }
        for (const iframe of document.querySelectorAll('iframe')) {
            try {
                const doc = iframe.contentDocument;
                if (!doc) continue;
                for (const el of doc.querySelectorAll('span, div, p')) {
                    const m = el.textContent.match(regex);
                    if (m) return `学习时长:${m[1]}`;
                }
            } catch (e) {}
        }
        return null;
    }

    // ==================== 判断课件是否完成 ====================
    function isItemDone(item) {
        // 优先通过图标 class 判断（平台真实状态）
        const icon = item.querySelector('.item_done_icon');
        if (icon && icon.classList.contains('done_icon_show')) return true;
        // 回退到 completestate 属性
        if (item.getAttribute('completestate') === '1') return true;
        return false;
    }

    // ==================== 获取当前播放课件标题 ====================
    function getCurrentCourseTitle() {
        // 方法1: 最近点击的课件
        if (state.lastClickedItemId) {
            const el = findSPointById(state.lastClickedItemId);
            if (el) {
                const title = el.querySelector('.s_pointti')?.textContent?.trim();
                if (title) return title;
            }
        }
        // 方法2: 主页面中 active/当前 的 s_point
        const selectors = ['.s_point.active', '.s_point.s_pointcur'];
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) {
                const title = el.querySelector('.s_pointti')?.textContent?.trim();
                if (title) return title;
            }
        }
        // 方法3: iframe 中
        for (const iframe of document.querySelectorAll('iframe')) {
            try {
                const doc = iframe.contentDocument;
                if (!doc) continue;
                for (const sel of selectors) {
                    const el = doc.querySelector(sel);
                    if (el) {
                        const title = el.querySelector('.s_pointti')?.textContent?.trim();
                        if (title) return title;
                    }
                }
            } catch (e) {}
        }
        // 方法4: 主页面中页面标题区域
        const pageTitle = document.querySelector('.courseware-title, .res-title, .resName, #resName');
        if (pageTitle) return pageTitle.textContent.trim();
        return null;
    }

    function findSPointById(id) {
        if (!id) return null;
        let el = document.getElementById(id);
        if (el && el.classList.contains('s_point')) return el;
        for (const iframe of document.querySelectorAll('iframe')) {
            try {
                el = iframe.contentDocument?.getElementById(id);
                if (el && el.classList.contains('s_point')) return el;
            } catch (e) {}
        }
        return null;
    }

    // ==================== 面板 ====================
    function createPanel() {
        if (document.getElementById('cma-helper-panel')) return;
        const panel = document.createElement('div');
        panel.id = 'cma-helper-panel';
        panel.innerHTML = `
            <div id="cma-panel-header">
                <span>🎓 自动学习助手</span>
                <span id="cma-panel-toggle" style="cursor:pointer;">▼</span>
            </div>
            <div id="cma-panel-body">
                <div id="cma-panel-status"></div>
                <div id="cma-panel-debug"></div>
                <div id="cma-panel-log"></div>
            </div>
        `;
        document.body.appendChild(panel);

        let dragging = false, dx = 0, dy = 0;
        panel.querySelector('#cma-panel-header').addEventListener('mousedown', e => {
            dragging = true; dx = e.clientX - panel.offsetLeft; dy = e.clientY - panel.offsetTop;
        });
        document.addEventListener('mousemove', e => {
            if (!dragging) return;
            panel.style.left = (e.clientX - dx) + 'px';
            panel.style.top = (e.clientY - dy) + 'px';
            panel.style.right = 'auto';
        });
        document.addEventListener('mouseup', () => dragging = false);

        let collapsed = false;
        panel.querySelector('#cma-panel-toggle').addEventListener('click', () => {
            collapsed = !collapsed;
            panel.querySelector('#cma-panel-body').style.display = collapsed ? 'none' : '';
            panel.querySelector('#cma-panel-toggle').textContent = collapsed ? '▶' : '▼';
        });
        state.panel = panel;
    }

    function updatePanel() {
        if (!state.panel) return;
        const statusEl = state.panel.querySelector('#cma-panel-status');
        const debugEl = state.panel.querySelector('#cma-panel-debug');
        const logEl = state.panel.querySelector('#cma-panel-log');

        // 调试
        const sPoints = document.querySelectorAll('.s_point').length;
        let iframeSPoints = 0;
        document.querySelectorAll('iframe').forEach(iframe => {
            try { iframeSPoints += iframe.contentDocument?.querySelectorAll('.s_point').length || 0; } catch(e) {}
        });
        const totalSPoints = Math.max(sPoints, iframeSPoints);
        const mainVideo = !!document.querySelector('video');
        let iframeVideo = false;
        document.querySelectorAll('iframe').forEach(iframe => {
            try { if (iframe.contentDocument?.querySelector('video')) iframeVideo = true; } catch(e) {}
        });

        debugEl.innerHTML = `
            <div style="font-size:11px;color:#f59e0b;border-top:1px solid rgba(99,102,241,0.2);padding-top:6px;margin-top:4px;">
                <div>🔍 s_point: 主页面=${sPoints} / iframe=${iframeSPoints}</div>
                <div>🔍 video: 主页面=${mainVideo} / iframe=${iframeVideo}</div>
                <div>🔍 iframe数: ${document.querySelectorAll('iframe').length}</div>
                <div>🔍 扫描: ${state.scanAttempts}次 | 已找到: ${state.elementsFound} | 已访问: ${state.scriptVisited.size}</div>
            </div>
        `;

        // 状态
        let statusHTML = '';
        const runTime = formatDuration(Date.now() - state.startTime);
        const studyTime = getPageStudyTime();
        statusHTML += `<div>⏱ 运行: <b>${runTime}</b> | 🖱 弹窗: <b>${state.popupClickCount}</b>次</div>`;
        if (studyTime) {
            statusHTML += `<div>📚 ${studyTime}</div>`;
        }
        const courseTitle = getCurrentCourseTitle();
        if (courseTitle) {
            // 截断过长的标题
            const displayTitle = courseTitle.length > 35 ? courseTitle.substring(0, 35) + '...' : courseTitle;
            statusHTML += `<div>📖 ${displayTitle}</div>`;
        }
        const { points: allPoints } = findSPoints();
        const doneItems = allPoints.filter(p => isItemDone(p)).length;
        const pendingItems = totalSPoints - doneItems;
        statusHTML += `<div>📊 课件: <b>${doneItems}/${totalSPoints}</b> (剩余 ${pendingItems})</div>`;

        if (state.currentVideo) {
            const v = state.currentVideo;
            const cur = formatTime(v.currentTime);
            const dur = formatTime(v.duration);
            const pct = v.duration ? Math.round((v.currentTime / v.duration) * 100) : 0;
            statusHTML += `<div>🎬 ${cur} / ${dur} (${pct}%)</div>`;
            statusHTML += `<div>${v.paused ? '⏸ 暂停' : '▶ 播放中'} | 🔇 静音</div>`;
        } else {
            statusHTML += `<div>⏳ 等待视频...</div>`;
        }

        statusEl.innerHTML = statusHTML;
        logEl.innerHTML = state.logLines.slice(-12).map(l => `<div>${l}</div>`).join('');
        logEl.scrollTop = logEl.scrollHeight;
    }

    function formatTime(s) {
        if (!s || isNaN(s)) return '00:00';
        return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(Math.floor(s%60)).padStart(2,'0')}`;
    }

    function formatDuration(ms) {
        const s = Math.floor(ms / 1000);
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = s % 60;
        if (h > 0) return `${h}时${String(m).padStart(2,'0')}分${String(sec).padStart(2,'0')}秒`;
        return `${m}分${String(sec).padStart(2,'0')}秒`;
    }

    // ==================== 弹窗拦截 ====================
    function interceptDialogs() {
        window.alert = function(msg) { log(`📢 alert 拦截`); };
        window.confirm = function(msg) { log(`📢 confirm → true`); return true; };
        window.prompt = function(msg) { log(`📢 prompt → ''`); return ''; };

        // 拦截所有 iframe
        document.querySelectorAll('iframe').forEach(iframe => {
            try {
                const w = iframe.contentWindow;
                if (w && !w.__cmaDone) {
                    w.alert = function() {};
                    w.confirm = function() { return true; };
                    w.prompt = function() { return ''; };
                    w.__cmaDone = true;
                }
            } catch (e) {}
        });
        log('✅ 弹窗拦截已启用');
    }

    function autoClickPopups() {
        try {
            const docs = [document];
            document.querySelectorAll('iframe').forEach(iframe => {
                try { if (iframe.contentDocument) docs.push(iframe.contentDocument); } catch(e) {}
            });

            docs.forEach(doc => {
                const btns = doc.querySelectorAll(
                    '.ui-messager-button .l-btn, .ui-dialog-buttonset button, .ui-dialog .ui-button, ' +
                    '.layui-layer-btn0, .el-message-box__btns .el-button--primary, .swal2-confirm'
                );
                btns.forEach(btn => {
                    const text = (btn.textContent || '').trim();
                    if (['确定','确认','是','OK','ok','Yes','我知道了','继续','关闭'].some(k => text.includes(k))) {
                        if (btn.offsetParent !== null || btn.offsetWidth > 0) {
                            btn.click();
                            state.popupClickCount++;
                            log(`✅ 点击弹窗: "${text}" (第${state.popupClickCount}次)`);
                        }
                    }
                });
            });
        } catch (e) {}
    }

    // ==================== 静音 ====================
    function muteAllMedia() {
        document.querySelectorAll('video, audio').forEach(el => {
            el.muted = true; el.volume = 0;
        });
        document.querySelectorAll('iframe').forEach(iframe => {
            try {
                iframe.contentDocument?.querySelectorAll('video, audio').forEach(el => {
                    el.muted = true; el.volume = 0;
                });
            } catch (e) {}
        });
    }

    // ==================== 查找视频 ====================
    function findVideo() {
        state.scanAttempts++;

        // 主页面
        let v = document.querySelector('video');
        if (v) return v;

        // iframe 中
        for (const iframe of document.querySelectorAll('iframe')) {
            try {
                v = iframe.contentDocument?.querySelector('video');
                if (v) return v;
                // 深层
                for (const inner of (iframe.contentDocument?.querySelectorAll('iframe') || [])) {
                    try {
                        v = inner.contentDocument?.querySelector('video');
                        if (v) return v;
                    } catch (e) {}
                }
            } catch (e) {}
        }

        return null;
    }

    // ==================== 查找课件列表 ====================
    function findSPoints() {
        let points = Array.from(document.querySelectorAll('.s_point'));
        if (points.length > 0) return { points, doc: document };

        for (const iframe of document.querySelectorAll('iframe')) {
            try {
                const doc = iframe.contentDocument;
                if (!doc) continue;
                points = Array.from(doc.querySelectorAll('.s_point'));
                if (points.length > 0) return { points, doc };
            } catch (e) {}
        }

        return { points: [], doc: document };
    }

    // ==================== 视频监控 ====================
    function monitorVideo() {
        const video = findVideo();

        if (video && video !== state.currentVideo) {
            const oldVideo = state.currentVideo;
            state.currentVideo = video;
            state.videoEnded = false;
            video.muted = true;
            video.volume = 0;

            const title = getCurrentCourseTitle();
            if (title) {
                log(`🎬 ${title} (${formatTime(video.duration)})`);
            } else {
                log(`🎬 检测到视频 (${formatTime(video.duration)})`);
                // 延迟重试获取标题
                setTimeout(() => {
                    const t = getCurrentCourseTitle();
                    if (t) log(`📖 当前课件: ${t}`);
                }, 2000);
            }
            if (oldVideo) log(`🔄 视频已切换`);

            video.addEventListener('ended', () => {
                if (!state.videoEnded) {
                    state.videoEnded = true;
                    log('🎬 视频播放结束');
                    onVideoEnded();
                }
            });

            video.addEventListener('pause', () => {
                if (!state.videoEnded && video.currentTime < video.duration - 5) {
                    setTimeout(() => {
                        if (!state.videoEnded && video.paused) {
                            video.play().catch(() => {});
                        }
                    }, 3000);
                }
            });

            updatePanel();
        }

        if (state.currentVideo && !state.videoEnded) {
            const v = state.currentVideo;
            if (!v.duration || isNaN(v.duration)) {
                state.currentVideo = null;
                return;
            }
            if (v.currentTime >= v.duration - CONFIG.VIDEO_END_THRESHOLD) {
                state.videoEnded = true;
                log('🎬 视频播放结束 (轮询)');
                onVideoEnded();
            }
        }
    }

    // ==================== 自动切换 ====================
    function onVideoEnded() {
        log('⏭ 视频结束，等待平台更新状态...');
        setTimeout(() => {
            playNextIncomplete();
            updatePanel();
        }, CONFIG.NEXT_COURSE_DELAY);
    }

    function markCurrentItemDone() {
        const item = getCurrentItem();
        if (item) {
            const icon = item.querySelector('.item_done_icon');
            if (icon) icon.classList.add('done_icon_show');
            item.setAttribute('completestate', '1');
            log('✅ 标记当前课件完成');
        }
    }

    function getCurrentItem() {
        // 方法1: 最近点击的课件
        if (state.lastClickedItemId) {
            const el = findSPointById(state.lastClickedItemId);
            if (el) return el;
        }
        // 方法2: active/当前 class
        const selectors = ['.s_point.active', '.s_point.s_pointcur'];
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) return el;
        }
        for (const iframe of document.querySelectorAll('iframe')) {
            try {
                const doc = iframe.contentDocument;
                if (!doc) continue;
                for (const sel of selectors) {
                    const el = doc.querySelector(sel);
                    if (el) return el;
                }
            } catch (e) {}
        }
        return null;
    }

    function getCurrentItemId() {
        const item = getCurrentItem();
        return item?.id || null;
    }

    function playNextIncomplete() {
        const { points } = findSPoints();
        const currentId = getCurrentItemId();

        // 详细日志: 列出所有课件状态
        log(`📋 共找到 ${points.length} 个课件:`);
        points.forEach((p, i) => {
            const title = (p.querySelector('.s_pointti')?.textContent || '?').substring(0, 25);
            const icon = p.querySelector('.item_done_icon');
            const hasDoneClass = icon ? icon.classList.contains('done_icon_show') : 'no-icon';
            const compState = p.getAttribute('completestate');
            const inOrig = state.originallyDone.has(p.id);
            const visited = state.scriptVisited.has(p.id);
            const isCur = p.id === currentId;
            log(`  ${i+1}. [${title}] doneClass=${hasDoneClass} comp=${compState} orig=${inOrig} vis=${visited} cur=${isCur}`);
        });

        // 找出从未完成过的课件（排除启动时已完成的）
        const neverDone = points.filter(p => !state.originallyDone.has(p.id));

        // 从 neverDone 中找未完成的，排除当前播放的，排除已访问过的
        const candidates = neverDone.filter(p => {
            if (p.id === currentId) return false;
            if (state.scriptVisited.has(p.id)) return false;
            return !isItemDone(p);
        });

        log(`📊 neverDone=${neverDone.length} candidates=${candidates.length} visited=${state.scriptVisited.size}`);

        const nextItem = candidates[0] || null;

        if (!nextItem) {
            log('🎉 所有课件已完成！');
            state.scriptSwitchedTo = null;
            updatePanel();
            return;
        }

        const title = nextItem.querySelector('.s_pointti')?.textContent || '未知';
        log(`▶ 切换到: ${title} (剩余${candidates.length}个未访问)`);

        state.scriptSwitchedTo = nextItem.id;
        state.scriptVisited.add(nextItem.id);
        expandParent(nextItem);
        setTimeout(() => {
            nextItem.click();
            state.currentVideo = null;
            state.videoEnded = false;
            log('▶ 已点击下一个课件');
            setTimeout(() => expandParent(nextItem), 1000);
            setTimeout(() => { muteAllMedia(); monitorVideo(); }, 3000);
        }, 500);
    }

    function expandParent(item) {
        // 向上遍历，展开所有隐藏的容器
        let p = item.parentElement;
        while (p) {
            if (p.classList.contains('s_sectionwrap') && p.style.display === 'none') {
                p.style.display = 'block';
            }
            if (p.classList.contains('s_sectionlist') && p.style.display === 'none') {
                p.style.display = 'block';
            }
            p = p.parentElement;
        }

        // 触发章节/讲次标题的点击事件来展开
        try {
            // 找到所属的讲次标题并点击
            const sectionWrap = item.closest('.s_sectionwrap');
            if (sectionWrap) {
                const sectionTitle = sectionWrap.previousElementSibling;
                if (sectionTitle && sectionTitle.classList.contains('s_section')) {
                    sectionTitle.click();
                    // 也尝试 jQuery
                    if (typeof $ !== 'undefined') $(sectionTitle).trigger('click');
                }
            }

            // 找到所属的章节目录并点击
            const sectionList = item.closest('.s_sectionlist');
            if (sectionList) {
                const chapterTitle = sectionList.previousElementSibling;
                if (chapterTitle && chapterTitle.classList.contains('s_chapter')) {
                    chapterTitle.click();
                    if (typeof $ !== 'undefined') $(chapterTitle).trigger('click');
                }
            }
        } catch (e) {}

        // 滚动到可见
        try { item.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
    }

    // ==================== 监听动态加载 ====================
    function watchForDynamicContent() {
        // 监听 body 变化，查找新出现的元素
        const obs = new MutationObserver((mutations) => {
            if (state.elementsFound) return; // 已找到，不再扫描

            for (const m of mutations) {
                for (const node of m.addedNodes) {
                    if (node.nodeType !== 1) continue;
                    if (node.classList?.contains('s_point') || node.querySelector?.('.s_point') ||
                        node.tagName === 'VIDEO' || node.querySelector?.('video') ||
                        node.id === 'mainFrame' || node.id === 'learnMenu') {
                        log('🔔 检测到新元素加载');
                        state.elementsFound = true;
                        obs.disconnect();
                        startMainLoop();
                        return;
                    }
                }
            }
        });
        obs.observe(document.body, { childList: true, subtree: true });
        log('👀 监听动态内容加载...');
    }

    // ==================== 监听课件项点击 ====================
    function watchSPointClicks() {
        document.addEventListener('click', (e) => {
            const point = e.target.closest('.s_point');
            if (point && point.id) {
                state.lastClickedItemId = point.id;
            }
        }, true);
        for (const iframe of document.querySelectorAll('iframe')) {
            try {
                iframe.contentDocument?.addEventListener('click', (e) => {
                    const point = e.target.closest('.s_point');
                    if (point && point.id) {
                        state.lastClickedItemId = point.id;
                    }
                }, true);
            } catch (e) {}
        }
    }

    // ==================== 主循环 ====================
    let mainLoopStarted = false;
    function startMainLoop() {
        if (mainLoopStarted) return;
        mainLoopStarted = true;

        log('🔄 启动主监控循环');

        // 监听课件点击
        watchSPointClicks();

        // 主循环
        setInterval(() => {
            monitorVideo();
            autoClickPopups();
            muteAllMedia();
            if (state.currentVideo) {
                state.currentVideo.muted = true;
                state.currentVideo.volume = 0;
            }
            updatePanel();
        }, CONFIG.CHECK_INTERVAL);

        // iframe load 监听
        document.querySelectorAll('iframe').forEach(iframe => {
            iframe.addEventListener('load', () => {
                log('🔄 iframe 加载完成');
                state.currentVideo = null;
                state.videoEnded = false;
                setTimeout(() => {
                    interceptDialogs();
                    muteAllMedia();
                    monitorVideo();
                }, 1000);
            });

            // src 变化
            new MutationObserver(() => {
                log('🔄 iframe src 变化');
                state.currentVideo = null;
                state.videoEnded = false;
            }).observe(iframe, { attributes: true, attributeFilter: ['src'] });
        });

        // 初始尝试
        interceptDialogs();
        muteAllMedia();
        setTimeout(() => {
            const st = getPageStudyTime();
            if (st) log(`📚 ${st}`);
            monitorVideo();
        }, 2000);
        setTimeout(() => monitorVideo(), 4000);
        setTimeout(() => monitorVideo(), 6000);
    }

    // ==================== 主初始化 ====================
    function init() {
        document.querySelectorAll('#cma-helper-panel').forEach(el => el.remove());

        injectStyles();
        createPanel();

        log('🚀 助手启动，扫描页面...');

        // 先打印页面结构
        const info = scanPageStructure();
        log(`📍 URL: ${location.pathname}`);
        log(`📍 iframe: ${info.iframe}, s_point: ${info.sPoints}, video: ${info.videos}`);

        // 拦截弹窗（立即）
        interceptDialogs();

        // 等待元素出现
        waitForElements((result) => {
            if (result) {
                startMainLoop();
            } else {
                // 超时但仍启动监控 + 监听动态内容
                startMainLoop();
                watchForDynamicContent();
            }
        });
    }

    function injectStyles() {
        const s = document.createElement('style');
        s.textContent = `
            #cma-helper-panel {
                position:fixed;top:10px;right:10px;width:340px;
                background:linear-gradient(135deg,#1e293b,#0f172a);
                color:#e2e8f0;border-radius:12px;
                box-shadow:0 8px 32px rgba(0,0,0,0.4);z-index:999999;
                font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:13px;
                border:1px solid rgba(99,102,241,0.3);
            }
            #cma-panel-header{display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:rgba(99,102,241,0.15);border-radius:12px 12px 0 0;cursor:move;user-select:none;font-weight:600}
            #cma-panel-body{padding:10px 14px}
            #cma-panel-status div{margin-bottom:4px;line-height:1.5}
            #cma-panel-log{border-top:1px solid rgba(99,102,241,0.2);padding-top:6px;margin-top:4px;max-height:120px;overflow-y:auto;font-size:11px;color:#94a3b8}
            #cma-panel-log div{margin-bottom:2px;line-height:1.4}
            #cma-panel-toggle{font-size:12px;opacity:.7}
            #cma-panel-toggle:hover{opacity:1}
        `;
        document.head.appendChild(s);
    }

    // ==================== 启动 ====================
    let initialized = false;
    function safeInit() {
        if (initialized) return;
        initialized = true;
        init();
    }

    if (document.readyState === 'complete') {
        safeInit();
    } else {
        window.addEventListener('load', safeInit);
    }

})();
