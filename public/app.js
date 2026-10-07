// ==========================================
// Zalo Public Check - Client Application
// Mobile & Desktop Responsive with Local Cache
// ==========================================

// Global Cache Key in LocalStorage
const LOCAL_CACHE_KEY = 'zalo_local_contacts_cache';

// Helper: Normalize phone (chuyển 84 / +84 thành đầu 0)
function normalizePhoneClient(raw) {
  let str = String(raw || '').trim().replace(/[\s.\-()]/g, '');
  if (str.startsWith('+840')) str = '0' + str.slice(4);
  else if (str.startsWith('+84')) str = '0' + str.slice(3);
  else if (str.startsWith('840') && str.length >= 12) str = '0' + str.slice(3);
  else if (str.startsWith('84') && str.length >= 11) str = '0' + str.slice(2);
  else if (str.length === 9 && /^[35789]\d{8}$/.test(str)) str = '0' + str;
  if (str.startsWith('00')) str = '0' + str.slice(2);
  return str;
}

// Helper: Toast message
let toastTimeout = null;
function showToast(msg) {
  const toast = document.querySelector('#toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.hidden = false;
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.hidden = true;
  }, 2600);
}

// Helper: Copy to clipboard
async function copyToClipboard(text, successMsg = 'Đã sao chép vào bộ nhớ tạm!') {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    showToast(successMsg);
  } catch {
    showToast('Không thể tự động sao chép. Hãy chọn và sao chép thủ công.');
  }
}

