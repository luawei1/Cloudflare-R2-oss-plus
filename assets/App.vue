<template>
  <div
    class="app-container"
    :data-theme="theme"
    :class="{ 'drag-active': isDraggingFiles }"
    @dragenter.prevent="onDragEnter"
    @dragover.prevent="onDragOver"
    @dragleave.prevent="onDragLeave"
    @drop.prevent="onDrop"
  >
    <!-- Header -->
    <Header
      :search="search"
      :theme="theme"
      :user="currentUser"
      @update:search="search = $event"
      @toggleTheme="toggleTheme"
      @login="showLoginDialog = true"
      @logout="handleLogout"
      @showShareList="showShareListDialog = true"
      @showAdminTools="showAdminTools = true"
      @showApiKeys="showApiKeyDialog = true"
      @showActivityLog="showActivityLog = true"
      @showUploadSettings="openUploadSettings"
    />

    <!-- Main Content -->
    <main class="main-content">
      <!-- Stats Cards (仅登录用户可见) -->
      <StatsCards v-if="showStats" ref="statsCards" />

      <!-- Toolbar -->
      <Toolbar
        :viewMode="viewMode"
        :sortBy="sortBy"
        :sortOrder="sortOrder"
        :selectionMode="selectionMode"
        :selectedCount="selectedItems.length"
        :totalCount="filteredFiles.length + filteredFolders.length"
        :isReadonly="isReadonly"
        :refreshing="refreshing"
        @update:viewMode="viewMode = $event"
        @update:sortBy="sortBy = $event"
        @update:sortOrder="sortOrder = $event"
        @toggleSelection="selectionMode = !selectionMode"
        @selectAll="selectAll"
        @createFolder="createFolder"
        @refresh="handleRefresh"
      >
        <template #breadcrumb>
          <Breadcrumb :path="cwd" @navigate="navigateTo" />
        </template>
      </Toolbar>

      <!-- Upload Progress -->
      <div v-if="uploadProgress !== null" class="upload-progress">
        <div class="upload-progress-bar" :style="{ width: uploadProgress + '%' }"></div>
      </div>

      <!-- Drag Upload Hint -->
      <div v-if="isDraggingFiles" class="drag-upload-overlay">
        <div class="drag-upload-card">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          <strong>{{ isReadonly ? '当前账号不可上传' : '释放鼠标上传到当前文件夹' }}</strong>
          <span>{{ cwd || '根目录' }}</span>
        </div>
      </div>

      <!-- Loading State -->
      <div v-if="loading" class="state-container">
        <div class="loading-spinner"></div>
        <p class="state-title">加载中...</p>
      </div>

      <!-- Empty State -->
      <div
        v-else-if="!filteredFiles.length && !filteredFolders.length"
        class="state-container"
      >
        <svg class="state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/>
          <line x1="9" y1="13" x2="15" y2="13"/>
        </svg>
        <p class="state-title">暂无文件</p>
        <p class="state-desc">拖拽文件到此处上传，或点击右下角按钮</p>
      </div>

      <!-- File Grid/List -->
      <div v-else :class="viewMode === 'grid' ? 'file-grid' : 'file-list-view'">
        <!-- Back folder -->
        <FileCard
          v-if="cwd !== ''"
          :file="{ key: '..', isFolder: true, name: '..' }"
          :viewMode="viewMode"
          :selectionMode="false"
          @click="navigateUp"
        />

        <!-- Folders -->
        <FileCard
          v-for="folder in filteredFolders"
          :key="folder"
          :file="{ key: folder + '_$folder$', isFolder: true }"
          :viewMode="viewMode"
          :selected="isSelected(folder + '_$folder$')"
          :selectionMode="selectionMode"
          @click="navigateTo(folder)"
          @select="toggleSelect(folder + '_$folder$')"
          @contextmenu="showContextMenuFor($event, folder)"
        />

        <!-- Files -->
        <FileCard
          v-for="file in filteredFiles"
          :key="file.key"
          :file="file"
          :viewMode="viewMode"
          :selected="isSelected(file.key)"
          :selectionMode="selectionMode"
          :fileBaseUrl="fileBaseUrl"
          :shareCount="shareCounts[file.key] || 0"
          @click="preview(file)"
          @select="toggleSelect(file.key)"
          @contextmenu="showContextMenuFor($event, file)"
        />
      </div>
    </main>

    <!-- Batch Actions Bar -->
    <BatchBar
      :selectedCount="selectedItems.length"
      :loading="batchLoading"
      @download="batchDownload"
      @delete="batchDelete"
      @move="batchMove"
      @cancel="clearSelection"
    />

    <!-- Upload FAB -->
    <button class="fab-button" @click="showUploadPopup = true" title="上传文件" v-if="!isReadonly">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="17 8 12 3 7 8"/>
        <line x1="12" y1="3" x2="12" y2="15"/>
      </svg>
    </button>

    <!-- Upload Popup -->
    <UploadPopup
      v-model="showUploadPopup"
      @upload="onUploadClicked"
      @importLink="openRemoteImport"
      @createFolder="createFolder"
    />

    <!-- Upload Settings Dialog -->
    <Dialog v-model="showUploadSettings">
      <div class="upload-settings-dialog">
        <div class="upload-settings-header">
          <h3>上传参数</h3>
          <p>提高并发与分片大小可加速上传，但弱网更容易失败</p>
        </div>
        <div class="upload-settings-body">
          <label class="upload-settings-row">
            <span>分片大小</span>
            <select v-model.number="uploadSettingsDraft.chunkSizeMb" class="upload-settings-select">
              <option :value="20">20MB</option>
              <option :value="40">40MB</option>
              <option :value="60">60MB</option>
              <option :value="80">80MB</option>
              <option :value="100">100MB</option>
            </select>
          </label>
          <label class="upload-settings-row">
            <span>并发数</span>
            <select v-model.number="uploadSettingsDraft.concurrency" class="upload-settings-select">
              <option :value="1">1</option>
              <option :value="2">2</option>
              <option :value="3">3</option>
              <option :value="4">4</option>
            </select>
          </label>
          <label class="upload-settings-row">
            <span>重试次数</span>
            <select v-model.number="uploadSettingsDraft.retries" class="upload-settings-select">
              <option :value="0">0</option>
              <option :value="1">1</option>
              <option :value="2">2</option>
              <option :value="3">3</option>
              <option :value="4">4</option>
              <option :value="5">5</option>
            </select>
          </label>
          <label class="upload-settings-row upload-settings-toggle">
            <span>自动续传</span>
            <input type="checkbox" v-model="uploadSettingsDraft.autoResume" />
          </label>
          <div v-if="uploadResumeList.length" class="upload-settings-resume">
            <div class="upload-settings-resume-title">未完成上传</div>
            <div class="upload-settings-resume-list">
              <div v-for="item in uploadResumeList" :key="item.key" class="upload-settings-resume-item">
                <div class="upload-settings-resume-info">
                  <div class="upload-settings-resume-name">{{ item.name }}</div>
                  <div class="upload-settings-resume-meta">{{ item.progressText }}</div>
                </div>
                <div class="upload-settings-resume-actions">
                  <button class="upload-settings-btn ghost" @click="resumeUploadFromSettings(item)">继续</button>
                  <button class="upload-settings-btn secondary" @click="removeResumeRecord(item.key)">移除</button>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="upload-settings-footer">
          <button class="upload-settings-btn secondary" @click="resetUploadSettings">
            恢复默认
          </button>
          <div class="upload-settings-actions">
            <button class="upload-settings-btn ghost" @click="showUploadSettings = false">取消</button>
            <button class="upload-settings-btn primary" @click="saveUploadSettings">保存</button>
          </div>
        </div>
      </div>
    </Dialog>

    <!-- Login Dialog -->
    <LoginDialog
      v-model="showLoginDialog"
      :loading="loginLoading"
      :error="loginError"
      :required="!currentUser"
      @login="handleLogin"
      @guestLogin="handleGuestLogin"
    />

    <!-- Share Dialog -->
    <ShareDialog
      :show="showShareDialog"
      :fileKey="shareFileKey"
      @close="showShareDialog = false"
      @changed="updateShareCount"
    />

    <!-- Share List Dialog (Admin) -->
    <ShareListDialog
      :show="showShareListDialog"
      @close="showShareListDialog = false"
      @toast="handleToast"
      @confirm="showConfirm"
    />

    <!-- Admin Tools Dialog -->
    <AdminTools
      v-model="showAdminTools"
      @toast="handleToast"
    />

    <!-- API Key Dialog -->
    <ApiKeyDialog
      v-model="showApiKeyDialog"
      @toast="handleToast"
    />

    <!-- Input Dialog -->
    <InputDialog
      v-model="showInputDialog"
      :title="inputDialogConfig.title"
      :description="inputDialogConfig.description"
      :placeholder="inputDialogConfig.placeholder"
      :hint="inputDialogConfig.hint"
      :defaultValue="inputDialogConfig.defaultValue"
      :confirmText="inputDialogConfig.confirmText"
      :icon="inputDialogConfig.icon"
      @confirm="handleInputConfirm"
    />

    <!-- Confirm Dialog -->
    <ConfirmDialog
      v-model="showConfirmDialog"
      :title="confirmDialogConfig.title"
      :message="confirmDialogConfig.message"
      :confirmText="confirmDialogConfig.confirmText"
      :cancelText="confirmDialogConfig.cancelText"
      :type="confirmDialogConfig.type"
      @confirm="handleConfirmDialogConfirm"
      @cancel="handleConfirmDialogCancel"
    />

    <!-- Context Menu Dialog -->
    <Dialog v-model="showContextMenu">
      <div class="context-menu">
        <div class="context-menu-header">
          {{ focusedItemName }}
        </div>
        <div v-if="typeof focusedItem === 'string'" class="context-menu-body">
          <button class="context-menu-item" @click="renameFolder(focusedItem)" v-if="!isReadonly">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            重命名
          </button>
          <button class="context-menu-item" @click="copyLink(`/?p=${encodeURIComponent(focusedItem)}`)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
            </svg>
            复制链接
          </button>
          <button class="context-menu-item" @click="downloadFolder(focusedItem)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            下载文件夹
          </button>
          <button class="context-menu-item" @click="moveFile(focusedItem + '_$folder$')" v-if="!isReadonly">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            移动
          </button>
          <button class="context-menu-item danger" @click="removeFile(focusedItem + '_$folder$')" v-if="!isReadonly">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
            删除
          </button>
        </div>
        <div v-else class="context-menu-body">
          <button class="context-menu-item" @click="renameFile(focusedItem.key)" v-if="!isReadonly">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
            重命名
          </button>
          <button class="context-menu-item" @click="editFocusedText" v-if="!isReadonly && isEditableTextFile(focusedItem)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 20h9"/>
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
            </svg>
            编辑文本
          </button>
          <a class="context-menu-item" :href="getFileUrl(focusedItem.key)" target="_blank" download @click="showContextMenu = false">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            下载
          </a>
          <button class="context-menu-item" @click="clipboard = focusedItem.key; showContextMenu = false">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
            复制
          </button>
          <button class="context-menu-item" @click="moveFile(focusedItem.key)" v-if="!isReadonly">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            移动
          </button>
          <button class="context-menu-item" @click="copyLink(getFileUrl(focusedItem.key))">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
            </svg>
            复制链接
          </button>
          <button class="context-menu-item" @click="openShareDialog(focusedItem.key)" v-if="!isReadonly">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="18" cy="5" r="3"/>
              <circle cx="6" cy="12" r="3"/>
              <circle cx="18" cy="19" r="3"/>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
            </svg>
            分享
          </button>
          <button class="context-menu-item danger" @click="removeFile(focusedItem.key)" v-if="!isReadonly">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
            删除
          </button>
        </div>
      </div>
    </Dialog>

    <!-- Toast -->
    <Toast ref="toast" />

    <!-- Activity Log -->
    <ActivityLog ref="activityLog" v-model="showActivityLog" />

    <!-- File Preview -->
    <FilePreview
      v-model="showFilePreview"
      :fileUrl="previewFileUrl"
      :fetchUrl="previewFetchUrl"
      :fileName="previewFileName"
      :contentType="previewContentType"
      :fileKey="previewFileKey"
      :editable="!isReadonly"
      @edit="handlePreviewEdit"
    />

    <!-- Markdown Editor -->
    <MarkdownEditor
      v-model="showMarkdownEditor"
      :fileKey="markdownEditorFileKey"
      :contentType="markdownEditorContentType"
      :guestUploadPassword="guestUploadPassword"
      @toast="handleToast"
      @saved="handleMarkdownSaved"
    />
  </div>
