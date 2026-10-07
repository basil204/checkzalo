// Elements
const form = document.querySelector('#form');
const panel = document.querySelector('#progress');
const runBtn = document.querySelector('#run');
const stateText = document.querySelector('#state');
const countText = document.querySelector('#count');
const progressBar = document.querySelector('#bar');
const downloadBox = document.querySelector('#download-box');
const downloadAllBtn = document.querySelector('#download');
const downloadZaloTxtBtn = document.querySelector('#download-zalo-txt');
const downloadZaloXlsxBtn = document.querySelector('#download-zalo-xlsx');

const foundContainer = document.querySelector('#found-phones-container');
const foundCountText = document.querySelector('#found-phones-count');
const foundTextarea = document.querySelector('#found-phones-textarea');
const copyFoundBtn = document.querySelector('#copy-found-phones-btn');

const connectBtn = document.querySelector('#connect');
const disconnectBtn = document.querySelector('#disconnect');
const zaloState = document.querySelector('#zalo-state');
const qrContainer = document.querySelector('#qr-container');
const qrImg = document.querySelector('#qr');
const headerPill = document.querySelector('#zalo-status-pill');
const headerZaloText = document.querySelector('#header-zalo-text');
const connectedBanner = document.querySelector('#zalo-user-connected');
const connectedName = document.querySelector('#connected-account-name');

const metricTotal = document.querySelector('#metric-total');
const metricPublic = document.querySelector('#metric-public');
const metricPrivate = document.querySelector('#metric-private');
const metricError = document.querySelector('#metric-error');
const tableBody = document.querySelector('#table-body');

// Tabs
const tabFileBtn = document.querySelector('#tab-file-btn');
const tabTextBtn = document.querySelector('#tab-text-btn');
const paneFile = document.querySelector('#pane-file');
const paneText = document.querySelector('#pane-text');
const phoneTextarea = document.querySelector('#phone-text');
const lineCounter = document.querySelector('#line-counter');

// Drop zone
const dropZone = document.querySelector('#drop-zone');
const fileInput = document.querySelector('#file-input');
const selectedFileName = document.querySelector('#selected-file-name');

// Single lookup
const singleForm = document.querySelector('#single-form');
const singleInput = document.querySelector('#single-phone');
const singleBtn = document.querySelector('#single-btn');
const singleResultBox = document.querySelector('#single-result-box');
const singleLoading = document.querySelector('#single-loading');
const singleContent = document.querySelector('#single-content');
const singleError = document.querySelector('#single-error');
const resAvatar = document.querySelector('#res-avatar');
const resAvatarFallback = document.querySelector('#res-avatar-fallback');
const resName = document.querySelector('#res-name');
const resPublicBadge = document.querySelector('#res-public-badge');
const resPhone = document.querySelector('#res-phone');
const resOrig = document.querySelector('#res-orig');
const resUid = document.querySelector('#res-uid');
const resGender = document.querySelector('#res-gender');
const resDob = document.querySelector('#res-dob');
const resBio = document.querySelector('#res-bio');

// Helper to normalize phone (84 -> 0)
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

