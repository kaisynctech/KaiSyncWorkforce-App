/**
 * KaiFlow website — app_versions integration via Supabase RPCs.
 */
(function (global) {
    'use strict';

    var cfg = global.KAIFLOW_CONFIG || {};

    function rpcUrl(name) {
        return cfg.supabaseUrl + '/rest/v1/rpc/' + name;
    }

    function rpcHeaders() {
        return {
            'Content-Type': 'application/json',
            'apikey': cfg.supabaseAnonKey,
            'Authorization': 'Bearer ' + cfg.supabaseAnonKey
        };
    }

    async function callRpc(name, body) {
        var res = await fetch(rpcUrl(name), {
            method: 'POST',
            headers: rpcHeaders(),
            body: JSON.stringify(body || {})
        });
        if (!res.ok) throw new Error('RPC ' + name + ' failed: ' + res.status);
        return res.json();
    }

    function formatDate(iso) {
        if (!iso) return '—';
        try {
            return new Date(iso).toLocaleDateString('en-ZA', {
                year: 'numeric', month: 'long', day: 'numeric'
            });
        } catch (_) {
            return iso;
        }
    }

    function pickDownloadUrl(versionRow, platform) {
        if (!versionRow) return null;
        var winKeys = ['windows_download_url', 'download_url_windows'];
        var androidKeys = ['android_download_url', 'download_url_android'];
        var keys = platform === 'android' ? androidKeys : winKeys;
        for (var i = 0; i < keys.length; i++) {
            if (versionRow[keys[i]]) return versionRow[keys[i]];
        }
        if (versionRow.download_url) return versionRow.download_url;
        var fallbacks = cfg.fallbackDownloads || {};
        return fallbacks[platform] || null;
    }

    async function fetchLatest(platform) {
        try {
            var data = await callRpc('get_latest_app_version', { p_platform: platform || 'windows' });
            return data && data.version ? data : null;
        } catch (e) {
            console.warn('get_latest_app_version:', e);
            return null;
        }
    }

    async function fetchReleaseHistory(limit) {
        try {
            var data = await callRpc('list_public_app_versions', { p_limit: limit || 25 });
            return Array.isArray(data) ? data : [];
        } catch (e) {
            console.warn('list_public_app_versions:', e);
            return [];
        }
    }

    function setText(id, text) {
        var el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    function setHtml(id, html) {
        var el = document.getElementById(id);
        if (el) el.innerHTML = html;
    }

    function notesToHtml(notes) {
        if (!notes) return '<p class="release-notes-empty">No release notes provided.</p>';
        return notes.split(/\n+/).filter(Boolean).map(function (line) {
            return '<p>' + line.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</p>';
        }).join('');
    }

    async function initDownloadPage() {
        var latest = await fetchLatest('windows');
        var winUrl = pickDownloadUrl(latest, 'windows');
        var androidUrl = pickDownloadUrl(latest, 'android');

        if (latest) {
            setText('dl-version', 'v' + latest.version + (latest.build_number ? ' (build ' + latest.build_number + ')' : ''));
            setText('dl-release-date', formatDate(latest.release_date));
            setHtml('dl-release-notes', notesToHtml(latest.release_notes));
        } else {
            setText('dl-version', 'Checking…');
            setText('dl-release-date', '—');
            setHtml('dl-release-notes', '<p class="release-notes-empty">Unable to load release information. Please try again or contact support.</p>');
        }

        var winBtn = document.getElementById('dl-btn-windows');
        var androidBtn = document.getElementById('dl-btn-android');

        if (winBtn && winUrl) {
            winBtn.href = winUrl;
            winBtn.removeAttribute('aria-disabled');
        } else if (winBtn) {
            winBtn.classList.add('btn-disabled');
            winBtn.setAttribute('aria-disabled', 'true');
        }

        if (androidBtn && androidUrl) {
            androidBtn.href = androidUrl;
            androidBtn.removeAttribute('aria-disabled');
        } else if (androidBtn) {
            androidBtn.classList.add('btn-disabled');
            androidBtn.setAttribute('aria-disabled', 'true');
        }
    }

    async function initReleasesPage() {
        var container = document.getElementById('releases-list');
        var status = document.getElementById('releases-status');
        if (!container) return;

        if (status) status.textContent = 'Loading release history…';

        var releases = await fetchReleaseHistory(50);
        container.innerHTML = '';

        if (!releases.length) {
            if (status) status.textContent = 'No releases published yet.';
            container.innerHTML = '<p class="releases-empty">Release history will appear here when rows exist in app_versions.</p>';
            return;
        }

        if (status) status.hidden = true;

        releases.forEach(function (r, i) {
            var article = document.createElement('article');
            article.className = 'release-card' + (i === 0 ? ' release-card--latest' : '');
            article.innerHTML =
                '<div class="release-card-head">' +
                    '<h2 class="release-card-version">v' + r.version +
                        (r.build_number ? ' <span class="release-build">build ' + r.build_number + '</span>' : '') +
                    '</h2>' +
                    '<time class="release-card-date" datetime="' + (r.release_date || '') + '">' + formatDate(r.release_date) + '</time>' +
                '</div>' +
                '<div class="release-card-notes">' + notesToHtml(r.release_notes) + '</div>' +
                (i === 0 ? (
                    '<div class="release-card-actions">' +
                        (pickDownloadUrl(r, 'windows') ? '<a class="btn btn-secondary btn-sm" href="' + pickDownloadUrl(r, 'windows') + '">Windows</a>' : '') +
                        (pickDownloadUrl(r, 'android') ? '<a class="btn btn-secondary btn-sm" href="' + pickDownloadUrl(r, 'android') + '">Android</a>' : '') +
                    '</div>'
                ) : '');
            container.appendChild(article);
        });
    }

    global.KaiFlowVersions = {
        fetchLatest: fetchLatest,
        fetchReleaseHistory: fetchReleaseHistory,
        formatDate: formatDate,
        pickDownloadUrl: pickDownloadUrl,
        initDownloadPage: initDownloadPage,
        initReleasesPage: initReleasesPage
    };

    document.addEventListener('DOMContentLoaded', function () {
        if (document.body.classList.contains('page-download')) {
            initDownloadPage();
        }
        if (document.body.classList.contains('page-releases')) {
            initReleasesPage();
        }
    });
})(window);
