# Offline Web Constraints

- 页面隐藏时，未挂载 HLS 的加载必须取消；已挂载播放器只暂停，保留 src 供前台手动续播。隐藏后禁止异步回调及恢复前台自动播放，仅显式点击列表播放可重新允许自动起播。保留源码回归测试，避免下载列表后台自动播放再次出现。
- package-lock.json 的公开 npm 依赖使用 registry.npmjs.org，不依赖境内镜像；修改 resolved 时保留完整 integrity。
- 仅真实完整 IDB manifest 可抑制同集 IDB active partial；browser 导出与 filesystem 记录独立保留，不得作为同集应用内缓存已完成的依据。
