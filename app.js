(function () {
  const STORAGE_KEY = "thought-note-library-v2";
  const seed = window.NOTE_LIBRARY || { categories: [] };
  const view = document.getElementById("view");
  const searchInput = document.getElementById("searchInput");

  let library = loadLibrary();

  function loadLibrary() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    }

    const initial = {
      version: 2,
      root: {
        id: "root",
        name: "书房",
        folders: seed.categories.map((category) => ({
          id: makeId("folder"),
          name: category.name,
          folders: [],
          notes: category.notes.map((note) => ({
            id: makeId("note"),
            title: note.title,
            content: note.content || "",
            createdAt: note.updatedAt || today(),
            updatedAt: note.updatedAt || today(),
          })),
        })),
        notes: [],
      },
    };

    saveLibrary(initial);
    return initial;
  }

  function saveLibrary(nextLibrary = library) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextLibrary));
  }

  function makeId(prefix) {
    if (window.crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function markdownToHtml(markdown) {
    const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
    const blocks = [];
    let paragraph = [];

    function flushParagraph() {
      if (!paragraph.length) return;
      blocks.push(`<p>${inline(paragraph.join("\n"))}</p>`);
      paragraph = [];
    }

    function inline(text) {
      return escapeHtml(text)
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.+?)\*/g, "<em>$1</em>")
        .replace(/`(.+?)`/g, "<code>$1</code>")
        .replace(/\n/g, "<br>");
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

  function renderHome() {
    const root = library.root;
    view.innerHTML = `
      <section class="page-head">
        <div>
          <p class="eyebrow">Bookshelf</p>
          <h1>书房</h1>
        </div>
        <button class="button primary" type="button" data-action="add-folder" data-folder-id="root">+ 文件夹</button>
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
      <a class="shelf-link" href="#/folder/${encodeURIComponent(folder.id)}">
        <article class="shelf">
          <div class="shelf-title">
            <h2>${escapeHtml(folder.name)}</h2>
            <span>${folderCount} 个文件夹 · ${noteCount} 篇笔记</span>
          </div>
          <div class="book-row" aria-hidden="true">
            ${renderBookSpines(noteCount + folderCount || 1)}
          </div>
        </article>
      </a>
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
        <div class="shelf-title">
          <h2>${escapeHtml(text)}</h2>
          <span>等待第一本书</span>
        </div>
        <div class="book-row" aria-hidden="true">${renderBookSpines(1)}</div>
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
          <button class="button" type="button" data-action="add-folder" data-folder-id="${escapeHtml(folder.id)}">+ 文件夹</button>
          <button class="button primary" type="button" data-action="add-note" data-folder-id="${escapeHtml(folder.id)}">+ 笔记</button>
        </div>
      </section>

      <section class="shelves sub-shelves">
        ${
          folder.folders.length
            ? folder.folders.map((child) => renderShelf(child)).join("")
            : ""
        }
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
        <strong>${escapeHtml(note.title || "未命名笔记")}</strong>
        <span>${escapeHtml(excerpt(note.content))}</span>
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
          <button class="button primary" type="button" data-action="edit-note" data-note-id="${escapeHtml(note.id)}">编辑</button>
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

    const { note, folder, trail } = found;
    view.innerHTML = `
      ${renderBreadcrumb(trail)}
      <form class="editor" data-note-id="${escapeHtml(note.id)}">
        <div class="editor-head">
          <a class="button" href="#/note/${encodeURIComponent(note.id)}">取消</a>
          <button class="button primary" type="submit">保存</button>
        </div>
        <input class="title-input" name="title" value="${escapeHtml(note.title || "")}" placeholder="标题" />
        <textarea class="content-input" name="content" placeholder="写点什么">${escapeHtml(note.content || "")}</textarea>
        <input type="hidden" name="folderId" value="${escapeHtml(folder.id)}" />
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
    document.querySelector(".modal-backdrop")?.remove();
    document.body.insertAdjacentHTML(
      "beforeend",
      `
        <div class="modal-backdrop">
          <form class="modal folder-form" data-folder-id="${escapeHtml(parentId)}">
            <div class="modal-head">
              <strong>新文件夹</strong>
              <button class="plain-button" type="button" data-action="close-modal">×</button>
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

  function addFolder(form) {
    const parentId = form.dataset.folderId;
    const found = findFolder(parentId);
    if (!found) return;
    const name = new FormData(form).get("name");
    if (!name?.trim()) return;
    found.folder.folders.push({
      id: makeId("folder"),
      name: name.trim(),
      folders: [],
      notes: [],
    });
    saveLibrary();
    document.querySelector(".modal-backdrop")?.remove();
    renderFolder(parentId);
  }

  function addNote(folderId) {
    const found = findFolder(folderId);
    if (!found) return;
    const note = {
      id: makeId("note"),
      title: "新笔记",
      content: "",
      createdAt: today(),
      updatedAt: today(),
    };
    found.folder.notes.unshift(note);
    saveLibrary();
    location.hash = `#/edit/${encodeURIComponent(note.id)}`;
  }

  function saveNote(form) {
    const found = findNote(form.dataset.noteId);
    if (!found) return;
    const data = new FormData(form);
    found.note.title = String(data.get("title") || "").trim() || "未命名笔记";
    found.note.content = String(data.get("content") || "");
    found.note.updatedAt = today();
    saveLibrary();
    location.hash = `#/note/${encodeURIComponent(found.note.id)}`;
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
    if (target.dataset.action === "add-folder") openFolderDialog(target.dataset.folderId);
    if (target.dataset.action === "add-note") addNote(target.dataset.folderId);
    if (target.dataset.action === "edit-note") location.hash = `#/edit/${encodeURIComponent(target.dataset.noteId)}`;
    if (target.dataset.action === "close-modal") document.querySelector(".modal-backdrop")?.remove();
  });

  document.addEventListener("submit", (event) => {
    if (event.target.matches(".folder-form")) {
      event.preventDefault();
      addFolder(event.target);
      return;
    }

    if (!event.target.matches(".editor")) return;
    event.preventDefault();
    saveNote(event.target);
  });

  searchInput.addEventListener("input", () => renderSearch(searchInput.value));
  window.addEventListener("hashchange", route);
  route();
})();
