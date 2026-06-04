(function () {
  const seed = window.NOTE_LIBRARY || { categories: [] };
  const config = window.SUPABASE_CONFIG || {};
  const view = document.getElementById("view");
  const searchInput = document.getElementById("searchInput");
  const authSlot = document.getElementById("authSlot");

  const cloudReady = Boolean(
    window.supabase &&
      config.url &&
      config.anonKey &&
      !config.url.includes("YOUR_") &&
      !config.anonKey.includes("YOUR_")
  );
  const db = cloudReady ? window.supabase.createClient(config.url, config.anonKey) : null;

  let folders = [];
  let notes = [];
  let library = { root: { id: "root", name: "书房", folders: [], notes: [] } };
  let session = null;
  let isAdmin = false;
  let currentError = "";

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

  function buildTree() {
    const root = { id: "root", name: "书房", folders: [], notes: [] };
    const byId = new Map();

    folders.forEach((folder) => {
      byId.set(folder.id, { ...folder, folders: [], notes: [] });
    });

    byId.forEach((folder) => {
      const parent = folder.parent_id ? byId.get(folder.parent_id) : root;
      (parent || root).folders.push(folder);
    });

    notes.forEach((note) => {
      const parent = note.folder_id ? byId.get(note.folder_id) : root;
      (parent || root).notes.push(note);
    });

    library = { root };
  }

  function buildPreviewTree() {
    library = {
      root: {
        id: "root",
        name: "书房",
        folders: seed.categories.map((category, index) => ({
          id: `preview-folder-${index}`,
          name: category.name,
          folders: [],
          notes: category.notes.map((note, noteIndex) => ({
            id: `preview-note-${index}-${noteIndex}`,
            title: note.title,
            content: note.content || "",
            updated_at: note.updatedAt || today(),
          })),
        })),
        notes: [],
      },
    };
  }

  async function refreshAuth() {
    if (!db) {
      session = null;
      isAdmin = false;
      return;
    }

    const { data } = await db.auth.getSession();
    session = data.session || null;
    isAdmin = false;

    if (session) {
      const { data: adminResult, error } = await db.rpc("is_notes_admin");
      isAdmin = !error && adminResult === true;
    }
  }

  async function loadCloudData() {
    if (!db) {
      buildPreviewTree();
      return;
    }

    currentError = "";
    const [folderResult, noteResult] = await Promise.all([
      db.from("folders").select("id,name,parent_id,created_at,updated_at").order("created_at", { ascending: true }),
      db.from("notes").select("id,title,content,folder_id,created_at,updated_at").order("updated_at", { ascending: false }),
    ]);

    if (folderResult.error || noteResult.error) {
      currentError = folderResult.error?.message || noteResult.error?.message || "无法读取云端数据";
      buildPreviewTree();
      return;
    }

    folders = folderResult.data || [];
    notes = noteResult.data || [];
    buildTree();
  }

  async function refresh() {
    await refreshAuth();
    await loadCloudData();
    renderAuthControls();
    route();
  }

  function renderAuthControls() {
    if (!cloudReady) {
      authSlot.innerHTML = `<span class="status-badge">云端未配置</span>`;
      return;
    }

    if (isAdmin) {
      authSlot.innerHTML = `
        <span class="status-badge">编辑模式</span>
        <button class="button auth-button" type="button" data-action="logout">退出</button>
      `;
      return;
    }

    authSlot.innerHTML = `<button class="button auth-button" type="button" data-action="login">管理员登录</button>`;
  }

  function renderBreadcrumb(trail) {
    return `
      <nav class="crumbs" aria-label="路径">
        ${trail
          .map(
            (folder, index) => `
              <a href="#/${folder.id === "root" ? "" : `folder/${encodeURIComponent(folder.id)}`}">
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
    const message = cloudReady
      ? `云端读取失败：${currentError}`
      : "还没有填写 Supabase 配置。当前只是预览初始笔记，配置完成后会使用云端数据库。";
    return `<div class="setup-card">${escapeHtml(message)}</div>`;
  }

  function renderHome() {
    const root = library.root;
    view.innerHTML = `
      ${renderSetupNotice()}
      <section class="page-head">
        <div>
          <p class="eyebrow">Bookshelf</p>
          <h1>书房</h1>
        </div>
        ${
          isAdmin
            ? `
              <div class="actions">
                ${root.folders.length === 0 && seed.categories.length ? `<button class="button" type="button" data-action="import-seed">导入初始笔记</button>` : ""}
                <button class="button primary" type="button" data-action="add-folder" data-folder-id="root">+ 文件夹</button>
              </div>
            `
            : `<p class="read-only-note">只读模式</p>`
        }
      </section>

      <section class="shelves">
        ${
          root.folders.length
            ? root.folders.map((folder) => renderShelf(folder)).join("")
            : renderEmptyShelf("还没有文件夹")
        }
      </section>
    `;
  }

  function renderShelf(folder) {
    const noteCount = countNotes(folder);
    const folderCount = countFolders(folder);
    return `
      <article class="shelf">
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
        ${
          isAdmin
            ? `
              <div class="item-actions">
                <button class="mini-button" type="button" data-action="rename-folder" data-folder-id="${escapeHtml(folder.id)}">重命名</button>
                <button class="mini-button danger" type="button" data-action="delete-folder" data-folder-id="${escapeHtml(folder.id)}">删除</button>
              </div>
            `
            : ""
        }
      </article>
    `;
  }

  function renderBookSpines(amount) {
    const colors = ["green", "red", "blue", "sand", "ink"];
    return Array.from({ length: Math.min(Math.max(amount, 4), 10) })
      .map((_, index) => `<span class="book ${colors[index % colors.length]}"></span>`)
      .join("");
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
      <section class="page-head">
        <div>
          <p class="eyebrow">Folder</p>
          <h1>${escapeHtml(folder.name)}</h1>
        </div>
        <div class="actions">
          ${
            isAdmin
              ? `
                <button class="button" type="button" data-action="add-folder" data-folder-id="${escapeHtml(folder.id)}">+ 文件夹</button>
                <button class="button primary" type="button" data-action="add-note" data-folder-id="${escapeHtml(folder.id)}">+ 笔记</button>
              `
              : `<p class="read-only-note">只读模式</p>`
          }
        </div>
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
    `;
  }

  function renderNoteCard(note) {
    return `
      <a class="note-card" href="#/note/${encodeURIComponent(note.id)}">
        <span class="note-cover" aria-hidden="true"></span>
        <strong>${escapeHtml(note.title || "未命名笔记")}</strong>
        <span>${escapeHtml(excerpt(note.content)) || "空白笔记"}</span>
      </a>
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
          <a class="button" href="#/folder/${encodeURIComponent(folder.id)}">返回</a>
          ${
            isAdmin
              ? `<button class="button primary" type="button" data-action="edit-note" data-note-id="${escapeHtml(note.id)}">编辑</button>`
              : `<span class="read-only-note">只读</span>`
          }
        </header>
        <h1>${escapeHtml(note.title || "未命名笔记")}</h1>
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
          <a class="button" href="#/note/${encodeURIComponent(note.id)}">取消</a>
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
    `;
  }

  function openFolderDialog(parentId) {
    if (!isAdmin) return;
    document.querySelector(".modal-backdrop")?.remove();
    document.body.insertAdjacentHTML(
      "beforeend",
      `
        <div class="modal-backdrop">
          <form class="modal folder-form" data-folder-id="${escapeHtml(parentId)}">
            <div class="modal-head">
              <strong>新文件夹</strong>
              <button class="plain-button" type="button" data-action="close-modal">x</button>
            </div>
            <input class="modal-input" name="name" placeholder="文件夹名称" autocomplete="off" />
            <div class="modal-actions">
              <button class="button" type="button" data-action="close-modal">取消</button>
              <button class="button primary" type="submit">添加</button>
            </div>
          </form>
        </div>
      `
    );
    document.querySelector(".modal-input")?.focus();
  }

  function openRenameFolderDialog(folderId) {
    if (!isAdmin) return;
    const found = findFolder(folderId);
    if (!found || found.folder.id === "root") return;

    document.querySelector(".modal-backdrop")?.remove();
    document.body.insertAdjacentHTML(
      "beforeend",
      `
        <div class="modal-backdrop">
          <form class="modal folder-rename-form" data-folder-id="${escapeHtml(folderId)}">
            <div class="modal-head">
              <strong>重命名文件夹</strong>
              <button class="plain-button" type="button" data-action="close-modal">x</button>
            </div>
            <input class="modal-input" name="name" value="${escapeHtml(found.folder.name)}" placeholder="文件夹名称" autocomplete="off" />
            <div class="modal-actions">
              <button class="button" type="button" data-action="close-modal">取消</button>
              <button class="button primary" type="submit">保存</button>
            </div>
          </form>
        </div>
      `
    );
    document.querySelector(".modal-input")?.focus();
  }

  function openDeleteFolderDialog(folderId) {
    if (!isAdmin) return;
    const found = findFolder(folderId);
    if (!found || found.folder.id === "root") return;

    document.querySelector(".modal-backdrop")?.remove();
    document.body.insertAdjacentHTML(
      "beforeend",
      `
        <div class="modal-backdrop">
          <form class="modal folder-delete-form" data-folder-id="${escapeHtml(folderId)}">
            <div class="modal-head">
              <strong>删除文件夹</strong>
              <button class="plain-button" type="button" data-action="close-modal">x</button>
            </div>
            <p class="modal-hint">确定删除“${escapeHtml(found.folder.name)}”吗？里面的子文件夹和笔记也会一起删除。</p>
            <div class="modal-actions">
              <button class="button" type="button" data-action="close-modal">取消</button>
              <button class="button danger-button" type="submit">删除</button>
            </div>
          </form>
        </div>
      `
    );
  }

  function openLoginDialog() {
    if (!cloudReady) return;
    document.querySelector(".modal-backdrop")?.remove();
    document.body.insertAdjacentHTML(
      "beforeend",
      `
        <div class="modal-backdrop">
          <form class="modal login-form">
            <div class="modal-head">
              <strong>管理员登录</strong>
              <button class="plain-button" type="button" data-action="close-modal">x</button>
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
      `
    );
    document.querySelector(".modal-input")?.focus();
  }

  async function login(form) {
    const data = new FormData(form);
    const email = String(data.get("email") || "").trim();
    const password = String(data.get("password") || "");
    const hint = form.querySelector(".modal-hint");

    const { error } = await db.auth.signInWithPassword({ email, password });
    if (error) {
      hint.textContent = error.message || "登录失败。";
      return;
    }

    document.querySelector(".modal-backdrop")?.remove();
    await refresh();
  }

  async function logout() {
    if (!db) return;
    await db.auth.signOut();
    await refresh();
  }

  async function addFolder(form) {
    if (!isAdmin) return;
    const parentId = form.dataset.folderId;
    const name = String(new FormData(form).get("name") || "").trim();
    if (!name) return;

    const { error } = await db.from("folders").insert({
      name,
      parent_id: parentId === "root" ? null : parentId,
    });

    if (error) return showError(error.message);
    document.querySelector(".modal-backdrop")?.remove();
    await refresh();
    location.hash = parentId === "root" ? "#/" : `#/folder/${encodeURIComponent(parentId)}`;
  }

  async function renameFolder(form) {
    if (!isAdmin) return;
    const found = findFolder(form.dataset.folderId);
    if (!found || found.folder.id === "root") return;

    const name = String(new FormData(form).get("name") || "").trim();
    if (!name) return;

    const { error } = await db.from("folders").update({ name }).eq("id", found.folder.id);
    if (error) return showError(error.message);

    document.querySelector(".modal-backdrop")?.remove();
    await refresh();
  }

  async function deleteFolder(form) {
    if (!isAdmin) return;
    const found = findFolder(form.dataset.folderId);
    if (!found || found.folder.id === "root") return;

    const parent = found.trail.at(-2);
    const { error } = await db.from("folders").delete().eq("id", found.folder.id);
    if (error) return showError(error.message);

    document.querySelector(".modal-backdrop")?.remove();
    await refresh();
    location.hash = !parent || parent.id === "root" ? "#/" : `#/folder/${encodeURIComponent(parent.id)}`;
  }

  async function addNote(folderId) {
    if (!isAdmin) return;
    const { data, error } = await db
      .from("notes")
      .insert({ folder_id: folderId, title: "新笔记", content: "" })
      .select("id")
      .single();

    if (error) return showError(error.message);
    await refresh();
    location.hash = `#/edit/${encodeURIComponent(data.id)}`;
  }

  async function saveNote(form) {
    if (!isAdmin) return;
    const found = findNote(form.dataset.noteId);
    if (!found) return;

    const data = new FormData(form);
    const { error } = await db
      .from("notes")
      .update({
        title: String(data.get("title") || "").trim() || "未命名笔记",
        content: String(data.get("content") || ""),
      })
      .eq("id", found.note.id);

    if (error) return showError(error.message);
    await refresh();
    location.hash = `#/note/${encodeURIComponent(found.note.id)}`;
  }

  async function importSeed() {
    if (!isAdmin || !seed.categories.length) return;
    for (const category of seed.categories) {
      const { data: folder, error: folderError } = await db
        .from("folders")
        .insert({ name: category.name, parent_id: null })
        .select("id")
        .single();
      if (folderError) return showError(folderError.message);

      const rows = category.notes.map((note) => ({
        folder_id: folder.id,
        title: note.title || "未命名笔记",
        content: note.content || "",
      }));
      if (rows.length) {
        const { error: noteError } = await db.from("notes").insert(rows);
        if (noteError) return showError(noteError.message);
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

  document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    if (target.dataset.action === "login") openLoginDialog();
    if (target.dataset.action === "logout") logout();
    if (target.dataset.action === "add-folder") openFolderDialog(target.dataset.folderId);
    if (target.dataset.action === "rename-folder") openRenameFolderDialog(target.dataset.folderId);
    if (target.dataset.action === "delete-folder") openDeleteFolderDialog(target.dataset.folderId);
    if (target.dataset.action === "add-note") addNote(target.dataset.folderId);
    if (target.dataset.action === "edit-note") location.hash = `#/edit/${encodeURIComponent(target.dataset.noteId)}`;
    if (target.dataset.action === "close-modal") document.querySelector(".modal-backdrop")?.remove();
    if (target.dataset.action === "import-seed") importSeed();
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

    if (event.target.matches(".folder-rename-form")) {
      event.preventDefault();
      renameFolder(event.target);
      return;
    }

    if (event.target.matches(".folder-delete-form")) {
      event.preventDefault();
      deleteFolder(event.target);
      return;
    }

    if (event.target.matches(".editor")) {
      event.preventDefault();
      saveNote(event.target);
    }
  });

  searchInput.addEventListener("input", () => renderSearch(searchInput.value));
  window.addEventListener("hashchange", route);
  if (db) db.auth.onAuthStateChange(() => refresh());

  refresh();
})();