// ----------------- LOCAL CACHE MANAGEMENT -----------------
function getLocalContacts() {
  try {
    const raw = localStorage.getItem(LOCAL_CACHE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLocalContacts(list) {
  try {
    localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(list));
  } catch (e) {
    console.warn('Lỗi lưu localStorage:', e);
  }
  updateCacheBadge();
}

function addContactsToCache(newContacts) {
  if (!Array.isArray(newContacts) || newContacts.length === 0) return;
  const current = getLocalContacts();
  const map = new Map();
  // Khởi tạo map bằng danh sách hiện tại
  for (const c of current) {
    const p = normalizePhoneClient(c.phone || c.value);
    if (p) map.set(p, c);
  }
  // Bổ sung các contact mới
  for (const nc of newContacts) {
    const p = normalizePhoneClient(nc.phone || nc.value);
    if (p && (nc.hasPublicInfo || nc.status === 'found')) {
      const existing = map.get(p) || {};
      map.set(p, {
        ...existing,
        ...nc,
        phone: p,
        hasPublicInfo: true,
        updatedAt: new Date().toISOString()
      });
    }
  }
  const merged = Array.from(map.values());
  saveLocalContacts(merged);
}

function updateCacheBadge() {
  const list = getLocalContacts();
  const badge1 = document.querySelector('#cache-badge');
  const badge2 = document.querySelector('#cache-total-badge');
  if (badge1) badge1.textContent = list.length;
  if (badge2) badge2.textContent = `${list.length} số`;
}

// Sync local cache with server cache on startup
async function syncServerCache() {
  try {
    const res = await fetch('/api/cache');
    if (!res.ok) return;
    const data = await res.json();
    if (data.contacts && Array.isArray(data.contacts)) {
      addContactsToCache(data.contacts);
    }
  } catch {
    // Offline or server unreachable
  }
}

// ----------------- TAB SWITCHING -----------------
function initTabs() {
  const tabs = document.querySelectorAll('.nav-tab');
  const panels = document.querySelectorAll('.view-panel');

  function switchTab(targetId) {
    tabs.forEach(t => {
      const isActive = t.dataset.target === targetId;
      t.classList.toggle('active', isActive);
    });
    panels.forEach(p => {
      p.classList.toggle('active', p.id === targetId);
    });
    if (targetId === 'tab-cache') {
      renderCacheView();
    }
  }

  tabs.forEach(t => {
    t.addEventListener('click', () => switchTab(t.dataset.target));
  });

  const headerZaloStatus = document.querySelector('#nav-zalo-status');
  if (headerZaloStatus) {
    headerZaloStatus.addEventListener('click', () => switchTab('tab-qr'));
  }
}

// ----------------- TAB 1: BULK CHECK -----------------
function initBulkView() {
  const btnModePaste = document.querySelector('#btn-mode-paste');
  const btnModeFile = document.querySelector('#btn-mode-file');
  const modePasteContainer = document.querySelector('#mode-paste-container');
  const modeFileContainer = document.querySelector('#mode-file-container');
  const phoneText = document.querySelector('#phone-text');
  const pasteLineCount = document.querySelector('#paste-line-count');
  const btnPasteClipboard = document.querySelector('#btn-paste-clipboard');
  const fileInput = document.querySelector('#file-input');
  const dropZone = document.querySelector('#drop-zone');
  const fileBadge = document.querySelector('#selected-file-badge');

  const bulkForm = document.querySelector('#bulk-form');
  const runBtn = document.querySelector('#run-btn');

  const progressCard = document.querySelector('#progress-card');
  const progressTitle = document.querySelector('#progress-title');
  const progressCount = document.querySelector('#progress-count');
  const progressBarFill = document.querySelector('#progress-bar-fill');
  const statFound = document.querySelector('#stat-found');
  const statSkipped = document.querySelector('#stat-skipped');
  const statTotal = document.querySelector('#stat-total');

  const bulkDownloadActions = document.querySelector('#bulk-download-actions');
  const btnCopyBulkFound = document.querySelector('#btn-copy-bulk-found');
  const linkDownloadTxt = document.querySelector('#link-download-txt');
  const linkDownloadXlsx = document.querySelector('#link-download-xlsx');
  const liveFoundTag = document.querySelector('#live-found-tag');
  const bulkContactsContainer = document.querySelector('#bulk-contacts-container');

  let activeMode = 'paste';
  let liveFoundPhones = [];

  // Toggle modes
  btnModePaste.addEventListener('click', () => {
    activeMode = 'paste';
    btnModePaste.classList.add('active');
    btnModeFile.classList.remove('active');
    modePasteContainer.classList.add('active');
    modePasteContainer.hidden = false;
    modeFileContainer.classList.remove('active');
    modeFileContainer.hidden = true;
  });

  btnModeFile.addEventListener('click', () => {
    activeMode = 'file';
    btnModeFile.classList.add('active');
    btnModePaste.classList.remove('active');
    modeFileContainer.classList.add('active');
    modeFileContainer.hidden = false;
    modePasteContainer.classList.remove('active');
    modePasteContainer.hidden = true;
  });

  // Line count update
  function updateTextStats() {
    const lines = phoneText.value.split('\n').map(l => l.trim()).filter(Boolean);
    pasteLineCount.textContent = `${lines.length} số điện thoại`;
  }
  phoneText.addEventListener('input', updateTextStats);

  // Paste clipboard
  if (btnPasteClipboard) {
    btnPasteClipboard.addEventListener('click', async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text) {
          phoneText.value = text;
          updateTextStats();
          showToast('Đã dán danh sách số từ bộ nhớ tạm');
        }
      } catch {
        showToast('Trình duyệt chặn truy cập bộ nhớ tạm. Hãy dùng phím Ctrl+V.');
      }
    });
  }

  // File drop/change
  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files[0]) {
      const file = fileInput.files[0];
      fileBadge.hidden = false;
      fileBadge.textContent = `Đã chọn: ${file.name} (${Math.round(file.size / 1024)} KB)`;
    }
  });

  // Submit bulk check
  bulkForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    let formData = new FormData(bulkForm);

    if (activeMode === 'paste') {
      const textVal = phoneText.value.trim();
      if (!textVal) {
        showToast('Vui lòng dán danh sách số điện thoại!');
        phoneText.focus();
        return;
      }
      const blob = new Blob([textVal], { type: 'text/plain;charset=utf-8' });
      formData.set('input', blob, 'danh-sach-sdt.txt');
    } else {
      if (!fileInput.files || !fileInput.files[0]) {
        showToast('Vui lòng chọn tệp danh sách số điện thoại!');
        return;
      }
    }

    // Reset UI
    progressCard.hidden = false;
    progressCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    runBtn.disabled = true;
    runBtn.innerHTML = '<span>Đang xử lý tra cứu...</span>';
    bulkDownloadActions.hidden = true;
    bulkContactsContainer.innerHTML = '<div class="empty-placeholder">Đang kiểm tra dữ liệu... Chỉ hiển thị các số có Zalo tại đây.</div>';
    liveFoundPhones = [];
    statFound.textContent = '0';
    statSkipped.textContent = '0';
    statTotal.textContent = '0';
    progressBarFill.style.width = '0%';
    progressCount.textContent = '0 / 0';
    progressTitle.textContent = 'Đang tra cứu Zalo...';

    try {
      const response = await fetch('/api/jobs', {
        method: 'POST',
        body: formData
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Không thể tạo phiên tra cứu');

      const jobId = data.id;
      pollJobProgress(jobId);
    } catch (err) {
      runBtn.disabled = false;
      runBtn.innerHTML = '<span>Bắt đầu kiểm tra hàng loạt</span><span class="btn-arrow">→</span>';
      alert('Lỗi: ' + err.message);
    }
  });

  // Polling Job Progress
  async function pollJobProgress(jobId) {
    const renderedPhones = new Set();

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        if (!res.ok) return;
        const job = await res.json();

        // Update stats
        const done = job.completed || 0;
        const total = job.total || 0;
        const found = job.foundCount || 0;
        const skipped = (job.privateCount || 0) + (job.errorCount || 0);

        statFound.textContent = found;
        statSkipped.textContent = skipped;
        statTotal.textContent = total;
        progressCount.textContent = `${done} / ${total}`;

        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        progressBarFill.style.width = `${pct}%`;

        // Render preview - CHỈ CÁC SỐ CÓ ZALO
        if (Array.isArray(job.preview) && job.preview.length > 0) {
          const onlyFound = job.preview.filter(r => r.hasPublicInfo || r.status === 'found');

          // Xóa placeholder nếu có số tìm thấy
          if (onlyFound.length > 0) {
            const ph = bulkContactsContainer.querySelector('.empty-placeholder');
            if (ph) ph.remove();
          }

          onlyFound.forEach(item => {
            const p = normalizePhoneClient(item.phone || item.value);
            if (p && !renderedPhones.has(p)) {
              renderedPhones.add(p);
              liveFoundPhones.push(p);
              const card = createContactCard(item);
              bulkContactsContainer.prepend(card);
            }
          });

          // Lưu vào local cache
          addContactsToCache(onlyFound);
          liveFoundTag.textContent = `${renderedPhones.size} tài khoản`;
        }

        // Job hoàn thành
        if (job.state === 'done' || job.state === 'error') {
          clearInterval(interval);
          runBtn.disabled = false;
          runBtn.innerHTML = '<span>Bắt đầu kiểm tra hàng loạt</span><span class="btn-arrow">→</span>';

          if (job.state === 'done') {
            progressTitle.textContent = 'Hoàn tất tra cứu!';
            linkDownloadTxt.href = `/api/jobs/${jobId}/download?filter=found&type=txt`;
            linkDownloadXlsx.href = `/api/jobs/${jobId}/download?filter=found&type=xlsx`;
            bulkDownloadActions.hidden = false;
            showToast(`Hoàn tất! Tìm thấy ${found} tài khoản Zalo.`);
          } else {
            progressTitle.textContent = 'Xử lý gặp lỗi: ' + (job.error || '');
          }
        }
      } catch (e) {
        console.warn('Polling error:', e);
      }
    }, 1200);
  }

  // Copy bulk found phones button
  btnCopyBulkFound.addEventListener('click', () => {
    if (liveFoundPhones.length === 0) {
      showToast('Chưa có số nào có Zalo để sao chép.');
      return;
    }
    copyToClipboard(liveFoundPhones.join('\r\n'), `Đã sao chép ${liveFoundPhones.length} số điện thoại có Zalo!`);
  });
}