// ----------------- Zalo Auth Management -----------------
async function jsonFetch(url, options = {}) {
  const res = await fetch(url, { ...options, cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Yêu cầu thất bại (${res.status})`);
  return data;
}

async function refreshZalo() {
  try {
    const session = await jsonFetch('/api/zalo');
    const { phase, qr, error, profile } = session;

    headerPill.className = `status-pill ${phase === 'ready' ? 'ready' : (phase === 'waiting' || phase === 'scanned' ? 'waiting' : 'offline')}`;

    if (phase === 'ready') {
      const name = profile?.name || 'Đã kết nối';
      headerZaloText.textContent = `Zalo: ${name}`;
      zaloState.textContent = 'Tài khoản Zalo sẵn sàng hoạt động';
      connectedName.textContent = profile?.name ? `Tài khoản: ${profile.name}` : 'Tài khoản Zalo sẵn sàng tra cứu';
      connectedBanner.hidden = false;
      connectBtn.hidden = true;
      disconnectBtn.hidden = false;
      qrContainer.hidden = true;
    } else if (phase === 'waiting') {
      headerZaloText.textContent = 'Zalo: Quét mã QR...';
      zaloState.textContent = 'Vui lòng mở app Zalo trên điện thoại để quét mã QR';
      connectedBanner.hidden = true;
      connectBtn.hidden = false;
      connectBtn.disabled = true;
      disconnectBtn.hidden = true;
      qrContainer.hidden = !qr;
      if (qr) qrImg.src = qr;
    } else if (phase === 'scanned') {
      headerZaloText.textContent = 'Zalo: Đã quét...';
      zaloState.textContent = 'Đã quét mã! Hãy nhấn Xác nhận đăng nhập trên điện thoại';
      connectedBanner.hidden = true;
      connectBtn.disabled = true;
      qrContainer.hidden = true;
    } else {
      headerZaloText.textContent = 'Zalo: Chưa kết nối';
      zaloState.textContent = error || 'Chưa đăng nhập Zalo';
      connectedBanner.hidden = true;
      connectBtn.hidden = false;
      connectBtn.disabled = false;
      connectBtn.textContent = 'Tạo mã QR đăng nhập';
      disconnectBtn.hidden = true;
      qrContainer.hidden = true;
    }
  } catch {
    headerZaloText.textContent = 'Zalo: Lỗi kết nối';
  }
}

connectBtn.addEventListener('click', async () => {
  connectBtn.disabled = true;
  connectBtn.textContent = 'Đang tạo mã QR...';
  try {
    await jsonFetch('/api/zalo/connect', { method: 'POST' });
    await refreshZalo();
  } catch (err) {
    zaloState.textContent = err.message;
    connectBtn.disabled = false;
  }
});

disconnectBtn.addEventListener('click', async () => {
  if (!confirm('Bạn có chắc chắn muốn ngắt kết nối Zalo không?')) return;
  try {
    await jsonFetch('/api/zalo/disconnect', { method: 'POST' });
    await refreshZalo();
  } catch (err) {
    alert(err.message);
  }
});

setInterval(refreshZalo, 2500);
refreshZalo();

// ----------------- Single Phone Quick Check -----------------
singleForm.addEventListener('submit', async event => {
  event.preventDefault();
  const raw = singleInput.value.trim();
  if (!raw) return;

  const normalized = normalizePhoneClient(raw);
  singleResultBox.hidden = false;
  singleLoading.hidden = false;
  singleContent.hidden = true;
  singleError.hidden = true;
  singleBtn.disabled = true;

  try {
    const data = await jsonFetch('/api/check-single', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: raw })
    });

    singleLoading.hidden = true;
    singleContent.hidden = false;

    resPhone.textContent = data.phone;
    resOrig.textContent = data.originalPhone !== data.phone ? `(Gốc: ${data.originalPhone})` : '';

    if (data.hasPublicInfo && data.user) {
      const u = data.user;
      resName.textContent = u.name || u.displayName || u.zaloName || 'Tài khoản Zalo';
      resPublicBadge.textContent = 'Có thông tin public';
      resPublicBadge.className = 'badge public';

      if (u.avatar) {
        resAvatar.src = u.avatar;
        resAvatar.hidden = false;
        resAvatarFallback.hidden = true;
      } else {
        resAvatar.hidden = true;
        resAvatarFallback.hidden = false;
        resAvatarFallback.textContent = (u.name || 'Z').charAt(0).toUpperCase();
      }

      resUid.textContent = u.uid || '—';
      resGender.textContent = u.gender || '—';
      resDob.textContent = u.dob || '—';
      resBio.textContent = u.bio || '—';
    } else {
      resName.textContent = 'Không tìm thấy thông tin';
      resPublicBadge.textContent = 'Không có thông tin public / Riêng tư';
      resPublicBadge.className = 'badge private';
      resAvatar.hidden = true;
      resAvatarFallback.hidden = false;
      resAvatarFallback.textContent = '?';
      resUid.textContent = '—';
      resGender.textContent = '—';
      resDob.textContent = '—';
      resBio.textContent = 'Không có thông tin công khai hoặc số chưa kích hoạt Zalo';
    }
  } catch (err) {
    singleLoading.hidden = true;
    singleError.hidden = false;
    singleError.textContent = `Lỗi: ${err.message}`;
  } finally {
    singleBtn.disabled = false;
  }
});

// Quick Example Chips
document.querySelectorAll('.chip[data-phone]').forEach(chip => {
  chip.addEventListener('click', () => {
    singleInput.value = chip.dataset.phone;
    singleForm.requestSubmit();
  });
});

// ----------------- Tabs & Drop Zone -----------------
tabFileBtn.addEventListener('click', () => {
  tabFileBtn.classList.add('active');
  tabTextBtn.classList.remove('active');
  paneFile.hidden = false;
  paneText.hidden = true;
});

tabTextBtn.addEventListener('click', () => {
  tabTextBtn.classList.add('active');
  tabFileBtn.classList.remove('active');
  paneText.hidden = false;
  paneFile.hidden = true;
  phoneTextarea.focus();
});

// Textarea line counter
function updateLineCounter() {
  const lines = phoneTextarea.value.split('\n').map(s => s.trim()).filter(Boolean);
  lineCounter.textContent = `${lines.length} số điện thoại`;
}
phoneTextarea.addEventListener('input', updateLineCounter);

// Drop Zone file selection
fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (file) {
    selectedFileName.textContent = `✓ Đã chọn: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
    selectedFileName.hidden = false;
  } else {
    selectedFileName.hidden = true;
  }
});

