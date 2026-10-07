import { readFile, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Zalo, LoginQRCallbackEventType, type API } from 'zca-js';
import type { PhoneLookup, ZaloUserInfo } from './core.js';
import { normalizePhone } from './core.js';

const SESSION_FILE = resolve(process.cwd(), '.zalo_session.json');

export class ZaloSession implements PhoneLookup {
  source = 'zca-js:Zalo';
  private api?: API;
  private qr?: string;
  private phase: 'offline' | 'waiting' | 'scanned' | 'ready' | 'error' = 'offline';
  private error?: string;
  private connecting?: Promise<void>;
  private profile?: { name: string; id?: string; avatar?: string };

  get status() {
    return {
      phase: this.phase,
      qr: this.qr,
      error: this.error,
      profile: this.profile
    };
  }

  async tryResumeSession(): Promise<boolean> {
    try {
      const raw = await readFile(SESSION_FILE, 'utf8');
      const credentials = JSON.parse(raw);
      if (credentials?.cookie && credentials?.imei && credentials?.userAgent) {
        const zalo = new Zalo({ logging: false, checkUpdate: false });
        const api = await zalo.login(credentials);
        this.api = api;
        this.phase = 'ready';
        this.error = undefined;
        this.qr = undefined;
        try {
          const info = await api.fetchAccountInfo();
          if (info?.profile) {
            this.profile = {
              name: info.profile.displayName || info.profile.zaloName || 'Tài khoản Zalo',
              id: info.profile.userId,
              avatar: info.profile.avatar
            };
          }
        } catch {
          // fetchAccountInfo optional
        }
        return true;
      }
    } catch {
      // Session invalid or expired
      try {
        await unlink(SESSION_FILE);
      } catch {
        // ignore
      }
    }
    return false;
  }

  async disconnect() {
    this.api = undefined;
    this.qr = undefined;
    this.phase = 'offline';
    this.error = undefined;
    this.profile = undefined;
    this.connecting = undefined;
    try {
      await unlink(SESSION_FILE);
    } catch {
      // ignore
    }
  }

  connect() {
    if (this.phase === 'ready' || this.connecting) return;
    this.connecting = (async () => {
      // First try resuming saved session if available
      const resumed = await this.tryResumeSession();
      if (resumed) return;

      this.phase = 'waiting';
      this.error = undefined;
      this.qr = undefined;
      this.profile = undefined;
      const zalo = new Zalo({ logging: false, checkUpdate: false });
      return zalo.loginQR({}, async event => {
        if (event.type === LoginQRCallbackEventType.QRCodeGenerated) {
          const image = event.data.image.trim();
          if (!/^[A-Za-z0-9+/]+={0,2}$/.test(image) || !image.startsWith('iVBORw0KGgo')) {
            event.actions.abort();
            this.phase = 'error';
            this.error = 'Zalo trả mã QR không hợp lệ. Hãy thử kết nối lại.';
            return;
          }
          this.qr = `data:image/png;base64,${image}`;
          this.phase = 'waiting';
        } else if (event.type === LoginQRCallbackEventType.QRCodeScanned) {
          this.phase = 'scanned';
          this.qr = undefined;
        } else if (event.type === LoginQRCallbackEventType.QRCodeExpired || event.type === LoginQRCallbackEventType.QRCodeDeclined) {
          event.actions.abort();
        } else if (event.type === LoginQRCallbackEventType.GotLoginInfo) {
          // Lưu lại thông tin session đăng nhập Zalo để không phải quét lại QR
          try {
            await writeFile(SESSION_FILE, JSON.stringify(event.data, null, 2), 'utf8');
          } catch {
            // ignore
          }
        }
      }).then(async api => {
        this.api = api;
        this.qr = undefined;
        this.phase = 'ready';
        try {
          const info = await api.fetchAccountInfo();
          if (info?.profile) {
            this.profile = {
              name: info.profile.displayName || info.profile.zaloName || 'Tài khoản Zalo',
              id: info.profile.userId,
              avatar: info.profile.avatar
            };
          }
        } catch {
          // fetchAccountInfo optional
        }
      }).catch(() => {
        this.qr = undefined;
        this.phase = 'error';
        this.error ??= 'Đăng nhập QR thất bại hoặc hết hạn. Bấm kết nối lại.';
      });
    })().finally(() => {
      this.connecting = undefined;
    });
  }

  async check(phone: string): Promise<ZaloUserInfo | null> {
    if (!this.api) throw Error('Chưa đăng nhập Zalo');
    const normalized = normalizePhone(phone);
    const response = await this.api.findUser(normalized);
    if (!response) return null;

    const name = response.display_name?.trim() || response.zalo_name?.trim() || '';
    const uid = response.uid ? String(response.uid) : undefined;
    const hasPublicInfo = Boolean(name || uid || response.avatar);

    let genderStr = 'Không rõ';
    if (response.gender === 0) genderStr = 'Nam';
    else if (response.gender === 1) genderStr = 'Nữ';

    let dobStr = response.sdob?.trim() || undefined;
    if (!dobStr && response.dob) {
      try {
        dobStr = new Date(response.dob).toLocaleDateString('vi-VN');
      } catch {
        // ignore invalid date
      }
    }

    return {
      hasPublicInfo,
      name,
      zaloName: response.zalo_name?.trim() || undefined,
      displayName: response.display_name?.trim() || undefined,
      uid,
      gender: genderStr,
      avatar: response.avatar?.trim() || undefined,
      cover: response.cover?.trim() || undefined,
      dob: dobStr,
      bio: response.status?.trim() || undefined,
      isBusiness: Boolean(response.bizPkg && Object.keys(response.bizPkg).length > 0)
    };
  }

  async find(phone: string): Promise<string | null> {
    const user = await this.check(phone);
    return user?.name || null;
  }
}