// ----------------- TAB 2: SINGLE LOOKUP -----------------
function initSingleView() {
  const singleForm = document.querySelector('#single-form');
  const singlePhoneInput = document.querySelector('#single-phone');
  const singleBtn = document.querySelector('#single-btn');
  const singleResultBox = document.querySelector('#single-result-box');
  const singleLoading = document.querySelector('#single-loading');
  const singleContent = document.querySelector('#single-content');
  const singleError = document.querySelector('#single-error');

  const singleAvatar = document.querySelector('#single-avatar');
  const singleAvatarFallback = document.querySelector('#single-avatar-fallback');
  const singleName = document.querySelector('#single-name');
  const singlePhoneVal = document.querySelector('#single-phone-val');
  const singleOrigVal = document.querySelector('#single-orig-val');
  const singleUid = document.querySelector('#single-uid');
  const singleGender = document.querySelector('#single-gender');
  const singleDob = document.querySelector('#single-dob');
  const singleBio = document.querySelector('#single-bio');
  const singleChatLink = document.querySelector('#single-chat-link');
  const singleCopyBtn = document.querySelector('#single-copy-btn');

  // Quick chips
  document.querySelectorAll('.quick-chips .chip').forEach(btn => {
    btn.addEventListener('click', () => {
      singlePhoneInput.value = btn.dataset.phone;
      singleForm.dispatchEvent(new Event('submit'));
    });
  });

  singleForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const raw = singlePhoneInput.value.trim();
    if (!raw) return;

    singleResultBox.hidden = false;
    singleLoading.hidden = false;
    singleContent.hidden = true;
    singleError.hidden = true;
    singleBtn.disabled = true;

    try {
      const res = await fetch('/api/check-single', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: raw })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Tra cứu thất bại');

      singleLoading.hidden = true;

      if (!data.hasPublicInfo || !data.user) {
        singleError.hidden = false;
        singleError.textContent = `Số ${data.phone || raw} không tìm thấy tài khoản Zalo hoặc chủ tài khoản để chế độ riêng tư.`;
        return;
      }

      // Có Zalo Public!
      const user = data.user;
      const normalized = data.phone;

      singleContent.hidden = false;
      singleName.textContent = user.name || 'Người dùng Zalo';
      singlePhoneVal.textContent = normalized;
      singleOrigVal.textContent = data.originalPhone !== normalized ? `(Gốc: ${data.originalPhone})` : '';

      singleUid.textContent = user.uid || '—';
      singleGender.textContent = user.gender || '—';
      singleDob.textContent = user.dob || '—';
      singleBio.textContent = user.bio || 'Không có tiểu sử';

      // Avatar
      if (user.avatar) {
        singleAvatar.src = user.avatar;
        singleAvatar.hidden = false;
        singleAvatarFallback.hidden = true;
        singleAvatar.onerror = () => {
          singleAvatar.hidden = true;
          singleAvatarFallback.hidden = false;
          singleAvatarFallback.textContent = (user.name || 'Z').charAt(0).toUpperCase();
        };
      } else {
        singleAvatar.hidden = true;
        singleAvatarFallback.hidden = false;
        singleAvatarFallback.textContent = (user.name || 'Z').charAt(0).toUpperCase();
      }

      // Links & copy
      singleChatLink.href = `https://zalo.me/${normalized}`;
      singleCopyBtn.onclick = () => {
        copyToClipboard(normalized, `Đã sao chép số ${normalized}`);
      };

      // Tự động lưu vào local cache
      addContactsToCache([{
        phone: normalized,
        name: user.name,
        avatar: user.avatar,
        zaloId: user.uid,
        gender: user.gender,
        dob: user.dob,
        bio: user.bio,
        hasPublicInfo: true
      }]);

    } catch (err) {
      singleLoading.hidden = true;
      singleError.hidden = false;
      singleError.textContent = err.message;
    } finally {
      singleBtn.disabled = false;
    }
  });
}