</template>

<script>
import {
  generateThumbnail,
  blobDigest,
  multipartUpload,
  SIZE_LIMIT,
} from "/assets/main.mjs";
import {
  getFileExtension,
  getFileNameFromKey,
  getFileTypeForFile,
  parseSearchQuery,
} from "/assets/search.mjs";
import {
  FOLDER_DOWNLOAD_LIMITS,
  fetchAllItemsRecursively,
  fetchFolderTreeRecursively,
  getFolderDownloadLimitMessage,
  getRelativeZipPath,
  summarizeDownloadItems,
} from "./file-ops.mjs";
import {
  ensureTrailingSlash,
  getPathName,
  isFolderMarker,
  stripFolderMarker,
  toFolderMarkerKey,
} from "./item-paths.mjs";
import { encodePathForUrl } from "./url-utils.mjs";
import Dialog from "./Dialog.vue";
import Header from "./Header.vue";
import StatsCards from "./StatsCards.vue";
import Breadcrumb from "./Breadcrumb.vue";
import Toolbar from "./Toolbar.vue";
import FileCard from "./FileCard.vue";
import BatchBar from "./BatchBar.vue";
import UploadPopup from "./UploadPopup.vue";
import LoginDialog from "./LoginDialog.vue";
import ShareDialog from "./ShareDialog.vue";
import ShareListDialog from "./ShareListDialog.vue";
import AdminTools from "./AdminTools.vue";
import ApiKeyDialog from "./ApiKeyDialog.vue";
import InputDialog from "./InputDialog.vue";
import ConfirmDialog from "./ConfirmDialog.vue";
import Toast from "./Toast.vue";
import FilePreview from "./FilePreview.vue";
import MarkdownEditor from "./MarkdownEditor.vue";
import ActivityLog from "./ActivityLog.vue";

