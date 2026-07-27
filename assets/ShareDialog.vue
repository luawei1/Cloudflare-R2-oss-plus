<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div v-if="show" class="dialog-overlay" @click.self="$emit('close')">
        <div class="dialog-content share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-dialog-title">
          <div class="dialog-header">
            <h3 id="share-dialog-title">文件分享</h3>
            <button class="close-btn" @click="$emit('close')" aria-label="关闭分享窗口">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>

          <div class="dialog-body">
            <div class="file-info"><span>{{ fileName }}</span></div>
            <div v-if="error" class="error-message">{{ error }}</div>

            <section v-if="!creating" class="existing-shares">
              <div class="section-heading">
                <div>
                  <h4>已有有效分享</h4>
                  <p>{{ loadingShares ? '正在读取…' : existingShares.length ? `此文件有 ${existingShares.length} 条独立分享规则` : '暂无有效分享' }}</p>
                </div>
                <button class="btn btn-secondary compact" @click="creating = true">创建新分享</button>
              </div>
              <div v-if="existingShares.length" class="share-list">
                <article v-for="share in existingShares" :key="share.id" class="share-item">
                  <div class="share-meta">
                    <span>{{ share.hasPassword ? '密码保护' : '无需密码' }}</span>
                    <span>{{ formatExpiry(share.expiresAt) }}</span>
                    <span v-if="share.maxDownloads">限 {{ share.maxDownloads }} 次</span>
                  </div>
                  <div class="copy-field">
                    <input :value="share.url" readonly aria-label="分享链接" @focus="$event.target.select()" />
                    <button @click="copy(share.url, share.id)" class="copy-btn-inline">{{ copied === share.id ? '已复制' : '复制' }}</button>
                  </div>
                  <div class="share-actions">
                    <span>创建于 {{ formatDate(share.createdAt) }}</span>
                    <button class="link-danger" @click="revokeShare(share)" :disabled="revokingId === share.id">{{ revokingId === share.id ? '撤销中…' : '撤销' }}</button>
                  </div>
                </article>
              </div>
              <p v-else-if="!loadingShares" class="empty-hint">创建后的链接会保留在这里，可随时复制或撤销。</p>
            </section>

            <form v-else @submit.prevent="createShare" novalidate>
              <div class="section-heading">
                <div><h4>创建新分享</h4><p>每条分享可使用独立的访问规则。</p></div>
                <button type="button" class="btn btn-secondary compact" @click="creating = false">返回已有分享</button>
              </div>
              <div class="form-group">
                <label>有效期</label>
                <div class="duration-options">
                  <button v-for="opt in durationOptions" :key="opt.value" type="button" :class="['duration-btn', { active: duration === opt.value }]" @click="duration = opt.value">{{ opt.label }}</button>
                </div>
                <div v-if="duration === 'custom'" class="custom-duration"><input type="number" v-model.number="customMinutes" placeholder="分钟数" min="1" /><span>分钟</span></div>
              </div>
              <div class="form-group">
                <label class="checkbox-label"><input type="checkbox" v-model="enablePassword" /><span>密码保护</span></label>
                <input v-if="enablePassword" type="password" v-model="password" placeholder="设置访问密码" class="password-input" autocomplete="new-password" />
              </div>
              <div class="form-group">
                <label class="checkbox-label"><input type="checkbox" v-model="enableDownloadLimit" /><span>限制下载次数</span></label>
                <input v-if="enableDownloadLimit" type="number" v-model.number="maxDownloads" placeholder="最大下载次数" min="1" class="download-limit-input" />
              </div>
              <div class="form-group">
                <label class="checkbox-label"><input type="checkbox" v-model="trackDownloads" /><span>记录下载者 IP</span></label>
                <p v-if="trackDownloads" class="option-hint">开启后可在分享管理中查看下载记录。</p>
              </div>
              <button class="btn btn-primary" type="submit" :disabled="loading">{{ loading ? '创建中...' : '创建分享链接' }}</button>
            </form>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script>
