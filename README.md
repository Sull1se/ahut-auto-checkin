# AHUT 晚寝自动签到与双轨容灾助手 (AHUT Auto Check-In)

[![Daily Check-In](https://github.com/Sull1se/ahut-auto-checkin/actions/workflows/daily-sign.yml/badge.svg)](https://github.com/Sull1se/ahut-auto-checkin/actions/workflows/daily-sign.yml)
[![Python 3.12](https://img.shields.io/badge/Python-3.12-blue.svg)](https://www.python.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Platform: Edge / Chrome / Linux](https://img.shields.io/badge/Platform-Edge%20%7C%20Chrome%20%7C%20Actions-brightgreen.svg)]()

专为**安徽工业大学（AHUT）微信移动端考勤系统**打造的双轨无人值守自动打卡解决方案。

采用 **“云端主力首发 (GitHub Actions 21:31) + 本地桌面容灾 (Tampermonkey 21:35)”** 双保险闭环架构，享受 GitHub Public 仓库无额度上限的免费云算力，永久告别云厂商按量扣费与欠费停服风险。

---

## 🌟 核心特性

- 🚀 **永久零成本全托管**：利用 GitHub Actions 公开仓库无限制的免费托管 Runner，无需购买云服务器或充值阿里云函数计算（FC）；
- 🛡️ **双轨错峰容灾体系**：
  - **首发防线（云端 21:31）**：定时调度无头签到，支持多学号并发，直接提交协议并推送通知；
  - **兜底防线（本地 21:35）**：Windows 任务计划程序定时从休眠唤醒电脑，拉起真实浏览器环境；若检测到云端已打卡成功，右下角悬浮看板显示 `🎉 今日已签到` 并安全退出，实现**零业务冲突、零重复提交**；
- 📍 **GPS 拟真抖动收敛**：优化上游粗粒度偏移算法，将随机抖动严格收敛在基准定位 $\pm 0.0002^\circ$（约 15~20 米范围内），既打破静态坐标特征规避风控，又绝对不超出宿舍打卡地理围栏；
- 🔄 **动态 TaskID 自愈提取**：自动请求任务分页接口提取当期最新有效考勤任务，跨学期、新任务更迭无需人工介入修改任务编号；
- 🔔 **多通道智能分级告警**：
  - **日常结果**：通过 [Server 酱·Turbo 版](https://sct.ftqq.com/) 推送每日详细微信打卡报表；
  - **失败强提醒**：集成 [ntfy.sh](https://ntfy.sh) 官方 JSON 规范，**仅在打卡失败或异常时触发最高优先级（Priority 5）夜间免打扰穿透响铃**，提醒用户及时处置；
- 🔒 **严格安全脱敏机制**：个人学号、密码、推送密钥全部由 GitHub Encrypted Secrets 与本地 `.gitignore` 双重隔离，公开仓库零明文凭据残留。

---

## 🏗️ 架构设计图

```mermaid
flowchart TD
    subgraph Track1["第一防线：GitHub Actions 云端主力 (每晚 21:31)"]
        TimerActions["GitHub Cron 定时器 (UTC 13:31 / CST 21:31)"] --> Runner["Ubuntu Runner (main.py)"]
        Runner --> DynamicTask["动态提取今日 TaskID 与基准定位"]
        DynamicTask --> Jitter["GPS 拟真抖动收敛 (±0.0002°)"]
        Jitter --> ApiSign["协议层提交打卡"]
        ApiSign --> ServerChan["Server 酱推送日常微信结果"]
        ApiSign -.->|仅签到异常/失败| Ntfy["ntfy Priority 5 免打扰穿透响铃"]
    end

    subgraph Track2["第二防线：Windows 桌面自动化兜底 (每晚 21:35)"]
        LocalScheduler["Windows 任务计划程序 (21:35:00 唤醒计算机)"] --> LocalBrowser["拉起 Edge / Chrome 独立浏览器"]
        LocalBrowser --> Tampermonkey["油猴脚本 (wise-auto-adapter.user.js)"]
        Tampermonkey --> CheckToday{"核验今日打卡状态"}
        CheckToday -->|云端已成功| Skip["看板显示「🎉 今日已签到」\n安全终止退出 (0 重复提交)"]
        CheckToday -->|未完成/云端网络中断| Fallback["本地自动注入会话并执行打卡"]
        Fallback --> LocalDone["本地打卡兜底成功"]
    end

    Track1 -.->|错峰 4 分钟| Track2
```

---

## 📂 项目结构

```text
ahut-auto-checkin/
├── .github/
│   └── workflows/
│       └── daily-sign.yml             # GitHub Actions 定时签到工作流 (21:31 CST)
├── main.py                            # 云端自动化签到主程序
├── notifier.py                        # Server 酱微信报表与 ntfy 强穿透告警
├── requirements.txt                   # Python 核心依赖 (aiohttp)
├── local/                             # 本地桌面浏览器 + 油猴容灾套件
│   ├── wise-auto-adapter.user.js      # 油猴脚本 (v1.2.0 内嵌账密/动态TaskID/HUD看板)
│   ├── Start-WiseCheckIn.cmd / .ps1   # 本地一键签到启动器
│   ├── Check-WiseCheckIn.cmd          # 本地只读状态检查工具 (0写入)
│   ├── Set-EdgeConfig.cmd / .ps1      # Edge 浏览器路径与 User Data 自动探测器
│   ├── Install-WiseTask.cmd / .ps1    # Windows 任务计划程序一键安装器 (21:35)
│   ├── Uninstall-WiseTask.cmd / .ps1  # 任务计划程序一键卸载器
│   ├── wise-adapter-console.js        # 控制台免扩展运行脚本
│   └── wise-checkin.config.template.json # 本地脱敏配置模板
├── docs/
│   ├── actions-setup.md               # GitHub Actions 云端部署与 Secrets 详细配置
│   └── local-setup.md                 # 本地油猴与任务计划程序部署详细指引
├── README.md                          # 项目说明文档
├── LICENSE                            # MIT 开源许可证
└── .gitignore                         # 严格阻断真实凭据与运行日志提交
```

---

## 🚀 快速上手

### 轨出一：云端 GitHub Actions 部署（最简、推荐）

只需 3 分钟即可完成全托管部署：

1. **Fork 本仓库** 或新建公开仓库推入本源码；
2. 进入仓库的 **Settings** ➔ **Secrets and variables** ➔ **Actions**；
3. 点击 **New repository secret** 添加凭据：
   - `STUDENT_IDS`：您的统一身份认证学号（必填，多人用英文分号 `;` 分隔）；
   - `PASSWORDS`：您的密码（选填，默认 `Ahgydx@920`）；
   - `SERVERCHAN_SENDKEY`：[Server酱](https://sct.ftqq.com/) SendKey（选填，用于微信通知）；
   - `NTFY_TOPIC`：[ntfy.sh](https://ntfy.sh) 自定频道（选填，仅在失败时高优先级告警）；
4. 进入 **Actions** 页面，点击 `AHUT 晚寝自动签到` ➔ **Run workflow** 即可手动联调验证。
> 详细图文指引请参考 [docs/actions-setup.md](docs/actions-setup.md)。

---

### 轨出二：本地桌面与油猴容灾部署（可选容灾）

作为应对网络断连或云端不可用时的终极兜底手段：

1. 打开 Edge 浏览器，安装 [Tampermonkey (油猴)](https://www.tampermonkey.net/)；
2. 复制 [`local/wise-auto-adapter.user.js`](local/wise-auto-adapter.user.js) 源码导入油猴；
3. 在 `local/` 目录下双击运行 `Set-EdgeConfig.cmd` 自动完成浏览器环境配置；
4. 右键管理员运行 `Install-WiseTask.cmd`，自动注册每晚 21:35:00 唤醒打卡任务。
> 详细配置与故障排查请参考 [docs/local-setup.md](docs/local-setup.md)。

---

## 📝 致谢与开源参考

本项目云端核心签到协议逆向与基础架构受启发于开源项目 [dawn200712/AHUT](https://github.com/dawn200712/AHUT)，在此对其开创性工作表示诚挚感谢。

在此基础上，本项目针对实际生产化无人值守运行进行了二次深度重构：
1. 取消对已取消免费额度的阿里云 FC 的依赖，完全迁移并适配 GitHub Actions 免费算力体系；
2. 修复原上游坐标粗粒度偏移容易导致超出考勤围栏的缺陷，优化为 $\pm 0.0002^\circ$ 拟真抖动算法；
3. 引入 ntfy 官方 JSON 强穿透双通道告警体系，解决日常推送刷屏与夜间漏签风险的矛盾；
4. 引入本地桌面油猴自动化方案，形成真正具备高可用韧性的云地双轨容灾闭环。

---

## ⚖️ 免责声明 (Disclaimer)

1. 本项目仅供个人学习、网络协议分析与容灾自动化技术研究交流使用；
2. 用户使用本项目产生的所有行为及后果均由使用者自行承担，开发者不对因使用本工具导致的任何形式的纪律处分、数据异常或其他损失承担任何法律责任；
3. 请合理安排作息，严格遵守学校晚归考勤管理规定。