export default {
  data: () => ({
    // Theme
    theme: localStorage.getItem('theme') || 'light',

    // Navigation
    cwd: new URL(window.location).searchParams.get("p") || "",

    // Files
    files: [],
    folders: [],
    loading: false,
    refreshing: false,

    // Search & Sort
    search: "",
    sortBy: 'name',
    sortOrder: 'asc',
    viewMode: localStorage.getItem('viewMode') || 'grid',

    // Selection
    selectionMode: false,
    selectedItems: [],

    // Batch operations
    batchLoading: false,

    // Context menu
    clipboard: null,
    focusedItem: null,
    showContextMenu: false,

    // Upload
    showUploadPopup: false,
    uploadProgress: null,
    dragDepth: 0,
    isDraggingFiles: false,
    uploadQueue: [],
    isProcessingUploadQueue: false,
    remoteImporting: false,
    uploadResumeInfo: {},
    uploadConfig: {
      chunkSizeMb: 80,
      concurrency: 3,
      retries: 3,
      autoResume: false,
    },
    showUploadSettings: false,
    uploadSettingsDraft: {
      chunkSizeMb: 80,
      concurrency: 3,
      retries: 3,
      autoResume: false,
    },

    // Auth
    showLoginDialog: false,
    loginLoading: false,
    loginError: '',
    currentUser: null,

    // Config
    fileBaseUrl: '',

    // Share
    showShareDialog: false,
    shareFileKey: '',
    shareCounts: {},

    // Share List (admin)
    showShareListDialog: false,

    // Admin Tools
    showAdminTools: false,

    // API Key Dialog
    showApiKeyDialog: false,

    // Activity Log
    showActivityLog: false,

    // Guest Upload Password
    guestUploadPassword: localStorage.getItem('guest_upload_password') || '',

    // Input Dialog
    showInputDialog: false,
    inputDialogConfig: {
      title: '',
      description: '',
      placeholder: '',
      hint: '',
      defaultValue: '',
      confirmText: '确定',
      icon: '',
      callback: null,
    },

    // Confirm Dialog
    showConfirmDialog: false,
    confirmDialogConfig: {
      title: '确认操作',
      message: '',
      confirmText: '确定',
      cancelText: '取消',
      type: 'warning',
      callback: null,
      cancelCallback: null,
    },

    // File Preview
    showFilePreview: false,
    previewFileUrl: '',
    previewFetchUrl: '',  // 用于 fetch 内容，避免 CORS
    previewFileName: '',
    previewContentType: '',
    previewFileKey: '',

    // Markdown Editor
    showMarkdownEditor: false,
    markdownEditorFileKey: '',
    markdownEditorContentType: '',
  }),

  computed: {
    searchFilters() {
      return parseSearchQuery(this.search);
    },

    filteredFiles() {
      let files = [...this.files];

      // Filter out folder markers and invalid entries
      files = files.filter((file) => {
        if (!file.key) return false;
        // 过滤掉文件夹标记
        if (file.key.endsWith('_$folder$')) return false;
        // 过滤掉以 / 结尾的对象（可能是空文件夹标记）
        if (file.key.endsWith('/')) return false;
        return true;
      });

      // Filter by search
      const filters = this.searchFilters;

      if (filters.nameTerms.length) {
        files = files.filter((file) =>
          filters.nameTerms.every((term) =>
            getFileNameFromKey(file.key).toLowerCase().includes(term)
          )
        );
      }

      if (filters.types) {
        files = files.filter((file) => filters.types.has(getFileTypeForFile(file)));
      }

      if (filters.extensions) {
        files = files.filter((file) => filters.extensions.has(getFileExtension(file.key)));
      }

      if (filters.minSizeBytes !== null) {
        files = files.filter((file) => file.size >= filters.minSizeBytes);
      }

      if (filters.maxSizeBytes !== null) {
        files = files.filter((file) => file.size <= filters.maxSizeBytes);
      }

      // Sort
      files.sort((a, b) => {
        let comparison = 0;
        if (this.sortBy === 'name') {
          comparison = a.key.localeCompare(b.key);
        } else if (this.sortBy === 'size') {
          comparison = a.size - b.size;
        } else if (this.sortBy === 'date') {
          comparison = new Date(a.uploaded) - new Date(b.uploaded);
        }
        return this.sortOrder === 'asc' ? comparison : -comparison;
      });

      return files;
    },

    filteredFolders() {
      let folders = [...this.folders];
      const { nameTerms } = this.searchFilters;
      if (nameTerms.length) {
        folders = folders.filter((folder) =>
          nameTerms.every((term) => folder.toLowerCase().includes(term))
        );
      }
      // Sort folders alphabetically
      folders.sort((a, b) => {
        const comparison = a.localeCompare(b);
        return this.sortOrder === 'asc' ? comparison : -comparison;
      });
      return folders;
    },

    uploadResumeList() {
      return Object.entries(this.uploadResumeInfo || {})
        .map(([key, info]) => {
          const done = Array.isArray(info.uploadedParts) ? info.uploadedParts.length : 0;
          const total = info.totalChunks || 0;
          const progressText = total ? `${done}/${total}` : `${done}`;
          return {
            key,
            name: info.fileName || key,
            progressText,
            info,
          };
        })
        .sort((a, b) => (b.info.updatedAt || 0) - (a.info.updatedAt || 0));
    },

    focusedItemName() {
      if (!this.focusedItem) return '';
      if (typeof this.focusedItem === 'string') {
        return getPathName(this.focusedItem) || this.focusedItem;
      }
      return getPathName(this.focusedItem.key) || '';
    },
    isReadonly() {
      return this.currentUser?.isReadonly === true;
    },
    // 是否显示统计卡片（访客不显示）
    showStats() {
      return this.currentUser && !this.currentUser.isGuest;
    },
  },

  methods: {
    // Theme
    toggleTheme() {
      this.theme = this.theme === 'dark' ? 'light' : 'dark';
      localStorage.setItem('theme', this.theme);
      document.documentElement.setAttribute('data-theme', this.theme);
    },

    // 处理子组件的 Toast 消息
    handleToast({ type, message }) {
      if (type === 'success') {
        this.$refs.toast?.success(message);
      } else if (type === 'error') {
        this.$refs.toast?.error(message);
      } else {
        this.$refs.toast?.info?.(message) || this.$refs.toast?.success(message);
      }
    },

    // Auth
    async handleLogin({ username, password }) {
      this.loginLoading = true;
      this.loginError = '';

      try {
        const response = await fetch('/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });

        const data = await response.json();

        if (!data.success) {
          this.loginError = data.error || '登录失败';
          return;
        }

        // 保存凭据
        localStorage.setItem('auth_credentials', data.credentials);
        localStorage.setItem('auth_user', JSON.stringify({
          username: data.username,
          permissions: data.permissions,
          isAdmin: data.isAdmin,
          isReadonly: data.isReadonly,
        }));

        // 设置 axios 默认 header
        axios.defaults.headers.common['Authorization'] = `Basic ${data.credentials}`;

        this.currentUser = {
          username: data.username,
          permissions: data.permissions,
          isAdmin: data.isAdmin,
          isReadonly: data.isReadonly,
        };

        this.showLoginDialog = false;
        this.loginError = '';
      } catch (e) {
        this.loginError = '网络错误，请重试';
      } finally {
        this.loginLoading = false;
      }
    },

    handleLogout() {
      localStorage.removeItem('auth_credentials');
      localStorage.removeItem('auth_user');
      delete axios.defaults.headers.common['Authorization'];
      this.currentUser = null;
      this.showLoginDialog = true;
    },

    handleGuestLogin() {
      // 访客登录 - 不需要凭据，只设置用户状态
      this.currentUser = {
        username: '访客',
        permissions: [],
        isAdmin: false,
        isGuest: true,
      };
      localStorage.setItem('auth_user', JSON.stringify(this.currentUser));
      this.showLoginDialog = false;
      this.loginError = '';
    },

    restoreAuth() {
      const credentials = localStorage.getItem('auth_credentials');
      const userStr = localStorage.getItem('auth_user');

      if (userStr) {
        try {
          this.currentUser = JSON.parse(userStr);
          if (credentials) {
            axios.defaults.headers.common['Authorization'] = `Basic ${credentials}`;
          }
          return true;
        } catch (e) {
          this.handleLogout();
        }
      }
      return false;
    },

    // Config
    async loadConfig() {
      try {
        const response = await fetch('/api/config');
        const config = await response.json();
        this.fileBaseUrl = config.fileBaseUrl || '';
      } catch (e) {
        console.warn('Failed to load config:', e);
      }
    },

    getChildrenUrl(prefix) {
      return `/api/children/${encodePathForUrl(prefix)}`;
    },

    getWriteItemUrl(key) {
      return `/api/write/items/${encodePathForUrl(key)}`;
    },

    getAuthHeaders() {
      const headers = {};
      const credentials = localStorage.getItem('auth_credentials');
      if (credentials) {
        headers['Authorization'] = `Basic ${credentials}`;
      }
      return headers;
    },

    getFileFetchHeaders() {
      return this.fileBaseUrl ? {} : this.getAuthHeaders();
    },

    async fetchFileBlob(key) {
      const response = await fetch(this.getFileUrl(key), {
        headers: this.getFileFetchHeaders(),
      });
      if (!response.ok) {
        throw new Error(`下载失败 (${response.status})`);
      }
      return response.blob();
    },

    getFileUrl(key) {
      // 如果配置了 fileBaseUrl（CDN 回源），直接使用
      // 否则使用 /raw/ 路由（通过 Pages Function 代理）
      const encodedKey = encodePathForUrl(key);
      if (this.fileBaseUrl) {
        return `${this.fileBaseUrl}/${encodedKey}`;
      }
      return `/raw/${encodedKey}`;
    },

    // Navigation
    navigateTo(path) {
      // 规范化路径（确保一致性）
      const normalizedPath = path || '';

      // 如果路径相同，强制刷新
      if (this.cwd === normalizedPath) {
        this.fetchFiles();
      } else {
        this.cwd = normalizedPath;
      }
      this.clearSelection();
    },

    navigateUp() {
      this.cwd = this.cwd.replace(/[^\/]+\/$/, '');
      this.clearSelection();
    },

    // Selection
    isSelected(key) {
      return this.selectedItems.includes(key);
    },

    toggleSelect(key) {
      const index = this.selectedItems.indexOf(key);
      if (index > -1) {
        this.selectedItems.splice(index, 1);
      } else {
        this.selectedItems.push(key);
      }
    },

    selectAll() {
      const allKeys = [
        ...this.filteredFolders.map(f => f + '_$folder$'),
        ...this.filteredFiles.map(f => f.key)
      ];
      if (this.selectedItems.length === allKeys.length) {
        this.selectedItems = [];
      } else {
        this.selectedItems = [...allKeys];
      }
    },

    clearSelection() {
      this.selectedItems = [];
      this.selectionMode = false;
    },

    // Batch Operations
    async batchDownload() {
      if (!this.selectedItems.length) return;

      // For single file, direct download
      if (this.selectedItems.length === 1 && !isFolderMarker(this.selectedItems[0])) {
        const fileName = getPathName(this.selectedItems[0]);
        if (this.fileBaseUrl) {
          this.$refs.activityLog?.add('download', `下载 "${fileName}"`, 'success');
          window.open(this.getFileUrl(this.selectedItems[0]), '_blank');
          return;
        }

        try {
          const blob = await this.fetchFileBlob(this.selectedItems[0]);
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = fileName;
          a.click();
          URL.revokeObjectURL(url);
          this.$refs.activityLog?.add('download', `下载 "${fileName}"`, 'success');
        } catch (error) {
          this.$refs.toast?.error(error?.message || '下载失败');
        }
        return;
      }

      // For multiple files or folders, use JSZip if available
      if (typeof JSZip === 'undefined') {
        this.$refs.toast?.error('批量下载需要 JSZip 库支持，请刷新页面后重试');
        return;
      }

      const count = this.selectedItems.length;
      const logId = this.$refs.activityLog?.add('download', `批量下载 ${count} 个项目`, 'pending');

      this.batchLoading = true;
      try {
        const zip = new JSZip();
        const summary = { fileCount: 0, totalBytes: 0 };

        for (const key of this.selectedItems) {
          if (isFolderMarker(key)) {
            // Download folder contents
            const folderPath = stripFolderMarker(key);
            const items = await this.getAllItems(folderPath);
            const folderSummary = summarizeDownloadItems(items);
            summary.fileCount += folderSummary.fileCount;
            summary.totalBytes += folderSummary.totalBytes;
            const limitMessage = getFolderDownloadLimitMessage(summary, FOLDER_DOWNLOAD_LIMITS);
            if (limitMessage) {
              throw new Error(limitMessage);
            }
            for (const item of items) {
              if (!item.key.endsWith('_$folder$')) {
                const blob = await this.fetchFileBlob(item.key);
                const relativePath = getRelativeZipPath(folderPath, item.key);
                zip.file(relativePath, blob);
              }
            }
          } else {
            // Download single file
            summary.fileCount += 1;
            const matchedFile = this.files.find((file) => file.key === key);
            summary.totalBytes += Number(matchedFile?.size) || 0;
            const limitMessage = getFolderDownloadLimitMessage(summary, FOLDER_DOWNLOAD_LIMITS);
            if (limitMessage) {
              throw new Error(limitMessage);
            }
            const blob = await this.fetchFileBlob(key);
            const fileName = getPathName(key);
            zip.file(fileName, blob);
          }
        }

        const content = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(content);
        const a = document.createElement('a');
        a.href = url;
        a.download = `download-${Date.now()}.zip`;
        a.click();
        URL.revokeObjectURL(url);
        this.clearSelection();
        this.$refs.activityLog?.update(logId, 'success', `批量下载 ${count} 个项目成功`);
      } catch (error) {
        console.error('Batch download failed:', error);
        this.$refs.activityLog?.update(logId, 'error', `批量下载失败`);
        this.$refs.toast?.error(error?.message || '批量下载失败');
      } finally {
        this.batchLoading = false;
      }
    },

    async batchDelete() {
      if (!this.selectedItems.length) return;

      this.showConfirm({
        title: '确认删除',
        message: `确定要删除选中的 ${this.selectedItems.length} 个项目吗？`,
        confirmText: '删除',
        type: 'danger',
        callback: async () => {
          this.batchLoading = true;
          const items = [...this.selectedItems];
          const count = items.length;
          const logId = this.$refs.activityLog?.add('delete', `批量删除 ${count} 个项目`, 'pending');
          try {
            for (const key of items) {
              if (isFolderMarker(key)) {
                await this.deleteFolderRecursively(key);
              } else {
                await axios.delete(this.getWriteItemUrl(key));
              }
            }
            this.clearSelection();
            this.fetchFiles();
            this.$refs.statsCards?.refresh();
            this.$refs.activityLog?.update(logId, 'success', `批量删除 ${count} 个项目成功`);
            this.$refs.toast?.success('删除成功');
          } catch (error) {
            console.error('Batch delete failed:', error);
            this.$refs.activityLog?.update(logId, 'error', `批量删除失败`);
            this.$refs.toast?.error('批量删除失败');
          } finally {
            this.batchLoading = false;
            this.uploadProgress = null;
          }
        }
      });
    },
    batchMove() {
      if (!this.selectedItems.length) return;

      this.showInput({
        title: '批量移动',
        description: `将选中的 ${this.selectedItems.length} 个项目移动到`,
        placeholder: '请输入目标路径',
        hint: '留空表示移动到根目录',
        defaultValue: '',
        icon: 'move',
        confirmText: '移动',
        callback: async (targetPath) => {
          const normalizedPath = targetPath === '' ? '' : ensureTrailingSlash(targetPath);
          const items = [...this.selectedItems];
          const count = items.length;
          const logId = this.$refs.activityLog?.add('move', `批量移动 ${count} 个项目`, 'pending');

          this.batchLoading = true;
          try {
            for (const key of items) {
              const fileName = getPathName(key);
              if (isFolderMarker(key)) {
                const targetFolderPath = `${normalizedPath}${fileName}/`;
                if (ensureTrailingSlash(stripFolderMarker(key)) === targetFolderPath) {
                  continue;
                }
                await this.moveFolderRecursively(key, targetFolderPath);
                await this.moveShares(ensureTrailingSlash(stripFolderMarker(key)), targetFolderPath);
              } else {
                const targetFilePath = normalizedPath + fileName;
                if (targetFilePath === key) {
                  continue;
                }
                await this.copyPaste(key, targetFilePath);
                await axios.delete(this.getWriteItemUrl(key));
                await this.moveShares(key, targetFilePath);
              }
            }
            this.clearSelection();
            this.fetchFiles();
            this.$refs.activityLog?.update(logId, 'success', `批量移动 ${count} 个项目成功`);
            this.$refs.toast?.success('移动成功');
          } catch (error) {
            console.error('Batch move failed:', error);
            this.$refs.activityLog?.update(logId, 'error', `批量移动失败`);
            this.$refs.toast?.error('批量移动失败');
          } finally {
            this.batchLoading = false;
            this.uploadProgress = null;
          }
        }
      });
    },
    // Context Menu
    showContextMenuFor(event, item) {
      this.focusedItem = item;
      this.showContextMenu = true;
    },

    async copyLink(link) {
      const url = new URL(link, window.location.origin);
      try {
        await navigator.clipboard.writeText(url.toString());
        this.$refs.toast?.success('链接已复制');
      } catch {
        this.$refs.toast?.error('复制失败，请手动复制链接');
      }
      this.showContextMenu = false;
    },

    openShareDialog(fileKey) {
      this.shareFileKey = fileKey;
      this.showShareDialog = true;
      this.showContextMenu = false;
    },

    // Input Dialog Helper
    showInput(config) {
      this.inputDialogConfig = {
        title: config.title || '输入',
        description: config.description || '',
        placeholder: config.placeholder || '请输入...',
        hint: config.hint || '',
        defaultValue: config.defaultValue || '',
        confirmText: config.confirmText || '确定',
        icon: config.icon || '',
        callback: config.callback || null,
      };
      this.showInputDialog = true;
    },

    handleInputConfirm(value) {
      if (this.inputDialogConfig.callback) {
        this.inputDialogConfig.callback(value);
      }
    },

    // Confirm Dialog Helper
    showConfirm(config) {
      this.confirmDialogConfig = {
        title: config.title || '确认操作',
        message: config.message || '确定要执行此操作吗？',
        confirmText: config.confirmText || '确定',
        cancelText: config.cancelText || '取消',
        type: config.type || 'warning',
        callback: config.callback || null,
        cancelCallback: config.cancelCallback || null,
      };
      this.showConfirmDialog = true;
    },

    handleConfirmDialogConfirm() {
      if (this.confirmDialogConfig.callback) {
        this.confirmDialogConfig.callback();
      }
    },

    handleConfirmDialogCancel() {
      if (this.confirmDialogConfig.cancelCallback) {
        this.confirmDialogConfig.cancelCallback();
      }
    },

    async copyPaste(source, target) {
      const uploadUrl = this.getWriteItemUrl(target);
      await axios.put(uploadUrl, "", {
        headers: { "x-amz-copy-source": encodeURIComponent(source) },
      });
    },

    async deleteFolderRecursively(folderPath) {
      const normalizedFolderPath = ensureTrailingSlash(stripFolderMarker(folderPath));
      const { files, folders } = await this.getFolderTree(normalizedFolderPath);
      const folderPrefixes = [
        ...folders.map((folder) => folder.prefix).sort((a, b) => b.length - a.length),
        normalizedFolderPath,
      ];
      const totalItems = files.length + folderPrefixes.length;
      let processedItems = 0;

      const updateProgress = () => {
        this.uploadProgress = totalItems ? (processedItems / totalItems) * 100 : null;
      };

      for (const file of files) {
        await axios.delete(this.getWriteItemUrl(file.key));
        processedItems += 1;
        updateProgress();
      }

      for (const prefix of folderPrefixes) {
        try {
          await axios.delete(this.getWriteItemUrl(toFolderMarkerKey(prefix)));
        } catch (error) {
          if (error.response?.status !== 404) {
            throw error;
          }
        }
        processedItems += 1;
        updateProgress();
      }
    },

    async moveFolderRecursively(sourcePath, targetPath) {
      const sourceBasePath = ensureTrailingSlash(stripFolderMarker(sourcePath));
      const targetBasePath = ensureTrailingSlash(stripFolderMarker(targetPath));
      const { files, folders } = await this.getFolderTree(sourceBasePath);
      const rootIsEmpty = files.length === 0 && folders.length === 0;
      const folderEntries = [
        { prefix: sourceBasePath, isEmpty: rootIsEmpty },
        ...folders,
      ].sort((a, b) => b.prefix.length - a.prefix.length);
      const totalItems = files.length + folderEntries.length;
      let processedItems = 0;

      const updateProgress = () => {
        this.uploadProgress = totalItems ? (processedItems / totalItems) * 100 : null;
      };

      for (const file of files) {
        const relativePath = getRelativeZipPath(sourceBasePath, file.key);
        await this.copyPaste(file.key, targetBasePath + relativePath);
        await axios.delete(this.getWriteItemUrl(file.key));
        processedItems += 1;
        updateProgress();
      }

      for (const folder of folderEntries) {
        const relativePath =
          folder.prefix === sourceBasePath
            ? ''
            : getRelativeZipPath(sourceBasePath, folder.prefix);
        const sourceMarker = toFolderMarkerKey(folder.prefix);
        const targetMarker = toFolderMarkerKey(`${targetBasePath}${relativePath}`);

        try {
          await this.copyPaste(sourceMarker, targetMarker);
          await axios.delete(this.getWriteItemUrl(sourceMarker));
        } catch (error) {
          if (error.response?.status === 404) {
            if (folder.isEmpty || folder.prefix === sourceBasePath) {
              await axios.put(this.getWriteItemUrl(targetMarker), '');
            }
          } else {
            throw error;
          }
        }

        processedItems += 1;
        updateProgress();
      }
    },
    createFolder() {
      this.showUploadPopup = false;
      this.showInput({
        title: '新建文件夹',
        description: '创建一个新的文件夹',
        placeholder: '请输入文件夹名称',
        hint: '文件夹名称不能包含特殊字符',
        icon: 'folder',
        confirmText: '创建',
        callback: async (folderName) => {
           if (!folderName) return;
           const logId = this.$refs.activityLog?.add('folder', `创建文件夹 "${folderName}"`, 'pending');
           try {
            const uploadUrl = this.getWriteItemUrl(`${this.cwd}${folderName}/_$folder$`);
            await axios.put(uploadUrl, "");
            this.fetchFiles();
            this.$refs.statsCards?.refresh();
            this.$refs.activityLog?.update(logId, 'success', `创建文件夹 "${folderName}" 成功`);
            this.$refs.toast?.success('文件夹创建成功');
          } catch (error) {
            const status = error.response?.status;
            let errorMsg = '创建失败';
            if (status === 401) {
              errorMsg = '请先登录';
            } else if (status === 403) {
              errorMsg = '没有写入权限';
            } else if (error.code === 'ERR_NETWORK' || !error.response) {
              errorMsg = '网络连接异常';
            }
            this.$refs.activityLog?.update(logId, 'error', `创建文件夹 "${folderName}" 失败：${errorMsg}`);
            this.$refs.toast?.error(`创建失败：${errorMsg}`);
            console.log(`Create folder failed`, error);
          }
        }
      });
    },

    async handleRefresh() {
      this.refreshing = true;
      await this.fetchFiles();
      this.$refs.toast?.success('刷新成功');
      this.refreshing = false;
    },

    updateShareCount({ key, count }) {
      this.shareCounts = { ...this.shareCounts, [key]: count };
    },

    async loadShareCounts(files) {
      const credentials = localStorage.getItem('auth_credentials');
      if (!credentials || !files.length) {
        this.shareCounts = {};
        return;
      }

      try {
        const response = await fetch('/api/share/list', {
          headers: { Authorization: `Basic ${credentials}` },
          cache: 'no-store',
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '获取分享状态失败');

        const visibleKeys = new Set(files.map((file) => file.key));
        const counts = {};
        for (const share of data.shares || []) {
          if (visibleKeys.has(share.key)) {
            counts[share.key] = (counts[share.key] || 0) + 1;
          }
        }
        this.shareCounts = counts;
      } catch (error) {
        console.warn('Load share counts error:', error);
        this.shareCounts = {};
      }
    },

    fetchFiles() {
      this.files = [];
      this.folders = [];
      this.loading = true;

      // 构建请求头，包含认证信息
      const headers = {};
      const credentials = localStorage.getItem('auth_credentials');
      if (credentials) {
        headers['Authorization'] = `Basic ${credentials}`;
      }

      return fetch(this.getChildrenUrl(this.cwd), { headers })
        .then((res) => {
          if (!res.ok) throw new Error('获取文件列表失败');
          return res.json();
        })
        .then(async (files) => {
          this.files = files.value || [];
          this.folders = files.folders || [];
          await this.loadShareCounts(this.files);
        })
        .catch((error) => {
          console.error('Fetch files error:', error);
          this.files = [];
          this.folders = [];
        })
        .finally(() => {
          this.loading = false;
        });
    },

    hasDraggedFiles(ev) {
      return Array.from(ev.dataTransfer?.types || []).includes('Files');
    },

    onDragEnter(ev) {
      if (!this.hasDraggedFiles(ev)) return;
      this.dragDepth += 1;
      this.isDraggingFiles = true;
    },

    onDragOver(ev) {
      if (!this.hasDraggedFiles(ev)) return;
      ev.dataTransfer.dropEffect = this.isReadonly ? 'none' : 'copy';
      this.isDraggingFiles = true;
    },

    onDragLeave(ev) {
      if (!this.hasDraggedFiles(ev)) return;
      this.dragDepth = Math.max(0, this.dragDepth - 1);
      if (this.dragDepth === 0) this.isDraggingFiles = false;
    },

    getDroppedFiles(dataTransfer) {
      if (!dataTransfer) return [];
      if (dataTransfer.items?.length) {
        return Array.from(dataTransfer.items)
          .filter((item) => item.kind === 'file')
          .map((item) => item.getAsFile())
          .filter(Boolean);
      }
      return Array.from(dataTransfer.files || []);
    },

    onDrop(ev) {
      this.dragDepth = 0;
      this.isDraggingFiles = false;
      const files = this.getDroppedFiles(ev.dataTransfer);
      if (!files.length) return;
      if (this.isReadonly) {
        this.$refs.toast?.error('当前账号没有上传权限');
        return;
      }
      this.uploadFiles(files);
    },

    onUploadClicked(fileElement) {
      if (!fileElement.value) return;
      this.uploadFiles(fileElement.files);
      this.showUploadPopup = false;
      fileElement.value = null;
    },

    openRemoteImport() {
      this.showUploadPopup = false;
      this.showInput({
        title: '从链接导入',
        description: '将公开文件链接直接保存到当前文件夹',
        placeholder: 'https://example.com/file.zip',
        hint: '仅支持无需登录的 HTTP/HTTPS 直链，单文件最大 200MB。',
        confirmText: '开始导入',
        callback: (url) => this.importFromLink(url),
      });
    },

    async importFromLink(sourceUrl) {
      let parsedUrl;
      try {
        parsedUrl = new URL(sourceUrl);
        if (!['http:', 'https:'].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) {
          throw new Error();
        }
      } catch {
        this.$refs.toast?.error('请输入不含账号密码的 HTTP/HTTPS 直链');
        return;
      }

      this.remoteImporting = true;
      this.uploadProgress = 0;
      const suggestedName = decodeURIComponent(parsedUrl.pathname.split('/').filter(Boolean).pop() || '远程文件');
      const logId = this.$refs.activityLog?.add('upload', `从链接导入 "${suggestedName}"`, 'pending');
      try {
        const response = await fetch('/api/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...this.getAuthHeaders() },
          body: JSON.stringify({ url: sourceUrl.trim(), targetDir: this.cwd || '' }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '从链接导入失败');

        const name = getPathName(data.file.key) || suggestedName;
        this.uploadProgress = 100;
        await this.fetchFiles();
        this.$refs.statsCards?.refresh();
        this.$refs.activityLog?.update(logId, 'success', `从链接导入 "${name}" 成功`);
        this.$refs.toast?.success(`已导入 ${name}`);
      } catch (error) {
        const message = error.message || '从链接导入失败';
        this.$refs.activityLog?.update(logId, 'error', `从链接导入 "${suggestedName}" 失败：${message}`);
        this.$refs.toast?.error(`导入失败：${message}`);
      } finally {
        this.remoteImporting = false;
        this.uploadProgress = null;
      }
    },

    async getTemporaryFileUrl(key) {
      const response = await fetch(`/api/file-access/${encodePathForUrl(key)}`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        cache: 'no-store',
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || `获取文件访问授权失败 (${response.status})`);
      }
      return data.url;
    },

    async preview(file) {
      // 如果传入的是文件对象
      if (typeof file === 'object') {
        this.previewFileName = getPathName(file.key) || '';
        this.previewContentType = file.httpMetadata?.contentType || '';
        this.previewFileKey = file.key || '';

        try {
          if (this.fileBaseUrl) {
            this.previewFileUrl = this.getFileUrl(file.key);
            this.previewFetchUrl = `/raw/${encodePathForUrl(file.key)}`;
          } else {
            const temporaryUrl = await this.getTemporaryFileUrl(file.key);
            this.previewFileUrl = temporaryUrl;
            this.previewFetchUrl = temporaryUrl;
          }
          this.showFilePreview = true;
        } catch (error) {
          this.$refs.toast?.error(error.message || '无法获取文件预览授权');
        }
      } else {
        // 兼容旧的字符串 URL 调用
        this.previewFileUrl = file;
        this.previewFetchUrl = file;
        this.previewFileName = getPathName(file) || '';
        this.previewContentType = '';
        this.previewFileKey = '';
        this.showFilePreview = true;
      }
    },

    isMarkdownFile(file) {
      if (!file || typeof file !== 'object') return false;
      const ext = getFileExtension(file.key);
      return ['md', 'markdown', 'mdown', 'mkd'].includes(ext);
    },

    isEditableTextFile(file) {
      if (!file || typeof file !== 'object' || Number(file.size || 0) > 2 * 1024 * 1024) return false;
      const ext = getFileExtension(file.key);
      const contentType = file.httpMetadata?.contentType || '';
      return contentType.startsWith('text/') || [
        'txt', 'md', 'markdown', 'mdown', 'mkd', 'json', 'json5', 'yaml', 'yml',
        'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'vue', 'css', 'scss', 'sass',
        'html', 'htm', 'xml', 'svg', 'sql', 'py', 'sh', 'bash', 'ini', 'toml', 'log'
      ].includes(ext);
    },

    openMarkdownEditor(fileKey, contentType = '') {
      if (!fileKey) return;
      if (this.isReadonly) {
        this.$refs.toast?.error('只读模式无法编辑');
        return;
      }

      // 访客写入复用上传密码逻辑
      if (this.currentUser?.isGuest && !this.guestUploadPassword) {
        this.showInput({
          title: '访客写入验证',
          description: '请输入上传密码',
          placeholder: '请输入密码',
          hint: '访客写入需要提供密码验证',
          icon: 'folder',
          confirmText: '确认',
          callback: (password) => {
            if (!password) return;
            this.guestUploadPassword = password;
            localStorage.setItem('guest_upload_password', password);
            this.openMarkdownEditor(fileKey, contentType);
          }
        });
        return;
      }

      this.markdownEditorFileKey = fileKey;
      this.markdownEditorContentType = contentType || '';
      this.showMarkdownEditor = true;
    },

    editFocusedText() {
      if (!this.focusedItem || typeof this.focusedItem !== 'object') return;
      this.openMarkdownEditor(this.focusedItem.key, this.focusedItem.httpMetadata?.contentType || '');
      this.showContextMenu = false;
    },

    handlePreviewEdit({ fileKey, contentType }) {
      if (!fileKey) return;
      this.showFilePreview = false;
      this.openMarkdownEditor(fileKey, contentType || '');
    },

    handleMarkdownSaved() {
      this.fetchFiles();
      this.$refs.statsCards?.refresh();
    },

    scheduleUploadQueue() {
      setTimeout(() => this.processUploadQueue());
    },

    async processSingleUploadTask({ basedir, file, resume: taskResume }) {
      const uploadKey = this.getUploadResumeKey(file, basedir);
      const chunkSizeBytes = this.getUploadChunkSizeBytes();
      const resumeInfo = taskResume && taskResume.chunkSize === chunkSizeBytes
        ? taskResume
        : (this.uploadResumeInfo[uploadKey]?.chunkSize === chunkSizeBytes ? this.uploadResumeInfo[uploadKey] : null);
      let thumbnailDigest = null;

      if (file.type.startsWith("image/") || file.type === "video/mp4") {
        try {
           const thumbnailBlob = await generateThumbnail(file);
           const digestHex = await blobDigest(thumbnailBlob);

          const thumbnailUploadUrl = this.getWriteItemUrl(`_$flaredrive$/thumbnails/${digestHex}.png`);
          try {
            await axios.put(thumbnailUploadUrl, thumbnailBlob, {
              headers: { 'Content-Type': 'image/png' }
            });
            thumbnailDigest = digestHex;
          } catch (error) {
            // 缩略图上传失败不影响主文件上传，静默处理
            console.log(`Upload ${digestHex}.png failed`);
          }
        } catch (error) {
          console.log(`Generate thumbnail failed`);
        }
      }

      // 添加上传日志（pending 状态）
      const logId = resumeInfo?.logId || this.$refs.activityLog?.add('upload', `上传 "${file.name}"`, 'pending');
      if (resumeInfo?.logId) {
        const doneParts = Array.isArray(resumeInfo.uploadedParts) ? resumeInfo.uploadedParts.length : 0;
        const totalParts = resumeInfo.totalChunks || Math.ceil(file.size / chunkSizeBytes);
        this.$refs.activityLog?.update(logId, 'pending', `继续上传 "${file.name}" (${doneParts}/${totalParts})`);
      }

      try {
        const uploadUrl = this.getWriteItemUrl(`${basedir}${file.name}`);
        const headers = {};
        let multipartProgress = null;
        if (file.size >= chunkSizeBytes) {
          const totalChunks = Math.ceil(file.size / chunkSizeBytes);
          const partLoaded = {};
          if (resumeInfo?.uploadedParts?.length) {
            for (const part of resumeInfo.uploadedParts) {
              const partSize = this.getMultipartPartSize(
                part.partNumber,
                totalChunks,
                chunkSizeBytes,
                file.size
              );
              partLoaded[part.partNumber] = partSize;
            }
          }
          multipartProgress = { partLoaded, totalChunks };
        }
        const onUploadProgress = (progressEvent) => {
          if (multipartProgress && progressEvent.partNumber) {
            multipartProgress.partLoaded[progressEvent.partNumber] = progressEvent.partLoaded;
            const loaded = Object.values(multipartProgress.partLoaded).reduce(
              (sum, value) => sum + value,
              0
            );
            const percentCompleted = (loaded * 100) / progressEvent.total;
            this.uploadProgress = Math.min(100, Math.max(0, percentCompleted));
            return;
          }
          const percentCompleted =
            (progressEvent.loaded * 100) / progressEvent.total;
          this.uploadProgress = percentCompleted;
        };
        if (thumbnailDigest) headers["fd-thumbnail"] = thumbnailDigest;
        // 访客上传添加密码头
        if (this.currentUser?.isGuest && this.guestUploadPassword) {
          headers["X-Guest-Password"] = this.guestUploadPassword;
        }
        if (file.size >= chunkSizeBytes) {
          await multipartUpload(`${basedir}${file.name}`, file, {
            headers,
            onUploadProgress,
            retries: this.uploadConfig.retries,
            retryDelayMs: 800,
            concurrency: this.uploadConfig.concurrency,
            chunkSize: chunkSizeBytes,
            resume: resumeInfo,
          });
        } else {
          await axios.put(uploadUrl, file, { headers, onUploadProgress });
        }
        if (this.uploadResumeInfo[uploadKey]) {
          delete this.uploadResumeInfo[uploadKey];
          this.persistUploadResumeInfo();
        }
        // 上传成功
        this.$refs.activityLog?.update(logId, 'success', `上传 "${file.name}" 成功`);
        this.$refs.toast?.success(`"${file.name}" 上传成功`);
      } catch (error) {
        if (error?.isMultipartUpload) {
          const uploadedParts = Array.isArray(error.uploadedParts) ? error.uploadedParts : [];
          const totalChunks = error.totalChunks || Math.ceil(file.size / chunkSizeBytes);
          this.uploadResumeInfo[uploadKey] = {
            uploadId: error.uploadId,
            uploadedParts,
            totalChunks,
            logId,
            chunkSize: chunkSizeBytes,
            updatedAt: Date.now(),
            fileName: file.name,
            fileSize: file.size,
            lastModified: file.lastModified,
          };
          this.persistUploadResumeInfo();

          const doneCount = uploadedParts.length;
          const message = `上传 "${file.name}" 失败：网络波动（已完成 ${doneCount}/${totalChunks}）`;
          this.$refs.activityLog?.update(logId, 'error', message);
          this.$refs.toast?.error(`"${file.name}" 上传中断，可续传`);

          this.showConfirm({
            title: '上传中断',
            message: `"${file.name}" 已完成 ${doneCount}/${totalChunks}，是否继续上传？`,
            confirmText: '继续上传',
            cancelText: '稍后',
            type: 'warning',
            callback: () => {
              this.uploadQueue.unshift({ basedir, file, resume: this.uploadResumeInfo[uploadKey] });
              this.scheduleUploadQueue();
            }
          });
          return;
        }
        const status = error.response?.status;
        const fileName = file.name;
        let errorMsg = '';

        // 根据不同错误类型给出针对性提示
        if (status === 401) {
          if (this.currentUser?.isGuest) {
            this.guestUploadPassword = '';
            localStorage.removeItem('guest_upload_password');
            errorMsg = '上传密码错误';
          } else {
            errorMsg = '登录已过期，请重新登录';
          }
        } else if (status === 403) {
          errorMsg = '没有写入权限';
        } else if (status === 404) {
          errorMsg = '上传接口不存在';
        } else if (status === 413) {
          errorMsg = '文件超出大小限制';
        } else if (status === 507) {
          errorMsg = '存储空间不足';
        } else if (error.code === 'ERR_NETWORK' || !error.response) {
          errorMsg = '网络连接异常';
        } else {
          errorMsg = error.response?.data?.error || '服务器错误';
        }

        // 更新日志为失败状态
        this.$refs.activityLog?.update(logId, 'error', `上传 "${fileName}" 失败：${errorMsg}`);
        this.$refs.toast?.error(`"${fileName}" 上传失败：${errorMsg}`);
        console.log(`Upload ${file.name} failed`, error);
      }
    },

    async processUploadQueue() {
      if (this.isProcessingUploadQueue) return;

      this.isProcessingUploadQueue = true;
      try {
        while (this.uploadQueue.length) {
          const task = this.uploadQueue.shift();
          if (!task) continue;
          await this.processSingleUploadTask(task);
        }
      } finally {
        this.isProcessingUploadQueue = false;
        this.uploadProgress = null;
        if (!this.uploadQueue.length) {
          this.fetchFiles();
          this.$refs.statsCards?.refresh();
        }
      }
    },

    async removeFile(key) {
      const fileName = getPathName(key);
      this.showContextMenu = false;

      this.showConfirm({
        title: '确认删除',
        message: `确定要删除 "${fileName}" 吗？`,
        confirmText: '删除',
        type: 'danger',
        callback: async () => {
          const logId = this.$refs.activityLog?.add('delete', `删除 "${fileName}"`, 'pending');
          try {
            if (isFolderMarker(key)) {
              await this.deleteFolderRecursively(key);
            } else {
              await axios.delete(this.getWriteItemUrl(key));
            }
            this.fetchFiles();
            this.$refs.statsCards?.refresh();
            this.$refs.activityLog?.update(logId, 'success', `删除 "${fileName}" 成功`);
            this.$refs.toast?.success('删除成功');
          } catch (error) {
            console.error('Delete failed:', error);
            this.$refs.activityLog?.update(logId, 'error', `删除 "${fileName}" 失败`);
            this.$refs.toast?.error('删除失败');
          } finally {
            this.uploadProgress = null;
          }
        }
      });
    },
    async moveShares(oldKey, newKey) {
      if (!oldKey || !newKey || oldKey === newKey) return;
      try {
        await fetch('/api/share/move', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...this.getAuthHeaders() },
          body: JSON.stringify({ oldKey, newKey }),
        });
      } catch (error) {
        console.warn('Share links were not migrated:', error);
      }
    },

    renameFile(key) {
      const currentName = getPathName(key);
      this.showContextMenu = false;
      this.showInput({
        title: '重命名',
        description: `将 "${currentName}" 重命名为`,
        placeholder: '请输入新名称',
        defaultValue: currentName,
        icon: 'rename',
        confirmText: '重命名',
        callback: async (newName) => {
          if (!newName || newName === currentName) return;
          const logId = this.$refs.activityLog?.add('rename', `重命名 "${currentName}" → "${newName}"`, 'pending');
          try {
            await this.copyPaste(key, `${this.cwd}${newName}`);
            await axios.delete(this.getWriteItemUrl(key));
            await this.moveShares(key, `${this.cwd}${newName}`);
            this.fetchFiles();
            this.$refs.activityLog?.update(logId, 'success', `重命名 "${currentName}" → "${newName}" 成功`);
          } catch (error) {
            console.error('Rename failed:', error);
            this.$refs.activityLog?.update(logId, 'error', `重命名 "${currentName}" 失败`);
            this.$refs.toast?.error('重命名失败');
          }
        }
      });
    },

    renameFolder(folderPath) {
      // folderPath 格式: "path/to/folder/" 或 "folder/"
      // 规范化路径：确保以 / 结尾
      const normalizedPath = ensureTrailingSlash(folderPath);
      const pathParts = normalizedPath.replace(/\/$/, '').split('/');
      const currentName = pathParts.pop();
      const parentPath = pathParts.length > 0 ? pathParts.join('/') + '/' : '';

      this.showContextMenu = false;
      this.showInput({
        title: '重命名文件夹',
        description: `将 "${currentName}" 重命名为`,
        placeholder: '请输入新名称',
        defaultValue: currentName,
        icon: 'rename',
        confirmText: '重命名',
        callback: async (newName) => {
          if (!newName || newName === currentName) return;

          // 检查名称是否包含非法字符
          if (newName.includes('/') || newName.includes('\\')) {
            this.$refs.toast?.error('文件夹名称不能包含 / 或 \\');
            return;
          }

          try {
            const sourcePath = normalizedPath;
            const targetPath = parentPath + newName + '/';
            await this.moveFolderRecursively(sourcePath, targetPath);
            await this.moveShares(sourcePath, targetPath);
            this.uploadProgress = null;

            this.$refs.toast?.success('文件夹重命名成功');
            this.fetchFiles();
          } catch (error) {
            console.error('重命名文件夹失败:', error);
            this.uploadProgress = null;
            this.$refs.toast?.error('重命名文件夹失败，请重试');
          }
        }
      });
    },
    moveFile(key) {
      const fileName = getPathName(key);
      const displayName = fileName;
      this.showContextMenu = false;

      this.showInput({
        title: '移动文件',
        description: `将 "${displayName}" 移动到`,
        placeholder: '请输入目标路径',
        hint: '留空表示移动到根目录',
        defaultValue: '',
        icon: 'move',
        confirmText: '移动',
        callback: async (targetPath) => {
          const normalizedPath = targetPath === '' ? '' : ensureTrailingSlash(targetPath);
          const finalFileName = fileName;

          try {
            if (isFolderMarker(key)) {
              const sourceBasePath = ensureTrailingSlash(stripFolderMarker(key));
              const targetBasePath = `${normalizedPath}${finalFileName}/`;
              if (sourceBasePath === targetBasePath) {
                return;
              }
              await this.moveFolderRecursively(sourceBasePath, targetBasePath);
              await this.moveShares(sourceBasePath, targetBasePath);
            } else {
              const targetFilePath = normalizedPath + finalFileName;
              if (targetFilePath === key) {
                return;
              }
              await this.copyPaste(key, targetFilePath);
              await axios.delete(this.getWriteItemUrl(key));
              await this.moveShares(key, targetFilePath);
            }

            this.fetchFiles();
          } catch (error) {
            console.error('移动失败:', error);
            this.$refs.toast?.error('移动失败，请检查目标路径是否正确');
          } finally {
            this.uploadProgress = null;
          }
        }
      });
    },
    async downloadFolder(folderPath) {
      if (typeof JSZip === 'undefined') {
        this.$refs.toast?.error('文件夹下载需要 JSZip 库支持');
        return;
      }

      this.showContextMenu = false;
      this.batchLoading = true;

      const folderName = getPathName(folderPath) || 'folder';
      const logId = this.$refs.activityLog?.add('download', `下载文件夹 "${folderName}"`, 'pending');

      try {
        const zip = new JSZip();
        const items = await this.getAllItems(folderPath);
        const summary = summarizeDownloadItems(items);
        const limitMessage = getFolderDownloadLimitMessage(summary, FOLDER_DOWNLOAD_LIMITS);
        if (limitMessage) {
          throw new Error(limitMessage);
        }

        for (const item of items) {
          if (!item.key.endsWith('_$folder$')) {
            const blob = await this.fetchFileBlob(item.key);
            const relativePath = getRelativeZipPath(folderPath, item.key);
            zip.file(relativePath, blob);
          }
        }

        const content = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(content);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${folderName}.zip`;
        a.click();
        URL.revokeObjectURL(url);
        this.$refs.activityLog?.update(logId, 'success', `下载文件夹 "${folderName}" 成功`);
      } catch (error) {
        console.error('Download folder failed:', error);
        this.$refs.activityLog?.update(logId, 'error', `下载文件夹 "${folderName}" 失败`);
        this.$refs.toast?.error(error?.message || '文件夹下载失败');
      } finally {
        this.batchLoading = false;
      }
    },

    async getFolderTree(prefix) {
      return fetchFolderTreeRecursively({
        prefix: stripFolderMarker(prefix),
        buildChildrenUrl: (currentPrefix) => this.getChildrenUrl(currentPrefix),
        getHeaders: () => this.getAuthHeaders(),
        concurrency: FOLDER_DOWNLOAD_LIMITS.concurrency,
      });
    },

    async getAllItems(prefix) {
      return fetchAllItemsRecursively({
        prefix: stripFolderMarker(prefix),
        buildChildrenUrl: (currentPrefix) => this.getChildrenUrl(currentPrefix),
        getHeaders: () => this.getAuthHeaders(),
        concurrency: FOLDER_DOWNLOAD_LIMITS.concurrency,
      });
    },
    uploadFiles(files) {
      if (this.cwd) this.cwd = ensureTrailingSlash(this.cwd);

      // 访客上传需要验证密码
      if (this.currentUser?.isGuest && !this.guestUploadPassword) {
        this.showInput({
          title: '访客上传验证',
          description: '请输入上传密码',
          placeholder: '请输入密码',
          hint: '访客上传需要提供密码验证',
          icon: 'folder',
          confirmText: '确认',
          callback: (password) => {
            if (password) {
              this.guestUploadPassword = password;
              localStorage.setItem('guest_upload_password', password);
              this.doUploadFiles(files);
            }
          }
        });
        return;
      }

      this.doUploadFiles(files);
    },

    doUploadFiles(files) {
      const uploadTasks = Array.from(files).map((file) => ({
        basedir: this.cwd,
        file,
      }));
      uploadTasks.forEach((task) => {
        const resume = this.getResumeInfoForFile(task.file, task.basedir);
        if (resume && !this.uploadConfig.autoResume) {
          this.showConfirm({
            title: '检测到未完成上传',
            message: `"${task.file.name}" 有未完成上传，是否继续？`,
            confirmText: '继续上传',
            cancelText: '重新开始',
            type: 'info',
            callback: () => {
              this.enqueueUploadTask({ ...task, resume });
            },
            cancelCallback: () => {
              this.clearUploadResumeInfo(task.file, task.basedir);
              this.enqueueUploadTask(task);
            },
          });
        } else {
          this.enqueueUploadTask({ ...task, resume });
        }
      });
    },

    getUploadResumeKey(file, basedir) {
      const safeBase = basedir || '';
      return `${safeBase}${file.name}:${file.size}:${file.lastModified}`;
    },

    getUploadChunkSizeBytes() {
      const size = Number(this.uploadConfig.chunkSizeMb) || 80;
      return Math.max(20, size) * 1024 * 1024;
    },

    getMultipartPartSize(partNumber, totalChunks, chunkSize, fileSize) {
      if (partNumber === totalChunks) {
        return fileSize - chunkSize * (totalChunks - 1);
      }
      return chunkSize;
    },

    getResumeInfoForFile(file, basedir) {
      const key = this.getUploadResumeKey(file, basedir);
      const chunkSizeBytes = this.getUploadChunkSizeBytes();
      const resumeInfo = this.uploadResumeInfo[key];
      if (!resumeInfo || resumeInfo.chunkSize !== chunkSizeBytes) return null;
      if (this.isResumeInfoExpired(resumeInfo)) {
        delete this.uploadResumeInfo[key];
        this.persistUploadResumeInfo();
        return null;
      }
      return resumeInfo;
    },

    enqueueUploadTask(task) {
      this.uploadQueue.push(task);
      this.scheduleUploadQueue();
    },

    clearUploadResumeInfo(file, basedir) {
      const key = this.getUploadResumeKey(file, basedir);
      if (this.uploadResumeInfo[key]) {
        delete this.uploadResumeInfo[key];
        this.persistUploadResumeInfo();
      }
    },

    removeResumeRecord(key) {
      if (this.uploadResumeInfo[key]) {
        delete this.uploadResumeInfo[key];
        this.persistUploadResumeInfo();
      }
    },

    resumeUploadFromSettings(item) {
      this.showUploadSettings = false;
      this.showUploadPopup = true;
      this.$refs.toast?.info?.('请选择相同文件以继续上传');
    },

    isResumeInfoExpired(resumeInfo) {
      const maxAgeMs = 48 * 60 * 60 * 1000;
      const updatedAt = resumeInfo.updatedAt || 0;
      return Date.now() - updatedAt > maxAgeMs;
    },

    persistUploadResumeInfo() {
      try {
        const data = Object.fromEntries(
          Object.entries(this.uploadResumeInfo).map(([key, info]) => {
            const { uploadId, uploadedParts, totalChunks, chunkSize, updatedAt, fileName, fileSize, lastModified } = info;
            return [key, { uploadId, uploadedParts, totalChunks, chunkSize, updatedAt, fileName, fileSize, lastModified }];
          })
        );
        localStorage.setItem('upload_resume_info', JSON.stringify(data));
      } catch (error) {
        console.log('Upload resume info save failed');
      }
    },

    loadUploadResumeInfo() {
      const saved = localStorage.getItem('upload_resume_info');
      if (!saved) return;
      try {
        const parsed = JSON.parse(saved);
        if (!parsed || typeof parsed !== 'object') return;
        this.uploadResumeInfo = parsed;
        this.pruneUploadResumeInfo();
      } catch (error) {
        console.log('Upload resume info parse failed');
      }
    },

    pruneUploadResumeInfo() {
      const next = {};
      for (const [key, info] of Object.entries(this.uploadResumeInfo || {})) {
        if (!this.isResumeInfoExpired(info)) {
          next[key] = info;
        }
      }
      this.uploadResumeInfo = next;
      this.persistUploadResumeInfo();
    },

    updateUploadConfig(config) {
      this.uploadConfig = this.normalizeUploadConfig({ ...this.uploadConfig, ...config });
      localStorage.setItem('upload_config', JSON.stringify(this.uploadConfig));
    },

    normalizeUploadConfig(config) {
      const chunkSizeMb = Math.min(100, Math.max(20, Number(config.chunkSizeMb) || 80));
      const concurrency = Math.min(4, Math.max(1, Number(config.concurrency) || 3));
      const retries = Math.min(5, Math.max(0, Number(config.retries) || 3));
      const autoResume = Boolean(config.autoResume);
      return { chunkSizeMb, concurrency, retries, autoResume };
    },

    openUploadSettings() {
      this.uploadSettingsDraft = { ...this.uploadConfig };
      this.showUploadSettings = true;
    },

    saveUploadSettings() {
      this.updateUploadConfig(this.uploadSettingsDraft);
      this.showUploadSettings = false;
      this.$refs.toast?.success('上传参数已更新');
    },

    resetUploadSettings() {
      this.uploadSettingsDraft = { chunkSizeMb: 80, concurrency: 3, retries: 3, autoResume: false };
    },

  },

  watch: {
    cwd: {
      handler() {
        this.fetchFiles();
        const url = new URL(window.location);
        if ((url.searchParams.get("p") || "") !== this.cwd) {
          this.cwd
            ? url.searchParams.set("p", this.cwd)
            : url.searchParams.delete("p");
          window.history.pushState(null, "", url.toString());
        }
        document.title = `${
          this.cwd.replace(/.*\/(?!$)|\//g, "") || "/"
        } - StaroDrive`;
      },
      immediate: true,
    },
    viewMode(val) {
      localStorage.setItem('viewMode', val);
    },
  },

  created() {
    // Apply theme on load
    document.documentElement.setAttribute('data-theme', this.theme);

    // Load config (file base URL for CDN)
    this.loadConfig();

    const savedUploadConfig = localStorage.getItem('upload_config');
    if (savedUploadConfig) {
      try {
        const parsed = JSON.parse(savedUploadConfig);
        this.uploadConfig = this.normalizeUploadConfig({ ...this.uploadConfig, ...parsed });
      } catch (error) {
        console.log('Upload config parse failed');
      }
    }

    this.loadUploadResumeInfo();

    // Restore auth state, show login if not restored
    const restored = this.restoreAuth();
    if (!restored) {
      this.showLoginDialog = true;
    }

    // Handle browser back/forward
    window.addEventListener("popstate", (ev) => {
      const searchParams = new URL(window.location).searchParams;
      if (searchParams.get("p") !== this.cwd)
        this.cwd = searchParams.get("p") || "";
    });

    // Handle system theme preference
    if (!localStorage.getItem('theme')) {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      this.theme = prefersDark ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', this.theme);
    }
  },

  components: {
    Dialog,
    Header,
    StatsCards,
    Breadcrumb,
    Toolbar,
    FileCard,
    BatchBar,
    UploadPopup,
    LoginDialog,
    ShareDialog,
    ShareListDialog,
    AdminTools,
    ApiKeyDialog,
    InputDialog,
    ConfirmDialog,
    Toast,
    FilePreview,
    MarkdownEditor,
    ActivityLog,
  },
};
</script>

<style>
/* Drag Upload */
.app-container.drag-active {
  cursor: copy;
}

.drag-upload-overlay {
  position: fixed;
  inset: 0;
  z-index: 9000;
  display: grid;
  place-items: center;
  padding: 24px;
  background: rgba(15, 23, 42, 0.18);
  backdrop-filter: blur(3px);
  pointer-events: none;
}

.drag-upload-card {
  width: min(420px, 100%);
  padding: 28px;
  border: 2px dashed rgba(243, 128, 32, 0.75);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 24px 60px rgba(15, 23, 42, 0.18);
  color: var(--text-primary);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  text-align: center;
}

.drag-upload-card svg {
  width: 48px;
  height: 48px;
  color: var(--primary-color);
}

.drag-upload-card strong {
  font-size: 18px;
}

.drag-upload-card span {
  max-width: 100%;
  color: var(--text-muted);
  font-size: 13px;
  overflow-wrap: anywhere;
}

[data-theme="dark"] .drag-upload-card {
  background: rgba(30, 41, 59, 0.94);
}

/* Context Menu Styles */
.context-menu {
  background: var(--card-bg);
  border-radius: var(--radius-lg);
  overflow: hidden;
  min-width: 220px;
}

.context-menu-header {
  padding: 14px 16px;
  background: var(--primary-gradient);
  color: white;
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.context-menu-body {
  padding: 8px;
}

.context-menu-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 12px;
  font-size: 14px;
  color: var(--text-primary);
  border-radius: var(--radius-md);
  transition: var(--transition);
  background: none;
  border: none;
  cursor: pointer;
  text-decoration: none;
}

.context-menu-item:hover {
  background: var(--hover-bg);
}

.context-menu-item.danger {
  color: var(--error-color);
}

/* Upload Settings Dialog */
.upload-settings-dialog {
  width: min(520px, 100%);
  background: var(--card-bg);
}

.upload-settings-header {
  padding: 20px 24px 16px;
  border-bottom: 1px solid var(--divider-color);
}

.upload-settings-header h3 {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 6px;
}

.upload-settings-header p {
  font-size: 13px;
  color: var(--text-muted);
}

.upload-settings-body {
  padding: 20px 24px;
  display: grid;
  gap: 14px;
}

.upload-settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 14px;
  color: var(--text-secondary);
}

.upload-settings-toggle {
  padding-top: 8px;
  border-top: 1px dashed var(--divider-color);
}

.upload-settings-toggle input[type="checkbox"] {
  width: 18px;
  height: 18px;
}

.upload-settings-resume {
  border-top: 1px dashed var(--divider-color);
  padding-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.upload-settings-resume-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
}

.upload-settings-resume-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.upload-settings-resume-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-secondary);
}

.upload-settings-resume-info {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.upload-settings-resume-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.upload-settings-resume-meta {
  font-size: 12px;
  color: var(--text-muted);
}

.upload-settings-resume-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.upload-settings-select {
  min-width: 140px;
  padding: 8px 12px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-color);
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 14px;
}

.upload-settings-footer {
  padding: 16px 24px 20px;
  border-top: 1px solid var(--divider-color);
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.upload-settings-actions {
  display: flex;
  gap: 10px;
}

.upload-settings-btn {
  padding: 8px 16px;
  border-radius: var(--radius-md);
  font-size: 14px;
  font-weight: 500;
  transition: var(--transition);
}

.upload-settings-btn.primary {
  background: var(--primary-gradient);
  color: white;
}

.upload-settings-btn.primary:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-md);
}

.upload-settings-btn.secondary {
  background: var(--hover-bg);
  color: var(--text-secondary);
}

.upload-settings-btn.secondary:hover {
  background: var(--bg-secondary);
}

.upload-settings-btn.ghost {
  color: var(--text-secondary);
}

.upload-settings-btn.ghost:hover {
  color: var(--text-primary);
  background: var(--hover-bg);
}

@media (max-width: 640px) {
  .upload-settings-header,
  .upload-settings-body,
  .upload-settings-footer {
    padding-left: 16px;
    padding-right: 16px;
  }

  .upload-settings-row {
    flex-direction: column;
    align-items: flex-start;
  }

  .upload-settings-select {
    width: 100%;
  }

  .upload-settings-footer {
    flex-direction: column;
    align-items: stretch;
  }

  .upload-settings-actions {
    width: 100%;
    justify-content: flex-end;
  }
}

.context-menu-item svg {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}
</style>
