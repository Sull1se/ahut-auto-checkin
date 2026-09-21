# 本地桌面浏览器 + 油猴脚本自动化与容灾配置指南

本地工具链通过真实浏览器（Microsoft Edge / Google Chrome）+ Tampermonkey 油猴脚本，实现登录会话适配、宿舍考勤页面动态直达、状态核验与 Windows 定时休眠唤醒打卡。

---

## 一、安装与配置 Tampermonkey 脚本

1. 在日常使用的 Edge 或 Chrome 浏览器中安装 [Tampermonkey (油猴)](https://www.tampermonkey.net/) 扩展；
2. 点击油猴图标 ➔ **管理面板** ➔ 点击右上角的 **`+` (添加新脚本)**；
3. 打开本项目中的 [`local/wise-auto-adapter.user.js`](../local/wise-auto-adapter.user.js)，**全选复制全部内容**；
4. 粘贴覆盖油猴编辑器中的默认代码，点击 **文件 ➔ 保存**；
5. （可选）若希望脚本完全脱耦外部密码管理器自动填充，可在脚本头部 `EMBEDDED_CREDENTIALS` 填入您的学号与密码：
   ```javascript
   const EMBEDDED_CREDENTIALS = {
     studentId: '你的学号',
     password: '你的密码'
   };
   ```

---

## 二、初始化本地配置文件

1. 进入 `local/` 目录；
2. 复制一份 `wise-checkin.config.template.json` 并重命名为 `wise-checkin.config.json`；
3. **若使用 Microsoft Edge 浏览器（推荐一键配置）**：
   - 直接双击运行 `Set-EdgeConfig.cmd`；
   - 脚本将自动检索本机 Edge 浏览器的安装绝对路径与当前用户的 User Data 目录并自动写入配置文件。
4. **若使用 Google Chrome 或自定义浏览器**：
   - 打开 `wise-checkin.config.json`，核对 `browserPath`（Chrome 安装路径）与 `userDataDir`。

---

## 三、测试与日常运行

- **状态检查（只读，零写入）**：
  双击运行 `Check-WiseCheckIn.cmd`。浏览器将被唤起，执行登录验证、动态 TaskID 拉取与定位核验，确认正常后在右下角悬浮看板显示 `🔍 检查完成 (0写入)` 并停下。
- **手动一键签到**：
  双击运行 `Start-WiseCheckIn.cmd`。若在签到开放时段且未打卡，将自动模拟定位并提交。

---

## 四、配置 Windows 任务计划程序（每晚 21:35 自动唤醒）

1. 在 `local/` 目录下右键点击 `Install-WiseTask.cmd` ➔ 选择 **以管理员身份运行**（普通双击也可运行，管理员运行可获取更高唤醒权限）；
2. 脚本将自动注册名为 `AHUT-WiseCheckIn-Auto` 的定时任务：
   - 触发时间：每天 **21:35:00**（精准错峰在云端 Actions 21:31 之后 4 分钟）；
   - 支持设置唤醒计算机（从现代待机/睡眠中唤醒电脑并拉起打卡）；
   - 独立用户交互会话，具备浏览器图形界面与看板反馈。
3. **卸载方式**：双击运行 `Uninstall-WiseTask.cmd` 即可随时注销并安全移除该定时任务。
