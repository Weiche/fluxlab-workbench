# FluxLab 电机稳态分析工作台

面向 PMSM/IPMSM 控制设计和测试的离线工具。Windows 安装包与单文件网页版使用同一套 TypeScript 求解器和 Canvas 图形。

## 使用

首次使用可从 [GitHub Releases](https://github.com/Weiche/fluxlab-workbench/releases/latest) 下载预构建的 Windows 安装包或单文件网页版。iPad 上可用 Safari 打开网页版的托管地址，竖屏时仍可在同一页调节运行工况并查看双图。

在 Windows 10/11 x64 上运行 `release/FluxLab-1.0.0-Windows-x64-Setup.exe`。程序安装到当前用户目录，开始菜单提供 FluxLab 快捷方式。也可用现代桌面浏览器打开 `release/FluxLab-Offline.html`。两个版本均内置示例电机、磁链图和批量工况。

- **自动求点**使用机械转速和目标电磁转矩寻找满足约束的最小电流点。**手动验点**保留指定的 dq 电流，显示实际转矩、电压及超限量。
- 顶部模型选择器可切换理想、常参数工程和磁链图模型。左侧参数可精确输入；滑块可直接改变工况。当转速为负或目标转矩为负时使用相同的带符号方程。
- **求解器对照**在理想自动模式下显示解析与数值结果。点击图右上角可放大。帮助按钮包含坐标约定、方程和图示说明。
- **工况回放**支持 CSV、逐行查看、步进和播放。表中标明源文件行号与错误。导出菜单按当前工作区输出单点或整批 CSV，也可输出当前双图 PNG。
- **保存项目**生成带版本号的 JSON，包含工况、电机、模型选项、整张磁链图和工况行。随项目携带的数据支持离线重开。

## 模型与数值约定

电流和电压为相基波峰值，电感输入单位为 mH，电阻为 Ω，磁链为 Wb。转速输入为有符号机械 rpm。转矩为电磁转矩。

ω<sub>e</sub> = 2π p n / 60<br>
V<sub>d</sub> = R<sub>s</sub> i<sub>d</sub> − ω<sub>e</sub> ψ<sub>q</sub><br>
V<sub>q</sub> = R<sub>s</sub> i<sub>q</sub> + ω<sub>e</sub> ψ<sub>d</sub><br>
T<sub>e</sub> = 1.5 p (ψ<sub>d</sub> i<sub>q</sub> − ψ<sub>q</sub> i<sub>d</sub>)<br>
V<sub>max</sub> = k<sub>v</sub> V<sub>dc</sub> / √3

默认理想模型使用 ψ<sub>d</sub> = ψ<sub>f</sub> + L<sub>d</sub> i<sub>d</sub> 和 ψ<sub>q</sub> = L<sub>q</sub> i<sub>q</sub>，R<sub>s</sub> = 0。常参数工程模型可启用定子电阻、以 20 °C 为参考的铜阻温度修正及电压利用率，也可直接给定电压上限。

解析法将等转矩关系代入电流幅值驻点条件及两项约束边界，隔离低阶多项式的实根并复核候选点。零转矩单独处理。数值法沿 d 轴分段，在各磁链网格单元内精确求解 q 方向的二次等式与不等式，再细化边界、极值和可行分支。磁链图采用双线性插值。可行域着色与曲线为离散绘图，明细数值由运行点方程计算。

数值搜索未找到目标时检查数据覆盖与区间界限。查表范围、精度预算或搜索结果不足时，界面给出覆盖或未确定状态。可达边界点与原目标分开标记。数值结果的范围和精度依赖磁链图的采样与覆盖。

默认示例取 4 极对、L<sub>d</sub> = 0.45 mH、L<sub>q</sub> = 0.90 mH、ψ<sub>f</sub> = 0.09 Wb、260 V 母线及 120 A 限流。在 3000 rpm、48 N·m 下，理想模型的工作点约为 (−27.0144, 78.3112) A，端电压幅值约为 131.9592 V。

## CSV 约定

- 磁链表使用 `id_A,iq_A,psi_d_Wb,psi_q_Wb`。两磁链列均为含永磁体贡献的总磁链。两轴各至少两个节点，允许非均匀间距，所有笛卡尔网格点各出现一次。网格顺序可任意。
- 工况表使用 `mode,rpm,torque_Nm,id_A,iq_A`。`auto` 行填写转速与目标转矩，`manual` 行填写转速与两轴电流。未使用的列可留空。
- 示例位于 `public/examples`。磁链示例为合成数据。使用 UTF-8、逗号分隔与小数点记法。

## 构建和验证

使用 Node.js 24、npm 和 TypeScript。开发和编译命令如下。

```sh
npm ci
npm run dev
npm test
npm run build
```

`dist` 可由静态服务器提供，`release/FluxLab-Offline.html` 可单独分发。开发服务器运行时，`npm run test:ui` 检查界面和文件往返，`npm run test:perf` 测量 101×101 网格连续 10 秒的参数输入。可通过 `APP_URL`、`CHROMIUM_PATH` 指定被测页面和浏览器，通过 `BENCH_PARAM` 选择 `torque`、`rpm`、`imax` 或 `vdc`。性能测试按浏览器动画帧统计图表更新及响应时间。

在 Linux 构建机上运行 `npm run package:win`。需要带 amd64 Unicode 目标的 NSIS 3.11 或更新版本，以及 Bash、Python 3、curl、unzip、sha256sum。脚本下载并校验固定版本的 Electron Windows x64 运行时。可用 `ELECTRON_CACHE_DIR` 指定已缓存的归档，用 `MAKENSIS` 和 `NSISDIR` 指定 NSIS 路径。输出目录包含安装程序及 SHA-256 校验文件。

## 已测结果

12 项模型与文件测试通过。另对 1,000 组伪随机常参数工况交叉核对了解析法和数值法。界面自动化覆盖两种给定方式、求解器对照、磁链图、超限显示、回放、坏行、项目往返、CSV 和 PNG。使用同版本 Linux Electron 的桌面测试通过原生下载事件核对导出内容。通过 `ELECTRON_BIN` 指向可执行程序可重跑桌面测试，开发时另用 `ELECTRON_APP` 指定应用目录。

下表为 Linux Chromium、1440×900 视口、101×101 非线性磁链网格下的结果。每次连续模拟对应滑块输入 10 秒。刷新率按实际结果更新后的动画帧统计，延迟为输入到该帧的时间，最终复核包含恢复完整曲线分辨率。

| 滑块 | 图形刷新 FPS | 延迟 P95 | 最终复核 |
|---|---:|---:|---:|
| 目标转矩 | 59.5 | 19.2 ms | 33.1 ms |
| 机械转速 | 59.8 | 19.8 ms | 32.9 ms |
| 相电流峰值 | 60.0 | 18.4 ms | 33.3 ms |
| 母线电压 | 59.6 | 20.1 ms | 35.6 ms |

Windows x64 安装程序已在全新 Wine 配置中验证安装、注册表、快捷方式、程序文件与卸载清理。安装后的前端资源与发布构建逐文件一致，同版本 Linux Electron 已用这份安装内容跑通上述界面测试。Windows 可执行程序在 Wine 10 中启动后未进入工作台，原生 Windows 10/11 的启动与目标硬件性能仍待实机验收。
