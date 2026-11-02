import { emptySlots, matchAugmentSlots } from './augment-matching.js';

export class OverlayController {
  constructor({ capture, recognizeSlots, loadData, onState, show, hide, onInvalidate = () => {}, autoSchedule = true, settings = {} }) {
    Object.assign(this, { capture, recognizeSlots, loadData, onState, show, hide, onInvalidate, autoSchedule });
    this.state = { enabled: true, phase: 'Unavailable', championId: 0, championName: '',
      status: 'idle', message: '等待客户端进入对局', displayId: 'primary', calibrated: false,
      slots: emptySlots(), visible: false, ...settings };
    this.connected = false;
    this.epoch = 0;
    this.misses = 0;
    this.disposed = false;
    this.pending = null;
    this.timer = null;
  }

  getState() { return structuredClone(this.state); }

  eligible() {
    return !this.disposed && this.connected && this.state.enabled && !this.state.calibrating
      && this.state.phase === 'InProgress' && this.state.championId > 0;
  }

  emit() { if (!this.disposed) this.onState(this.getState()); }

  clear() {
    this.state.visible = false;
    this.state.slots = emptySlots();
    this.misses = 0;
    this.hide();
  }

  updateSession(snapshot) {
    const connected = snapshot.status === 'connected';
    const changed = this.connected !== connected || this.state.phase !== snapshot.phase
      || this.state.championId !== snapshot.championId;
    this.connected = connected;
    if (!changed) return;
    this.epoch++;
    this.onInvalidate();
    clearTimeout(this.timer);
    this.state.phase = snapshot.phase;
    this.state.championId = snapshot.championId || 0;
    this.state.championName = '';
    this.clear();
    this.state.status = this.state.enabled ? 'idle' : 'disabled';
    this.state.message = !this.state.enabled ? '已关闭自动识别'
      : this.eligible() ? '对局中，等待海克斯选择界面'
        : snapshot.phase === 'InProgress' && connected ? '未能核实本局英雄，请检查客户端连接'
          : '等待客户端进入实际对局';
    this.emit();
    this.schedule(0);
  }

  setEnabled(enabled) {
    this.state.enabled = enabled;
    this.invalidateSettings();
    return this.getState();
  }

  invalidateSettings(settings = {}) {
    Object.assign(this.state, settings);
    this.epoch++;
    this.onInvalidate();
    clearTimeout(this.timer);
    this.clear();
    this.state.status = this.state.enabled ? 'idle' : 'disabled';
    this.state.message = this.state.enabled ? '等待识别海克斯' : '已关闭自动识别';
    this.emit();
    this.schedule(0);
  }

  schedule(delay = this.state.visible ? 1000 : 1800) {
    clearTimeout(this.timer);
    if (!this.autoSchedule || !this.eligible() || this.pending) return;
    this.timer = setTimeout(() => { void this.scanOnce(); }, delay);
    this.timer.unref?.();
  }

  async scanOnce() {
    if (!this.eligible()) return this.getState();
    if (this.pending) {
      await this.pending;
      return this.getState();
    }
    clearTimeout(this.timer);
    const epoch = this.epoch;
    const current = () => epoch === this.epoch && this.eligible();
    this.pending = (async () => {
      try {
        this.state.status = 'scanning';
        this.state.message = '正在本地截图';
        this.emit();
        const images = await this.capture();
        if (!current()) return;
        this.state.status = 'recognizing';
        this.state.message = '正在本地识别海克斯名称';
        this.emit();
        const readings = images.length === 3 ? await this.recognizeSlots(images) : [];
        if (!current()) return;
        const data = await this.loadData(this.state.championId);
        if (!current()) return;
        this.state.championName = data.championName ?? '';
        const slots = matchAugmentSlots(readings, data.catalog, data.augments);
        const recognized = slots.filter(slot => !slot.missing);
        const unique = new Set(recognized.map(slot => slot.augmentId)).size === recognized.length;
        if (unique && (recognized.length === 3 || (this.state.visible && recognized.length === 2))) {
          this.misses = 0;
          this.state.slots = slots;
          this.state.visible = true;
          this.state.status = 'visible';
          this.state.message = recognized.length === 3 ? '已识别左、中、右三张海克斯' : '部分识别，未读到的位置留空';
          this.show(this.getState());
        } else {
          this.misses++;
          if (this.misses >= 2) this.clear();
          this.state.status = this.state.visible ? 'visible' : 'idle';
          this.state.message = '未识别到完整三卡；如已打开选择界面，请校准名称区域';
        }
        this.emit();
      } catch (error) {
        if (current()) {
          this.clear();
          this.state.status = 'error';
          this.state.message = `本地识别失败：${error instanceof Error ? error.message : '未知错误'}`;
          this.emit();
        }
      }
    })().finally(() => {
      this.pending = null;
      this.schedule(this.state.status === 'error' ? 5000 : undefined);
    });
    await this.pending;
    return this.getState();
  }

  dispose() {
    this.epoch++;
    this.disposed = true;
    clearTimeout(this.timer);
    this.clear();
  }
}