['dragenter', 'dragover'].forEach(name => {
  dropZone.addEventListener(name, e => { e.preventDefault(); dropZone.classList.add('dragover'); });
});
['dragleave', 'drop'].forEach(name => {
  dropZone.addEventListener(name, e => { e.preventDefault(); dropZone.classList.remove('dragover'); });
});
dropZone.addEventListener('drop', e => {
  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    fileInput.files = e.dataTransfer.files;
    fileInput.dispatchEvent(new Event('change'));
  }
});

// ----------------- Bulk Job Monitoring -----------------
async function monitorJob(id) {
  while (true) {
    const data = await jsonFetch(`/api/jobs/${id}`);
    countText.textContent = `${data.completed} / ${data.total} dòng`;
    progressBar.style.width = `${data.total ? Math.round((data.completed / data.total) * 100) : 0}%`;

    // Update realtime metrics on each poll
    metricTotal.textContent = String(data.total || 0);
    metricPublic.textContent = String(data.foundCount || 0);
    metricPrivate.textContent = String(data.privateCount || 0);
    metricError.textContent = String(data.errorCount || 0);

    // Update realtime live table
    if (data.preview && data.preview.length > 0) {
      updateLiveTable(data.preview);
    }

    if (data.state === 'done') {
      stateText.textContent = 'Đã hoàn thành kiểm tra!';
      downloadBox.hidden = false;

      // Setup downloads
      downloadZaloTxtBtn.href = `/api/jobs/${id}/download?filter=found&type=txt`;
      downloadZaloXlsxBtn.href = `/api/jobs/${id}/download?filter=found&type=xlsx`;
      downloadAllBtn.href = `/api/jobs/${id}/download`;

      // Setup Found Phones textarea
      if (data.foundPhones && data.foundPhones.length > 0) {
        foundContainer.hidden = false;
        foundCountText.textContent = String(data.foundPhones.length);
        foundTextarea.value = data.foundPhones.join('\n');
      } else {
        foundContainer.hidden = false;
        foundCountText.textContent = '0';
        foundTextarea.value = 'Không tìm thấy số điện thoại nào có Zalo public trong danh sách.';
      }

      metricPublic.textContent = String(data.foundCount || 0);
      metricPrivate.textContent = String(data.privateCount || Math.max(0, (data.total || 0) - (data.foundCount || 0) - (data.errorCount || 0)));
      metricError.textContent = String(data.errorCount || 0);
      return;
    }

    if (data.state === 'error') {
      throw new Error(data.error || 'Xử lý thất bại');
    }

    stateText.textContent = `Đang tra cứu Zalo... (${data.completed}/${data.total})`;
    await new Promise(r => setTimeout(r, 600));
  }
}

