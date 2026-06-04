# 我的感悟笔记

这是一个静态前端 + Supabase 云端数据库的笔记网站。

## 现在的功能

- 访客可以直接阅读。
- 管理员用 Supabase 邮箱密码登录后，可以添加文件夹、添加笔记、编辑笔记。
- 数据保存在 Supabase 云端数据库里，手机和电脑可以同步。
- 网站前端仍然可以部署到 GitHub Pages。

## 你需要手动做的事

### 1. 创建 Supabase 项目

1. 打开 <https://supabase.com>
2. 登录后点 `New project`
3. 填项目名和数据库密码
4. 等项目创建完成

### 2. 创建管理员账号

1. 进入 Supabase 项目
2. 左侧点 `Authentication`
3. 点 `Users`
4. 点 `Add user`
5. 填你的邮箱和密码
6. 保存

### 3. 建表和权限

1. 左侧点 `SQL Editor`
2. 点 `New query`
3. 打开本项目里的 `supabase-schema.sql`
4. 把里面的 `YOUR_ADMIN_EMAIL@example.com` 改成你的管理员邮箱
5. 复制整段 SQL 到 Supabase
6. 点 `Run`

### 4. 填写网站配置

1. 在 Supabase 左侧点 `Project Settings`
2. 点 `Data API`
3. 复制 `Project URL`
4. 复制 `anon public` key
5. 打开本项目里的 `supabase-config.js`
6. 替换成你的值：

```js
window.SUPABASE_CONFIG = {
  url: "你的 Project URL",
  anonKey: "你的 anon public key",
};
```

### 5. 上传到 GitHub

把整个网站文件重新上传到 GitHub 仓库，尤其要包含：

- `index.html`
- `styles.css`
- `app.js`
- `notes-data.js`
- `supabase-config.js`
- `supabase-schema.sql`
- `notes/`

## 导入原来的笔记

Supabase 配置完成并上传后：

1. 打开你的网站
2. 点右上角 `管理员登录`
3. 用你在 Supabase 创建的邮箱密码登录
4. 如果云端数据库还是空的，首页会出现 `导入初始笔记`
5. 点它即可把 `notes-data.js` 里的旧笔记导入云端

## 重要说明

`anon public key` 可以放在前端，它不是管理员密码。真正限制写入的是 Supabase 的 RLS 权限策略。

只有 `supabase-schema.sql` 里指定的管理员邮箱可以写入。其他人即使打开开发者工具，也只能读取，不能改云端数据库。