export default {
  name: 'ShareDialog',
  props: { show: { type: Boolean, default: false }, fileKey: { type: String, required: true } },
  emits: ['close', 'changed'],
  data() {
    return {
      duration: '7d', customMinutes: 60, enablePassword: false, password: '',
      enableDownloadLimit: false, maxDownloads: 10, trackDownloads: false,
      loading: false, loadingShares: false, revokingId: '', error: '', copied: '', creating: false, existingShares: [],
      durationOptions: [
        { value: '1h', label: '1小时' }, { value: '1d', label: '1天' }, { value: '7d', label: '7天' },
        { value: '30d', label: '30天' }, { value: 'forever', label: '永久' }, { value: 'custom', label: '自定义' }
      ]
    };
  },
  computed: { fileName() { return this.fileKey ? this.fileKey.split('/').pop() : ''; } },
  watch: { show(val) { if (val) this.open(); } },
  methods: {
    getHeaders() {
      const credentials = localStorage.getItem('auth_credentials');
      return credentials ? { Authorization: `Basic ${credentials}` } : {};
    },
    async open() {
      this.resetForm();
      await this.loadShares();
    },
    resetForm() {
      this.duration = '7d'; this.customMinutes = 60; this.enablePassword = false; this.password = '';
      this.enableDownloadLimit = false; this.maxDownloads = 10; this.trackDownloads = false;
      this.error = ''; this.copied = ''; this.creating = false;
    },
    async loadShares() {
      this.loadingShares = true;
      try {
        const response = await fetch(`/api/share/list?key=${encodeURIComponent(this.fileKey)}`, { headers: this.getHeaders(), cache: 'no-store' });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '获取分享列表失败');
        this.existingShares = data.shares || [];
      } catch (error) {
        this.error = error.message || '获取分享列表失败';
      } finally { this.loadingShares = false; }
    },
    validate() {
      if (this.enablePassword && !this.password.trim()) return '请设置访问密码';
      if (this.duration === 'custom' && (!Number.isFinite(this.customMinutes) || this.customMinutes <= 0)) return '自定义有效期必须大于 0 分钟';
      if (this.enableDownloadLimit && (!Number.isFinite(this.maxDownloads) || this.maxDownloads <= 0)) return '下载次数必须大于 0';
      return '';
    },
    async createShare() {
      this.error = this.validate();
      if (this.error) return;
      this.loading = true;
      try {
        const response = await fetch('/api/share/create', {
          method: 'POST', headers: { 'Content-Type': 'application/json', ...this.getHeaders() },
          body: JSON.stringify({ key: this.fileKey, duration: this.duration, customMinutes: this.duration === 'custom' ? this.customMinutes : undefined, password: this.enablePassword ? this.password : undefined, maxDownloads: this.enableDownloadLimit ? this.maxDownloads : undefined, trackDownloads: this.trackDownloads || undefined })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '创建分享失败');
        this.creating = false;
        await this.loadShares();
        this.$emit('changed', { key: this.fileKey, count: this.existingShares.length });
      } catch (error) { this.error = error.message || '创建分享失败'; }
      finally { this.loading = false; }
    },
    async revokeShare(share) {
      if (!window.confirm(`撤销“${share.fileName}”的这条分享？链接将立即失效。`)) return;
      this.revokingId = share.id;
      try {
        const response = await fetch(`/api/share/${share.id}`, { method: 'DELETE', headers: this.getHeaders() });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '撤销分享失败');
        this.existingShares = this.existingShares.filter((item) => item.id !== share.id);
        this.$emit('changed', { key: this.fileKey, count: this.existingShares.length });
      } catch (error) { this.error = error.message || '撤销分享失败'; }
      finally { this.revokingId = ''; }
    },
    async copy(text, type) {
      try {
        await navigator.clipboard.writeText(text);
        this.copied = type;
        setTimeout(() => { this.copied = ''; }, 2000);
      } catch {
        this.error = '浏览器未授予剪贴板权限，请选中链接后手动复制。';
      }
    },
    formatDate(timestamp) { return new Date(timestamp).toLocaleString('zh-CN'); },
    formatExpiry(timestamp) { return timestamp ? `有效至 ${this.formatDate(timestamp)}` : '永久有效'; }
  }
};
</script>