function updateLiveTable(rows) {
  tableBody.innerHTML = '';
  rows.slice(-15).reverse().forEach(row => {
    const tr = document.createElement('tr');

    const tdLine = document.createElement('td');
    tdLine.textContent = row.line;

    const tdAvatar = document.createElement('td');
    if (row.avatar) {
      const img = document.createElement('img');
      img.src = row.avatar;
      img.className = 'table-avatar';
      img.alt = '';
      tdAvatar.appendChild(img);
    } else {
      const fb = document.createElement('div');
      fb.className = 'table-avatar-fallback';
      fb.textContent = (row.name || '?').charAt(0).toUpperCase();
      tdAvatar.appendChild(fb);
    }

    const tdPhone = document.createElement('td');
    tdPhone.innerHTML = `<span class="phone-tag">${row.phone || row.value}</span>`;

    const tdOrig = document.createElement('td');
    tdOrig.innerHTML = `<span class="phone-tag-orig">${row.originalPhone || '—'}</span>`;

    const tdName = document.createElement('td');
    tdName.textContent = row.name || '—';
    tdName.style.fontWeight = '600';

    const tdPublic = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `badge ${row.hasPublicInfo ? 'public' : 'private'}`;
    badge.textContent = row.hasPublicInfoText || (row.hasPublicInfo ? 'Có' : 'Không');
    tdPublic.appendChild(badge);

    const tdGender = document.createElement('td');
    tdGender.textContent = row.gender || '—';

    const tdUid = document.createElement('td');
    tdUid.textContent = row.zaloId || '—';
    tdUid.className = 'code-val';

    const tdNote = document.createElement('td');
    tdNote.textContent = row.error || (row.hasPublicInfo ? 'Đã tìm thấy' : 'Riêng tư / Không có');
    tdNote.style.color = row.error ? '#fca5a5' : 'var(--text-dim)';

    tr.append(tdLine, tdAvatar, tdPhone, tdOrig, tdName, tdPublic, tdGender, tdUid, tdNote);
    tableBody.appendChild(tr);
  });
}

// Copy found phones to clipboard
copyFoundBtn.addEventListener('click', async () => {
  if (!foundTextarea.value.trim()) return;
  try {
    await navigator.clipboard.writeText(foundTextarea.value.trim());
    const originalText = copyFoundBtn.textContent;
    copyFoundBtn.textContent = '✓ Đã sao chép!';
    setTimeout(() => { copyFoundBtn.textContent = originalText; }, 2000);
  } catch {
    foundTextarea.select();
    document.execCommand('copy');
    alert('Đã sao chép danh sách số điện thoại!');
  }
});

// Bulk Form Submit
form.addEventListener('submit', async event => {
  event.preventDefault();

  const isTextMode = !paneText.hidden;
  const pastedText = phoneTextarea.value.trim();
  const hasFile = fileInput.files && fileInput.files.length > 0;

  if (isTextMode && !pastedText) {
    alert('Vui lòng dán danh sách số điện thoại vào ô văn bản.');
    phoneTextarea.focus();
    return;
  }
  if (!isTextMode && !hasFile) {
    alert('Vui lòng chọn hoặc kéo thả tệp (.xlsx, .txt, .csv) cần kiểm tra.');
    return;
  }

  runBtn.disabled = true;
  panel.hidden = false;
  downloadBox.hidden = true;
  foundContainer.hidden = true;
  progressBar.style.width = '0%';
  countText.textContent = '0 / 0 dòng';
  metricTotal.textContent = '0';
  metricPublic.textContent = '0';
  metricPrivate.textContent = '0';
  metricError.textContent = '0';
  stateText.textContent = 'Đang tải dữ liệu và khởi tạo phiên tra cứu...';
  tableBody.innerHTML = '<tr class="empty-row"><td colspan="9">Đang chuẩn bị dữ liệu...</td></tr>';

  try {
    const body = new FormData(form);
    if (!form.elements.table?.files?.length) {
      body.delete('table');
    }
    if (!hasFile) {
      body.delete('input');
    }
    const data = await jsonFetch('/api/jobs', { method: 'POST', body });
    await monitorJob(data.id);
  } catch (error) {
    stateText.textContent = `Lỗi: ${error.message}`;
    alert(`Lỗi khi khởi động kiểm tra: ${error.message}`);
  } finally {
    runBtn.disabled = false;
  }
});
