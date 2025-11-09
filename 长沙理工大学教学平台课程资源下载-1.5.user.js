// ==UserScript==
// @name         长沙理工大学教学平台课程资源下载
// @namespace    http://tampermonkey.net/
// @version      1.5
// @description  批量下载网络教学平台课件
// @author       alittlelove
// @match        *://pt.csust.edu.cn/meol/jpk/course/layout/newpage/index.jsp*
// @match        *://vpn.csust.edu.cn/*
// @match        *://pt.csust.edu.cn/meol/common/script/preview/download_preview.jsp*
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      pt.csust.edu.cn
// @connect      vpn.csust.edu.cn
// ==/UserScript==

(function() {
    'use strict';

    const currentPageUrl = window.location.href;
    const isAndroid = /android/i.test(navigator.userAgent);

    if (currentPageUrl.includes('/preview/download_preview.jsp')) {
        runSingleFileDownloader();
    } else if (currentPageUrl.includes('/newpage/index.jsp')) {
        startMainScriptFinder();
    }

    // =================================================================================
    // 功能A: 单文件预览页下载器 (强制使用策略二/三)
    // =================================================================================
    function runSingleFileDownloader() {
        const button = createManualDownloadButton();
        document.body.appendChild(button);
        button.addEventListener('click', async (e) => {
            e.preventDefault();
            if(button.dataset.downloading === 'true') return;
            button.dataset.downloading = 'true';
            button.textContent = '处理中...';
            const urlParams = new URLSearchParams(window.location.search);
            const fileId = urlParams.get('fileid'), resId = urlParams.get('resid'), lid = urlParams.get('lid');
            let fileName = document.querySelector('.h1-title h1 p span')?.textContent.trim() || document.title.replace("预览", "").trim() || `download_${Date.now()}`;
            // ★★★ 核心修正：在预览页，强制跳过策略一 ★★★
            logMessage(`[预览页模式] 已启动，将直接使用智能分析策略。`);
            await fetchAndDownloadFile({
                previewUrl: currentPageUrl, fileName: fileName,
                fileId: fileId, resId: resId, lid: lid,
                isSingleFileMode: true, downloadCount: 0 // 强制设为0以跳过策略一
            }, button);
            button.dataset.downloading = 'false';
        });
    }

    // ... (createManualDownloadButton, startMainScriptFinder, 和 UI 部分保持不变) ...
     function createManualDownloadButton() {
        const button = document.createElement('a');
        button.textContent = '智能下载';
        button.href = 'javascript:void(0);';
        Object.assign(button.style, {
            position: 'fixed', top: '20px', right: '20px', zIndex: '9999', padding: '10px 18px',
            backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '5px',
            cursor: 'pointer', fontSize: '16px', fontWeight: 'bold', textDecoration: 'none',
            boxShadow: '0 4px 8px rgba(0,0,0,0.2)'
        });
        return button;
    }
    function startMainScriptFinder() {
        const maxAttempts = 50; let attempt = 0;
        const finderInterval = setInterval(() => {
            attempt++;
            const targetIframe = document.querySelector('iframe[name="mainFrame"]');
            const courseButton = document.querySelector('a[title="课程资源"]');
            if (targetIframe && courseButton) { clearInterval(finderInterval); mainBatchDownloader(); }
            else if (attempt >= maxAttempts) { clearInterval(finderInterval); }
        }, 200);
    }
    function mainBatchDownloader() { createUI(); setupInitialListeners(); }
    let currentDirectoryContent = { directories: [], files: [] };
    let isSortedByName = false;
    function createUI() {
        GM_addStyle(`
            #csust-main-button { position: fixed; bottom: 20px; right: 20px; padding: 10px 15px; background-color: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer; z-index: 9998; font-size: 16px; box-shadow: 0 2px 5px rgba(0,0,0,0.2); }
            #csust-window-overlay { position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0, 0, 0, 0.5); z-index: 9999; display: none; }
            #csust-window-container { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 800px; max-width: 95%; background-color: white; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.3); z-index: 10000; display: flex; height: 600px; }
            #csust-left-panel { width: 350px; border-right: 1px solid #ddd; padding: 10px; display: flex; flex-direction: column; }
            #csust-right-panel { flex-grow: 1; padding: 10px; display: flex; flex-direction: column; }
            #csust-window-header { padding-bottom: 10px; border-bottom: 1px solid #ddd; display: flex; justify-content: space-between; align-items: center; }
            #csust-window-header h3, #csust-window-header button { margin: 0; font-size: 18px; }
            #csust-window-close-btn { background: none; border: none; font-size: 24px; cursor: pointer; color: #888; }
            #dir-tree-container { flex-grow: 1; overflow-y: auto; border: 1px solid #ccc; margin-top: 10px; padding: 5px; }
            #dir-tree-container ul { list-style: none; padding-left: 5px; margin: 0; }
            #dir-tree-container li { margin: 4px 0; font-size: 14px; display: flex; align-items: center; }
            #dir-tree-container li input { margin-right: 8px; }
            #action-buttons, #sort-button-container { margin-top: 10px; }
            #action-buttons button, #sort-button-container button { margin-right: 10px; padding: 5px 10px; }
            #log-area { flex-grow: 1; width: 100%; box-sizing: border-box; font-family: monospace; font-size: 12px; border: 1px solid #ccc; padding: 5px; resize: none; margin-top: 10px; }
        `);
        const mainButton = document.createElement('button'); mainButton.id = 'csust-main-button'; mainButton.innerText = '资源脚本'; document.body.appendChild(mainButton);
        const overlay = document.createElement('div'); overlay.id = 'csust-window-overlay'; document.body.appendChild(overlay);
        const windowContainer = document.createElement('div'); windowContainer.id = 'csust-window-container';
        windowContainer.innerHTML = `
            <div id="csust-left-panel">
                <div id="csust-window-header"><h3>选择文件</h3></div>
                <div id="sort-button-container"><button id="sort-btn">切换排序 (当前: 原始)</button></div>
                <div id="dir-tree-container">请先在主页面点击“课程资源”...</div>
                <div id="action-buttons">
                    <button id="select-all-btn">全选</button>
                    <button id="deselect-all-btn">反选</button>
                    <button id="download-btn" style="background-color: #28a745; color: white;">开始下载</button>
                </div>
            </div>
            <div id="csust-right-panel">
                <div id="csust-window-header"><h3>日志记录</h3><button id="csust-window-close-btn">&times;</button></div>
                <textarea id="log-area" readonly></textarea>
            </div>
        `;
        overlay.appendChild(windowContainer);
        mainButton.addEventListener('click', () => overlay.style.display = 'block');
        document.getElementById('csust-window-close-btn').addEventListener('click', () => overlay.style.display = 'none');
        document.getElementById('select-all-btn').addEventListener('click', () => document.querySelectorAll('#dir-tree-container input.file-checkbox').forEach(cb => cb.checked = true));
        document.getElementById('deselect-all-btn').addEventListener('click', () => document.querySelectorAll('#dir-tree-container input.file-checkbox').forEach(cb => cb.checked = !cb.checked));
        document.getElementById('download-btn').addEventListener('click', handleBatchDownload);
        document.getElementById('sort-btn').addEventListener('click', toggleSort);
    }
    function logMessage(message) {
        const logArea = document.getElementById('log-area');
        if (logArea) {
            const timestamp = new Date().toLocaleTimeString('it-IT');
            logArea.value += `[${timestamp}] ${message}\n`;
            logArea.scrollTop = logArea.scrollHeight;
        } else { console.log(`[LOG] ${message}`); }
    }
    function setupInitialListeners() {
        logMessage("脚本已就绪，等待用户操作...");
        const courseResourceButton = document.querySelector('a[title="课程资源"]');
        let monitoringStarted = false;
        if (courseResourceButton) {
            courseResourceButton.addEventListener('click', () => {
                logMessage("捕获 '课程资源' 按钮点击事件。");
                if (!monitoringStarted) {
                    monitoringStarted = true;
                    logMessage(">>> 开始执行监视任务... <<<");
                    startMonitoring();
                }
            });
            logMessage("已成功绑定 '课程资源' 按钮的点击监听器。");
        }
    }
    function startMonitoring() {
        const targetIframe = document.querySelector('iframe[name="mainFrame"]');
        if (!targetIframe) { logMessage("错误: 未找到名为 'mainFrame' 的 iframe。"); return; }
        let lastIframeSrc = '';
        setInterval(() => {
            try {
                const currentIframeSrc = targetIframe.contentWindow.location.href;
                if (currentIframeSrc !== lastIframeSrc && currentIframeSrc !== 'about:blank') {
                    lastIframeSrc = currentIframeSrc;
                    if (currentIframeSrc.includes('courseResource.jsp')) {
                        findAndMonitorContentFrame(targetIframe);
                    }
                }
            } catch (e) {}
        }, 500);
    }
    function findAndMonitorContentFrame(parentFrame) {
        const subFrameFinder = setInterval(() => {
            try {
                for (let i = 0; i < parentFrame.contentWindow.frames.length; i++) {
                    const subFrame = parentFrame.contentWindow.frames[i];
                    if (subFrame.location.href.includes('listview.jsp')) {
                        clearInterval(subFrameFinder);
                        monitorContentFrame(subFrame);
                        break;
                    }
                }
            } catch (e) {}
        }, 500);
    }
    function monitorContentFrame(contentFrame) {
        let lastContentUrl = '';
        logMessage("开始持续监视 listview.jsp ...");
        setInterval(() => {
            try {
                const currentContentUrl = contentFrame.location.href;
                if (currentContentUrl !== lastContentUrl && currentContentUrl !== 'about:blank') {
                    lastContentUrl = currentContentUrl;
                    const analyzeNow = () => {
                        currentDirectoryContent = analyzeIframeContent(contentFrame.document, contentFrame);
                        isSortedByName = false;
                        buildDirectoryTree();
                    };
                    if (contentFrame.document.readyState === 'complete') { analyzeNow(); }
                    else { contentFrame.addEventListener('load', analyzeNow, { once: true }); }
                }
            } catch(e) {}
        }, 500);
    }
    function toggleSort() {
        isSortedByName = !isSortedByName;
        buildDirectoryTree();
        const sortBtn = document.getElementById('sort-btn');
        sortBtn.textContent = `切换排序 (当前: ${isSortedByName ? '文件名' : '原始'})`;
    }
    function buildDirectoryTree() {
        const container = document.getElementById('dir-tree-container');
        const content = currentDirectoryContent;
        if (!container) return;
        if (!content || (content.directories.length === 0 && content.files.length === 0)) { container.innerHTML = '当前目录为空。'; return; }
        let html = '<ul>';
        const sortedFiles = [...content.files];
        if (isSortedByName) { sortedFiles.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')); }
        content.directories.forEach(dir => {
            html += `<li><label><input type="checkbox" disabled> 📁 ${dir.name} (请进入)</label></li>`;
        });
        sortedFiles.forEach(file => {
            html += `<li><label><input type="checkbox" class="file-checkbox" data-url="${file.url}" data-name="${file.name}" data-icon="${file.icon}" data-count="${file.downloadCount}"> 📄 ${file.name}</label></li>`;
        });
        html += '</ul>';
        container.innerHTML = html;
    }
     async function handleBatchDownload() {
        const selectedFiles = document.querySelectorAll('#dir-tree-container input.file-checkbox:checked');
        if (selectedFiles.length === 0) { alert('请至少选择一个文件！'); return; }
        const downloadBtn = document.getElementById('download-btn');
        downloadBtn.disabled = true;
        let successCount = 0;
        const totalFiles = selectedFiles.length;
        const failedFiles = [];
        logMessage(`\n====== 开始批量下载任务 ======`);
        for (let i = 0; i < totalFiles; i++) {
            const checkbox = selectedFiles[i];
            const urlParams = new URLSearchParams(new URL(checkbox.dataset.url).search);
            const progress = Math.round(((i + 1) / totalFiles) * 100);
            const progressBar = `[${'#'.repeat(progress / 5)}${'-'.repeat(20 - progress / 5)}]`;
            downloadBtn.textContent = `下载中 ${progress}%`;
            logMessage(`\n- - - - - Progress: ${progressBar} (${i+1}/${totalFiles}) - - - - -`);
            const success = await fetchAndDownloadFile({
                previewUrl: checkbox.dataset.url, fileName: checkbox.dataset.name,
                fileId: urlParams.get('fileid'), resId: urlParams.get('resid'), lid: urlParams.get('lid'),
                iconClass: checkbox.dataset.icon, isSingleFileMode: false, downloadCount: parseInt(checkbox.dataset.count, 10)
            });
            if (success) { successCount++; } else { failedFiles.push(checkbox.dataset.name); }
            if(i < totalFiles - 1) await new Promise(r => setTimeout(r, 1000));
        }
        logMessage(`\n====== 下载任务总结 ======`);
        logMessage(`成功: ${successCount} / ${totalFiles}`);
        logMessage(`失败: ${totalFiles - successCount} / ${totalFiles}`);
        if (failedFiles.length > 0) { logMessage(`失败文件列表:\n  - ` + failedFiles.join('\n  - ')); }
        logMessage(`==========================`);
        downloadBtn.disabled = false;
        downloadBtn.textContent = '开始下载';
    }


    function analyzeIframeContent(iframeDoc, iframeElement) {
        const result = { directories: [], files: [] };
        if (!iframeDoc) return result;
        const baseFrameUrl = iframeElement.location.href;
        iframeDoc.querySelectorAll('tr').forEach(row => {
            const link = row.querySelector('a[href*="download_preview.jsp"]');
            if(link){
                const iconSpan = link.previousElementSibling;
                const iconClass = (iconSpan && iconSpan.tagName === 'SPAN') ? iconSpan.className : '';
                const absoluteUrl = new URL(link.getAttribute('href'), baseFrameUrl).href;
                const tds = row.querySelectorAll('td');
                let downloadCount = -1;
                if (tds.length >= 3 && tds[2].classList.contains('align_c')) {
                    const count = parseInt(tds[2].textContent.trim(), 10);
                    if(!isNaN(count)) {
                        downloadCount = count;
                    }
                }
                result.files.push({ name: link.textContent.trim(), url: absoluteUrl, icon: iconClass, downloadCount: downloadCount });
            }
        });
        iframeDoc.querySelectorAll('a[href*="listview.jsp"][href*="folderid="]').forEach(link => {
            if (link.textContent.trim() !== "返回上一级目录") {
                const absoluteUrl = new URL(link.getAttribute('href'), baseFrameUrl).href;
                result.directories.push({ name: link.textContent.trim(), url: absoluteUrl });
            }
        });
        logMessage(`分析完毕: 找到 ${result.directories.length} 个目录, ${result.files.length} 个文件。`);
        return result;
    }

    async function fetchAndDownloadFile(fileInfo, singleFileButton = null) {
        const { previewUrl, fileName, fileId, resId, lid, iconClass, isSingleFileMode, downloadCount } = fileInfo;
        logMessage(`[处理文件]: ${fileName}`);
        let success = false;
        let strategyOneSkipped = false;

        // ★★★ 核心修正：策略一的执行条件 ★★★
        const shouldSkipStrategy1 = downloadCount === 0 || (isSingleFileMode);
        if (shouldSkipStrategy1) {
            if(isSingleFileMode) logMessage(`[策略1] 预览页模式，为求稳定，跳过策略一。`);
            else logMessage(`[策略1] 检测到下载次数为0，大概率无直接下载权限，跳过策略一。`);
            strategyOneSkipped = true;
        } else {
            const directSwapUrl = previewUrl.replace('/preview/download_preview.jsp', '/download.jsp');
            logMessage(`[策略1] 尝试直接替换链接: ${directSwapUrl}`);
            // ★★★ 核心修正：安卓端使用iframe下载 ★★★
            if(isAndroid){
                logMessage(`  > (安卓模式) 使用iframe触发系统下载...`);
                success = await downloadWithIframe(directSwapUrl);
            } else {
                success = await downloadFileWithAuth(directSwapUrl, fileName, false);
            }
        }

        if (success) {
            logMessage(`[策略1] 成功! 文件已开始下载。`);
            if (singleFileButton) { singleFileButton.textContent = '下载成功!'; singleFileButton.style.backgroundColor = '#28a745'; }
            return true;
        }

        if(!strategyOneSkipped) logMessage(`[策略1] 失败，将尝试降级策略...`);
        let fallbackUrl = null;
        logMessage(`[策略2/3] 开始后台分析预览页: ${previewUrl}`);
        const pageSource = await crawlPage(previewUrl);

        if (pageSource) {
            let iconHint = iconClass;
            if (isSingleFileMode && !iconHint) {
                if(pageSource.includes('resPdfShow.do')) { iconHint = 'pdf'; }
            }
            if (iconHint && (iconHint.includes('pdf') || iconHint.includes('ppt') || iconHint.includes('powerpoint'))) {
                 fallbackUrl = buildUrlFromPath(`meol/analytics/resPdfShow.do?resId=${resId}&lid=${lid}`);
            }
            else if (iconHint && iconHint.includes('word')) {
                const htmlRegex = new RegExp(`(https?:\\/\\/[^"']+?\\/data\\/convert\\/[^"']+?${fileId}\\.html)`, 'i');
                const match = pageSource.match(htmlRegex);
                if (match) { fallbackUrl = match[1]; }
            }
            if (!fallbackUrl) {
                const htmlRegex = new RegExp(`(https?:\\/\\/[^"']+?\\/data\\/convert\\/[^"']+?${fileId}\\.html)`, 'i');
                let match = pageSource.match(htmlRegex);
                if (match) { fallbackUrl = match[1]; }
                else {
                    const pdfRegex = /<iframe[^>]+src=["']([^"']+\/meol\/analytics\/resPdfShow\.do[^"']+)["']/i;
                    match = pageSource.match(pdfRegex);
                    if (match) { fallbackUrl = new URL(match[1], previewUrl).href; }
                }
            }
        }

        if (fallbackUrl && !fallbackUrl.startsWith('data:')) {
            const isHtmlExpected = fallbackUrl.toLowerCase().includes('.html');
            let finalName =智能后缀处理(fileName, fallbackUrl);
            logMessage(`  > 使用分析链接下载: ${finalName}`);
            success = await downloadFileWithAuth(fallbackUrl, finalName, isHtmlExpected);
            if (singleFileButton) { singleFileButton.textContent = success ? '下载成功!' : '下载失败!'; singleFileButton.style.backgroundColor = success ? '#28a745' : '#dc3545'; }
        }

        if (!success && strategyOneSkipped) {
            logMessage(`[策略1 复活] 智能分析失败，最后尝试一次直接替换...`);
            const directSwapUrl = previewUrl.replace('/preview/download_preview.jsp', '/download.jsp');
             if(isAndroid){
                success = await downloadWithIframe(directSwapUrl);
            } else {
                success = await downloadFileWithAuth(directSwapUrl, fileName, false);
            }
             if (success && singleFileButton) { singleFileButton.textContent = '下载成功!'; singleFileButton.style.backgroundColor = '#28a745'; }
        }

        if (!success) {
            logMessage(`[失败] 所有策略均未能获取 ${fileName} 的下载链接。`);
            if (singleFileButton) { singleFileButton.textContent = '下载失败!'; singleFileButton.style.backgroundColor = '#dc3545'; }
        }
        return success;
    }

    // ★★★ 新增：安卓专属的iframe下载方式 ★★★
    function downloadWithIframe(url){
        return new Promise(resolve => {
            const iframe = document.createElement('iframe');
            iframe.style.display = 'none';
            iframe.src = url;
            document.body.appendChild(iframe);
            // 无法精确知道是否成功，但这是触发系统下载的唯一方法
            // 我们假设它会成功，并设置一个短暂的超时
            setTimeout(() => {
                document.body.removeChild(iframe);
                resolve(true); // 乐观地返回成功
            }, 3000); // 3秒后移除iframe
        });
    }

    function 智能后缀处理(fileName, url) {
        let finalName = fileName;
        const urlObj = new URL(url);
        let realExt = '';
        if (urlObj.pathname.endsWith('resPdfShow.do')) {
            realExt = '.pdf';
        } else {
            const match = urlObj.pathname.match(/\.(\w+)$/);
            if (match) realExt = `.${match[1]}`;
        }
        if (!realExt) return finalName;
        const lowerCaseName = finalName.toLowerCase();
        const lowerCaseExt = realExt.toLowerCase();
        if (lowerCaseName.endsWith(lowerCaseExt)) return finalName;
        return finalName + realExt;
    }

    function downloadFileWithAuth(url, name, expectHtml = false) {
        return new Promise(resolve => {
            GM_xmlhttpRequest({
                method: "GET", url: url, responseType: 'blob', withCredentials: true, anonymous: false,
                onload: function(response) {
                    if (response.status === 200) {
                        if (response.response.type.includes('html') && !expectHtml) {
                            resolve(false);
                        } else {
                            const blobUrl = URL.createObjectURL(response.response);
                            const a = document.createElement('a');
                            a.href = blobUrl; a.download = name;
                            document.body.appendChild(a); a.click(); document.body.removeChild(a);
                            URL.revokeObjectURL(blobUrl);
                            resolve(true);
                        }
                    } else {
                        resolve(false);
                    }
                },
                onerror: () => resolve(false),
                ontimeout: () => resolve(false)
            });
        });
    }

    function crawlPage(url) {
        return new Promise(resolve => {
            GM_xmlhttpRequest({
                method: "GET", url: url, withCredentials: true, anonymous: false,
                onload: res => resolve(res.responseText),
                onerror: () => resolve(null)
            });
        });
    }

    function buildUrlFromPath(path){
        const base = window.location.href;
        if (base.includes('vpn.csust.edu.cn')) {
            const meolIndex = base.indexOf('/meol/');
            if (meolIndex !== -1) {
                const vpnBaseUrl = base.substring(0, meolIndex + 1);
                return vpnBaseUrl + path;
            }
        }
        return `${window.location.protocol}//pt.csust.edu.cn/${path}`;
    }
})();