// ----------------- TAB 3: CACHE VIEW (ĐÃ LƯU) -----------------
function initCacheView() {
  const cacheSearch = document.querySelector('#cache-search');
  const btnCopyAllCache = document.querySelector('#btn-copy-all-cache');
  const btnClearCache = document.querySelector('#btn-clear-cache');

  cacheSearch.addEventListener('input', () => {
    renderCacheView(cacheSearch.value.trim().toLowerCase());
  });

  btnCopyAllCache.addEventListener('click', () => {
    const list = getLocalContacts();
    if (list.length === 0) {
      showToast('Cache máy trống.');
      return;
    }
    const phones = list.map(c => normalizePhoneClient(c.phone || c.value)).filter(Boolean);
    copyToClipboard(phones.join('\r\n'), `Đã sao chép ${phones.length} số điện thoại từ cache!`);
  });

  btnClearCache.addEventListener('click', async () => {
    if (!confirm('Bạn có chắc muốn xóa toàn bộ danh bạ Zalo đã lưu trong máy không?')) return;
    localStorage.removeItem(LOCAL_CACHE_KEY);
    try {
      await fetch('/api/cache/clear', { method: 'POST' });
    } catch {
      // Ignore
    }
    updateCacheBadge();
    renderCacheView();
    showToast('Đã xóa sạch cache.');
  });
}