<style scoped>
.dialog-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:1000;padding:20px}.dialog-content{background:var(--card-bg);border-radius:var(--radius-lg);width:100%;max-width:560px;max-height:90vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.3)}.dialog-header,.section-heading,.share-actions{display:flex;align-items:center;justify-content:space-between;gap:12px}.dialog-header{padding:20px 24px;border-bottom:1px solid var(--border-color)}.dialog-header h3,.section-heading h4{margin:0;color:var(--text-primary)}.close-btn{width:32px;height:32px;border:0;background:none;cursor:pointer;color:var(--text-muted)}.close-btn svg{width:20px}.dialog-body{padding:24px}.file-info,.share-item,.result-info{padding:16px;background:var(--bg-secondary);border-radius:var(--radius-md)}.file-info{margin-bottom:20px;font-weight:500;word-break:break-all}.section-heading{margin-bottom:16px}.section-heading p,.empty-hint,.option-hint{margin:5px 0 0;color:var(--text-muted);font-size:12px}.share-list{display:grid;gap:12px}.share-meta,.share-actions{font-size:12px;color:var(--text-muted);margin-bottom:10px}.share-meta{display:flex;flex-wrap:wrap;gap:8px}.share-actions{margin:10px 0 0}.copy-field{display:flex;gap:8px}.copy-field input,.password-input,.download-limit-input,.custom-duration input{min-width:0;flex:1;width:100%;padding:10px 12px;border:1px solid var(--border-color);border-radius:var(--radius-md);background:var(--card-bg);color:var(--text-primary)}.copy-field input{font-family:monospace;background:var(--card-bg)}.copy-btn-inline,.btn{border:0;border-radius:var(--radius-md);cursor:pointer;font-weight:600}.copy-btn-inline{padding:10px 14px;background:var(--primary-color);color:#fff}.btn{width:100%;padding:12px}.btn-primary{background:var(--primary-color);color:#fff}.btn-secondary{background:var(--bg-secondary);color:var(--text-primary);border:1px solid var(--border-color)}.compact{width:auto;padding:8px 12px;font-size:13px}.link-danger{border:0;background:none;color:#dc2626;cursor:pointer}.form-group{margin-bottom:20px}.form-group>label{display:block;margin-bottom:8px;font-size:14px;font-weight:500;color:var(--text-secondary)}.checkbox-label{display:inline-flex!important;align-items:center;gap:10px;cursor:pointer}.checkbox-label input{width:18px;height:18px;accent-color:var(--primary-color)}.duration-options{display:flex;flex-wrap:wrap;gap:8px}.duration-btn{padding:8px 14px;border:1px solid var(--border-color);background:var(--card-bg);border-radius:var(--radius-md);cursor:pointer;color:var(--text-primary)}.duration-btn.active{background:var(--primary-color);border-color:var(--primary-color);color:#fff}.custom-duration{display:flex;align-items:center;gap:8px;margin-top:12px}.error-message{background:#fee;color:#b91c1c;padding:12px;border-radius:var(--radius-md);margin-bottom:16px;font-size:14px}.dialog-enter-active,.dialog-leave-active{transition:opacity .2s}.dialog-enter-from,.dialog-leave-to{opacity:0}@media(max-width:600px){.dialog-overlay{padding:12px}.dialog-body{padding:18px}.copy-field{flex-direction:column}.copy-btn-inline{width:100%}}
</style>
