# 内容后台

第一阶段使用 Node.js 24 与私有 SQLite 数据库，不需要安装 npm 依赖。公开网站仍为 GitHub Pages 静态网站。多人远程编辑阶段可迁移到 Directus/PostgreSQL；当前实现不依赖 Docker 或云端账号。

## 打开与登录

`npm run admin` 启动本机后台，打开 `http://127.0.0.1:4287/admin/`。首次访问创建管理员及至少 12 个字符的密码。密码以 scrypt 哈希保存，登录会话放在 HttpOnly/SameSite=Strict Cookie 中，8 小时过期。默认且当前实现只绑定本机回环地址；不会向局域网或公网开放。

macOS 可以运行 `npm run admin:service` 安装登录后自动启动的用户服务。

```sh
# 查看状态
launchctl print gui/$(id -u)/com.buy-great-things.admin
# 重启
launchctl kickstart -k gui/$(id -u)/com.buy-great-things.admin
# 停止自动启动的服务
launchctl bootout gui/$(id -u) "$HOME/Library/LaunchAgents/com.buy-great-things.admin.plist"
```

服务停止后删除该项目的 plist 可以取消下次登录时自动启动；私有数据库不会被删除。

## 编辑与审核

1. 保存商品信息为草稿。已公开商品的草稿修改不会覆盖网站上的旧版本。
2. 记录制造地、材质、独立测试、长期使用等证据。原始网址、附件和内部备注留在本机。
3. 保存并提交编辑审核。管理员填写实际审核说明后批准。
4. 到“发布管理”查看将发布的内容，然后发布到 GitHub。

编辑审核状态：`draft → review → approved → published`；可以退回草稿或标记撤回。品质状态单独管理：`pending / verified`。审核通过不自动等于品质审定。

申请品质审定必须提供独立测试、长期使用证据及适用范围。中国制造例外还需要独立同类对照、至少两个具体对照型号、完整审核理由及公开例外说明。证据类别由编辑填写，系统只检查材料完整性，实际真实性与方法质量必须由管理员审核。

新增、修改或移除证据会使当前编辑版本回到草稿。历史恢复同时恢复当时的商品信息与证据引用，并生成新的草稿，不能直接回滚公开网站。

## 发布与 GitHub

发布任务只导出允许公开的字段到 `content/catalog.json`，生成 `dist/products.js`，复制审核版本需要的图片，提交并推送 `main`。GitHub Actions 执行后端测试、生成公开目录、验证静态网站，再部署 Pages。

草稿、管理员信息、原始证据网址、证据附件与内部备注不进入公开导出。发布任务只暂存指定公开文件，工作区已有其他未提交修改时拒绝发布。代码同步与网站部署分别记录，不能用“已推送”代替“已部署”。

运行后台的电脑需要现有的 GitHub 登录和仓库推送权限。图片上传使用 `cwebp` 转成 720 像素宽的 WebP，单张不超过 100 KB；没有 `cwebp` 时只接收已经合规的小型 WebP。原始证据附件上限为 8 MB。

## 数据位置与备份

默认私有目录为仓库的 `.local/`，目录权限 700、数据库和附件权限 600，已从 Git 排除。包含数据库 `catalog.sqlite`、附件 `assets/`、数据库备份 `backups/` 与服务日志。可通过 `BGT_DATA_DIR` 改变位置，`BGT_PORT` 改变本机端口。

后台的备份按钮生成一致的 SQLite 数据库副本。完整备份还应保留 `assets/`，恢复时先停止后台，再恢复数据库与附件。首次启动会导入已有公开档案及制造地来源，不会凭此自动建立新的品质结论。

发布中断会保留本地提交。重启后中断的任务标记为失败，可以检查工作区后重新发布。GitHub 推送失败时不会将草稿标成公开成功。

## 验证

`npm test` 验证登录、跨站写入限制、版本冲突、审核门槛、私有信息隔离、证据历史恢复、静态发布以及 Git 推送失败后重试。`npm run build && npm run check` 验证公开产物及性能预算。
