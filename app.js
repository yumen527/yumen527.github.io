(function () {
  const seed = window.NOTE_LIBRARY || { categories: [] };
  const config = window.SUPABASE_CONFIG || {};
  const view = document.getElementById("view");
  const searchInput = document.getElementById("searchInput");
  const searchPanel = document.getElementById("searchPanel");
  const searchToggle = document.querySelector(".search-toggle");
  const authSlot = document.getElementById("authSlot");
  const AUTH_SESSION_KEY = "thought-note-supabase-session-v1";
  const LONG_PRESS_MS = 520;
  const ROOT_ID = "root";

  const configReady = Boolean(
    config.url &&
      config.anonKey &&
      !config.url.includes("YOUR_") &&
      !config.anonKey.includes("YOUR_")
  );
  const cloudReady = configReady;

  let folders = [];
  let notes = [];
  let library = { root: { id: ROOT_ID, name: "书房", folders: [], notes: [] } };
  let session = loadStoredSession();
  let isAdmin = false;
  let currentError = "";
  let hasExtendedFields = true;
  let selectionMode = false;
  let selectedItems = new Map();
  let searchOpen = false;
  let authMenuOpen = false;
  let pageActionsOpen = false;
  let pressTimer = null;
  let suppressNextClickKey = "";

  function loadStoredSession() {
    try {
      return JSON.parse(localStorage.getItem(AUTH_SESSION_KEY) || "null");
    } catch {
      localStorage.removeItem(AUTH_SESSION_KEY);
      return null;
    }
  }

  function storeSession(nextSession) {
    session = nextSession;
    if (nextSession) localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(nextSession));
    else localStorage.removeItem(AUTH_SESSION_KEY);
  }

  async function api(path, options = {}, useUserToken = false) {
    if (!configReady) throw new Error("Supabase 尚未配置");
    const token = useUserToken && session?.access_token ? session.access_token : config.anonKey;
    const response = await fetch(`${config.url}${path}`, {
      ...options,
      headers: {
        apikey: config.anonKey,
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    });

    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    if (!response.ok) {
      throw new Error(body?.message || body?.error_description || body?.error || "云端请求失败");
    }
    return body;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function markdownToHtml(markdown) {
    const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
    const blocks = [];
    let paragraph = [];

    function inline(text) {
      return escapeHtml(text)
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.+?)\*/g, "<em>$1</em>")
        .replace(/`(.+?)`/g, "<code>$1</code>")
        .replace(/\n/g, "<br>");
    }

    function flushParagraph() {
      if (!paragraph.length) return;
      blocks.push(`<p>${inline(paragraph.join("\n"))}</p>`);
      paragraph = [];
    }

    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      if (!line.trim()) {
        flushParagraph();
        continue;
      }

      const heading = /^(#{1,3})\s+(.+)$/.exec(line);
      if (heading) {
        flushParagraph();
        const level = Math.min(heading[1].length + 1, 4);
        blocks.push(`<h${level}>${inline(heading[2])}</h${level}>`);
        continue;
      }

      const quote = /^>\s?(.+)$/.exec(line);
      if (quote) {
        flushParagraph();
        blocks.push(`<blockquote>${inline(quote[1])}</blockquote>`);
        continue;
      }

      paragraph.push(line);
    }

    flushParagraph();
    return blocks.join("");
  }

  function plainText(content) {
    return String(content || "").replace(/[#*_`>]/g, "").replace(/\s+/g, " ").trim();
  }

  function excerpt(content) {
    const text = plainText(content);
    return text.length > 70 ? `${text.slice(0, 70)}...` : text;
  }

  function countNotes(folder) {
    return folder.notes.length + folder.folders.reduce((sum, child) => sum + countNotes(child), 0);
  }

  function countFolders(folder) {
    return folder.folders.length + folder.folders.reduce((sum, child) => sum + countFolders(child), 0);
  }

  function itemKey(type, id) {
    return `${type}:${id}`;
  }

  function selectedArray() {
    return Array.from(selectedItems.values());
  }

  function isSelected(type, id) {
    return selectedItems.has(itemKey(type, id));
  }

  function clearSelection(render = true) {
    selectionMode = false;
    selectedItems = new Map();
    if (render) route();
  }

  function enterSelection(type, id) {
    if (!isAdmin || !id || id === ROOT_ID) return;
    selectionMode = true;
    selectedItems.set(itemKey(type, id), { type, id });
    route();
  }

  function toggleSelection(type, id) {
    if (!isAdmin || !selectionMode || !id || id === ROOT_ID) return;
    const key = itemKey(type, id);
    if (selectedItems.has(key)) selectedItems.delete(key);
    else selectedItems.set(key, { type, id });
    if (!selectedItems.size) selectionMode = false;
    route();
  }

  function getItem(item) {
    if (item.type === "folder") return findFolder(item.id)?.folder || null;
    return findNote(item.id)?.note || null;
  }

  function findFolder(id, folder = library.root, trail = []) {
    if (folder.id === id) return { folder, trail: [...trail, folder] };
    for (const child of folder.folders) {
      const found = findFolder(id, child, [...trail, folder]);
      if (found) return found;
    }
    return null;
  }

  function findNote(id, folder = library.root, trail = []) {
    const note = folder.notes.find((item) => item.id === id);
    if (note) return { note, folder, trail: [...trail, folder] };
    for (const child of folder.folders) {
      const found = findNote(id, child, [...trail, folder]);
      if (found) return found;
    }
    return null;
  }

  function allNotes(folder = library.root, trail = []) {
    return [
      ...folder.notes.map((note) => ({ note, folder, trail: [...trail, folder] })),
      ...folder.folders.flatMap((child) => allNotes(child, [...trail, folder])),
    ];
  }

  function allFolders(folder = library.root, trail = []) {
    return [
      { folder, trail: [...trail, folder] },
      ...folder.folders.flatMap((child) => allFolders(child, [...trail, folder])),
    ];
  }

  function isFolderInside(folderId, possibleAncestorId) {
    const found = findFolder(folderId);
    return Boolean(found?.trail.some((item) => item.id === possibleAncestorId));
  }

  function compareFolders(a, b) {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
    const orderDiff = Number(a.sort_order || 0) - Number(b.sort_order || 0);
    if (orderDiff) return orderDiff;
    return String(a.created_at || "").localeCompare(String(b.created_at || ""));
  }

  function compareNotes(a, b) {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
    const orderDiff = Number(a.sort_order || 0) - Number(b.sort_order || 0);
    if (orderDiff) return orderDiff;
    return String(b.updated_at || "").localeCompare(String(a.updated_at || ""));
  }

  function sortTree(folder) {
    folder.folders.sort(compareFolders);
    folder.notes.sort(compareNotes);
    folder.folders.forEach(sortTree);
  }

  function normalizeFolder(folder) {
    return {
      ...folder,
      pinned: Boolean(folder.pinned),
      sort_order: Number(folder.sort_order || 0),
      folders: [],
      notes: [],
    };
  }

  function normalizeNote(note) {
    return {
      ...note,
      pinned: Boolean(note.pinned),
      sort_order: Number(note.sort_order || 0),
    };
  }

  function buildTree() {
    const root = { id: ROOT_ID, name: "书房", folders: [], notes: [] };
    const byId = new Map();

    folders.forEach((folder) => {
      byId.set(folder.id, normalizeFolder(folder));
    });

    byId.forEach((folder) => {
      const parent = folder.parent_id ? byId.get(folder.parent_id) : root;
      (parent || root).folders.push(folder);
    });

    notes.forEach((note) => {
      const normalized = normalizeNote(note);
      const parent = normalized.folder_id ? byId.get(normalized.folder_id) : root;
      (parent || root).notes.push(normalized);
    });

    sortTree(root);
    library = { root };
  }

  function buildPreviewTree() {
    library = {
      root: {
        id: ROOT_ID,
        name: "书房",
        folders: seed.categories.map((category, index) => ({
          id: `preview-folder-${index}`,
          name: category.name,
          pinned: false,
          sort_order: index,
          folders: [],
          notes: category.notes.map((note, noteIndex) => ({
            id: `preview-note-${index}-${noteIndex}`,
            title: note.title,
            content: note.content || "",
            updated_at: note.updatedAt || today(),
            pinned: false,
            sort_order: noteIndex,
          })),
        })),
        notes: [],
      },
    };
  }

  async function refreshAuth() {
    if (!configReady || !session?.access_token) {
      session = null;
      isAdmin = false;
      return;
    }

    try {
      const adminResult = await api(
        "/rest/v1/rpc/is_notes_admin",
        {
          method: "POST",
          body: "{}",
        },
        true
      );
      isAdmin = adminResult === true;
    } catch {
      storeSession(null);
      isAdmin = false;
    }
  }

  async function fetchCloudRows() {
    try {
      const [folderResult, noteResult] = await Promise.all([
        api("/rest/v1/folders?select=id,name,parent_id,pinned,sort_order,created_at,updated_at&order=created_at.asc"),
        api("/rest/v1/notes?select=id,title,content,folder_id,pinned,sort_order,created_at,updated_at&order=updated_at.desc"),
      ]);
      hasExtendedFields = true;
      return [folderResult || [], noteResult || []];
    } catch (firstError) {
      const [folderResult, noteResult] = await Promise.all([
        api("/rest/v1/folders?select=id,name,parent_id,created_at,updated_at&order=created_at.asc"),
        api("/rest/v1/notes?select=id,title,content,folder_id,created_at,updated_at&order=updated_at.desc"),
      ]);
      hasExtendedFields = false;
      return [folderResult || [], noteResult || []];
    }
  }

  async function loadCloudData() {
    if (!configReady) {
      buildPreviewTree();
      return;
    }

    currentError = "";
    try {
      const [folderResult, noteResult] = await fetchCloudRows();
      folders = folderResult;
      notes = noteResult;
      buildTree();
    } catch (error) {
      currentError = error.message || "无法读取云端数据";
      buildPreviewTree();
    }
  }

  async function refresh() {
    await refreshAuth();
    await loadCloudData();
    selectedItems.forEach((item, key) => {
      if (!getItem(item)) selectedItems.delete(key);
    });
    if (!selectedItems.size) selectionMode = false;
    renderAuthControls();
    route();
  }

  function renderAuthControls() {
    if (!cloudReady) {
      authSlot.innerHTML = `
        <button class="icon-button auth-menu-toggle" type="button" data-action="toggle-auth-menu" aria-label="云端状态" aria-expanded="${authMenuOpen}">
          <span class="menu-dot" aria-hidden="true"></span>
        </button>
        ${authMenuOpen ? `<div class="auth-menu"><span class="menu-label">云端未配置</span></div>` : ""}
      `;
      return;
    }

    if (isAdmin) {
      authSlot.innerHTML = `
        <button class="icon-button auth-menu-toggle is-admin" type="button" data-action="toggle-auth-menu" aria-label="管理菜单" aria-expanded="${authMenuOpen}">
          <span class="menu-dot" aria-hidden="true"></span>
        </button>
        ${
          authMenuOpen
            ? `
              <div class="auth-menu">
                <span class="menu-label">编辑模式</span>
                <button class="menu-item" type="button" data-action="logout">退出</button>
              </div>
            `
            : ""
        }
      `;
      return;
    }

    authSlot.innerHTML = `
      <button class="icon-button auth-menu-toggle" type="button" data-action="toggle-auth-menu" aria-label="管理菜单" aria-expanded="${authMenuOpen}">
        <span class="menu-dot" aria-hidden="true"></span>
      </button>
      ${
        authMenuOpen
          ? `
            <div class="auth-menu">
              <span class="menu-label">只读模式</span>
              <button class="menu-item" type="button" data-action="login">管理员登录</button>
            </div>
          `
          : ""
      }
    `;
  }

  function syncTopbarControls() {
    searchPanel?.classList.toggle("is-open", searchOpen);
    searchPanel?.setAttribute("aria-hidden", String(!searchOpen));
    searchToggle?.classList.toggle("is-active", searchOpen);
    searchToggle?.setAttribute("aria-expanded", String(searchOpen));
    searchToggle?.setAttribute("aria-label", searchOpen ? "关闭搜索" : "打开搜索");
  }

  function setSearchOpen(nextOpen, focusInput = true) {
    searchOpen = nextOpen;
    syncTopbarControls();
    if (searchOpen && focusInput) window.setTimeout(() => searchInput?.focus(), 0);
  }

  function closeSearch(clearValue = false) {
    if (clearValue && searchInput.value.trim()) {
      searchInput.value = "";
      route();
    }
    setSearchOpen(false, false);
  }

  function toggleAuthMenu() {
    authMenuOpen = !authMenuOpen;
    renderAuthControls();
  }

  function togglePageActions() {
    pageActionsOpen = !pageActionsOpen;
    route();
  }

  function renderPageActions({ folderId, includeNote = false, includeImport = false }) {
    if (!isAdmin) return `<p class="read-only-note">只读模式</p>`;
    const safeFolderId = escapeHtml(folderId);
    const importButton = includeImport
      ? `<button class="button page-action-item" type="button" data-action="import-seed">导入初始笔记</button>`
      : "";
    const folderButton = `<button class="button page-action-item" type="button" data-action="add-folder" data-folder-id="${safeFolderId}">+ 文件夹</button>`;
    const noteButton = includeNote
      ? `<button class="button primary page-action-item" type="button" data-action="add-note" data-folder-id="${safeFolderId}">+ 笔记</button>`
      : "";
    return `
      <div class="actions page-actions">
        <button class="icon-button page-action-toggle" type="button" data-action="toggle-page-actions" aria-label="新增" aria-expanded="${pageActionsOpen}">
          <span class="plus-icon" aria-hidden="true"></span>
        </button>
        <div class="page-actions-menu ${pageActionsOpen ? "is-open" : ""}">
          ${importButton}
          ${folderButton}
          ${noteButton}
        </div>
      </div>
    `;
  }

  function renderBreadcrumb(trail) {
    return `
      <nav class="crumbs" aria-label="路径">
        ${trail
          .map(
            (folder, index) => `
              <a href="#/${folder.id === ROOT_ID ? "" : `folder/${encodeURIComponent(folder.id)}`}">
                ${escapeHtml(index === 0 ? "书房" : folder.name)}
              </a>
            `
          )
          .join('<span aria-hidden="true">/</span>')}
      </nav>
    `;
  }

  function renderSetupNotice() {
    if (cloudReady && !currentError) return "";
    const message = currentError
      ? `云端读取失败：${currentError}`
      : "还没有填写 Supabase 配置。当前只是预览初始笔记，配置完成后会使用云端数据库。";
    return `<div class="setup-card">${escapeHtml(message)}</div>`;
  }

  function renderExtensionNotice() {
    if (!isAdmin || hasExtendedFields) return "";
    return `<div class="setup-card">当前数据库还没有新版置顶字段。重命名、移动、删除可用；置顶需要先在 Supabase 执行新版 SQL。</div>`;
  }

  function renderHome() {
    const root = library.root;
    view.innerHTML = `
      ${renderSetupNotice()}
      ${renderExtensionNotice()}
      <section class="page-head">
        <div>
          <p class="eyebrow">Bookshelf</p>
          <h1>书房</h1>
        </div>
        ${renderPageActions({
          folderId: ROOT_ID,
          includeImport: root.folders.length === 0 && seed.categories.length,
        })}
      </section>

      <section class="shelves">
        ${
          root.folders.length
            ? root.folders.map((folder) => renderShelf(folder)).join("")
            : renderEmptyShelf("还没有文件夹")
        }
      </section>
      ${renderSelectionBar()}
    `;
  }

  function renderSelectionMark(type, id) {
    if (!isAdmin) return "";
    return `<span class="selection-mark" aria-hidden="true">${isSelected(type, id) ? "✓" : ""}</span>`;
  }

  function renderPinnedBadge(item) {
    return item.pinned ? `<span class="pin-badge">置顶</span>` : "";
  }

  function renderShelf(folder) {
    const noteCount = countNotes(folder);
    const folderCount = countFolders(folder);
    const selected = isSelected("folder", folder.id);
    return `
      <article class="shelf ${selected ? "is-selected" : ""} ${folder.pinned ? "is-pinned" : ""}" data-selectable="true" data-item-type="folder" data-item-id="${escapeHtml(folder.id)}">
        ${renderSelectionMark("folder", folder.id)}
        ${renderPinnedBadge(folder)}
        <a class="shelf-link" href="#/folder/${encodeURIComponent(folder.id)}">
          <span class="folder-cover" aria-hidden="true">
            <span></span>
            <span></span>
            <span></span>
          </span>
          <div class="shelf-title">
            <h2>${escapeHtml(folder.name)}</h2>
            <span>${folderCount} 个文件夹 · ${noteCount} 篇笔记</span>
          </div>
        </a>
      </article>
    `;
  }

  function renderEmptyShelf(text) {
    return `
      <article class="shelf empty-shelf">
        <span class="folder-cover muted-cover" aria-hidden="true">
          <span></span>
          <span></span>
          <span></span>
        </span>
        <div class="shelf-title">
          <h2>${escapeHtml(text)}</h2>
          <span>等待第一本书</span>
        </div>
      </article>
    `;
  }

  function renderFolder(id) {
    const found = findFolder(id);
    if (!found) {
      renderHome();
      return;
    }

    const { folder, trail } = found;
    view.innerHTML = `
      ${renderBreadcrumb(trail)}
      ${renderExtensionNotice()}
      <section class="page-head">
        <div>
          <p class="eyebrow">Folder</p>
          <h1>${escapeHtml(folder.name)}</h1>
        </div>
        ${renderPageActions({ folderId: folder.id, includeNote: true })}
      </section>

      <section class="shelves sub-shelves">
        ${folder.folders.length ? folder.folders.map((child) => renderShelf(child)).join("") : ""}
      </section>

      <section class="note-shelf">
        <div class="section-line">
          <span>笔记</span>
        </div>
        ${
          folder.notes.length
            ? `<div class="note-grid">${folder.notes.map((note) => renderNoteCard(note)).join("")}</div>`
            : `<div class="quiet">空</div>`
        }
      </section>
      ${renderSelectionBar()}
    `;
  }

  function renderNoteCard(note) {
    const selected = isSelected("note", note.id);
    return `
      <a class="note-card ${selected ? "is-selected" : ""} ${note.pinned ? "is-pinned" : ""}" href="#/note/${encodeURIComponent(note.id)}" data-selectable="true" data-item-type="note" data-item-id="${escapeHtml(note.id)}">
        ${renderSelectionMark("note", note.id)}
        ${renderPinnedBadge(note)}
        <span class="note-cover" aria-hidden="true"></span>
        <strong>${escapeHtml(note.title || "未命名笔记")}</strong>
        <span>${escapeHtml(excerpt(note.content)) || "空白笔记"}</span>
      </a>
    `;
  }

  function renderSelectionBar() {
    if (!isAdmin || !selectionMode) return "";
    const items = selectedArray();
    const pinnedItems = items.map(getItem).filter(Boolean).filter((item) => item.pinned);
    const pinLabel = items.length && pinnedItems.length === items.length ? "取消置顶" : "置顶";
    return `
      <div class="selection-bar" role="region" aria-label="选择操作">
        <div class="selection-count">
          <strong>${items.length}</strong>
          <span>已选择</span>
        </div>
        <div class="selection-actions">
          <button class="button" type="button" data-action="toggle-pin-selected">${pinLabel}</button>
          <button class="button" type="button" data-action="open-move-selected">分组至</button>
          <button class="button" type="button" data-action="rename-selected" ${items.length === 1 ? "" : "disabled"}>重命名</button>
          <button class="button danger-button" type="button" data-action="delete-selected">删除</button>
          <button class="button" type="button" data-action="clear-selection">取消</button>
        </div>
      </div>
    `;
  }

  function renderNote(id) {
    const found = findNote(id);
    if (!found) {
      renderHome();
      return;
    }

    const { note, folder, trail } = found;
    view.innerHTML = `
      ${renderBreadcrumb(trail)}
      <article class="reader">
        <header class="reader-head">
          <a class="button back-button" href="#/folder/${encodeURIComponent(folder.id)}">返回文件夹</a>
          ${
            isAdmin
              ? `<button class="button primary" type="button" data-action="edit-note" data-note-id="${escapeHtml(note.id)}">编辑</button>`
              : `<span class="read-only-note">只读</span>`
          }
        </header>
        <p class="reader-title">${escapeHtml(note.title || "未命名笔记")}</p>
        <div class="reader-body">${markdownToHtml(note.content)}</div>
      </article>
    `;
  }

  function renderEditor(id) {
    const found = findNote(id);
    if (!found) {
      renderHome();
      return;
    }
    if (!isAdmin) {
      renderNote(id);
      return;
    }

    const { note, trail } = found;
    view.innerHTML = `
      ${renderBreadcrumb(trail)}
      <form class="editor" data-note-id="${escapeHtml(note.id)}">
        <div class="editor-head">
          <a class="button back-button" href="#/note/${encodeURIComponent(note.id)}">返回阅读</a>
          <button class="button primary" type="submit">保存</button>
        </div>
        <input class="title-input" name="title" value="${escapeHtml(note.title || "")}" placeholder="标题" />
        <textarea class="content-input" name="content" placeholder="写点什么">${escapeHtml(note.content || "")}</textarea>
      </form>
    `;
  }

  function renderSearch(query) {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      route();
      return;
    }

    const results = allNotes().filter(({ note, folder }) =>
      `${note.title} ${note.content} ${folder.name}`.toLowerCase().includes(normalized)
    );

    view.innerHTML = `
      <section class="page-head">
        <div>
          <p class="eyebrow">Search</p>
          <h1>搜索</h1>
        </div>
      </section>
      ${
        results.length
          ? `<div class="note-grid">${results.map(({ note }) => renderNoteCard(note)).join("")}</div>`
          : `<div class="quiet">没有找到</div>`
      }
      ${renderSelectionBar()}
    `;
  }

  function insertModal(html, focusSelector = ".modal-input") {
    document.querySelector(".modal-backdrop")?.remove();
    document.body.insertAdjacentHTML("beforeend", html);
    const input = document.querySelector(focusSelector);
    input?.focus();
    if (input?.select) input.select();
  }

  function openFolderDialog(parentId) {
    if (!isAdmin) return;
    insertModal(`
      <div class="modal-backdrop">
        <form class="modal folder-form" data-folder-id="${escapeHtml(parentId)}">
          <div class="modal-head">
            <strong>新文件夹</strong>
            <button class="plain-button" type="button" data-action="close-modal" aria-label="关闭">×</button>
          </div>
          <input class="modal-input" name="name" placeholder="文件夹名称" autocomplete="off" />
          <p class="modal-hint">名称会显示在书架卡片上，建议保持简短。</p>
          <div class="modal-actions">
            <button class="button" type="button" data-action="close-modal">取消</button>
            <button class="button primary" type="submit">添加</button>
          </div>
        </form>
      </div>
    `);
  }

  function openLoginDialog() {
    if (!cloudReady) return;
    insertModal(`
      <div class="modal-backdrop">
        <form class="modal login-form">
          <div class="modal-head">
            <strong>管理员登录</strong>
            <button class="plain-button" type="button" data-action="close-modal" aria-label="关闭">×</button>
          </div>
          <input class="modal-input" type="email" name="email" placeholder="邮箱" autocomplete="email" />
          <input class="modal-input" type="password" name="password" placeholder="密码" autocomplete="current-password" />
          <p class="modal-hint">登录成功后，云端权限策略会决定你是否可以编辑。</p>
          <div class="modal-actions">
            <button class="button" type="button" data-action="close-modal">取消</button>
            <button class="button primary" type="submit">登录</button>
          </div>
        </form>
      </div>
    `);
  }

  async function login(form) {
    const data = new FormData(form);
    const email = String(data.get("email") || "").trim();
    const password = String(data.get("password") || "");
    const hint = form.querySelector(".modal-hint");

    try {
      const authResult = await api("/auth/v1/token?grant_type=password", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      storeSession({
        access_token: authResult.access_token,
        refresh_token: authResult.refresh_token,
        user: authResult.user,
      });
    } catch (error) {
      hint.textContent = error.message || "登录失败。";
      return;
    }

    document.querySelector(".modal-backdrop")?.remove();
    await refresh();
  }

  async function logout() {
    storeSession(null);
    isAdmin = false;
    clearSelection(false);
    await refresh();
  }

  function openRenameSelectedDialog() {
    if (!isAdmin) return;
    const items = selectedArray();
    if (items.length !== 1) return;
    const item = items[0];
    const target = getItem(item);
    if (!target) return;
    const currentName = item.type === "folder" ? target.name : target.title;
    insertModal(`
      <div class="modal-backdrop">
        <form class="modal item-rename-form" data-item-type="${item.type}" data-item-id="${escapeHtml(item.id)}">
          <div class="modal-head">
            <strong>重命名</strong>
            <button class="plain-button" type="button" data-action="close-modal" aria-label="关闭">×</button>
          </div>
          <input class="modal-input" name="name" value="${escapeHtml(currentName || "")}" placeholder="名称" autocomplete="off" />
          <p class="modal-hint">${item.type === "folder" ? "只会修改文件夹显示名称，里面的内容不会改变。" : "笔记名称会同步为编辑页里的标题。"}</p>
          <div class="modal-actions">
            <button class="button" type="button" data-action="close-modal">取消</button>
            <button class="button primary" type="submit">保存</button>
          </div>
        </form>
      </div>
    `);
  }

  function openDeleteSelectedDialog() {
    if (!isAdmin || !selectedItems.size) return;
    const items = selectedArray();
    const folderCount = items.filter((item) => item.type === "folder").length;
    const noteCount = items.filter((item) => item.type === "note").length;
    insertModal(
      `
        <div class="modal-backdrop">
          <form class="modal selected-delete-form">
            <div class="modal-head">
              <strong>删除所选内容</strong>
              <button class="plain-button" type="button" data-action="close-modal" aria-label="关闭">×</button>
            </div>
            <p class="modal-hint">确定删除 ${items.length} 项吗？包含 ${folderCount} 个文件夹、${noteCount} 篇笔记。文件夹里的子文件夹和笔记也会一起删除，此操作不可撤销。</p>
            <div class="modal-actions">
              <button class="button" type="button" data-action="close-modal">取消</button>
              <button class="button danger-button" type="submit">删除</button>
            </div>
          </form>
        </div>
      `,
      ".danger-button"
    );
  }

  function moveOptionLabel(folder, trail) {
    if (folder.id === ROOT_ID) return "书房";
    return trail
      .filter((item) => item.id !== ROOT_ID)
      .map((item) => item.name)
      .join(" / ");
  }

  function openMoveSelectedDialog() {
    if (!isAdmin || !selectedItems.size) return;
    const items = selectedArray();
    const includesNote = items.some((item) => item.type === "note");
    const selectedFolderIds = items.filter((item) => item.type === "folder").map((item) => item.id);
    const options = allFolders()
      .filter(({ folder }) => {
        if (folder.id === ROOT_ID) return !includesNote;
        return !selectedFolderIds.some((folderId) => folder.id === folderId || isFolderInside(folder.id, folderId));
      })
      .map(({ folder, trail }) => `<option value="${escapeHtml(folder.id)}">${escapeHtml(moveOptionLabel(folder, trail))}</option>`)
      .join("");
    if (!options) return showError("没有可移动到的目标文件夹。");

    insertModal(
      `
        <div class="modal-backdrop">
          <form class="modal selected-move-form">
            <div class="modal-head">
              <strong>分组至</strong>
              <button class="plain-button" type="button" data-action="close-modal" aria-label="关闭">×</button>
            </div>
            <select class="modal-input" name="target">${options}</select>
            <p class="modal-hint">所选文件夹和笔记会移动到目标文件夹。文件夹不能移动到自己或自己的子文件夹里。</p>
            <div class="modal-actions">
              <button class="button" type="button" data-action="close-modal">取消</button>
              <button class="button primary" type="submit">移动</button>
            </div>
          </form>
        </div>
      `,
      ".modal-input"
    );
  }

  function ensureExtendedFields() {
    if (hasExtendedFields) return true;
    showError("请先在 Supabase SQL 编辑器运行新版 supabase-schema.sql，才能使用置顶。");
    return false;
  }

  async function addFolder(form) {
    if (!isAdmin) return;
    const parentId = form.dataset.folderId;
    const name = String(new FormData(form).get("name") || "").trim();
    if (!name) return;

    try {
      await api(
        "/rest/v1/folders",
        {
          method: "POST",
          body: JSON.stringify({
            name,
            parent_id: parentId === ROOT_ID ? null : parentId,
          }),
        },
        true
      );
      document.querySelector(".modal-backdrop")?.remove();
      await refresh();
      location.hash = parentId === ROOT_ID ? "#/" : `#/folder/${encodeURIComponent(parentId)}`;
    } catch (error) {
      showError(error.message);
    }
  }

  async function renameSelectedItem(form) {
    if (!isAdmin) return;
    const type = form.dataset.itemType;
    const id = form.dataset.itemId;
    const name = String(new FormData(form).get("name") || "").trim();
    if (!name || !id) return;

    try {
      if (type === "folder") {
        await api(`/rest/v1/folders?id=eq.${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify({ name }),
        }, true);
      } else {
        await api(`/rest/v1/notes?id=eq.${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify({ title: name }),
        }, true);
      }
      document.querySelector(".modal-backdrop")?.remove();
      clearSelection(false);
      await refresh();
    } catch (error) {
      showError(error.message);
    }
  }

  function shouldReturnHomeAfterDelete(items) {
    const hash = decodeURIComponent(location.hash || "#/");
    const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
    if (!parts.length) return false;
    const selectedFolderIds = items.filter((item) => item.type === "folder").map((item) => item.id);
    if (parts[0] === "folder") return selectedFolderIds.some((id) => parts[1] === id || isFolderInside(parts[1], id));
    if (parts[0] === "note") {
      const found = findNote(parts[1]);
      return Boolean(found && selectedFolderIds.some((id) => found.trail.some((folder) => folder.id === id)));
    }
    return false;
  }

  async function deleteSelectedItems() {
    if (!isAdmin || !selectedItems.size) return;
    const items = selectedArray();
    const returnHome = shouldReturnHomeAfterDelete(items);
    const noteIds = items.filter((item) => item.type === "note").map((item) => item.id);
    const folderIds = items.filter((item) => item.type === "folder").map((item) => item.id);

    try {
      await Promise.all([
        ...noteIds.map((id) => api(`/rest/v1/notes?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" }, true)),
        ...folderIds.map((id) => api(`/rest/v1/folders?id=eq.${encodeURIComponent(id)}`, { method: "DELETE" }, true)),
      ]);
      document.querySelector(".modal-backdrop")?.remove();
      clearSelection(false);
      await refresh();
      if (returnHome) location.hash = "#/";
    } catch (error) {
      showError(error.message);
    }
  }

  async function moveSelectedItems(form) {
    if (!isAdmin || !selectedItems.size) return;
    const target = String(new FormData(form).get("target") || ROOT_ID);
    const targetId = target === ROOT_ID ? null : target;
    const items = selectedArray();
    if (!targetId && items.some((item) => item.type === "note")) {
      showError("笔记需要放在某个文件夹里，不能移动到书房根目录。");
      return;
    }

    try {
      await Promise.all(
        items.map((item) => {
          if (item.type === "folder") {
            return api(`/rest/v1/folders?id=eq.${encodeURIComponent(item.id)}`, {
              method: "PATCH",
              body: JSON.stringify({ parent_id: targetId }),
            }, true);
          }
          return api(`/rest/v1/notes?id=eq.${encodeURIComponent(item.id)}`, {
            method: "PATCH",
            body: JSON.stringify({ folder_id: targetId }),
          }, true);
        })
      );
      document.querySelector(".modal-backdrop")?.remove();
      clearSelection(false);
      await refresh();
      location.hash = targetId ? `#/folder/${encodeURIComponent(targetId)}` : "#/";
    } catch (error) {
      showError(error.message);
    }
  }

  async function togglePinSelected() {
    if (!isAdmin || !selectedItems.size || !ensureExtendedFields()) return;
    const items = selectedArray();
    const nextPinned = !items.map(getItem).filter(Boolean).every((item) => item.pinned);

    try {
      await Promise.all(
        items.map((item) => {
          const table = item.type === "folder" ? "folders" : "notes";
          return api(`/rest/v1/${table}?id=eq.${encodeURIComponent(item.id)}`, {
            method: "PATCH",
            body: JSON.stringify({ pinned: nextPinned }),
          }, true);
        })
      );
      clearSelection(false);
      await refresh();
    } catch (error) {
      showError(error.message);
    }
  }

  async function addNote(folderId) {
    if (!isAdmin) return;
    try {
      const rows = await api(
        "/rest/v1/notes?select=id",
        {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({ folder_id: folderId, title: "新笔记", content: "" }),
        },
        true
      );
      await refresh();
      location.hash = `#/edit/${encodeURIComponent(rows[0].id)}`;
    } catch (error) {
      showError(error.message);
    }
  }

  async function saveNote(form) {
    if (!isAdmin) return;
    const found = findNote(form.dataset.noteId);
    if (!found) return;

    const data = new FormData(form);
    try {
      await api(
        `/rest/v1/notes?id=eq.${encodeURIComponent(found.note.id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            title: String(data.get("title") || "").trim() || "未命名笔记",
            content: String(data.get("content") || ""),
          }),
        },
        true
      );
      await refresh();
      location.hash = `#/note/${encodeURIComponent(found.note.id)}`;
    } catch (error) {
      showError(error.message);
    }
  }

  async function importSeed() {
    if (!isAdmin || !seed.categories.length) return;
    for (const category of seed.categories) {
      let folder;
      try {
        const folderRows = await api(
          "/rest/v1/folders?select=id",
          {
            method: "POST",
            headers: { Prefer: "return=representation" },
            body: JSON.stringify({ name: category.name, parent_id: null }),
          },
          true
        );
        folder = folderRows[0];
      } catch (error) {
        return showError(error.message);
      }

      const rows = category.notes.map((note) => ({
        folder_id: folder.id,
        title: note.title || "未命名笔记",
        content: note.content || "",
      }));
      if (rows.length) {
        try {
          await api(
            "/rest/v1/notes",
            {
              method: "POST",
              body: JSON.stringify(rows),
            },
            true
          );
        } catch (error) {
          return showError(error.message);
        }
      }
    }
    await refresh();
  }

  function showError(message) {
    currentError = message;
    route();
  }

  function route() {
    if (searchInput.value.trim()) {
      renderSearch(searchInput.value);
      return;
    }

    const hash = decodeURIComponent(location.hash || "#/");
    const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
    if (!parts.length) return renderHome();
    if (parts[0] === "folder") return renderFolder(parts[1]);
    if (parts[0] === "note") return renderNote(parts[1]);
    if (parts[0] === "edit") return renderEditor(parts[1]);
    renderHome();
  }

  function clearPressTimer() {
    if (pressTimer) {
      window.clearTimeout(pressTimer);
      pressTimer = null;
    }
  }

  document.addEventListener("pointerdown", (event) => {
    if (!isAdmin || event.button > 0) return;
    const selectable = event.target.closest("[data-selectable]");
    if (!selectable) return;
    clearPressTimer();
    const type = selectable.dataset.itemType;
    const id = selectable.dataset.itemId;
    const key = itemKey(type, id);
    pressTimer = window.setTimeout(() => {
      suppressNextClickKey = key;
      enterSelection(type, id);
      clearPressTimer();
    }, LONG_PRESS_MS);
  });

  document.addEventListener("pointerup", clearPressTimer);
  document.addEventListener("pointercancel", clearPressTimer);
  document.addEventListener("pointerleave", clearPressTimer);

  document.addEventListener("contextmenu", (event) => {
    const selectable = event.target.closest("[data-selectable]");
    if (!isAdmin || !selectable) return;
    event.preventDefault();
    enterSelection(selectable.dataset.itemType, selectable.dataset.itemId);
  });

  document.addEventListener("click", (event) => {
    const selectable = event.target.closest("[data-selectable]");
    if (selectable) {
      const type = selectable.dataset.itemType;
      const id = selectable.dataset.itemId;
      const key = itemKey(type, id);
      if (selectionMode || suppressNextClickKey === key) {
        event.preventDefault();
        event.stopPropagation();
        if (suppressNextClickKey === key) suppressNextClickKey = "";
        else toggleSelection(type, id);
        return;
      }
    }

    const target = event.target.closest("[data-action]");
    if (!target || target.disabled) return;
    if (target.dataset.action === "toggle-search") {
      if (searchOpen && !searchInput.value.trim()) setSearchOpen(false, false);
      else setSearchOpen(true);
    }
    if (target.dataset.action === "close-search") closeSearch(true);
    if (target.dataset.action === "toggle-auth-menu") toggleAuthMenu();
    if (target.dataset.action === "toggle-page-actions") togglePageActions();
    if (target.dataset.action === "login") {
      authMenuOpen = false;
      renderAuthControls();
      openLoginDialog();
    }
    if (target.dataset.action === "logout") {
      authMenuOpen = false;
      logout();
    }
    if (target.dataset.action === "add-folder") {
      pageActionsOpen = false;
      openFolderDialog(target.dataset.folderId);
    }
    if (target.dataset.action === "add-note") {
      pageActionsOpen = false;
      addNote(target.dataset.folderId);
    }
    if (target.dataset.action === "edit-note") location.hash = `#/edit/${encodeURIComponent(target.dataset.noteId)}`;
    if (target.dataset.action === "close-modal") document.querySelector(".modal-backdrop")?.remove();
    if (target.dataset.action === "import-seed") {
      pageActionsOpen = false;
      importSeed();
    }
    if (target.dataset.action === "clear-selection") clearSelection();
    if (target.dataset.action === "rename-selected") openRenameSelectedDialog();
    if (target.dataset.action === "delete-selected") openDeleteSelectedDialog();
    if (target.dataset.action === "open-move-selected") openMoveSelectedDialog();
    if (target.dataset.action === "toggle-pin-selected") togglePinSelected();
  });

  document.addEventListener("click", (event) => {
    if (event.target.matches(".modal-backdrop")) {
      event.target.remove();
    }
    const actionTarget = event.target.closest("[data-action]");
    if (actionTarget?.dataset.action === "toggle-auth-menu") return;
    if (actionTarget?.dataset.action === "toggle-page-actions") return;
    if (authMenuOpen && !event.target.closest("#authSlot")) {
      authMenuOpen = false;
      renderAuthControls();
    }
    if (pageActionsOpen && !event.target.closest(".page-actions")) {
      pageActionsOpen = false;
      route();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (document.querySelector(".modal-backdrop")) document.querySelector(".modal-backdrop")?.remove();
      else if (searchOpen) closeSearch(false);
      else if (authMenuOpen) {
        authMenuOpen = false;
        renderAuthControls();
      }
      else if (pageActionsOpen) {
        pageActionsOpen = false;
        route();
      }
      else if (selectionMode) clearSelection();
    }
  });

  document.addEventListener("submit", (event) => {
    if (event.target.matches(".login-form")) {
      event.preventDefault();
      login(event.target);
      return;
    }

    if (event.target.matches(".folder-form")) {
      event.preventDefault();
      addFolder(event.target);
      return;
    }

    if (event.target.matches(".item-rename-form")) {
      event.preventDefault();
      renameSelectedItem(event.target);
      return;
    }

    if (event.target.matches(".selected-delete-form")) {
      event.preventDefault();
      deleteSelectedItems();
      return;
    }

    if (event.target.matches(".selected-move-form")) {
      event.preventDefault();
      moveSelectedItems(event.target);
      return;
    }

    if (event.target.matches(".editor")) {
      event.preventDefault();
      saveNote(event.target);
    }
  });

  searchInput.addEventListener("input", () => renderSearch(searchInput.value));
  window.addEventListener("hashchange", route);

  buildPreviewTree();
  renderAuthControls();
  syncTopbarControls();
  route();
  refresh();
})();