function renderCacheView(query = '') {
  const container = document.querySelector('#cache-contacts-container');
  if (!container) return;

  const contacts = getLocalContacts();
  let filtered = contacts;

  if (query) {
    filtered = contacts.filter(c => {
      const p = (c.phone || c.value || '').toLowerCase();
      const n = (c.name || '').toLowerCase();
      return p.includes(query) || n.includes(query);
    });
  }

  if (filtered.length === 0) {
    container.innerHTML = query
      ? `<div class="empty-placeholder">Không tìm thấy tài khoản nào khớp với từ khóa "${query}".</div>`
      : `<div class="empty-placeholder">Chưa có số Zalo nào được lưu trong cache máy. Hãy tra cứu để tự động lưu!</div>`;
    return;
  }

  container.innerHTML = '';
  filtered.forEach(c => {
    container.appendChild(createContactCard(c));
  });
}

// Helper: Render Contact Card DOM Element (Chỉ cho tài khoản có Zalo)
function createContactCard(item) {
  const card = document.createElement('div');
  card.className = 'contact-card';

  const phone = normalizePhoneClient(item.phone || item.value || '');
  const orig = item.originalPhone && item.originalPhone !== phone ? item.originalPhone : '';
  const name = item.name || 'Người dùng Zalo';
  const avatar = item.avatar || '';
  const initial = (name || 'Z').charAt(0).toUpperCase();

  const detailsArr = [];
  if (item.gender) detailsArr.push(item.gender);
  if (item.dob) detailsArr.push(item.dob);
  if (item.zaloId) detailsArr.push(`UID: ${item.zaloId}`);
  const extraInfo = detailsArr.join(' · ') || (item.bio ? item.bio : '');

  card.innerHTML = `
    <div class="contact-left">
      ${avatar
        ? `<img class="contact-avatar" src="${avatar}" alt="Avatar" onerror="this.outerHTML='<div class=\\'avatar-fallback-mini\\'>${initial}</div>'">`
        : `<div class="avatar-fallback-mini">${initial}</div>`
      }
      <div class="contact-meta">
        <div class="contact-name-row">
          <span class="contact-name" title="${name}">${name}</span>
          <span class="contact-badge-mini">ZALO PUBLIC</span>
        </div>
        <div class="contact-phone-row">
          <span class="contact-phone">${phone}</span>
          ${orig ? `<span class="contact-orig-phone">(${orig})</span>` : ''}
        </div>
        ${extraInfo ? `<div class="contact-extra-info">${extraInfo}</div>` : ''}
      </div>
    </div>
    <div class="contact-actions">
      <a href="https://zalo.me/${phone}" target="_blank" class="btn-icon-action" title="Nhắn tin Zalo (zalo.me)">💬</a>
      <button type="button" class="btn-icon-action btn-copy-card" title="Sao chép số điện thoại">📋</button>
    </div>
  `;

  const copyBtn = card.querySelector('.btn-copy-card');
  if (copyBtn) {
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      copyToClipboard(phone, `Đã chép số ${phone}`);
    });
  }

  return card;
}

