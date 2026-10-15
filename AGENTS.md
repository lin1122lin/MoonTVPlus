# Repository Collaboration Notes

- 面向用户的品牌名称统一使用 `LinTVPlus`；包名、数据库名、User-Agent 等兼容性标识未经迁移不得改名。

- 默认使用中文沟通，回答简洁直接。
- GitHub 发布目标是 `lin1122lin/MoonTVPlus`。除非用户明确要求，不要向上游
  `mtvpls/MoonTVPlus` 创建 PR。
- Android 手机 APK 使用 `apps/android-mobile` 和
  `.github/workflows/android-mobile.yml`。
- `apps/android-tv` 仅用于 Android TV / 电视盒子，不作为手机 APK 构建入口。
- Android 签名文件和密码不得提交到仓库；GitHub Secrets 不是可恢复的备份，
  必须在仓库外另行保存原始密钥和密码。
- 完成修改前，说明实际运行过的验证命令和结果。
- Windows 客户端自动化测试使用临时用户目录和本地测试站点，结束时显式退出应用并检查残留进程。
- 页面跳转或测试退出造成的 ERR_ABORTED 不弹加载失败提示；真实连接失败使用非阻塞提示。
