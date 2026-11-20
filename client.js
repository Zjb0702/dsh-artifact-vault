// Artifact Vault — client half.
//
// A sidebar panel ("产物管家") listing every session's artifacts with version
// grouping, plus a per-session header shortcut and storage/duplicate tooling
// backed by the same-origin routes in index.js.
window.__ModuleLoader__.load({
  id: 'dsh-artifact-vault',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useMemo, useCallback, useRef } = React

    const NS = 'artifact-vault'
    const PANEL_ID = 'artifact-vault'
    const BASE = 'api/dsh-artifact-vault'

    let localeService = null

    // ---------------------------------------------------------------- i18n
    const DICT = {
      zh: {
        'entry.label': '产物管家',
        'entry.tip': '产物管家：按会话归档的产物',
        'peek.label': '查看本会话产物',
        'title': '产物管家',
        'subtitle': '按会话归档 · 版本排序 · 磁盘管理',
        'tab.sessions': '会话',
        'tab.untracked': '未归类',
        'tab.storage': '存储',
        'tab.duplicates': '重复',
        'action.scan': '扫描更新',
        'action.scanning': '扫描中 {done}/{total}',
        'action.refresh': '刷新尺寸',
        'action.select': '查看',
        'action.back': '返回会话列表',
        'action.copy': '复制路径',
        'action.copied': '已复制路径',
        'action.download': '下载',
        'action.trash': '回收',
        'action.trashed': '已移入回收站',
        'action.restore': '还原',
        'action.restored': '已还原',
        'action.purge': '彻底删除',
        'action.purged': '已彻底删除',
        'action.purgeAll': '清空回收站',
        'action.declare': '标注',
        'action.save': '保存',
        'action.cancel': '取消',
        'action.reveal': '刷新',
        'action.copyFolder': '复制文件夹路径',
        'action.adopt': '启用会话工作区',
        'action.adopted': '已启用会话工作区',
        'action.adoptAll': '为全部会话启用工作区',
        'action.clean': '清理',
        'action.cleaned': '已清理 {n} 个文件（{size}）',
        'area.tools': '工具脚本',
        'area.artifacts': '产物',
        'area.loose': '散落文件',
        'area.outside': '工作区外',
        'meta.id': '会话 ID',
        'meta.folder': '工作区文件夹',
        'meta.toolsBytes': '工具占用',
        'meta.artifactsBytes': '产物占用',
        'storage.priority': '清理优先级',
        'storage.priorityHint': '先清理运行期脚本，再清理产物；清理文件不会删除会话记忆（会话记录）本身。',
        'storage.toolsCard': '① 工具脚本',
        'storage.artifactsCard': '② 产物',
        'storage.looseCard': '③ 散落文件',
        'storage.adoptCard': '会话工作区',
        'storage.adoptHint': '给已有会话补建 sessions/<日期>-<ID>/{tools,artifacts} 文件夹；进行中的会话在详情页单独启用。',
        'confirm.cleanArea': '把本会话「{area}」里的文件移入回收站？',
        'confirm.cleanToolsAll': '把全部会话工作区里的工具脚本移入回收站？',
        'confirm.cleanArtifactsAll': '把全部会话工作区里的产物移入回收站？（请先清理工具脚本）',
        'confirm.cleanLooseAll': '把全部会话工作区根目录下的散落文件移入回收站？',
        'trash.folder': '会话文件夹',
        'action.trashFolder': '删除文件夹',
        'action.expand': '展开',
        'action.collapse': '收起',
        'confirm.trash': '把 {name} 移入回收站？文件会从原位置移走。',
        'trash.missing': '暂存文件已丢失',
        'trash.empty2': '回收站是空的。被回收的文件与文件夹会显示在这里，可还原或彻底删除。',
        'trash.subtitle': '回收项按时间倒序排列；同盘暂存不占用 C 盘空间。',
        'cdrive.title': 'C 盘占用分析',
        'cdrive.hint': 'DSH 装在 D 盘，但数据目录 ~/.dsh 在 C 盘。会话日志、插件缓存、投影缓存都会随使用增长。',
        'cdrive.home': '数据目录',
        'cdrive.category': '占用分类',
        'cdrive.reclaimable': '可安全释放',
        'cdrive.plan': '清理计划',
        'cdrive.impact': '影响范围',
        'cdrive.scan': '重新分析',
        'cdrive.clean': '清理所选',
        'cdrive.selected': '已选 {n} 项 · 可释放 {size}',
        'cdrive.confirm': '按所选计划清理？清理后不可撤销，请确认未包含仍在使用的数据。',
        'cdrive.done': '已释放 {size}',
        'cdrive.sessionlog': '已删除会话的日志（会话已不存在于任何记录）',
        'cdrive.cache': '可重新下载 / 可重建的缓存',
        'cdrive.note': '不会删除工作区产物、工具脚本或仍在使用的会话数据。',
        'cdrive.notC': '当前 DSH 数据目录不在 C 盘，无需清理 C 盘。',
        'adopt.hint': '本会话尚未启用独立工作区；启用后新写入的文件会落到 sessions/<日期>-<ID>/ 下。',
        'badge.wantFolder': '待启用',
        'stat.sessions': '会话',
        'stat.artifacts': '产物',
        'stat.bytes': '占用空间',
        'stat.missing': '文件缺失',
        'stat.trash': '回收站',
        'stat.wasted': '可回收重复',
        'search.sessions': '搜索会话标题、路径或 ID…',
        'sort.recent': '最近活动',
        'sort.bytes': '文件大小',
        'sort.mtime': '修改时间',
        'sort.sessionBytes': '会话占用',
        'sort.name': '名称',
        'sort.dir': '降序',
        'sort.asc': '升序',
        'sort.artifacts': '产物最多',
        'sort.label': '排序',
        'empty.sessions': '还没有索引到产物。点击「扫描更新」读取会话记录。',
        'empty.detail': '这个会话的记录里没有可识别的产物路径。',
        'empty.untracked': '所有文件都已归属到某个会话。',
        'empty.duplicates': '没有发现内容完全相同的文件。',
        'empty.trash': '回收站是空的。',
        'badge.declared': '已标注',
        'badge.manual': '手工',
        'badge.inferred': '推断',
        'badge.missing': '已缺失',
        'badge.modified': '后续修改',
        'badge.live': '进行中',
        'badge.error': '读取失败',
        'meta.versions': '版本',
        'meta.artifacts': '产物',
        'meta.size': '大小',
        'meta.subagents': '子代理',
        'meta.turns': '轮次',
        'meta.updated': '更新',
        'meta.cwd': '工作目录',
        'meta.trashSize': '回收站占用',
        'meta.wasted': '浪费',
        'meta.files': '文件',
        'meta.groups': '组',
        'meta.hashed': '已校验 {n} 个文件',
        'meta.sessions': '{n} 个会话',
        'detail.groups': '产物（按版本分组）',
        'detail.noVersion': '尚未编号',
        'untracked.title': '未归类文件',
        'untracked.hint': '这些文件不来自任何已记录的会话写入（可能是手动创建，或更早的历史文件）。按文件夹分组，可整夹删除或勾选批量删除。',
        'untracked.files': '个文件',
        'untracked.search': '搜索文件夹名…',
        'untracked.selectAll': '全选本组',
        'untracked.selected': '已选 {n} 个文件 · {size}',
        'sort.files': '文件数',
        'action.clear': '清除选择',
        'action.trashSelected': '删除所选',
        'action.trashedFolder': '已删除文件夹（{n} 个文件）',
        'action.trashedMany': '已删除 {n} 个文件（{size}）{failed}',
        'action.trashedFailed': '，{n} 个失败',
        'confirm.trashSelected': '把所选的 {n} 个文件移入回收站？',
        'confirm.trashFolder': '把文件夹「{name}」整体移入回收站？含 {n} 个文件、{size}，可整体还原。',
        'trash.title': '回收站',
        'trash.hint': '产物回收只移动文件、不删除内容；还原时若原路径已存在会拒绝。',
        'dup.title': '重复文件',
        'dup.hint': '按大小初筛后用 SHA-256 校验内容，完全一致的才算重复。',
        'dup.includeUntracked': '包含未归类文件',
        'loading': '加载中…',
        'error.prefix': '出错了',
        'retry': '重试',
        'confirm.purge': '彻底删除这个文件？无法恢复。',
        'confirm.purgeAll': '彻底清空回收站？无法恢复。',
        'note.scanning': '正在读取会话记录…',
        'label.placeholder': '给这个版本起个名字，例如「客户版」',
        'count.of': '共 {n}',
        'session.unnamed': '（未命名会话）',
        'session.root': '根会话',
        'subagent.of': '子代理于 {name}',
        'group.versions': '{n} 个版本',
        'file.unknownSize': '大小未知',
        'footer.dataDir': '索引位置',
      },
      en: {
        'entry.label': 'Artifact Vault',
        'entry.tip': 'Artifact Vault: artifacts grouped by session',
        'peek.label': 'View this session\'s artifacts',
        'title': 'Artifact Vault',
        'subtitle': 'Grouped by session · versioned · disk-aware',
        'tab.sessions': 'Sessions',
        'tab.untracked': 'Untracked',
        'tab.storage': 'Storage',
        'tab.duplicates': 'Duplicates',
        'action.scan': 'Scan now',
        'action.scanning': 'Scanning {done}/{total}',
        'action.refresh': 'Refresh sizes',
        'action.select': 'Open',
        'action.back': 'Back to sessions',
        'action.copy': 'Copy path',
        'action.copied': 'Path copied',
        'action.download': 'Download',
        'action.trash': 'Recycle',
        'action.trashed': 'Moved to recycle bin',
        'action.restore': 'Restore',
        'action.restored': 'Restored',
        'action.purge': 'Delete forever',
        'action.purged': 'Deleted forever',
        'action.purgeAll': 'Empty recycle bin',
        'action.declare': 'Label',
        'action.save': 'Save',
        'action.cancel': 'Cancel',
        'action.reveal': 'Refresh',
        'action.copyFolder': 'Copy folder path',
        'action.adopt': 'Enable session workspace',
        'action.adopted': 'Session workspace enabled',
        'action.adoptAll': 'Enable workspaces for all sessions',
        'action.clean': 'Clean',
        'action.cleaned': 'Cleaned {n} files ({size})',
        'area.tools': 'Tool scripts',
        'area.artifacts': 'Artifacts',
        'area.loose': 'Loose files',
        'area.outside': 'Outside workspace',
        'meta.id': 'session id',
        'meta.folder': 'workspace folder',
        'meta.toolsBytes': 'tools',
        'meta.artifactsBytes': 'artifacts',
        'storage.priority': 'Cleanup priority',
        'storage.priorityHint': 'Throwaway scripts go first, deliverables second; cleaning files never deletes the session memory itself.',
        'storage.toolsCard': '① Tool scripts',
        'storage.artifactsCard': '② Artifacts',
        'storage.looseCard': '③ Loose files',
        'storage.adoptCard': 'Session workspaces',
        'storage.adoptHint': 'Backfills sessions/<date>-<id>/{tools,artifacts} for existing sessions; a live session can enable its own from the detail page.',
        'confirm.cleanArea': 'Move the files in this session\'s "{area}" to the recycle bin?',
        'confirm.cleanToolsAll': 'Move every session\'s tool scripts to the recycle bin?',
        'confirm.cleanArtifactsAll': 'Move every session\'s artifacts to the recycle bin? (Clean tool scripts first.)',
        'confirm.cleanLooseAll': 'Move every loose file at the session workspace root to the recycle bin?',
        'trash.folder': 'session folder',
        'action.trashFolder': 'Delete folder',
        'action.expand': 'Expand',
        'action.collapse': 'Collapse',
        'trash.missing': 'staged file missing',
        'trash.empty2': 'The recycle bin is empty. Recycled files and folders appear here, ready to restore or delete forever.',
        'trash.subtitle': 'Items are ordered by time; same-drive staging uses no C-drive space.',
        'cdrive.title': 'C-drive usage',
        'cdrive.hint': 'DSH is installed on D:, but its home ~/.dsh lives on C:. Session logs, plugin caches and projection caches grow with use.',
        'cdrive.home': 'Data directory',
        'cdrive.category': 'Usage by category',
        'cdrive.reclaimable': 'Safe to reclaim',
        'cdrive.plan': 'Cleanup plan',
        'cdrive.impact': 'Impact',
        'cdrive.scan': 'Re-analyze',
        'cdrive.clean': 'Clean selected',
        'cdrive.selected': '{n} selected · {size} reclaimable',
        'cdrive.confirm': 'Clean the selected plan? This cannot be undone; make sure no in-use data is included.',
        'cdrive.done': 'Freed {size}',
        'cdrive.sessionlog': 'Logs of deleted sessions (not present in any record)',
        'cdrive.cache': 'Re-downloadable / rebuildable caches',
        'cdrive.note': 'Never touches workspace artifacts, tool scripts, or live session data.',
        'cdrive.notC': 'The DSH home is not on C:; no C-drive cleanup needed.',
        'adopt.hint': 'This session has no workspace folder yet; enabling it sends new writes to sessions/<date>-<id>/.',
        'badge.wantFolder': 'pending',
        'stat.sessions': 'Sessions',
        'stat.artifacts': 'Artifacts',
        'stat.bytes': 'On disk',
        'stat.missing': 'Missing',
        'stat.trash': 'Recycle bin',
        'stat.wasted': 'Reclaimable',
        'search.sessions': 'Search session title, path or id…',
        'sort.recent': 'Recent',
        'sort.bytes': 'File size',
        'sort.mtime': 'Modified time',
        'sort.sessionBytes': 'Session usage',
        'sort.name': 'Name',
        'sort.dir': 'Descending',
        'sort.asc': 'Ascending',
        'sort.artifacts': 'Most files',
        'sort.label': 'Sort',
        'empty.sessions': 'Nothing indexed yet. Press "Scan now" to read session logs.',
        'empty.detail': 'No recognizable artifact paths in this session\'s log.',
        'empty.untracked': 'Every file belongs to a session.',
        'empty.duplicates': 'No byte-identical files found.',
        'empty.trash': 'The recycle bin is empty.',
        'badge.declared': 'declared',
        'badge.manual': 'manual',
        'badge.inferred': 'inferred',
        'badge.missing': 'missing',
        'badge.modified': 'edited later',
        'badge.live': 'live',
        'badge.error': 'read failed',
        'meta.versions': 'versions',
        'meta.artifacts': 'artifacts',
        'meta.size': 'size',
        'meta.subagents': 'subagents',
        'meta.turns': 'turns',
        'meta.updated': 'updated',
        'meta.cwd': 'workspace',
        'meta.trashSize': 'Bin size',
        'meta.wasted': 'wasted',
        'meta.files': 'files',
        'meta.groups': 'groups',
        'meta.hashed': 'hashed {n} files',
        'meta.sessions': '{n} sessions',
        'detail.groups': 'Artifacts (grouped by version)',
        'detail.noVersion': 'unnumbered',
        'untracked.title': 'Untracked files',
        'untracked.hint': 'These files never appear in a recorded session write — created by hand, or from an older history. Grouped by folder: delete a whole folder or tick rows to batch-delete.',
        'untracked.files': 'files',
        'untracked.search': 'Search folders…',
        'untracked.selectAll': 'Select all in this group',
        'untracked.selected': '{n} selected · {size}',
        'sort.files': 'File count',
        'action.clear': 'Clear selection',
        'action.trashSelected': 'Delete selected',
        'action.trashedFolder': 'Folder deleted ({n} files)',
        'action.trashedMany': 'Deleted {n} files ({size}){failed}',
        'action.trashedFailed': '; {n} failed',
        'confirm.trashSelected': 'Move the {n} selected files to the recycle bin?',
        'confirm.trashFolder': 'Move the whole folder "{name}" to the recycle bin? It holds {n} files ({size}) and can be restored as one unit.',
        'trash.title': 'Recycle bin',
        'trash.hint': 'Recycling only moves files; restoring refuses when the original path exists again.',
        'dup.title': 'Duplicate files',
        'dup.hint': 'Sized first, then SHA-256, so only byte-identical content counts.',
        'dup.includeUntracked': 'Include untracked files',
        'loading': 'Loading…',
        'error.prefix': 'Something went wrong',
        'retry': 'Retry',
        'confirm.trash': 'Move {name} to the recycle bin? The file leaves its original path.',
        'confirm.purge': 'Delete this file forever? This cannot be undone.',
        'confirm.purgeAll': 'Empty the recycle bin forever? This cannot be undone.',
        'note.scanning': 'Reading session logs…',
        'label.placeholder': 'Name this version, e.g. "client edition"',
        'count.of': '{n} total',
        'session.unnamed': '(untitled session)',
        'session.root': 'root session',
        'subagent.of': 'subagent of {name}',
        'group.versions': '{n} versions',
        'file.unknownSize': 'unknown size',
        'footer.dataDir': 'Index location',
      },
    }

    function activeLang() {
      try {
        const active = String(localeService?.getSnapshot?.().active ?? 'zh').toLowerCase()
        return active.startsWith('zh') ? 'zh' : 'en'
      } catch {
        return 'zh'
      }
    }

    function t(key, params) {
      const lang = activeLang()
      let text = DICT[lang]?.[key] ?? DICT.zh[key] ?? key
      if (params) {
        for (const [name, value] of Object.entries(params)) text = text.split(`{${name}}`).join(String(value))
      }
      return text
    }

    function useLocaleText() {
      const [, force] = useState(0)
      useEffect(() => {
        if (!localeService?.subscribe) return undefined
        const unsubscribe = localeService.subscribe(() => force((n) => n + 1))
        return () => {
          try {
            unsubscribe?.()
          } catch {
            /* disposed */
          }
        }
      }, [])
      return t
    }

    // ---------------------------------------------------------------- helpers
    function fmtBytes(value) {
      const bytes = Number(value ?? 0)
      if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
      const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
      let index = 0
      let scaled = bytes
      while (scaled >= 1024 && index < units.length - 1) {
        scaled /= 1024
        index += 1
      }
      const text = index === 0 || scaled >= 100 ? String(Math.round(scaled)) : scaled.toFixed(1)
      return `${text} ${units[index]}`
    }

    function fmtCount(value) {
      const number = Number(value ?? 0)
      return Number.isFinite(number) ? number.toLocaleString() : '0'
    }

    function fmtTime(value) {
      const time = Number(value ?? 0)
      if (!Number.isFinite(time) || time <= 0) return '—'
      const delta = Date.now() - time
      const minute = 60 * 1000
      const hour = 60 * minute
      const day = 24 * hour
      if (delta < 2 * minute) return activeLang() === 'zh' ? '刚刚' : 'just now'
      if (delta < hour) return activeLang() === 'zh' ? `${Math.floor(delta / minute)} 分钟前` : `${Math.floor(delta / minute)}m ago`
      if (delta < day) return activeLang() === 'zh' ? `${Math.floor(delta / hour)} 小时前` : `${Math.floor(delta / hour)}h ago`
      if (delta < 7 * day) return activeLang() === 'zh' ? `${Math.floor(delta / day)} 天前` : `${Math.floor(delta / day)}d ago`
      const date = new Date(time)
      return activeLang() === 'zh'
        ? `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
        : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    }

    function shortPath(value, max = 46) {
      const text = String(value ?? '')
      if (text.length <= max) return text
      const head = Math.max(8, Math.floor(max * 0.45))
      const tail = Math.max(8, max - head - 1)
      return `${text.slice(0, head)}…${text.slice(-tail)}`
    }

    function copyText(text) {
      const write = navigator.clipboard?.writeText?.(text)
      if (write && typeof write.then === 'function') return write
      return new Promise((resolve, reject) => {
        try {
          const area = document.createElement('textarea')
          area.value = text
          area.setAttribute('readonly', '')
          area.style.position = 'fixed'
          area.style.opacity = '0'
          document.body.appendChild(area)
          area.select()
          const ok = document.execCommand?.('copy')
          document.body.removeChild(area)
          ok ? resolve() : reject(new Error('copy failed'))
        } catch (error) {
          reject(error)
        }
      })
    }

    function downloadUrl(filePath) {
      return `${BASE}/file?path=${encodeURIComponent(filePath)}`
    }

    async function request(path, options = {}) {
      const init = { method: options.method ?? 'GET', headers: {}, credentials: 'same-origin' }
      if (options.body !== undefined) {
        init.headers['content-type'] = 'application/json'
        init.body = JSON.stringify(options.body)
      }
      const response = await fetch(`${BASE}/${path}`, init)
      const text = await response.text()
      let payload = null
      if (text !== '') {
        try {
          payload = JSON.parse(text)
        } catch {
          payload = null
        }
      }
      if (!response.ok) throw new Error(payload?.error ?? `HTTP ${response.status}`)
      return payload
    }

    // ------------------------------------------------- cross-slot selection
    const vaultStore = { sessionId: null, tab: 'sessions', listeners: new Set() }

    function patchVault(patch) {
      Object.assign(vaultStore, patch)
      for (const listener of [...vaultStore.listeners]) {
        try {
          listener()
        } catch {
          /* one bad listener should not break the rest */
        }
      }
    }

    function useVaultStore() {
      const [, force] = useState(0)
      useEffect(() => {
        const listener = () => force((n) => n + 1)
        vaultStore.listeners.add(listener)
        return () => vaultStore.listeners.delete(listener)
      }, [])
      return vaultStore
    }

    // ---------------------------------------------------------------- styles
    const CSS = `
    .av-root{display:flex;flex-direction:column;max-width:1120px;color:var(--dsw-alias-label-primary,#111);font-size:13px;line-height:1.55}
    .av-scroll{flex:1;min-height:0;padding:2px 0 12px}
    .av-head{display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:14px}
    .av-title{font-size:17px;font-weight:600;letter-spacing:.2px;margin:0}
    .av-sub{color:var(--dsw-alias-label-secondary,#6b7280);font-size:12px;margin:2px 0 0}
    .av-head-actions{margin-left:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    .av-btn{appearance:none;border:1px solid var(--dsw-alias-border-l1,#e5e7eb);background:var(--dsw-alias-bg-layer-1,#fafafa);color:inherit;border-radius:7px;padding:5px 11px;font-size:12px;cursor:pointer;transition:background .12s,border-color .12s,opacity .12s;white-space:nowrap}
    .av-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2,#f3f4f6);border-color:var(--dsw-alias-border-l2,#d1d5db)}
    .av-btn:disabled{opacity:.5;cursor:default}
    .av-btn.primary{background:var(--dsw-alias-brand-primary,#4f46e5);border-color:transparent;color:#fff}
    .av-btn.primary:hover:not(:disabled){filter:brightness(1.06);background:var(--dsw-alias-brand-primary,#4f46e5)}
    .av-btn.ghost{background:transparent;border-color:transparent;padding:3px 7px;color:var(--dsw-alias-label-secondary,#6b7280)}
    .av-btn.ghost:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2,#f3f4f6);color:var(--dsw-alias-label-primary,#111)}
    .av-btn.danger{color:var(--dsw-alias-state-error-primary,#dc2626)}
    .av-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:16px}
    .av-stat{border:1px solid var(--dsw-alias-border-l2,#d7dae0);border-radius:12px;padding:11px 13px;background:var(--dsw-alias-bg-layer-1,#fcfcfd)}
    .av-stat .k{font-size:11px;color:var(--dsw-alias-label-secondary,#6b7280);text-transform:uppercase;letter-spacing:.4px}
    .av-stat .v{font-size:16px;font-weight:600;margin-top:1px;font-variant-numeric:tabular-nums}
    .av-toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px}
    .av-tabs{display:flex;gap:2px;align-items:stretch;border-bottom:1px solid var(--dsw-alias-border-l1,#e8eaee);flex-wrap:wrap}
    .av-tab{appearance:none;font:inherit;cursor:pointer;border:0;background:transparent;padding:8px 14px;margin-bottom:-1px;font-size:13px;font-weight:600;line-height:20px;border-bottom:2px solid transparent;color:var(--dsw-alias-label-secondary,#6b7280);white-space:nowrap;transition:color .15s,border-color .15s}
    .av-tab:hover{color:var(--dsw-alias-label-primary,#111)}
    .av-tab.on{color:var(--dsw-alias-label-primary,#111);border-bottom-color:var(--dsw-alias-brand-primary,#4f46e5)}
    .av-search{flex:1 1 180px;min-width:140px;border:1px solid var(--dsw-alias-border-l1,#e5e7eb);background:var(--dsw-alias-bg-base,#fff);border-radius:8px;padding:5px 10px;font-size:12px;color:inherit;outline:none}
    .av-search:focus{border-color:var(--dsw-alias-brand-primary,#4f46e5)}
    .av-list{display:flex;flex-direction:column;gap:6px}
    .av-row{display:flex;align-items:center;gap:10px;border:1px solid var(--dsw-alias-border-l2,#d7dae0);background:var(--dsw-alias-bg-layer-1,#fcfcfd);border-radius:12px;padding:10px 14px;cursor:pointer;transition:border-color .16s,background .16s}
    .av-row:hover{border-color:var(--dsw-alias-border-l2,#d1d5db);background:var(--dsw-alias-bg-layer-2,#f8f9fb)}
    .av-row .main{min-width:0;flex:1}
    .av-row .name{font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .av-row .path{font-size:11px;color:var(--dsw-alias-label-secondary,#6b7280);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}
    .av-row .metrics{display:flex;gap:12px;align-items:center;color:var(--dsw-alias-label-secondary,#6b7280);font-size:11px;white-space:nowrap;font-variant-numeric:tabular-nums}
    .av-row .arrow{color:var(--dsw-alias-label-secondary,#9ca3af);font-size:15px}
    .av-pills{display:inline-flex;gap:4px;flex-wrap:wrap;margin-left:6px}
    .av-pill{font-size:10px;line-height:1.4;padding:1px 6px;border-radius:999px;border:1px solid transparent;white-space:nowrap}
    .av-pill.declared{color:#7c3aed;background:rgba(124,58,237,.10);border-color:rgba(124,58,237,.24)}
    .av-pill.missing{color:var(--dsw-alias-state-error-primary,#dc2626);background:rgba(220,38,38,.08);border-color:rgba(220,38,38,.22)}
    .av-pill.modified{color:var(--dsw-alias-state-warn-primary,#b45309);background:rgba(180,83,9,.08);border-color:rgba(180,83,9,.22)}
    .av-pill.inferred,.av-pill.manual{color:var(--dsw-alias-label-secondary,#6b7280);background:rgba(107,114,128,.10);border-color:rgba(107,114,128,.22)}
    .av-pill.live{color:var(--dsw-alias-state-success-primary,#059669);background:rgba(5,150,105,.10);border-color:rgba(5,150,105,.24)}
    .av-pill.error{color:var(--dsw-alias-state-error-primary,#dc2626);background:rgba(220,38,38,.10);border-color:rgba(220,38,38,.24)}
    .av-card{border:1px solid var(--dsw-alias-border-l2,#d7dae0);border-radius:12px;background:var(--dsw-alias-bg-layer-1,#fcfcfd);margin-bottom:10px;overflow:hidden;transition:border-color .16s}
    .av-card-head{display:flex;align-items:center;gap:9px;padding:11px 14px;background:transparent;border-bottom:1px solid var(--dsw-alias-border-l1,#e8eaee);flex-wrap:wrap}
    .av-card-head .gname{font-weight:600;font-size:13px}
    .av-card-head .gmeta{color:var(--dsw-alias-label-secondary,#6b7280);font-size:11px;font-variant-numeric:tabular-nums}
    .av-ext{font-size:10px;text-transform:uppercase;letter-spacing:.5px;color:var(--dsw-alias-label-secondary,#6b7280);border:1px solid var(--dsw-alias-border-l1,#e5e7eb);border-radius:5px;padding:0 5px}
    .av-ver{display:flex;align-items:center;gap:9px;padding:7px 12px;border-top:1px dashed var(--dsw-alias-border-l1,#eef0f4)}
    .av-ver:first-of-type{border-top:0}
    .av-vnum{min-width:30px;text-align:center;font-size:11px;font-weight:700;color:var(--dsw-alias-label-secondary,#6b7280);background:var(--dsw-alias-bg-layer-2,#f3f4f6);border-radius:6px;padding:1px 5px;font-variant-numeric:tabular-nums}
    .av-vnum.latest{color:#fff;background:var(--dsw-alias-brand-primary,#4f46e5)}
    .av-ver .fname{font-size:12px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
    .av-ver .fmeta{font-size:11px;color:var(--dsw-alias-label-secondary,#6b7280);white-space:nowrap;font-variant-numeric:tabular-nums}
    .av-ver .facts{display:flex;gap:6px;align-items:center}
    .av-empty{border:1px dashed var(--dsw-alias-border-l2,#d1d5db);border-radius:11px;padding:26px 18px;text-align:center;color:var(--dsw-alias-label-secondary,#6b7280);font-size:12px;background:var(--dsw-alias-bg-layer-1,#fafafa)}
    .av-err{border:1px solid rgba(220,38,38,.35);background:rgba(220,38,38,.06);color:var(--dsw-alias-state-error-primary,#b91c1c);border-radius:9px;padding:9px 12px;font-size:12px;margin-bottom:10px;display:flex;gap:10px;align-items:center}
    .av-toast{position:sticky;bottom:0;margin-top:10px;font-size:12px;color:var(--dsw-alias-label-secondary,#374151);background:var(--dsw-alias-bg-layer-2,#f3f4f6);border:1px solid var(--dsw-alias-border-l1,#e5e7eb);border-radius:8px;padding:6px 10px;display:inline-block}
    .av-sec-title{font-size:12px;font-weight:600;letter-spacing:.3px;text-transform:uppercase;color:var(--dsw-alias-label-secondary,#6b7280);margin:18px 0 8px}
    .av-hint{font-size:11.5px;color:var(--dsw-alias-label-secondary,#6b7280);margin:0 0 10px}
    .av-bar{display:flex;align-items:center;gap:8px;font-size:12px;padding:4px 0}
    .av-bar .track{flex:1;height:7px;border-radius:4px;background:var(--dsw-alias-bg-layer-2,#eef0f4);overflow:hidden}
    .av-bar .fill{height:100%;border-radius:4px;background:var(--dsw-alias-brand-primary,#4f46e5);opacity:.85}
    .av-bar .lbl{width:31%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .av-bar .num{width:70px;text-align:right;color:var(--dsw-alias-label-secondary,#6b7280);font-variant-numeric:tabular-nums}
    .av-detail-head{display:flex;align-items:flex-start;gap:10px;flex-wrap:wrap;margin-bottom:12px}
    .av-kv{display:grid;grid-template-columns:auto 1fr;gap:2px 12px;font-size:11.5px;color:var(--dsw-alias-label-secondary,#6b7280);margin-top:4px}
    .av-kv b{color:var(--dsw-alias-label-primary,#111);font-weight:500}
    .av-code{font-family:var(--dsw-font-mono,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:10.5px;letter-spacing:.4px;color:var(--dsw-alias-label-secondary,#6b7280);background:var(--dsw-alias-bg-layer-2,#f3f4f6);border-radius:5px;padding:1px 5px;margin-left:7px;white-space:nowrap}
    .av-folder{display:flex;gap:8px;align-items:center;flex-wrap:wrap;border:1px dashed var(--dsw-alias-border-l2,#d1d5db);border-radius:9px;padding:7px 10px;margin-bottom:10px;font-size:11.5px}
    .av-folder .av-kv{margin-top:0;grid-template-columns:auto auto}
    .av-areas{display:flex;flex-direction:column;gap:4px;margin-bottom:10px}
    .av-area-row{display:flex;gap:9px;align-items:center;font-size:11.5px;padding:5px 9px;border-radius:8px;background:var(--dsw-alias-bg-layer-1,#fafafa);border:1px solid var(--dsw-alias-border-l1,#eef0f4)}
    .av-priority{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;margin-bottom:6px}
    .av-priority .av-card{margin:0}
    .av-input{border:1px solid var(--dsw-alias-border-l2,#d1d5db);border-radius:6px;padding:2px 7px;font-size:12px;color:inherit;background:var(--dsw-alias-bg-base,#fff);outline:none;min-width:150px}
    .av-skel{height:12px;border-radius:5px;background:linear-gradient(90deg,var(--dsw-alias-bg-layer-2,#eef0f4),var(--dsw-alias-bg-layer-1,#f7f8fa),var(--dsw-alias-bg-layer-2,#eef0f4));background-size:200% 100%;animation:av-shimmer 1.2s linear infinite}
    @keyframes av-shimmer{from{background-position:0 0}to{background-position:-200% 0}}
    .av-iconbtn{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border:0;background:transparent;border-radius:6px;color:var(--dsw-alias-label-secondary,#6b7280);cursor:pointer}
    .av-iconbtn:hover{background:var(--dsw-alias-bg-layer-2,#f3f4f6);color:var(--dsw-alias-label-primary,#111)}
    /* --- redesigned controls & storage view --- */
    .av-sort{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap}
    .av-sort-label{font-size:11px;color:var(--dsw-alias-label-secondary,#6b7280)}
    .av-segment{display:inline-flex;background:var(--dsw-alias-bg-layer-2,#f3f4f6);border-radius:8px;padding:2px;gap:2px}
    .av-seg{border:0;background:transparent;border-radius:6px;padding:3px 9px;font-size:11px;cursor:pointer;color:var(--dsw-alias-label-secondary,#6b7280);white-space:nowrap}
    .av-seg:hover{color:var(--dsw-alias-label-primary,#111)}
    .av-seg.on{background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#111);box-shadow:0 1px 2px rgba(0,0,0,.08);font-weight:600}
    .av-order{min-width:28px;text-align:center;font-size:14px;line-height:1;padding:3px 6px}
    .av-section-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:10px}
    .av-section-title{font-size:13px;font-weight:600;margin:0;color:var(--dsw-alias-label-primary,#111)}
    .av-pad{padding:14px 16px}
    .av-card-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary,#6b7280);margin-bottom:8px}
    .av-stat-strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:10px}
    .av-meter{padding:4px 0}
    .av-meter-top{display:flex;justify-content:space-between;gap:10px;font-size:11.5px;align-items:baseline}
    .av-meter-label{color:var(--dsw-alias-label-primary,#111);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .av-meter-value{color:var(--dsw-alias-label-secondary,#6b7280);font-variant-numeric:tabular-nums;flex-shrink:0}
    .av-meter-track{height:6px;border-radius:4px;background:var(--dsw-alias-bg-layer-2,#eef0f4);overflow:hidden;margin-top:3px}
    .av-meter-fill{height:100%;border-radius:4px;background:linear-gradient(90deg,var(--dsw-alias-brand-primary,#4f46e5),var(--dsw-alias-brand-primary,#4f46e5));opacity:.85}
    .av-meter-sub{font-size:10.5px;color:var(--dsw-alias-label-secondary,#6b7280);margin-top:2px}
    .av-meter-row{border-bottom:1px solid var(--dsw-alias-border-l1,#eef0f4)}
    .av-meter-row:last-child{border-bottom:0}
    .av-priority{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:8px}
    .av-prio{border:1px solid var(--dsw-alias-border-l1,#eef0f4);border-radius:9px;padding:9px 11px;background:var(--dsw-alias-bg-base,#fff)}
    .av-prio-top{display:flex;align-items:center;gap:8px;margin-bottom:4px}
    .av-prio-num{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:6px;background:var(--dsw-alias-brand-primary,#4f46e5);color:#fff;font-size:11px;font-weight:700;flex-shrink:0}
    .av-prio-title{font-size:12px;font-weight:600;flex:1;min-width:0}
    .av-prio-adopt .av-prio-num{background:var(--dsw-alias-state-success-primary,#059669)}
    .av-plan{display:flex;gap:9px;align-items:flex-start;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1,#eef0f4);border-radius:9px;margin-bottom:6px;cursor:pointer;transition:border-color .12s,background .12s}
    .av-plan:hover{border-color:var(--dsw-alias-border-l2,#d1d5db)}
    .av-plan.on{border-color:var(--dsw-alias-brand-primary,#4f46e5);background:var(--dsw-alias-bg-layer-2,#f6f7ff)}
    .av-plan input{margin-top:3px}
    .av-plan-body{display:flex;flex-direction:column;gap:3px;min-width:0}
    .av-plan-title{display:flex;gap:7px;align-items:center;flex-wrap:wrap;font-size:12px}
    .av-plan-meta{font-size:11px;color:var(--dsw-alias-label-secondary,#6b7280)}
    .av-trash-item{border:1px solid var(--dsw-alias-border-l1,#eef0f4);border-radius:9px;margin-bottom:6px;overflow:hidden}
    .av-trash-main{display:flex;align-items:center;gap:9px;padding:8px 11px;cursor:pointer}
    .av-trash-main:hover{background:var(--dsw-alias-bg-layer-1,#fafafa)}
    .av-trash-name{font-size:12px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:46%}
    .av-trash-spacer{flex:1}
    .av-trash-detail{padding:8px 11px;border-top:1px dashed var(--dsw-alias-border-l1,#eef0f4);font-size:11px;color:var(--dsw-alias-label-secondary,#6b7280);display:flex;flex-direction:column;gap:4px}
    .av-trash-detail code{font-family:var(--dsw-font-mono,ui-monospace,monospace);word-break:break-all}
    .av-trash-actions{display:flex;gap:6px;margin-top:5px}
    .av-caret{color:var(--dsw-alias-label-secondary,#9ca3af);font-size:11px;flex-shrink:0;user-select:none}
    .av-group-head{cursor:pointer;user-select:none}
    .av-group-head:hover{background:var(--dsw-alias-bg-layer-1,#f8f9fb)}
    /* --- workbuddy-inspired: bordered boxes, underlined headers, row rules --- */
    .av-box{border:1px solid var(--dsw-alias-border-l2,#d7dae0);border-radius:12px;background:var(--dsw-alias-bg-layer-1,#fcfcfd);margin-bottom:10px;overflow:hidden;transition:border-color .16s,background .16s}
    .av-box:hover{border-color:var(--dsw-alias-label-dimmed,#a8adb8)}
    .av-box-head{display:flex;align-items:center;gap:10px;padding:11px 14px;flex-wrap:wrap;background:transparent;border-bottom:1px solid var(--dsw-alias-border-l1,#e8eaee)}
    .av-box-toggle{appearance:none;font:inherit;cursor:pointer;display:inline-flex;align-items:center;gap:7px;border:0;background:transparent;padding:0;color:inherit;min-width:0}
    .av-box-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#111);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:38ch}
    .av-box-meta{font-size:11.5px;color:var(--dsw-alias-label-secondary,#6b7280);font-variant-numeric:tabular-nums;white-space:nowrap}
    .av-box-body{padding:2px 0}
    .av-rowline{display:flex;align-items:center;gap:10px;padding:7px 14px;border-top:1px solid var(--dsw-alias-border-l1,#eef0f4);font-size:12px}
    .av-rowline:first-child{border-top:0}
    .av-rowline:hover{background:var(--dsw-alias-bg-layer-2,#f6f7f9)}
    .av-rowline.on{background:rgba(79,70,229,.06)}
    .av-rowline-name{min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary,#111)}
    .av-rowline-size{width:78px;text-align:right;color:var(--dsw-alias-label-secondary,#6b7280);font-variant-numeric:tabular-nums;white-space:nowrap}
    .av-rowline-time{width:96px;text-align:right;color:var(--dsw-alias-label-secondary,#8b8f98);white-space:nowrap}
    .av-check{width:15px;height:15px;accent-color:var(--dsw-alias-brand-primary,#4f46e5);cursor:pointer;flex-shrink:0}
    .av-toolbar-box{border:1px solid var(--dsw-alias-border-l2,#d7dae0);border-radius:12px;padding:9px 12px;background:var(--dsw-alias-bg-layer-1,#fcfcfd);margin-bottom:10px}
    .av-bulkbar{display:flex;align-items:center;gap:10px;padding:8px 12px;margin-bottom:10px;border:1px solid var(--dsw-alias-brand-primary,#4f46e5);border-radius:10px;background:rgba(79,70,229,.07);font-size:12px;color:var(--dsw-alias-label-primary,#111)}
    .av-count{font-size:11.5px;color:var(--dsw-alias-label-secondary,#6b7280);font-variant-numeric:tabular-nums;white-space:nowrap}
    .av-hint-top{margin-bottom:8px}
    .av-btn.danger-outline{color:var(--dsw-alias-state-error-primary,#dc2626);border-color:rgba(220,38,38,.35);background:transparent}
    .av-btn.danger-outline:hover:not(:disabled){background:rgba(220,38,38,.08);border-color:var(--dsw-alias-state-error-primary,#dc2626)}
    /* Underlined section headers, mirroring the workbuddy panel tab treatment. */
    .av-sec-title{border-bottom:1px solid var(--dsw-alias-border-l1,#e8eaee);padding-bottom:6px}
    `

    function ensureStyles() {
      const existing = document.querySelector('style[data-plugin="artifact-vault"]')
      if (existing) return
      const style = document.createElement('style')
      style.dataset.plugin = 'artifact-vault'
      style.textContent = CSS
      document.head.appendChild(style)
    }

    // ------------------------------------------------------------- primitives
    function Pill({ kind, children }) {
      return h('span', { className: `av-pill ${kind}` }, children)
    }

    function Btn({ variant, onClick, disabled, title, children }) {
      const className = `av-btn${variant ? ` ${variant}` : ''}`
      return h('button', { type: 'button', className, onClick, disabled, title }, children)
    }

    function Stat({ label, value, hint }) {
      return h('div', { className: 'av-stat' },
        h('div', { className: 'k' }, label),
        h('div', { className: 'v' }, value),
        hint ? h('div', { className: 'av-hint', style: { margin: 0 } }, hint) : null)
    }

    function Empty({ children }) {
      return h('div', { className: 'av-empty' }, children)
    }

    /** A compact, consistent sort control used by every list. */
    function SortBar({ value, order, options, onChange, onToggleOrder, label = 'sort.label' }) {
      const tt = useLocaleText()
      const labelOf = (option) => option.labelKey ?? (option.key === 'bytes' ? 'sort.bytes' : `sort.${option.key}`)
      return h('div', { className: 'av-sort' },
        h('span', { className: 'av-sort-label' }, tt(label)),
        h('div', { className: 'av-segment' }, options.map((option) => h('button', {
          key: option.key,
          type: 'button',
          className: `av-seg${value === option.key ? ' on' : ''}`,
          onClick: () => onChange(option.key),
          title: option.title ?? tt(labelOf(option)),
        }, tt(labelOf(option))))),
        h('button', {
          type: 'button',
          className: 'av-btn ghost av-order',
          onClick: onToggleOrder,
          title: tt(order === 'asc' ? 'sort.asc' : 'sort.dir'),
        }, order === 'asc' ? '↑' : '↓'))
    }

    /** Visual bar with a label, track and value — used by storage rankings. */
    function Meter({ label, value, max, sub }) {
      const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0
      return h('div', { className: 'av-meter' },
        h('div', { className: 'av-meter-top' },
          h('span', { className: 'av-meter-label', title: typeof label === 'string' ? label : '' }, label),
          h('span', { className: 'av-meter-value' }, fmtBytes(value))),
        h('div', { className: 'av-meter-track' }, h('div', { className: 'av-meter-fill', style: { width: `${pct}%` } })),
        sub ? h('div', { className: 'av-meter-sub' }, sub) : null)
    }

    function Skel() {
      return h('div', { className: 'av-list' },
        [0, 1, 2, 3].map((index) => h('div', { key: index, className: 'av-row', style: { cursor: 'default' } },
          h('div', { className: 'main' },
            h('div', { className: 'av-skel', style: { width: `${52 - index * 6}%` } }),
            h('div', { className: 'av-skel', style: { width: `${34 - index * 4}%`, marginTop: 6, height: 9 } })))))
    }

    // ------------------------------------------------- settings nav icon
    // Registered into `settings.section.icon` and matched to the section above
    // by the same id; the shell passes only a size.
    function SectionIcon({ size = 20 }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 32 32', fill: 'none',
        stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true',
      },
        h('rect', { x: 4, y: 7, width: 24, height: 21, rx: 3 }),
        h('path', { d: 'M4 13h24' }),
        h('circle', { cx: 12, cy: 20, r: 3.2 }),
        h('path', { d: 'M19.5 20.5h4.5M19.5 24h4.5' }))
    }

    // ------------------------------------------------------------ session row
    function SessionRow({ row, onOpen }) {
      const tt = useLocaleText()
      const title = row.title || tt('session.unnamed')
      const pills = []
      if (row.live) pills.push(h(Pill, { key: 'live', kind: 'live' }, tt('badge.live')))
      if (row.error) pills.push(h(Pill, { key: 'error', kind: 'error' }, tt('badge.error')))
      if (row.declared > 0) pills.push(h(Pill, { key: 'declared', kind: 'declared' }, `${tt('badge.declared')} ${row.declared}`))
      if (row.missing > 0) pills.push(h(Pill, { key: 'missing', kind: 'missing' }, `${tt('badge.missing')} ${row.missing}`))
      if (row.workspace && !row.workspace.adopted) pills.push(h(Pill, { key: 'pending', kind: 'manual' }, tt('badge.wantFolder')))
      return h('div', {
        className: 'av-row', role: 'button', tabIndex: 0,
        onClick: () => onOpen(row.id),
        onKeyDown: (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onOpen(row.id)
          }
        },
      },
        h('div', { className: 'main' },
          h('div', { className: 'name' }, title,
            row.shortId ? h('span', { className: 'av-code' }, row.shortId) : null,
            row.subagents > 0 ? h('span', { className: 'av-pills' }, h(Pill, { kind: 'manual' }, `${tt('meta.subagents')} ${row.subagents}`)) : null),
          h('div', { className: 'path' }, shortPath(row.workspace?.folder ?? row.cwd ?? row.id, 96))),
        h('div', { className: 'metrics' },
          h('span', null, `${row.artifacts} ${tt('meta.artifacts')}`),
          h('span', null, fmtBytes(row.bytes)),
          h('span', null, fmtTime(row.lastActivity))),
        h('div', { className: 'arrow' }, '›'))
    }

    // ---------------------------------------------------------- session detail
    function VersionRow({ version, groupName, onChanged, onToast }) {
      const tt = useLocaleText()
      const [editing, setEditing] = useState(false)
      const [label, setLabel] = useState(version.label ?? '')
      const [busy, setBusy] = useState(false)
      const statusPills = (version.status ?? []).map((status) => h(Pill, { key: status, kind: status }, tt(`badge.${status}`)))

      const saveLabel = async () => {
        setBusy(true)
        try {
          await request('declare', {
            method: 'POST',
            body: {
              sessionId: version.writtenBy?.[0],
              path: version.path,
              label: label.trim() || undefined,
            },
          })
          onToast(tt('action.declare'))
          setEditing(false)
          onChanged()
        } catch (error) {
          onToast(`${tt('error.prefix')}: ${error.message}`)
        } finally {
          setBusy(false)
        }
      }

      const recycle = async () => {
        if (!window.confirm(tt('confirm.trash', { name: version.name }))) return
        setBusy(true)
        try {
          await request('trash', { method: 'POST', body: { path: version.path, sessionId: version.writtenBy?.[0] } })
          onToast(tt('action.trashed'))
          onChanged()
        } catch (error) {
          onToast(`${tt('error.prefix')}: ${error.message}`)
        } finally {
          setBusy(false)
        }
      }

      const copy = async () => {
        try {
          await copyText(version.path)
          onToast(tt('action.copied'))
        } catch {
          onToast(version.path)
        }
      }

      return h('div', { className: 'av-ver' },
        h('span', { className: `av-vnum${version.isLatest ? ' latest' : ''}` }, `v${version.version}`),
        h('span', { className: 'fname', title: version.display },
          version.label ? h('b', { style: { fontWeight: 600 } }, `${version.label} · `) : null,
          version.name),
        ...statusPills,
        h('span', { className: 'facts' },
          h('span', { className: 'fmeta' }, version.known ? fmtBytes(version.size) : tt('file.unknownSize')),
          h('span', { className: 'fmeta', style: { marginLeft: 8 } }, fmtTime(version.time))),
        editing
          ? h('span', { style: { display: 'inline-flex', gap: 6, alignItems: 'center' } },
            h('input', {
              className: 'av-input',
              value: label,
              autoFocus: true,
              placeholder: tt('label.placeholder'),
              onChange: (event) => setLabel(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter') saveLabel()
                if (event.key === 'Escape') setEditing(false)
              },
            }),
            h(Btn, { onClick: saveLabel, disabled: busy }, tt('action.save')),
            h(Btn, { variant: 'ghost', onClick: () => setEditing(false) }, tt('action.cancel')))
          : h('span', { style: { display: 'inline-flex', gap: 2, alignItems: 'center' } },
            h('button', { type: 'button', className: 'av-btn ghost', onClick: copy, title: version.path }, tt('action.copy')),
            h('a', {
              className: 'av-btn ghost',
              href: downloadUrl(version.path),
              download: version.name,
              style: { textDecoration: 'none' },
            }, tt('action.download')),
            h('button', { type: 'button', className: 'av-btn ghost', onClick: () => setEditing(true) }, tt('action.declare')),
            h('button', { type: 'button', className: 'av-btn ghost danger', onClick: recycle, disabled: busy }, tt('action.trash'))))
    }

    function GroupCard({ group, onChanged, onToast, sort = 'version', order = 'desc' }) {
      const tt = useLocaleText()
      const [expanded, setExpanded] = useState(false)
      const versions = useMemo(() => {
        const list = [...(group.versions ?? [])]
        const dir = order === 'asc' ? 1 : -1
        list.sort((a, b) => {
          const left = sort === 'size' ? (a.size ?? 0) : sort === 'mtime' ? (a.mtimeMs ?? 0) : (a.version ?? 0)
          const right = sort === 'size' ? (b.size ?? 0) : sort === 'mtime' ? (b.mtimeMs ?? 0) : (b.version ?? 0)
          return (left - right) * (sort === 'version' ? -dir : dir)
        })
        return list
      }, [group, sort, order])
      return h('div', { className: 'av-card' },
        h('div', { className: 'av-card-head av-group-head', onClick: () => setExpanded((v) => !v), role: 'button', tabIndex: 0,
          onKeyDown: (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setExpanded((v) => !v) } } },
          h('span', { className: 'av-caret' }, expanded ? '▾' : '▸'),
          h('span', { className: 'gname' }, group.label ? `${group.label} · ${group.name}` : group.name),
          group.ext ? h('span', { className: 'av-ext' }, group.ext) : null,
          h('span', { className: 'gmeta' }, tt('group.versions', { n: versions.length })),
          h('span', { className: 'gmeta' }, fmtBytes(group.bytes)),
          group.declared ? h(Pill, { kind: 'declared' }, tt('badge.declared')) : null,
          h('span', { style: { flex: 1 } }),
          h('span', { className: 'gmeta', title: group.dir }, shortPath(group.dir, 52))),
        expanded ? versions.map((version, index) => h(VersionRow, {
          key: version.path,
          version: { ...version, isLatest: version.version === versions.length && sort === 'version' },
          groupName: group.name,
          onChanged,
          onToast,
        })) : null)
    }

    function SessionDetail({ sessionId, onBack, onChanged, onToast }) {
      const tt = useLocaleText()
      const [data, setData] = useState(null)
      const [error, setError] = useState(null)
      const [loading, setLoading] = useState(true)
      const [versionSort, setVersionSort] = useState('version')
      const [versionOrder, setVersionOrder] = useState('desc')

      const load = useCallback(async (fresh) => {
        setLoading(true)
        setError(null)
        try {
          const payload = await request(`session?id=${encodeURIComponent(sessionId)}${fresh ? '&fresh=1' : ''}`)
          setData(payload)
        } catch (caught) {
          setError(caught.message)
        } finally {
          setLoading(false)
        }
      }, [sessionId])

      useEffect(() => {
        void load(false)
      }, [load])

      const clean = useCallback(async (area) => {
        if (!window.confirm(tt('confirm.cleanArea', { area: tt(`area.${area}`) }))) return
        try {
          const result = await request('cleanup', { method: 'POST', body: { sessionId, area } })
          onToast(tt('action.cleaned', { n: result.moved, size: fmtBytes(result.bytes) }))
          await load(false)
          onChanged()
        } catch (caught) {
          onToast(`${tt('error.prefix')}: ${caught.message}`)
        }
      }, [load, onChanged, onToast, sessionId, tt])

      const adopt = useCallback(async () => {
        try {
          await request('adopt', { method: 'POST', body: { sessionId } })
          onToast(tt('action.adopted'))
          await load(false)
          onChanged()
        } catch (caught) {
          onToast(`${tt('error.prefix')}: ${caught.message}`)
        }
      }, [load, onChanged, onToast, sessionId, tt])

      const header = data?.session
      const workspace = data?.session?.workspace ?? null
      const areas = data?.areas ?? null
      return h('div', null,
        h('div', { className: 'av-detail-head' },
          h(Btn, { onClick: onBack }, `‹ ${tt('action.back')}`),
          h('div', { style: { flex: 1, minWidth: 0 } },
            h('div', { className: 'av-title', style: { fontSize: 15 } }, header?.title || tt('session.unnamed')),
            h('div', { className: 'av-kv' },
              h('span', null, tt('meta.id')), h('b', null, header?.shortId ?? '—'),
              h('span', null, tt('meta.cwd')), h('b', { title: header?.cwd ?? '' }, shortPath(header?.cwd ?? '—', 70)),
              h('span', null, tt('meta.updated')), h('b', null, fmtTime(header?.createdAt)),
              h('span', null, tt('meta.artifacts')), h('b', null, `${fmtCount(data?.totals?.versions ?? 0)} / ${fmtBytes(data?.totals?.bytes ?? 0)}`),
              h('span', null, tt('meta.turns')), h('b', null, fmtCount(header?.turns ?? 0)),
              h('span', null, tt('meta.subagents')), h('b', null, fmtCount(header?.subagents ?? 0)))),
          h(Btn, { onClick: () => load(true), disabled: loading }, tt('action.reveal'))),
        header && workspace
          ? h('div', { className: 'av-folder' },
            h('div', { className: 'av-kv' },
              h('span', null, tt('meta.folder')),
              h('b', { title: workspace.folder }, shortPath(workspace.folder, 96))),
            h(Btn, {
              variant: 'ghost',
              onClick: async () => {
                await copyText(workspace.folder)
                onToast(tt('action.copied'))
              },
            }, tt('action.copyFolder')),
            workspace.adopted
              ? null
              : h(Btn, { variant: 'ghost', onClick: adopt }, tt('action.adopt')))
          : null,
        header && areas
          ? h('div', { className: 'av-areas' },
            ['tools', 'artifacts', 'loose'].map((area) => h('div', { key: area, className: 'av-area-row' },
              h('span', { className: 'av-pill manual' }, tt(`area.${area}`)),
              h('span', { className: 'fmeta' }, `${fmtCount(areas[area]?.count ?? 0)} ${tt('meta.files')} · ${fmtBytes(areas[area]?.bytes ?? 0)}`),
              h('span', { style: { flex: 1 } }),
              h(Btn, {
                variant: 'ghost danger',
                disabled: (areas[area]?.count ?? 0) === 0,
                onClick: () => clean(area),
              }, tt('action.clean')))))
          : null,
        error ? h('div', { className: 'av-err' },
          h('span', null, `${tt('error.prefix')}: ${error}`),
          h(Btn, { variant: 'ghost', onClick: () => load(true) }, tt('retry'))) : null,
        header?.error ? h('div', { className: 'av-err' }, `${tt('badge.error')}: ${header.error}`) : null,
        loading && !data ? h(Skel, null) : null,
        data && (data.groups ?? []).length === 0
          ? h(Empty, null, tt('empty.detail'))
          : h('div', null,
            h('div', { className: 'av-section-head' },
              h('h3', { className: 'av-section-title' }, tt('detail.groups')),
              h(SortBar, {
                value: versionSort, order: versionOrder,
                options: [{ key: 'version' }, { key: 'size' }, { key: 'mtime' }],
                onChange: (key) => setVersionSort(key),
                onToggleOrder: () => setVersionOrder((v) => v === 'desc' ? 'asc' : 'desc'),
              })),
            (data?.groups ?? [])
              .slice()
              .sort((a, b) => {
                const dir = versionOrder === 'asc' ? 1 : -1
                const av = versionSort === 'size' ? a.bytes : versionSort === 'mtime' ? a.lastTime : a.lastTime
                const bv = versionSort === 'size' ? b.bytes : versionSort === 'mtime' ? b.lastTime : b.lastTime
                return (av - bv) * dir
              })
              .map((group) => h(GroupCard, {
                key: group.key,
                group,
                sort: versionSort,
                order: versionOrder,
                onChanged: () => {
                  load(false)
                  onChanged()
                },
                onToast,
              }))))
    }

    // --------------------------------------------------------- untracked view
    // Untracked files are the ones no session ever wrote. The user's complaint
    // was concrete: 128 rows in ssg500-eve means 128 clicks. So every bucket is
    // a collapsible box with (a) a whole-folder delete and (b) per-row
    // checkboxes that batch-delete the selection.
    function UntrackedView({ onToast }) {
      const tt = useLocaleText()
      const [data, setData] = useState(null)
      const [error, setError] = useState(null)
      const [loading, setLoading] = useState(true)
      const [busy, setBusy] = useState(false)
      const [expanded, setExpanded] = useState({})
      const [selected, setSelected] = useState(() => new Set())
      const [sort, setSort] = useState('size')
      const [order, setOrder] = useState('desc')
      const [query, setQuery] = useState('')

      const load = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
          setData(await request('untracked'))
          setSelected(new Set())
        } catch (caught) {
          setError(caught.message)
        } finally {
          setLoading(false)
        }
      }, [])

      useEffect(() => {
        void load()
      }, [load])

      const trashOne = async (file) => {
        setBusy(true)
        try {
          await request('trash', { method: 'POST', body: { path: file.path } })
          onToast(tt('action.trashed'))
          await load()
        } catch (caught) {
          onToast(`${tt('error.prefix')}: ${caught.message}`)
        } finally {
          setBusy(false)
        }
      }

      /** Delete a whole bucket directory in one call (kind:'folder'). */
      const trashFolder = async (group) => {
        if (!group?.dir) return
        if (!window.confirm(tt('confirm.trashFolder', { name: group.label, n: group.count, size: fmtBytes(group.bytes) }))) return
        setBusy(true)
        try {
          await request('trash', { method: 'POST', body: { path: group.dir, kind: 'folder' } })
          onToast(tt('action.trashedFolder', { n: group.count }))
          await load()
        } catch (caught) {
          onToast(`${tt('error.prefix')}: ${caught.message}`)
        } finally {
          setBusy(false)
        }
      }

      /** Batch-delete the ticked files through /trash-many. */
      const trashSelected = async () => {
        const paths = [...selected]
        if (paths.length === 0) return
        if (!window.confirm(tt('confirm.trashSelected', { n: paths.length }))) return
        setBusy(true)
        try {
          const result = await request('trash-many', { method: 'POST', body: { paths } })
          onToast(tt('action.trashedMany', {
            n: result.moved,
            size: fmtBytes(result.bytes),
            failed: result.failed > 0 ? tt('action.trashedFailed', { n: result.failed }) : '',
          }))
          await load()
        } catch (caught) {
          onToast(`${tt('error.prefix')}: ${caught.message}`)
        } finally {
          setBusy(false)
        }
      }

      const toggle = (filePath) => {
        setSelected((previous) => {
          const next = new Set(previous)
          if (next.has(filePath)) next.delete(filePath)
          else next.add(filePath)
          return next
        })
      }

      const toggleGroup = (group) => {
        const allIn = group.files.every((file) => selected.has(file.path))
        setSelected((previous) => {
          const next = new Set(previous)
          for (const file of group.files) {
            if (allIn) next.delete(file.path)
            else next.add(file.path)
          }
          return next
        })
      }

      const groups = useMemo(() => {
        const needle = query.trim().toLowerCase()
        const list = (data?.groups ?? []).filter((group) => needle === '' || group.label.toLowerCase().includes(needle))
        const dir = order === 'asc' ? 1 : -1
        return list.slice().sort((a, b) => {
          if (sort === 'name') return a.label.localeCompare(b.label) * dir
          if (sort === 'count') return (a.count - b.count) * dir
          return (a.bytes - b.bytes) * dir
        })
      }, [data, sort, order, query])

      const selectedBytes = useMemo(() => {
        if (selected.size === 0) return 0
        let total = 0
        for (const group of data?.groups ?? []) {
          for (const file of group.files) if (selected.has(file.path)) total += file.size
        }
        return total
      }, [selected, data])

      return h('div', { className: 'av-untracked' },
        h('p', { className: 'av-hint av-hint-top' }, tt('untracked.hint')),
        h('div', { className: 'av-toolbar av-toolbar-box' },
          h('span', { className: 'av-count' },
            `${fmtCount(data?.totals?.files ?? 0)} ${tt('untracked.files')} · ${fmtBytes(data?.totals?.bytes ?? 0)}`),
          h('input', {
            className: 'av-search',
            value: query,
            placeholder: tt('untracked.search'),
            onChange: (event) => setQuery(event.target.value),
          }),
          h(SortBar, {
            value: sort, order,
            options: [{ key: 'size', labelKey: 'sort.bytes' }, { key: 'count', labelKey: 'sort.files' }, { key: 'name' }],
            onChange: setSort,
            onToggleOrder: () => setOrder((value) => value === 'desc' ? 'asc' : 'desc'),
          }),
          h(Btn, { onClick: load, disabled: loading || busy }, tt('action.reveal'))),
        selected.size > 0
          ? h('div', { className: 'av-bulkbar' },
            h('span', null, tt('untracked.selected', { n: selected.size, size: fmtBytes(selectedBytes) })),
            h('span', { style: { flex: 1 } }),
            h(Btn, { variant: 'ghost', onClick: () => setSelected(new Set()) }, tt('action.clear')),
            h(Btn, { variant: 'danger', onClick: trashSelected, disabled: busy }, tt('action.trashSelected')))
          : null,
        error ? h('div', { className: 'av-err' }, h('span', null, error), h(Btn, { variant: 'ghost', onClick: load }, tt('retry'))) : null,
        loading && !data ? h(Skel, null) : null,
        data && data.totals.files === 0 ? h(Empty, null, tt('empty.untracked')) : null,
        groups.map((group) => {
          const open = expanded[group.label] === true
          const allChecked = group.files.length > 0 && group.files.every((file) => selected.has(file.path))
          return h('div', { key: group.label, className: 'av-box' },
            h('div', { className: 'av-box-head' },
              h('input', {
                type: 'checkbox',
                className: 'av-check',
                checked: allChecked,
                onChange: () => toggleGroup(group),
                title: tt('untracked.selectAll'),
              }),
              h('button', {
                type: 'button',
                className: 'av-box-toggle',
                onClick: () => setExpanded((previous) => ({ ...previous, [group.label]: !open })),
              },
                h('span', { className: 'av-caret' }, open ? '▾' : '▸'),
                h('span', { className: 'av-box-title' }, group.label)),
              h('span', { className: 'av-box-meta' }, `${fmtCount(group.count)} ${tt('untracked.files')}`),
              h('span', { className: 'av-box-meta' }, fmtBytes(group.bytes)),
              h('span', { style: { flex: 1 } }),
              group.deletable
                ? h(Btn, { variant: 'danger-outline', onClick: () => trashFolder(group), disabled: busy }, tt('action.trashFolder'))
                : null),
            open
              ? h('div', { className: 'av-box-body' },
                group.files.slice(0, 500).map((file) => h('div', { key: file.path, className: `av-rowline${selected.has(file.path) ? ' on' : ''}` },
                  h('input', {
                    type: 'checkbox',
                    className: 'av-check',
                    checked: selected.has(file.path),
                    onChange: () => toggle(file.path),
                  }),
                  h('span', { className: 'av-ext' }, file.ext || '·'),
                  h('span', { className: 'av-rowline-name', title: file.path }, file.display.split('/').slice(-1)[0]),
                  h('span', { className: 'av-rowline-size' }, fmtBytes(file.size)),
                  h('span', { className: 'av-rowline-time' }, fmtTime(file.mtimeMs)),
                  h('button', {
                    type: 'button',
                    className: 'av-btn ghost danger',
                    disabled: busy,
                    onClick: () => trashOne(file),
                  }, tt('action.trash')))))
              : null)
        }))
    }

    // ----------------------------------------------------------- storage view
    function CDriveView({ onToast, onChanged }) {
      const tt = useLocaleText()
      const [data, setData] = useState(null)
      const [loading, setLoading] = useState(true)
      const [error, setError] = useState(null)
      const [selected, setSelected] = useState([])
      const [busy, setBusy] = useState(false)

      const load = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
          const payload = await request('c-drive-usage')
          setData(payload)
          setSelected([])
        } catch (caught) {
          setError(caught.message)
        } finally {
          setLoading(false)
        }
      }, [])

      useEffect(() => {
        void load()
      }, [load])

      const totalHome = data?.totals?.homeBytes ?? 0
      const categoryMax = (data?.categories ?? []).reduce((peak, cat) => Math.max(peak, cat.bytes ?? 0), 1)
      const selectedBytes = (data?.plans ?? []).filter((p) => selected.includes(p.id)).reduce((sum, p) => sum + p.size, 0)

      const clean = async () => {
        if (selected.length === 0) return
        if (!window.confirm(tt('cdrive.confirm'))) return
        setBusy(true)
        try {
          const result = await request('c-drive-clean', { method: 'POST', body: { ids: selected } })
          onToast(tt('cdrive.done', { size: fmtBytes(result.freed) }))
          await load()
          onChanged()
        } catch (caught) {
          onToast(`${tt('error.prefix')}: ${caught.message}`)
        } finally {
          setBusy(false)
        }
      }

      if (data && !data.homeOnC) {
        return h('div', { className: 'av-card av-pad' }, h('p', { className: 'av-hint', style: { margin: 0 } }, tt('cdrive.notC')))
      }

      return h('div', { className: 'av-storage-cdrive' },
        h('div', { className: 'av-section-head' },
          h('div', null,
            h('h3', { className: 'av-section-title' }, tt('cdrive.title')),
            h('p', { className: 'av-hint', style: { margin: '2px 0 0' } }, tt('cdrive.hint'))),
          h(Btn, { onClick: load, disabled: loading }, tt('cdrive.scan'))),
        error ? h('div', { className: 'av-err' }, h('span', null, error), h(Btn, { variant: 'ghost', onClick: load }, tt('retry'))) : null,
        loading && !data ? h(Skel, null) : null,
        data ? h('div', null,
          h('div', { className: 'av-stat-strip' },
            h(Stat, { label: tt('cdrive.home'), value: shortPath(data.home, 34) }),
            h(Stat, { label: tt('cdrive.category'), value: fmtBytes(totalHome) }),
            h(Stat, { label: tt('cdrive.reclaimable'), value: fmtBytes(data.totals.reclaimable), hint: `${data.plans.length} 项` })),
          h('div', { className: 'av-card av-pad' },
            h('div', { className: 'av-card-title' }, tt('cdrive.category')),
            (data.categories ?? []).slice(0, 9).map((cat) => h(Meter, {
              key: cat.id,
              label: cat.label,
              value: cat.bytes,
              max: categoryMax,
            }))),
          h('div', { className: 'av-card av-pad' },
            h('div', { className: 'av-section-head' },
              h('div', { className: 'av-card-title' }, tt('cdrive.plan')),
              selected.length > 0
                ? h(Btn, { variant: 'primary', onClick: clean, disabled: busy }, `${tt('cdrive.clean')} · ${fmtBytes(selectedBytes)}`)
                : null),
            h('p', { className: 'av-hint' }, tt('cdrive.note')),
            (data.plans ?? []).length === 0
              ? h(Empty, null, tt('cdrive.notC'))
              : (data.plans ?? []).map((plan) => h('label', {
                key: plan.id,
                className: `av-plan${selected.includes(plan.id) ? ' on' : ''}`,
              },
                h('input', {
                  type: 'checkbox',
                  checked: selected.includes(plan.id),
                  onChange: (event) => setSelected((list) => event.target.checked ? [...list, plan.id] : list.filter((id) => id !== plan.id)),
                }),
                h('span', { className: 'av-plan-body' },
                  h('span', { className: 'av-plan-title' },
                    h(Pill, { kind: plan.kind === 'cache' ? 'modified' : 'manual' }, tt(plan.kind === 'cache' ? 'cdrive.cache' : 'cdrive.sessionlog')),
                    h('b', null, shortPath(plan.path, 60))),
                  h('span', { className: 'av-plan-meta' }, `${fmtBytes(plan.size)} · ${plan.impact}`)))))
          ) : null
      )
    }

    function StorageView({ overview, onToast, onChanged }) {
      const tt = useLocaleText()
      const [trash, setTrash] = useState(null)
      const [trashError, setTrashError] = useState(null)
      const [trashSort, setTrashSort] = useState('at')
      const [trashOrder, setTrashOrder] = useState('desc')
      const [sessionSort, setSessionSort] = useState('sessionBytes')
      const [sessionOrder, setSessionOrder] = useState('desc')
      const [detailId, setDetailId] = useState(null)
      const rows = useMemo(() => {
        const list = [...(overview?.sessions ?? [])]
        const dir = sessionOrder === 'asc' ? 1 : -1
        list.sort((a, b) => {
          const sizeOf = (row) => sessionSort === 'bytes' ? (row.artifacts ? row.bytes / row.artifacts : 0)
            : sessionSort === 'artifacts' ? row.artifacts
              : sessionSort === 'recent' ? row.lastActivity
                : row.bytes
          return (sizeOf(a) - sizeOf(b)) * dir
        })
        return list.slice(0, 14)
      }, [overview, sessionSort, sessionOrder])
      const max = rows.reduce((peak, row) => Math.max(peak, row.bytes), 1)

      const loadTrash = useCallback(async () => {
        try {
          const payload = await request(`trash-list?sort=${encodeURIComponent(trashSort)}&order=${encodeURIComponent(trashOrder)}`)
          setTrash(payload)
          setTrashError(null)
        } catch (caught) {
          setTrashError(caught.message)
          setTrash({ items: [], totals: { count: 0, bytes: 0 } })
        }
      }, [trashSort, trashOrder])

      useEffect(() => {
        void loadTrash()
      }, [loadTrash, overview])

      const afterChange = useCallback(async () => {
        await loadTrash()
        onChanged()
      }, [loadTrash, onChanged])

      const restore = async (entry) => {
        try {
          await request('restore', { method: 'POST', body: { id: entry.id } })
          onToast(tt('action.restored'))
          await afterChange()
        } catch (error) {
          onToast(`${tt('error.prefix')}: ${error.message}`)
        }
      }

      const purge = async (entry) => {
        if (!window.confirm(tt('confirm.purge'))) return
        try {
          await request('purge', { method: 'POST', body: { id: entry.id } })
          onToast(tt('action.purged'))
          await afterChange()
        } catch (error) {
          onToast(`${tt('error.prefix')}: ${error.message}`)
        }
      }

      const purgeAll = async () => {
        if (!window.confirm(tt('confirm.purgeAll'))) return
        try {
          await request('purge', { method: 'POST', body: {} })
          setTrash([])
          onToast(tt('action.purged'))
          await afterChange()
        } catch (error) {
          onToast(`${tt('error.prefix')}: ${error.message}`)
        }
      }

      const cleanAll = async (area, confirmKey) => {
        if (!window.confirm(tt(confirmKey))) return
        try {
          const result = await request('cleanup', { method: 'POST', body: { all: true, area } })
          onToast(tt('action.cleaned', { n: result.moved, size: fmtBytes(result.bytes) }))
          onChanged()
        } catch (error) {
          onToast(`${tt('error.prefix')}: ${error.message}`)
        }
      }

      const adoptAll = async () => {
        try {
          await request('adopt', { method: 'POST', body: { all: true } })
          onToast(tt('action.adopted'))
          onChanged()
        } catch (error) {
          onToast(`${tt('error.prefix')}: ${error.message}`)
        }
      }

      const priority = [
        { key: 'tools', title: tt('storage.toolsCard'), bytes: overview?.totals?.toolsBytes ?? 0, hint: `${tt('area.tools')} · ${tt('meta.toolsBytes')}`, confirm: 'confirm.cleanToolsAll' },
        { key: 'artifacts', title: tt('storage.artifactsCard'), bytes: overview?.totals?.artifactsBytes ?? 0, hint: `${tt('area.artifacts')} · ${tt('meta.artifactsBytes')}`, confirm: 'confirm.cleanArtifactsAll' },
        { key: 'loose', title: tt('storage.looseCard'), bytes: overview?.totals?.looseBytes ?? 0, hint: `${tt('area.loose')} · ${tt('meta.files')}`, confirm: 'confirm.cleanLooseAll' },
      ]
      const trashItems = trash?.items ?? []

      return h('div', { className: 'av-storage' },
        h('div', { className: 'av-card av-pad' },
          h('div', { className: 'av-section-head' },
            h('div', null,
              h('h3', { className: 'av-section-title' }, tt('storage.priority')),
              h('p', { className: 'av-hint', style: { margin: '2px 0 0' } }, tt('storage.priorityHint')))),
          h('div', { className: 'av-priority' }, priority.map((item, index) => h('div', { key: item.key, className: 'av-prio' },
            h('div', { className: 'av-prio-top' },
              h('span', { className: 'av-prio-num' }, index + 1),
              h('span', { className: 'av-prio-title' }, item.title),
              h(Btn, { variant: 'ghost danger', onClick: () => cleanAll(item.key, item.confirm) }, tt('action.clean'))),
            h(Meter, { label: item.hint, value: item.bytes, max: Math.max(overview?.totals?.bytes ?? 1, 1) }))),
            h('div', { className: 'av-prio av-prio-adopt' },
              h('div', { className: 'av-prio-top' },
                h('span', { className: 'av-prio-num' }, '✓'),
                h('span', { className: 'av-prio-title' }, tt('storage.adoptCard')),
                h(Btn, { variant: 'ghost', onClick: adoptAll }, tt('action.adoptAll'))),
              h('p', { className: 'av-hint', style: { margin: 0 } }, tt('storage.adoptHint')))))),

        h('div', { className: 'av-card av-pad' },
          h('div', { className: 'av-section-head' },
            h('div', null, h('h3', { className: 'av-section-title' }, `${tt('stat.bytes')} · ${tt('tab.sessions')}`)),
            h(SortBar, {
              value: sessionSort, order: sessionOrder,
              options: [{ key: 'sessionBytes' }, { key: 'bytes' }, { key: 'artifacts' }, { key: 'recent' }],
              onChange: (key) => { setSessionSort(key); },
              onToggleOrder: () => setSessionOrder((v) => v === 'desc' ? 'asc' : 'desc'),
            })),
          rows.length === 0 ? h(Empty, null, tt('empty.sessions')) : null,
          rows.map((row) => h('div', { key: row.id, className: 'av-meter-row' },
            h(Meter, {
              label: h('span', null,
                row.shortId ? h('span', { className: 'av-code' }, row.shortId) : null,
                row.title || tt('session.unnamed')),
              value: row.bytes,
              max,
              sub: `${fmtCount(row.artifacts)} ${tt('meta.artifacts')}`,
            })))),

        h('div', { className: 'av-card av-pad' },
          h('div', { className: 'av-section-head' },
            h('div', null,
              h('h3', { className: 'av-section-title' }, tt('trash.title')),
              h('p', { className: 'av-hint', style: { margin: '2px 0 0' } },
                `${tt('trash.subtitle')} · ${fmtCount(trash?.totals?.count ?? 0)} · ${fmtBytes(trash?.totals?.bytes ?? 0)}`)),
            h('div', { className: 'av-head-actions' },
              h(SortBar, {
                value: trashSort, order: trashOrder,
                options: [{ key: 'at' }, { key: 'mtime' }, { key: 'size' }, { key: 'display' }],
                onChange: (key) => setTrashSort(key),
                onToggleOrder: () => setTrashOrder((v) => v === 'desc' ? 'asc' : 'desc'),
              }),
              (trashItems.length > 0) ? h(Btn, { variant: 'ghost danger', onClick: purgeAll }, tt('action.purgeAll')) : null)),
          trashError ? h('div', { className: 'av-err' }, h('span', null, trashError), h(Btn, { variant: 'ghost', onClick: loadTrash }, tt('retry'))) : null,
          trash === null ? h(Skel, null) : null,
          trashItems.length === 0 ? h(Empty, null, tt('trash.empty2')) : null,
          trashItems.map((entry) => h('div', { key: entry.id, className: 'av-trash-item' },
            h('div', { className: 'av-trash-main', onClick: () => setDetailId((v) => v === entry.id ? null : entry.id) },
              entry.kind === 'folder' ? h(Pill, { kind: 'manual' }, tt('trash.folder')) : h(Pill, { kind: 'inferred' }, tt('meta.files')),
              h('span', { className: 'av-trash-name', title: entry.path }, entry.display.split('/').slice(-1)[0] || entry.path),
              !entry.present ? h(Pill, { kind: 'missing' }, tt('trash.missing')) : null,
              h('span', { className: 'av-trash-spacer' }),
              h('span', { className: 'fmeta' }, fmtBytes(entry.size)),
              h('span', { className: 'fmeta' }, fmtTime(entry.at)),
              h('span', { className: 'av-caret' }, detailId === entry.id ? '▾' : '▸')),
            detailId === entry.id ? h('div', { className: 'av-trash-detail' },
              h('div', null, h('span', null, `${tt('cdrive.home')}: `), h('code', null, entry.path)),
              h('div', null, h('span', null, `${tt('meta.folder')}: `), h('code', null, entry.staged)),
              h('div', { className: 'av-trash-actions' },
                h(Btn, { onClick: () => restore(entry), disabled: !entry.present }, tt('action.restore')),
                h(Btn, { variant: 'danger', onClick: () => purge(entry) }, tt('action.purge')))) : null)),

        h(CDriveView, { onToast, onChanged })
      )
    }

    // -------------------------------------------------------- duplicates view
    function DuplicatesView({ onToast }) {
      const tt = useLocaleText()
      const [data, setData] = useState(null)
      const [loading, setLoading] = useState(true)
      const [withUntracked, setWithUntracked] = useState(false)
      const [error, setError] = useState(null)

      const load = useCallback(async (includeUntracked) => {
        setLoading(true)
        setError(null)
        try {
          setData(await request(`duplicates${includeUntracked ? '?untracked=1' : ''}`))
        } catch (caught) {
          setError(caught.message)
        } finally {
          setLoading(false)
        }
      }, [])

      useEffect(() => {
        void load(withUntracked)
      }, [load, withUntracked])

      const recycle = async (file) => {
        if (!window.confirm(tt('confirm.trash', { name: file.display }))) return
        try {
          await request('trash', { method: 'POST', body: { path: file.path } })
          onToast(tt('action.trashed'))
          void load(withUntracked)
        } catch (caught) {
          onToast(`${tt('error.prefix')}: ${caught.message}`)
        }
      }

      return h('div', null,
        h('p', { className: 'av-hint' }, tt('dup.hint')),
        h('div', { className: 'av-toolbar' },
          h('label', { style: { display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 12 } },
            h('input', {
              type: 'checkbox', checked: withUntracked,
              onChange: (event) => setWithUntracked(event.target.checked),
            }),
            tt('dup.includeUntracked')),
          h('span', { style: { flex: 1 } }),
          h(Btn, { onClick: () => load(withUntracked), disabled: loading }, tt('action.reveal'))),
        data ? h('div', { className: 'av-toolbar' },
          h('span', { className: 'av-hint', style: { margin: 0 } },
            `${fmtCount(data.totals.groups)} ${tt('meta.groups')} · ${tt('meta.wasted')} ${fmtBytes(data.totals.wasted)} · ${tt('meta.hashed', { n: fmtCount(data.totals.hashed) })}`)) : null,
        error ? h('div', { className: 'av-err' }, h('span', null, error), h(Btn, { variant: 'ghost', onClick: () => load(withUntracked) }, tt('retry'))) : null,
        loading && !data ? h(Skel, null) : null,
        data && data.groups.length === 0 ? h(Empty, null, tt('empty.duplicates')) : null,
        (data?.groups ?? []).map((group) => h('div', { key: group.hash, className: 'av-card' },
          h('div', { className: 'av-card-head' },
            h('span', { className: 'gname' }, `${fmtBytes(group.size)} × ${group.files.length}`),
            h('span', { className: 'gmeta' }, `${tt('meta.wasted')} ${fmtBytes(group.wasted)}`),
            h('span', { className: 'gmeta', title: group.hash }, group.hash.slice(0, 12))),
          group.files.map((file) => h('div', { key: file.path, className: 'av-ver' },
            h('span', { className: 'fname', title: file.path }, shortPath(file.display, 88)),
            h('span', { className: 'fmeta' }, file.sessions?.length ? `${file.sessions.length} ${tt('meta.sessions', { n: file.sessions.length })}` : ''),
            h('button', { type: 'button', className: 'av-btn ghost danger', onClick: () => recycle(file) }, tt('action.trash')))))))
    }

    // ------------------------------------------------------------ panel root
    function PanelPage() {
      const tt = useLocaleText()
      const vault = useVaultStore()
      const [overview, setOverview] = useState(null)
      const [error, setError] = useState(null)
      const [loading, setLoading] = useState(true)
      const [scan, setScan] = useState(null)
      const [tab, setTab] = useState(vault.tab ?? 'sessions')
      const [query, setQuery] = useState('')
      const [sort, setSort] = useState('recent')
      const [sortOrder, setSortOrder] = useState('desc')
      const [notice, setNotice] = useState(null)
      const [detailId, setDetailId] = useState(vault.sessionId ?? null)
      const noticeTimer = useRef(null)

      const toast = useCallback((message) => {
        setNotice(message)
        if (noticeTimer.current) clearTimeout(noticeTimer.current)
        noticeTimer.current = setTimeout(() => setNotice(null), 3200)
      }, [])

      useEffect(() => () => {
        if (noticeTimer.current) clearTimeout(noticeTimer.current)
      }, [])

      // The header shortcut pushes a session id; honour it whenever it changes.
      useEffect(() => {
        if (vault.sessionId) setDetailId(vault.sessionId)
        if (vault.tab) setTab(vault.tab)
      }, [vault.sessionId, vault.tab])

      const loadOverview = useCallback(async (fresh) => {
        setLoading(true)
        setError(null)
        try {
          setOverview(await request(`overview${fresh ? '?fresh=1' : ''}`))
        } catch (caught) {
          setError(caught.message)
        } finally {
          setLoading(false)
        }
      }, [])

      useEffect(() => {
        void loadOverview(true)
      }, [loadOverview])

      const runScan = useCallback(async () => {
        setScan({ done: 0, total: 0 })
        try {
          let rounds = 0
          let total = 0
          let done = 0
          while (rounds < 12) {
            const result = await request('scan', { method: 'POST', body: { max: 8 } })
            total = result.total ?? total
            done += result.scanned ?? 0
            setScan({ done, total })
            rounds += 1
            if (!result.remaining) break
          }
          toast(`${tt('action.scan')}: ${done}`)
          await loadOverview(false)
        } catch (caught) {
          toast(`${tt('error.prefix')}: ${caught.message}`)
        } finally {
          setScan(null)
        }
      }, [loadOverview, tt])

      const refreshSizes = useCallback(async () => {
        try {
          await request('refresh', { method: 'POST', body: {} })
          await loadOverview(true)
          toast(tt('action.reveal'))
        } catch (caught) {
          toast(`${tt('error.prefix')}: ${caught.message}`)
        }
      }, [loadOverview, tt])

      const sessions = useMemo(() => {
        const rows = [...(overview?.sessions ?? [])]
        const needle = query.trim().toLowerCase()
        const filtered = needle === ''
          ? rows
          : rows.filter((row) => `${row.title ?? ''} ${row.cwd ?? ''} ${row.id}`.toLowerCase().includes(needle))
        const dir = sortOrder === 'asc' ? 1 : -1
        const valueOf = (row) => {
          if (sort === 'bytes') return row.bytes
          if (sort === 'mtime') return row.lastActivity
          if (sort === 'artifacts') return row.artifacts
          if (sort === 'name') return String(row.title ?? '')
          return row.lastActivity
        }
        return filtered.sort((a, b) => {
          const av = valueOf(a)
          const bv = valueOf(b)
          if (typeof av === 'string') return av.localeCompare(bv) * dir
          return (av - bv) * dir
        })
      }, [overview, query, sort, sortOrder])

      const totals = overview?.totals ?? {}
      const tabs = [
        { id: 'sessions', label: tt('tab.sessions'), count: totals.sessions },
        { id: 'untracked', label: tt('tab.untracked'), count: null },
        { id: 'storage', label: tt('tab.storage'), count: null },
        { id: 'duplicates', label: tt('tab.duplicates'), count: null },
      ]

      return h('div', { className: 'av-root' },
        h('div', { className: 'av-scroll' },
          h('div', { className: 'av-head' },
            h('div', null,
              h('h1', { className: 'av-title' }, tt('title')),
              h('p', { className: 'av-sub' }, tt('subtitle'))),
            h('div', { className: 'av-head-actions' },
              h(Btn, { variant: 'primary', onClick: runScan, disabled: scan !== null },
                scan ? tt('action.scanning', { done: scan.done, total: scan.total || '…' }) : tt('action.scan')),
              h(Btn, { onClick: refreshSizes }, tt('action.refresh')))),

          h('div', { className: 'av-stats' },
            h(Stat, { label: tt('stat.sessions'), value: fmtCount(totals.sessions) }),
            h(Stat, { label: tt('stat.artifacts'), value: fmtCount(totals.artifacts) }),
            h(Stat, { label: tt('stat.bytes'), value: fmtBytes(totals.bytes) }),
            h(Stat, { label: tt('stat.missing'), value: fmtCount(totals.missing) }),
            h(Stat, { label: tt('stat.trash'), value: fmtBytes(totals.trashBytes) })),

          error ? h('div', { className: 'av-err' },
            h('span', null, `${tt('error.prefix')}: ${error}`),
            h(Btn, { variant: 'ghost', onClick: () => loadOverview(true) }, tt('retry'))) : null,

          h('div', { className: 'av-toolbar' },
            h('div', { className: 'av-tabs', role: 'tablist' },
              tabs.map((entry) => h('button', {
                key: entry.id,
                type: 'button',
                role: 'tab',
                className: `av-tab${tab === entry.id ? ' on' : ''}`,
                onClick: () => setTab(entry.id),
              }, entry.count === null || entry.count === undefined ? entry.label : `${entry.label} ${entry.count}`))),
            tab === 'sessions'
              ? h('input', {
                className: 'av-search',
                value: query,
                placeholder: tt('search.sessions'),
                onChange: (event) => setQuery(event.target.value),
              })
              : h('span', { style: { flex: 1 } }),
            tab === 'sessions'
              ? h(SortBar, {
                value: sort, order: sortOrder,
                options: [{ key: 'recent' }, { key: 'bytes' }, { key: 'mtime' }, { key: 'artifacts' }, { key: 'name' }],
                onChange: (key) => setSort(key),
                onToggleOrder: () => setSortOrder((v) => v === 'desc' ? 'asc' : 'desc'),
              })
              : null),

          loading && !overview ? h(Skel, null) : null,

          tab === 'sessions'
            ? (detailId
              ? h(SessionDetail, {
                sessionId: detailId,
                onBack: () => {
                  setDetailId(null)
                  patchVault({ sessionId: null })
                },
                onChanged: () => loadOverview(false),
                onToast: toast,
              })
              : (sessions.length === 0
                ? h(Empty, null, loading ? tt('loading') : tt('empty.sessions'))
                : h('div', { className: 'av-list' },
                  sessions.map((row) => h(SessionRow, { key: row.id, row, onOpen: setDetailId })))))
            : null,

          tab === 'untracked' ? h(UntrackedView, { onToast: toast }) : null,
          tab === 'storage' ? h(StorageView, { overview, onToast: toast, onChanged: () => loadOverview(false) }) : null,
          tab === 'duplicates' ? h(DuplicatesView, { onToast: toast }) : null,

          notice ? h('div', { className: 'av-toast' }, notice) : null,

          overview
            ? h('div', { className: 'av-hint', style: { marginTop: 16, marginBottom: 0 } },
              `${tt('footer.dataDir')}: ${overview.roots?.length ? overview.roots.join(' · ') : '—'}`)
            : null))
    }

    // ------------------------------------------------------------------ apply
    function apply(ctx) {
      try {
        localeService = ctx.get('locale', false)
      } catch {
        localeService = null
      }
      ensureStyles()

      ctx.effect(() => {
        try {
          localeService?.register?.(NS, 'zh', DICT.zh)
          localeService?.register?.(NS, 'en', DICT.en)
        } catch {
          /* registration is cosmetic; the bundled dictionaries still work */
        }
        return () => {}
      }, 'artifact-vault: locale')

      ctx.slots.inject('settings.section', () => ctx.slots.register(
        { name: 'settings.section', id: PANEL_ID, order: 47, label: () => t('entry.label') },
        PanelPage))

      ctx.slots.inject('settings.section.icon', () => ctx.slots.register(
        { name: 'settings.section.icon', id: PANEL_ID, order: 47 },
        SectionIcon))
    }

    return { inject: ['slots', 'locale'], apply }
  },
})
