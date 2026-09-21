# 本地桌面浏览器 + 油猴脚本自动化配置指南

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

## 四、配置 Windows 任务计划程序（可选定时自动化）

若希望在本地电脑上实现每日定时自动唤醒与打卡，可注册 Windows 任务计划程序：

1. **一键快捷安装（默认预设时间 22:00:00）**：
   - 在 `local/` 目录下右键点击 `Install-WiseTask.cmd` ➔ 选择 **以管理员身份运行**；
   - 脚本将自动注册名为 `AHUT-WiseCheckIn-Auto` 的定时任务，默认预设触发时间为每天 **22:00:00**（与云端 Actions 21:31 首发错峰 29 分钟，作为本地兜底），支持从现代待机/睡眠中唤醒电脑并拉起打卡。
2. **手动修改定时触发时间的方法**：
   - **方法 A（命令行传参安装）**：
     以管理员身份打开 PowerShell，进入 `local/` 目录，通过 `-DailyTime` 参数指定任意时间：
     ```powershell
     powershell -ExecutionPolicy Bypass -File .\Install-WiseTask.ps1 -DailyTime "21:40:00"
     ```
   - **方法 B（通过系统图形界面随时调整）**：
     按快捷键 `Win + R` 输入 `taskschd.msc` 打开 Windows“任务计划程序”；在任务列表中找到 `AHUT-WiseCheckIn-Auto`，双击打开属性 ➔ 切换至 **触发器** 标签页 ➔ 选中每日触发器并点击 **编辑**，即可将触发时间更改为您期望的时段。
3. **卸载方式**：
   - 双击运行 `Uninstall-WiseTask.cmd` 即可随时注销并安全移除该定时任务。
