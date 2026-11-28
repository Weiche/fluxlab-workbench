# FluxLab 电机稳态分析工作台

面向 PMSM/IPMSM 控制设计和测试的离线工具。Windows 安装包与单文件网页版使用同一套 TypeScript 求解器和 Canvas 图形。

## 使用

首次使用可从 [GitHub Releases](https://github.com/Weiche/fluxlab-workbench/releases/latest) 下载预构建的 Windows 安装包或单文件网页版。iPad 上可用 Safari 打开网页版的托管地址，竖屏时仍可在同一页调节运行工况并查看双图。

在 Windows 10/11 x64 上运行 `release/FluxLab-1.0.0-Windows-x64-Setup.exe`。程序安装到当前用户目录，开始菜单提供 FluxLab 快捷方式。也可用现代桌面浏览器打开 `release/FluxLab-Offline.html`。两个版本均内置示例电机、磁链图和批量工况。

- **自动求点**使用机械转速和目标电磁转矩寻找满足约束的最小电流点。勾选「最大出力转矩」可按转速和约束实时求最大出力，取消勾选可继续编辑转矩。机械转换功率为电磁转矩乘机械角速度。**手动验点**保留指定的 dq 电流，显示实际转矩、电压及超限量。
- **转矩–转速图**默认显示零及正转矩。勾选「显示负转矩」即可查看当前电机模型与电压、电流约束下的完整转矩包络。横轴默认随求得的可达转速边界调整，图下滑块与横轴共用刻度。模型找不到有限转速边界时保留观察范围。可自定义横轴范围，清空输入框即可恢复自动估算。精确输入更高转速会扩展横轴。
- 顶部模型选择器可切换理想、常参数工程和磁链图模型。左侧参数可精确输入；滑块可直接改变工况。当转速为负或目标转矩为负时使用相同的带符号方程。
- **MTPV** 在非零转速下显示常参数模型的电压最优轨迹，圆点对应当前电压限值下的最大正、负转矩点。结合电流极限判断这些点是否可达。
- **求解器对照**在理想自动模式下显示解析与数值结果。点击图右上角可放大。帮助按钮包含坐标约定、方程和图示说明。
- **工况回放**可直接载入升降速、高速区扫描、正反转或混合工况预设，也可导入 CSV。平滑过渡按每段 0.9 秒对转速、目标转矩或 dq 电流缓入缓出。不同给定方式之间按两端 dq 电流衔接。勾选「保持最大出力」后，每个转速点和过渡途中均按当前约束求最大出力。表中标明源文件行号与错误。导出菜单按当前工作区输出单点或整批 CSV，也可输出当前双图 PNG。
- **保存项目**生成带版本号的 JSON，包含工况、电机、模型选项、整张磁链图、工况行和回放设置。随项目携带的数据支持离线重开。
- **电机预设**位于「参数设置 → 电机参数」。按低压和高压选择型号，查看换算值和目录来源，再载入电机、母线、限流与起始工况。载入后仍可微调参数和回放原工况序列，目录来源会随项目保存。

「0 → 最高速 → 0」预设按当前模型及电压、电流约束估算正转上限。未找到有限上限时使用当前横轴范围，界面会提示。开启「循环回放」后，序列会重复播放。平滑模式会衔接末点和首点，两点相同时直接开始下一轮。

## 模型与数值约定

电流和电压为相基波峰值，电感输入单位为 mH，电阻为 Ω，磁链为 Wb。转速输入为有符号机械 rpm。转矩为电磁转矩。

ω<sub>e</sub> = 2π p n / 60<br>
V<sub>d</sub> = R<sub>s</sub> i<sub>d</sub> − ω<sub>e</sub> ψ<sub>q</sub><br>
V<sub>q</sub> = R<sub>s</sub> i<sub>q</sub> + ω<sub>e</sub> ψ<sub>d</sub><br>
T<sub>e</sub> = 1.5 p (ψ<sub>d</sub> i<sub>q</sub> − ψ<sub>q</sub> i<sub>d</sub>)<br>
V<sub>max</sub> = k<sub>v</sub> V<sub>dc</sub> / √3（SVPWM）或 k<sub>v</sub> V<sub>dc</sub> / 2（SPWM）

默认使用常参数工程模型，计入定子电阻。常参数模型使用 ψ<sub>d</sub> = ψ<sub>f</sub> + L<sub>d</sub> i<sub>d</sub> 和 ψ<sub>q</sub> = L<sub>q</sub> i<sub>q</sub>。可选择以 20 °C 为参考的铜阻温度修正、调整电压利用率或直接输入电压上限。理想模型取 R<sub>s</sub> = 0，可用于解析法与数值法对照。

解析法将等转矩关系代入电流幅值驻点条件及两项约束边界，隔离低阶多项式的实根并复核候选点。零转矩单独处理。数值法沿 d 轴分段，在各磁链网格单元内精确求解 q 方向的二次等式与不等式，再细化边界、极值和可行分支。磁链图采用双线性插值。可行域着色与曲线为离散绘图，明细数值由运行点方程计算。

数值搜索未找到目标时检查数据覆盖与区间界限。查表范围、精度预算或搜索结果不足时，界面给出覆盖或未确定状态。可达边界点与原目标分开标记。数值结果的范围和精度依赖磁链图的采样与覆盖。

默认示例取 4 极对、L<sub>d</sub> = 0.45 mH、L<sub>q</sub> = 0.90 mH、ψ<sub>f</sub> = 0.09 Wb、R<sub>s</sub> = 0.045 Ω、260 V 母线及 120 A 限流。在 3000 rpm、48 N·m 下，工作点约为 (−27.0144, 78.3112) A，端电压幅值约为 135.4 V。

### 厂商目录预设

| 型号 | 直流母线 | 初始限流依据 | 电感来源 |
|---|---:|---|---|
| LinMot EC02-40/70 | 24 V | 目录额定 1.4 A RMS | 目录等效。 [EC02-40 目录，第 1112–1113 页](https://shop.linmot.com/data/import/Dokumente/0185-1137-E_1V0_DS_Servomotors_EC02-40.pdf) |
| Beckhoff AM8121-wFyz | 48 V | 21F 电机栏额定 4 A RMS | 目录等效。 [AM812x 技术数据](https://infosys.beckhoff.com/content/1033/am8100/1333897355.html) |
| Kollmorgen AKM42G | 320 V | 连续堵转 4.8 A RMS，温升 100 °C | 目录等效。 [AKM Rev F，第 28–29 页](https://www.kollmorgen.com/sites/default/files/2025-04/AKM-KM_SG_000077_RevF_EN.pdf) |
| Beckhoff AM8042-F | 560 V | 400 V AC 额定工况 3.8 A RMS | 目录等效。 [AM804x 技术数据](https://infosys.beckhoff.com/content/1033/am8000_am8500_ba/8010674955.html) · [AX5000 母线说明](https://infosys.beckhoff.com/content/1033/ax5000_function_doku_hw2/19981666699.html) |
| EMRAX 228 HV 液冷 | 830 V | 液冷连续 120 A RMS | 目录单相 L<sub>d</sub> / L<sub>q</sub>。 [EMRAX 228 V1.7，第 2 页](https://emrax.com/wp-content/uploads/2026/08/EMRAX_228_datasheet_v1.7.pdf) |

目录等效采用相电阻 R<sub>LL</sub> / 2、L<sub>d</sub> = L<sub>q</sub> = L<sub>LL</sub> / 2，并把线间 RMS 反电动势常数 K<sub>e</sub>（V/krpm）转换成 ψ<sub>f</sub> = √(2/3) K<sub>e</sub> / ω<sub>e,1000 rpm</sub>。所有初始限流都将目录 RMS 电流乘以 √2。25 °C 的电阻按本工具的铜温度系数换算到 20 °C。EMRAX 直接采用 V1.7 列出的 PM 磁链，其同版 K<sub>e</sub> 与按该磁链推算的反电动势有差异。

起始工况为便于比较选取的可行示例。转矩–转速包络按电压与电流约束计算，使用时还需参考目录的机械转速、散热和驱动器条件。

## CSV 约定

- 磁链表使用 `id_A,iq_A,psi_d_Wb,psi_q_Wb`。两磁链列均为含永磁体贡献的总磁链。两轴各至少两个节点，允许非均匀间距，所有笛卡尔网格点各出现一次。网格顺序可任意。
- 工况表使用 `mode,rpm,torque_Nm,id_A,iq_A`。`auto` 行填写转速与目标转矩，`manual` 行填写转速与两轴电流，`max-output` 行只填写转速。也可使用仅含 `rpm` 表头的单列 CSV，其中每行按最大出力求解。未使用的列可留空。
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