// ----------------- TAB 4: ZALO AUTH / QR -----------------
function initZaloAuth() {
  const navPill = document.querySelector('#nav-zalo-status');
  const navText = document.querySelector('#nav-zalo-text');
  const connectedCard = document.querySelector('#zalo-connected-card');
  const disconnectedCard = document.querySelector('#zalo-disconnected-card');
  const btnCreateQr = document.querySelector('#btn-create-qr');
  const qrStatusMsg = document.querySelector('#qr-status-msg');
  const qrWrapper = document.querySelector('#qr-image-wrapper');
  const qrImg = document.querySelector('#qr-img');
  const authAccountName = document.querySelector('#auth-account-name');
  const btnDisconnect = document.querySelector('#btn-disconnect');

  async function checkZaloStatus() {
    try {
      const res = await fetch('/api/zalo', { cache: 'no-store' });
      if (!res.ok) return;
      const status = await res.json();
      const phase = status.phase;

      if (phase === 'ready') {
        const name = status.profile?.name || 'Đã kết nối';
        navPill.className = 'status-badge ready';
        navText.textContent = `Zalo: ${name}`;
        connectedCard.hidden = false;
        disconnectedCard.hidden = true;
        authAccountName.textContent = status.profile?.name ? `Tài khoản: ${status.profile.name}` : 'Sẵn sàng tra cứu số điện thoại';
      } else if (phase === 'waiting') {
        navPill.className = 'status-badge waiting';
        navText.textContent = 'Zalo: Quét mã QR...';
        connectedCard.hidden = true;
        disconnectedCard.hidden = false;
        qrStatusMsg.textContent = 'Vui lòng mở app Zalo trên điện thoại quét mã QR:';
        if (status.qr) {
          qrWrapper.hidden = false;
          qrImg.src = status.qr;
        }
        btnCreateQr.disabled = true;
      } else if (phase === 'scanned') {
        navPill.className = 'status-badge waiting';
        navText.textContent = 'Zalo: Đã quét...';
        connectedCard.hidden = true;
        disconnectedCard.hidden = false;
        qrStatusMsg.textContent = 'Đã quét mã! Hãy nhấn XÁC NHẬN ĐĂNG NHẬP trên Zalo điện thoại.';
        qrWrapper.hidden = true;
        btnCreateQr.disabled = true;
      } else {
        navPill.className = 'status-badge offline';
        navText.textContent = 'Zalo: Chưa kết nối';
        connectedCard.hidden = true;
        disconnectedCard.hidden = false;
        qrStatusMsg.textContent = status.error || 'Chưa kết nối tài khoản Zalo.';
        qrWrapper.hidden = true;
        btnCreateQr.disabled = false;
        btnCreateQr.textContent = 'Tạo mã QR đăng nhập';
      }
    } catch {
      navPill.className = 'status-badge offline';
      navText.textContent = 'Zalo: Không có mạng';
    }
  }

  btnCreateQr.addEventListener('click', async () => {
    btnCreateQr.disabled = true;
    btnCreateQr.textContent = 'Đang khởi tạo mã QR...';
    try {
      await fetch('/api/zalo/connect', { method: 'POST' });
      await checkZaloStatus();
    } catch (e) {
      alert('Lỗi: ' + e.message);
      btnCreateQr.disabled = false;
    }
  });

  btnDisconnect.addEventListener('click', async () => {
    if (!confirm('Bạn có chắc chắn muốn ngắt kết nối Zalo không?')) return;
    try {
      await fetch('/api/zalo/disconnect', { method: 'POST' });
      await checkZaloStatus();
      showToast('Đã ngắt kết nối Zalo.');
    } catch (e) {
      alert('Lỗi: ' + e.message);
    }
  });

  // Check on load & poll every 2.5s
  checkZaloStatus();
  setInterval(checkZaloStatus, 2500);
}

// ----------------- APP INITIALIZATION -----------------
window.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initBulkView();
  initSingleView();
  initCacheView();
  initZaloAuth();
  updateCacheBadge();
  syncServerCache();
});
