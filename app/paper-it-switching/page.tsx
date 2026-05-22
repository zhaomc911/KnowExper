import type { Metadata } from "next";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "论文详解 | Rapid concerted switching",
  description: "A local Chinese explainer for the Nature paper on rapid concerted switching in inferotemporal cortex.",
};

type Section = {
  id: string;
  label: string;
  title: string;
  pages: number[];
  question: string;
  keyPoints: string[];
  detail: string[];
  confusions: string[];
  remember: string;
};

const sections: Section[] = [
  {
    id: "thesis",
    label: "总论点",
    title: "这篇文章到底发现了什么",
    pages: [1],
    question: "传统观点认为神经元的调谐函数相对固定；这篇 Nature 论文说，至少在猴 IT 皮层面孔系统里，编码轴可以在约 100 ms 后发生集体切换。",
    keyPoints: [
      "研究对象是猕猴下颞叶皮层 inferotemporal cortex, IT，尤其是面孔 patch ML 和 AM。",
      "核心发现不是单个神经元放电强弱变了，而是整个群体从一种编码坐标系切到另一种编码坐标系。",
      "早期编码更像通用物体空间里的面孔检测：这个东西像不像脸。",
      "后期编码变成面孔专用空间里的精细辨别：这是谁的脸、脸部特征差在哪里。",
      "切换很快、很同步、对面孔刺激特异，非面孔物体没有同样的群体编码轴切换。",
    ],
    detail: [
      "如果只用一句话概括：面孔细胞不是一直用同一种规则编码面孔。它们先用一个可以从普通物体空间解释的通用轴来判断“这是脸”，随后在不到 20 ms 的群体事件中切换到一套面孔专用轴，用来区分具体面孔身份。",
      "文章挑战的是一个很基础的默认假设：神经元的 tuning function 是稳定的。传统上我们会说一个 IT 神经元偏好某些形状或某些特征，它看到这些特征就高放电，看到另一些就低放电。本文的强结论是，这个“偏好方向”不是固定的，而会根据刺激类别在时间中改变。",
      "这里的“concerted”非常重要。它不是某几个神经元各自慢慢漂移，而是大量面孔选择性细胞在相近时间窗口一起改变编码轴。因此它更像一个网络状态转换，而不是孤立神经元的疲劳、适应或噪声。",
      "这篇文章的哲学味道也很重：同一块皮层区域可以先执行 domain-general 的快速检测，再转入 domain-specific 的精细分析。也就是说，domain-general 和 domain-specific 并不是非此即彼，而可能是同一个神经群体在不同时间片上的两种状态。",
    ],
    confusions: [
      "不要把“编码切换”理解成“神经元开始响应另一个脑区”。本文讨论的是同一批细胞在同一刺激之后，不同时间窗里的响应与特征空间方向之间的关系改变。",
      "不要把“face-specific”理解成只有面孔 patch 才有特殊结构。作者还发现 face patch 外某些偏好刺激的细胞也有较弱轴变化，说明这可能是 IT 的一般计算母题，面孔系统只是最强例子。",
      "不要把“100 ms 后”理解成整个识别才开始。早期已经有强面孔响应和检测信息，后期新增的是用于个体区分的高维面孔特征信息。",
    ],
    remember: "本文主线是“检测到辨别”的动态转换：早期通用轴检测面孔，后期面孔专用轴区分身份。",
  },
  {
    id: "debate",
    label: "背景争论",
    title: "domain-general 与 domain-specific 为什么吵了这么久",
    pages: [1, 2],
    question: "面孔 patch 到底是专门为面孔设计的模块，还是只是普通物体识别系统中一个偏好面孔的区域？",
    keyPoints: [
      "domain-specific 观点：面孔加工有专门机制，需要先通过一个 face-detection gate，再进行细粒度面孔特征抽取。",
      "domain-general 观点：面孔细胞也可以被一般物体识别 DNN 的特征空间解释，不需要特殊面孔机制。",
      "作者把争论转成一个可测问题：同一个细胞对 faces 和 non-face objects 是否使用同一个 preferred axis。",
      "如果是通用机制，face axis 和 object axis 应该一致；如果是专用机制，face axis 应该与 object axis 不同。",
    ],
    detail: [
      "Fig. 1a 左上画的是专用模型：输入图像先经过一个面孔检测门控，确认是 upright face 后，系统才抽取详细面孔特征。这和经典面孔整体加工现象相连，例如倒置 Thatcher illusion 会显著破坏局部面孔特征感知。",
      "Fig. 1a 左下画的是通用模型：深度神经网络训练在一般物体分类上，后期层单元已经可以解释 IT 皮层、包括面孔 patch 的响应。如果这个模型足够好，那么面孔 patch 也只是 general object space 中偏向面孔区域的一组单元。",
      "Fig. 1b 给出了本文最核心的数学语言：每个刺激被表示成一个 M 维特征向量，每个神经元有一个 preferred axis，神经元响应近似等于刺激特征向量在该轴上的投影。投影越大，放电越强。",
      "Fig. 1c 是物体空间的直觉图：作者用 AlexNet fc6 层特征，对大量 faces 和 objects 做 PCA，得到一个通用 object space。面孔不是脱离这个空间存在，而是在该空间的一个区域里成团分布。",
      "真正的判别逻辑在 Fig. 1d。如果同一个细胞真的只有一个通用轴，那么用 objects 拟合出来的 object axis 和用 faces 拟合出来的 face axis 应该方向相同。反之，如果面孔加工启动了特殊机制，同一细胞面对 faces 时可能改用另一条轴。",
    ],
    confusions: [
      "DNN 在这里不是作者要证明“大脑就是 AlexNet”。它主要是一个可操作的特征坐标系，用来把图片放进同一个高维空间并估计轴。",
      "axis 不是解剖上的神经纤维方向，而是特征空间中的向量方向。它描述“哪些刺激特征让这个细胞更高放电”。",
      "domain-general 不是说面孔细胞不偏好面孔，而是说它们偏好面孔可以由同一个物体特征空间中的固定轴解释。",
    ],
    remember: "本文把一个抽象争论变成了轴是否一致的问题：faces 和 objects 是否共享同一条编码轴。",
  },
  {
    id: "design",
    label: "实验设计",
    title: "他们怎么把“编码轴”测出来",
    pages: [2, 3],
    question: "要证明编码规则切换，首先要有一个可重复估计的特征空间和足够大的刺激集。",
    keyPoints: [
      "用 fMRI 定位猕猴面孔 patch ML 和 AM，再用 NHP Neuropixels 记录神经活动。",
      "主实验包含 1,525 张人脸和 1,392 张非面孔物体图像。",
      "每个刺激显示 150 ms，间隔 150 ms，动物执行被动注视任务。",
      "图像被送入 AlexNet fc6 层，再经 PCA 得到 60 维 general-object space。",
      "对每个细胞，用线性回归分别拟合 object axis 和 face axis，并在 held-out test set 上看 R²。",
    ],
    detail: [
      "Fig. 1e 是实验位置：他们先用 fMRI localizer 找到面孔 patch，再把 Neuropixels 探针插到 ML 或 AM。ML 通常被看作中间级面孔 patch，AM 更靠前、更高阶。",
      "Fig. 1f 展示刺激规模。这个规模非常关键，因为估计一个 60 维轴需要大量刺激，否则拟合容易被噪声和个别图片驱动。1,500 多张脸和 1,300 多个物体使作者能稳健地做训练集和测试集划分。",
      "Fig. 1g 和 1h 展示面孔 patch 的基本性质：ML 和 AM 的许多细胞确实更响应 faces。主文报告 ML 中 54.5% 细胞、AM 中 51.6% 细胞达到 face selectivity d′ >= 0.2。这说明记录位置确实捕获了 face-selective population。",
      "方法上，object axis 是用非面孔物体响应拟合出来的轴，face axis 是用面孔响应拟合出来的轴。这里不是简单比较平均响应，而是在问：细胞对不同图片的响应梯度，是否沿着同一个特征方向变化。",
      "作者始终用 held-out test set 评估轴能否解释响应，避免只是在训练集上过拟合。Extended Data Fig. 4a,b 进一步显示真实轴比 shuffle control 能解释更多方差。",
    ],
    confusions: [
      "face axis 和 object axis 都是在同一个 60 维 object space 中估计的，至少在 Fig. 2 和 Fig. 3 中是这样。因此二者可以直接比较方向。",
      "被动注视并不等于没有认知加工。它减少任务策略干扰，让神经动态更接近自动视觉处理。",
      "大样本图像集的意义不是为了训练 DNN，而是为了可靠地反演神经元偏好的特征轴。",
    ],
    remember: "实验设计的核心是：大刺激集 + DNN 特征空间 + 线性轴模型 + 时间窗分析。",
  },
  {
    id: "fig2",
    label: "Fig. 2",
    title: "同一批 face cells 对 faces 和 objects 用不同轴",
    pages: [3, 4],
    question: "如果 face patch 只是通用物体空间的一部分，那么 face axis 和 object axis 应该相似；结果却不是。",
    keyPoints: [
      "object axes 在 PC1-PC2 空间中高度一致，指向面孔所在象限，像是在做面孔检测。",
      "face axes 分散得多，说明每个细胞对面孔内部差异的偏好不同。",
      "PC1 和 PC2 上 face-axis weights 与 object-axis weights 基本不相关。",
      "用 face axis 预测 object responses 或用 object axis 预测 face responses 都失败。",
      "单细胞例子显示，某个细胞的 face axis 和 object axis 甚至可以近乎相反。",
    ],
    detail: [
      "Fig. 2a 是第一张关键证据图。左边绿色 object axes 指向同一象限，而这个象限正是 face stimuli 在 object space 中的位置。直觉上，这些轴像一群“脸检测器”：沿这个方向投影越大，越像脸，细胞越容易响应。",
      "右边紫色 face axes 则没有统一朝向。因为所有刺激都已经是脸，任务不再是“是不是脸”，而是“脸与脸之间有什么差异”。不同细胞分别关心不同面孔维度，所以方向分散。",
      "Fig. 2b 进一步定量：如果同一细胞在 faces 和 objects 上用同一条轴，PC1 权重和 PC2 权重应该有强相关。但结果 PC1 只有很弱相关，PC2 不相关。",
      "Fig. 2c 是更强的交叉预测检验。object axis 能预测 left-out objects，face axis 能预测 left-out faces；但 object axis 不能预测 faces，face axis 不能预测 objects。这说明不是估计噪声，而是响应规则真的分开。",
      "Fig. 2d 的单细胞例子很适合学习时反复看。上方两个散点说明这个细胞对 objects 和 faces 都能被各自轴解释；下方 PC1-PC2 图却显示两条轴方向相反。也就是说，不是这个细胞不可解释，而是它要用两个解释。",
    ],
    confusions: [
      "Fig. 2 主要是时间平均窗口 50-220 ms 的结果。它证明 faces 与 objects 的总体轴不同，但还没告诉我们这个差异什么时候出现。",
      "object axis 指向 face quadrant 不等于 object stimuli 是 faces；它表示这些 face cells 对非脸物体中“更接近面孔方向”的特征更响应。",
      "face axes 分散不是坏事。对于身份辨别来说，群体中不同细胞覆盖不同特征方向正是信息丰富的表现。",
    ],
    remember: "Fig. 2 证明同一批面孔细胞不能用单一通用轴解释；faces 和 objects 的编码轴已经分家。",
  },
  {
    id: "fig3",
    label: "Fig. 3",
    title: "最关键结果：轴不是一直不同，而是在约 100 ms 后切换",
    pages: [4, 5, 6],
    question: "如果 face axis 和 object axis 不同，那么细胞是一开始就知道要用哪条轴，还是先通用、后专用？",
    keyPoints: [
      "用 20 ms sliding window 估计时间变化轴。",
      "object axis 很早稳定，并且整个刺激期间保持稳定。",
      "face axis 早期 50-100 ms 与 object axis 对齐，随后约 100 ms 后变成负相关。",
      "许多细胞的 face axis 在 PC1-PC2 低维空间中出现方向反转，ML 中约 62% 清楚翻转，AM 中约 57%。",
      "face responses 在切换后变得更稀疏，提示群体从检测状态进入更选择性的辨别状态。",
    ],
    detail: [
      "Fig. 3b 是全篇最重要的图之一。左矩阵 object-object 显示 object axis 在不同时间窗之间高度相似，说明物体编码轴稳定。中矩阵 face-face 显示 face axis 稳定得更晚。右矩阵 face-object 显示，早期二者是正相关，过了约 100 ms 后转为负相关。",
      "Fig. 3c 把右矩阵的对角线拿出来看，也就是同一时间点 face axis 与 object axis 的相关。它先上升为正，随后下降为负。这个形状就是“先共享检测轴，后切换专用轴”的时间证据。",
      "Fig. 3d 显示群体放电峰大约在 93 ms。很有意思的是，切换发生在强早期响应附近或之后，而不是很晚的认知反馈阶段。这让作者主张它是快速视觉处理内部的一部分。",
      "Fig. 3e 把每个细胞的 time-varying face axis 与该细胞总体 object axis 做相似度。高度 face-selective 的细胞尤其明显：早期相似，随后快速变负。object axis 自己则从头到尾比较稳定。",
      "Fig. 3f 和 3g 是直观单细胞证据。看 PC1-PC2 里的紫色 face axis 箭头：80-100 ms 时指向 face quadrant，120-140 ms 时突然反向。这个反转不是图示夸张，作者统计说 ML 中约 62% 细胞符合清楚翻转标准。",
      "Fig. 3h 的 sparseness 很重要。面孔刺激下群体响应变得更 sparse，意味着不是所有细胞一起泛泛响应“脸”，而是更少、更特异的细胞组合开始区分具体面孔。检测通常需要低维、冗余、稳健；辨别通常需要高维、稀疏、细粒度。",
    ],
    confusions: [
      "轴反转不等于平均 firing rate 反转。它表示刺激特征到 firing rate 的梯度方向变了。",
      "早期 alignment 不是对 domain-specific 的否定，反而是本文整合两种理论的关键：同一系统先 general，再 specific。",
      "AM 比 ML 更晚出现反转，作者据此认为 ML 的切换不太可能是 AM 反馈造成，更可能来自 ML 局部复发 dynamics。",
    ],
    remember: "Fig. 3 是整篇论文的心脏：face cells 早期像普通面孔检测器，约 100 ms 后集体换成面孔辨别编码。",
  },
  {
    id: "stimulus-gated",
    label: "门控与控制",
    title: "为什么这不是普通响应强度、适应或图像频率造成的",
    pages: [6, 25, 27, 29, 31],
    question: "一个大结论必须排除简单解释：是不是只因为脸响应更强、弱刺激更慢、神经元适应、或者低高空间频率先后到达？",
    keyPoints: [
      "作者提出 single-stimulus axis-change score，用单张图片的群体早晚响应相关来判断是否触发轴变化。",
      "人脸和猴脸强烈触发，狗脸较可变，pareidolia 较弱，非脸物体不明显。",
      "face patch 外也能看到较弱 axis change，说明这可能是 IT 的一般计算策略。",
      "高平均响应不是充分条件：强响应的无脸动物身体或物体不触发同样切换。",
      "低响应的 degraded faces 仍可触发切换，说明不是简单强度阈值。",
      "作者还排除了弱刺激延迟、cell-intrinsic adaptation、空间频率 coarse-to-fine 等解释。",
    ],
    detail: [
      "Extended Data Fig. 5j-l 的 single-stimulus score 很巧妙。作者不再预先告诉模型“这张是脸”，而是看同一张图片在早期和晚期引起的群体响应 rank 是否发生面孔式改变。更负的早晚群体相关意味着更强 axis change，分类器把它转成 faceness score。",
      "这个分析的意义是：面孔 patch 是否“把某张图当作脸处理”，可以从动态模式本身读出来。人脸、猴脸强，狗脸和错觉脸较弱或可变，说明切换依赖刺激是否足以启动面孔网络状态。",
      "Extended Data Fig. 6 扩展到 face patch 外。某些 monkey-body-selective、stubby-object-selective、spiky-object-selective、face-selective outside-patch neurons 也有 axis change，但通常不如面孔 patch 中稳定。作者因此把它上升为 IT 的可能通用 motif。",
      "Extended Data Fig. 7 是控制分析大本营。第一类控制针对“是不是响应越强就切换”：作者找出最有效非面孔物体和最弱有效面孔，发现强非脸响应并不能触发 face-like axis change，而弱脸仍可以。",
      "第二类控制针对“弱刺激响应延迟造成表面反转”：如果只是弱刺激晚到，那么用早期最强 faces 子集估计的轴在早晚时间应该不反转。结果仍然反转，所以不是这个原因。",
      "第三类控制针对 adaptation：如果高响应后阈值升高，理论上会改变响应强度，但模拟显示单轴模型加阈值后轴仍高度相关，不能产生本文观察到的轴翻转。",
      "第四类控制针对 coarse-to-fine 视觉输入：低空间频率先到、高空间频率后到也可能造成表征变化。作者用低频和高频特征分别分析，仍看到面孔轴的负相关变化，因此不是简单频率通道先后到达。",
      "Extended Data Fig. 8 又显示 degraded faces 虽然平均响应弱，但仍能触发 axis change；同时用 VGGFace2/ResNet-50 face space 重做也得到类似结果，排除 AlexNet 特征空间偶然性的担忧。",
    ],
    confusions: [
      "控制分析不是附属小事。没有这些控制，Fig. 3 可以被解释成放电强度、疲劳、延迟或图像低级属性造成的假象。",
      "stimulus-gated 不等于只有人脸。猴脸也强烈触发，狗脸和 pareidolia 介于中间，说明门控可能按神经系统的“面孔性”连续变化。",
      "face patch 外有 axis change 不削弱主结论，反而说明这种动态编码可能是 IT 更广泛的计算机制。",
    ],
    remember: "作者用大量控制说明：触发切换的不是响应强度或低级图像属性，而是刺激启动了面孔相关的网络动态。",
  },
  {
    id: "fig4",
    label: "Fig. 4",
    title: "切换后不是丢信息，而是出现新的高维面孔调谐",
    pages: [6, 7],
    question: "face axis 反转之后，大脑到底获得了什么？答案是更多用于区分脸的高维特征轴。",
    keyPoints: [
      "作者另建 60 维 face space，强调面孔内部身份差异，而不是 faces 与 objects 的差异。",
      "face axes 在短时窗和长时窗之间低维反向、高维去相关；object axes 则保持相关。",
      "长时窗群体响应需要更多 PCA 维度才能解释 90% 方差，说明表征维度升高。",
      "ν⊥ 分析直接找出晚期相对于早期新增的正交调谐方向。",
      "新增方向对应具体面孔特征组合，例如眼距、下巴形状、性别化外观、肤色等。",
    ],
    detail: [
      "Fig. 4 与 Fig. 3 的区别在于坐标系变了。Fig. 3 主要在 general-object space 里看检测相关维度；Fig. 4 改用 face space，专门描述脸与脸之间的差异。",
      "Fig. 4a 显示 face axis weights 随时间发生显著变化：80-100 ms、120-140 ms、160-180 ms 三个窗口中的轴模式不同，尤其从早到中期变化剧烈。Fig. 4b 的 object axes 则稳定得多。",
      "Fig. 4c 用所有 60 个 face-space 维度计算早晚轴相似度。face axis 分布偏负，object axis 偏正。Fig. 4d 只看维度 6-60，face axis 仍不呈稳定正相关，说明变化不是只发生在低维检测维度。",
      "Fig. 4e 显示一旦从早期切到中期，face axis 在 120-140 ms 到 160-180 ms 之间又变得稳定。这像是网络从一个状态跳到另一个状态，而不是持续无规则漂移。",
      "Fig. 4f 的 PCA 方差解释非常重要：长 latency 需要约 91 个维度解释 90% 方差，短 latency 约 79 个维度。这说明晚期表征更高维、更分散，适合区分许多相似脸。",
      "Fig. 4g-k 进一步把晚期轴 ν2 分解成与早期轴 ν1 平行的部分和正交的新部分 ν⊥。如果某细胞晚期只是沿原轴增强或减弱，ν⊥ 不会有意义；但作者看到 ν⊥ 上出现清楚调谐，说明晚期真的获得新特征方向。",
    ],
    confusions: [
      "高维不是抽象夸张，而是指群体响应需要更多独立维度来解释，这通常意味着可编码更多细微差异。",
      "ν⊥ 是相对于同一细胞早期轴的新方向，不是所有细胞共享同一个新方向。不同细胞获得的正交特征不同。",
      "低维反转与高维新调谐是两个同时发生的现象：前者把系统从检测维度移开，后者增加身份辨别信息。",
    ],
    remember: "Fig. 4 说明切换的正功能是增加面孔身份所需的高维、细粒度特征调谐。",
  },
  {
    id: "fig5",
    label: "Fig. 5",
    title: "晚期编码真的更有用：它改善面孔身份重建",
    pages: [8, 9],
    question: "编码轴变化是否只是数学现象？作者用重建和识别任务证明它有功能后果。",
    keyPoints: [
      "作者用神经响应线性解码 face latent features，再用生成模型重建面孔。",
      "long 和 combined latency 的重建比 short latency 更好，尤其当可用细胞数增加时。",
      "跨时间窗训练测试会失败：短窗训练的 decoder 不能解释长窗响应，反之亦然。",
      "短 latency 在少量细胞时有优势，因为低维检测特征冗余且解释方差大。",
      "长 latency 在细胞数较多时胜出，因为它覆盖更多高维身份特征。",
    ],
    detail: [
      "Fig. 5a 是管线：原图先经过生成模型 encoder 得到 latent features；神经响应通过线性 decoder 预测这些 latent features；再由 decoder 生成重建脸。这样作者可以问：不同时间窗的神经响应能重建多少面孔身份信息。",
      "Fig. 5b 直观看重建。best possible reconstruction 是生成模型本身的上限，用真实 latent features 生成。combined 和 long latency 的神经重建更像原脸；short latency 较差。最关键的是跨窗训练测试失败，说明早晚不是同一编码加噪声，而是编码规则变了。",
      "Fig. 5c-d 用 face-discrimination DNN 做客观评价：每个神经重建与最佳重建在 DNN face space 中比较距离，看哪个时间窗最接近。这个指标避免只靠人眼主观判断。",
      "Fig. 5d 的交叉很有解释力。少细胞时 short latency 好，因为低维、强方差、面孔检测维度容易被少数细胞抓住。细胞数增多后，long 和 combined latency 超过 short，因为更多细胞可以覆盖更高维、更多样的身份特征。",
      "Extended Data Fig. 9 进一步支持：面孔分类 face vs object 的信息先到，身份 discrimination 的信息后升；即使固定低维面孔变化，只留下高维身份变化，晚期辨别仍然提升。",
    ],
    confusions: [
      "重建质量不是说猴子主观看到重建图，而是研究者用重建作为读出神经信息的工具。",
      "short latency 不差，它适合检测；long latency 更适合身份辨别。二者是不同计算目标。",
      "cross-window failure 是强证据：如果只是同一编码逐渐增强，跨窗 decoder 不应该完全崩掉。",
    ],
    remember: "Fig. 5 把编码切换和行为功能联系起来：晚期新轴使面孔身份信息更可读出。",
  },
  {
    id: "discussion",
    label: "讨论",
    title: "它对视觉神经科学和 DNN 模型意味着什么",
    pages: [9, 10],
    question: "这篇文章的意义不只是“面孔细胞很复杂”，而是挑战了固定调谐和纯前馈核心识别的常识。",
    keyPoints: [
      "domain-general 与 domain-specific 被整合成时间序列：早期 general，后期 specific。",
      "clear isolated faces 这种典型 core object recognition 任务也伴随快速 recurrent-like dynamics。",
      "深度前馈网络可以解释早期或平均响应的一部分，但不足以描述编码轴切换。",
      "作者推测局部和长程 recurrent connections 参与切换，Extended Data Fig. 10 用简单 RNN 展示 lateral inhibition 可产生轴反转。",
      "核心理论贡献是提出 stimulus-dependent switching of neural code 作为一种表征机制。",
    ],
    detail: [
      "讨论部分明确说，本文不是观察到不同特征有不同 latency。那种结果很常见，因为视觉路径有多条通路，不同信息先后抵达 IT 并不奇怪。本文更强：同一群体对同一类刺激的编码轴发生 wholesale switch。",
      "作者把 face-detection gate 具体化了。过去 gate 更像心理学或计算模型中的假设：先判断是不是脸，再进行整体面孔加工。本文给出神经实现：早期 object axis 指向 face quadrant，支持检测；后期 face axes 反转并展开高维调谐，支持辨别。",
      "这挑战了“200 ms 内核心物体识别主要由前馈网络完成”的强版本观点。因为即便是清晰、孤立、无背景的脸，IT 中关键面孔区域也出现快速动态编码变化。",
      "对 DNN 建模的启发是：只比较平均 firing rate 与 DNN layer features 可能漏掉时间结构。一个 DNN 特征空间可以作为坐标系，但如果模型本身没有状态切换或 recurrent dynamics，就难以解释本文最关键的结果。",
      "Extended Data Fig. 10 的 RNN 不是完整生物模型，而是 proof of principle：带局部抑制和长程兴奋的 recurrent network 可以把输入梯度反转。作者由此提出 lateral inhibition 可能不只是增强对比，也可能参与坐标轴级别的表征转换。",
    ],
    confusions: [
      "本文没有证明具体突触机制已经确定。RNN 和 lateral inhibition 是合理机制假说，不是直接电路证明。",
      "不是说前馈 DNN 完全没用。它仍然提供了可解释 IT 响应的特征空间；问题在于它不能单独解释时间中的编码切换。",
      "domain-specific 不一定是天生独立模块，也可以是通用系统中被刺激门控出来的动态状态。",
    ],
    remember: "最大的理论贡献是：皮层区域可以根据刺激类别快速切换编码规则，固定调谐函数不是唯一范式。",
  },
  {
    id: "methods-stimuli",
    label: "Methods 1",
    title: "刺激、动物和记录：为什么这个数据集可信",
    pages: [11, 12],
    question: "Nature 论文的说服力很大程度来自实验设计和数据规模，这部分告诉你结果从哪里来。",
    keyPoints: [
      "三只雄性 rhesus macaques，fMRI 定位 face patches。",
      "主刺激集包括多来源真实人脸、非面孔物体、混合类别、非人脸和模糊脸样刺激、degraded faces、synthetic faces。",
      "动物头固定，被动注视，眼动监测 1,000 Hz。",
      "Neuropixels 1.0 NHP probes 记录 ML 和 AM，SpikeGLX/OpenEphys 采集，Kilosort 排序。",
      "主图与扩展图分别来自不同猴和不同 patch，用来证明可重复性。",
    ],
    detail: [
      "Methods 的 Visual stimuli 很长，因为作者需要排除很多替代解释。除了主实验 faces/objects，他们还准备 monkey faces、dog faces、pareidolia、occluded/noisy/Mooney degraded faces、synthetic faces、monkey bodies 等。",
      "面孔图像来自多个数据库，经过 landmark alignment。这样做让面孔空间比较规范，减少背景、位置、尺度等无关差异，让神经差异更可能来自面孔特征本身。",
      "非面孔物体来自之前 object-space mapping 研究，保证与既有 IT object space 文献连接。作者不是临时挑一批任意物体，而是在已有理论框架中检验面孔 patch。",
      "Neuropixels 的优势是可以沿探针一次记录大量单位，覆盖 patch 内外。劣势是记录到的 face-selective cell 比例可能低于传统单钨电极，因为探针也采到边界外、小单位或视觉驱动弱的单位。作者在 Methods 中主动解释了这一点。",
      "主文 Figs. 1-5 主要展示 monkey A 的 ML session，但 Extended Data 提供 monkey J 的 ML 和 monkey A/M 的 AM 复现。读的时候要注意：主文是清晰故事线，Extended Data 是跨动物、跨 patch 的稳健性。",
    ],
    confusions: [
      "不是所有记录到的 units 都进主分析。作者有 visually responsive、face selectivity、R² 等筛选标准。",
      "被动注视减少任务变量，但不等于数据没有行为约束；动物必须维持注视才能获得奖励。",
      "主文只展示一个 session 不等于只做了一个 session；Methods 说明总共纳入 monkey A 13 sessions、monkey J 1 session、monkey M 1 session。",
    ],
    remember: "这个研究的实验基础是大规模刺激、精确 face patch 定位、高密度电生理和多套控制刺激。",
  },
  {
    id: "methods-axis",
    label: "Methods 2",
    title: "轴模型、d′、R² 和时间窗到底怎么算",
    pages: [12, 13],
    question: "理解本文必须掌握 preferred axis 的计算逻辑，否则 Fig. 2-4 很容易只看成漂亮热图。",
    keyPoints: [
      "visually responsive cells 用刺激前 -50-0 ms 与刺激后 50-300 ms 活动的 t-test 筛选。",
      "face selectivity d′ 按 faces 与 objects 的均值差除以 pooled variance 计算，并取 80-140 ms 之间 20 ms 滑窗峰值。",
      "general-object space 来自 AlexNet fc6 对 faces+objects 的 PCA，face space 来自 AlexNet fc6 对 faces 的 PCA。",
      "preferred axis 用线性回归从图像特征预测细胞 firing-rate response。",
      "time-varying axis 用 20 ms sliding window 拟合，比较不同 latency 的 cosine similarity。",
    ],
    detail: [
      "d′ 的作用是筛出真正 face-selective 的细胞。它不是简单 face 平均响应减 object 平均响应，而是把方差也考虑进去，因此更接近可分性指标。",
      "general-object space 的构建：把图像送进 AlexNet fc6，得到 4,096 维特征，再 PCA 成 60 维。这个空间能解释大部分 object fc6 方差和一部分 face fc6 方差，用于 Fig. 2 和 Fig. 3。",
      "face space 的构建：只用 face images 的 fc6 responses 做 PCA，得到更关注面孔内部差异的 60 维空间，用于 Fig. 4 和高维面孔调谐分析。",
      "preferred axis 的线性回归可以这样理解：给定每张图片的 60 维坐标，找一条方向，使图片投影到这条方向上的值最能预测某个细胞的响应。回归权重向量就是该细胞在这个空间里的轴。",
      "R² 是在 held-out test set 上计算的，这是防止过拟合的关键。作者还用 shuffle control、Gaussian stimulus distribution control、AlexNet artificial units 等验证轴结果不是刺激分布或建模框架的假象。",
      "time-varying axis 则是在不同 20 ms 时间窗重复拟合同样的轴。这样可以看到轴在时间上的稳定、对齐、反转，而不是只看平均 firing-rate PSTH。",
    ],
    confusions: [
      "R² 为正只是说明线性轴有解释力，不代表解释了所有神经响应。IT 响应仍可能有非线性和噪声。",
      "cosine similarity 比较的是方向相似度，不关心轴长度。方向变负代表偏好的特征梯度反向。",
      "用 AlexNet 不代表作者认为猴脑用 AlexNet。它是一个公共坐标系，让 faces 和 objects 可以被统一参数化。",
    ],
    remember: "preferred axis 是把神经元响应翻译成特征空间方向；本文所有“切换”都建立在时间窗内轴方向变化上。",
  },
  {
    id: "methods-controls",
    label: "Methods 3",
    title: "控制分析的技术路线",
    pages: [13, 14],
    question: "作者如何把“看起来像切换”的假象逐一排除？",
    keyPoints: [
      "normalized face-object axis correlation 用 within-category axis reliability 校正 out-of-distribution 影响。",
      "artificial AlexNet units 作为单轴模型的阳性对照，检验如果细胞本来就是固定轴会发生什么。",
      "single-stimulus score 用早晚 population response correlation 测单张图是否触发轴变化。",
      "控制分析分别针对响应强度、弱刺激延迟、adaptation、空间频率。",
      "ν⊥ 分析用于识别晚期相对于早期真正新增的正交 tuning direction。",
    ],
    detail: [
      "normalized axis correlation 的思路是公平比较。因为 faces 和 objects 分布不同，跨类别轴估计天然更难。作者先测同类内部两半数据拟合轴的一致性，把它当作可靠性上限，再用 face-object raw correlation 除以上限。",
      "artificial AlexNet units 很聪明。因为这些单元本来就在 fc6 空间里，它们按构造应该有单一轴。如果同样流程在 artificial units 上得到 face/object axes 相关，而真实神经元不相关，就说明真实结果不是方法必然产物。",
      "single-stimulus score 避免对每个细胞做归一化，直接用 raw firing rates 的 population vector。作者先去掉极端 firing-rate cells，防止少数高放电细胞支配相关，然后比较 early window 和 late window 的 population rank。",
      "弱刺激延迟控制特别值得记：如果早期强响应先来、晚期弱响应后到，就可能造成表面上的 preference reversal。作者把每个细胞最有效和最无效 faces 分开拟合轴，发现长时窗两组轴仍相关，且早晚轴仍反转，因此排除这个解释。",
      "ν⊥ 的计算是线性代数上的正交分解：晚期轴 ν2 减去它在早期轴 ν1 上的投影，剩下的就是相对于早期真正新出现的方向。Fig. 4h-k 就是在可视化这个新方向编码什么脸部特征。",
    ],
    confusions: [
      "控制分析不是都在主文里完整展示，很多藏在 Extended Data；读论文时必须把主文与扩展图对应起来。",
      "single-stimulus score 是群体动态指标，不是单细胞 face selectivity。",
      "artificial units 不是生物模型，而是“如果固定轴假说为真，分析流程应当看到什么”的方法对照。",
    ],
    remember: "Methods 的控制逻辑是：先证明轴可靠，再证明真实神经元不同于固定轴模型，最后排除强度、延迟、适应和低级图像属性。",
  },
  {
    id: "methods-decoding",
    label: "Methods 4",
    title: "面孔重建和识别评价怎么支持功能结论",
    pages: [14, 15],
    question: "Fig. 5 的“晚期更能识别身份”不是主观看图，而是一套神经解码和 DNN 评价流程。",
    keyPoints: [
      "生成模型类似 VAE/Wasserstein autoencoder，输入 128x128 图像，latent features 为 512 维。",
      "神经响应通过线性 decoder 预测 latent features，再由生成模型 decoder 重建脸。",
      "short、long、combined 三种时间窗长度匹配，AM 窗口相对 ML 延迟 20 ms。",
      "最佳重建 best possible reconstruction 用真实图像 latent features 得到，作为生成模型上限。",
      "重建评价用 pretrained face-discrimination DNN 的 feature space 距离，而非纯肉眼判断。",
    ],
    detail: [
      "作者先训练一个图像生成模型，把 faces 和 objects 压到 512 维 latent features，并加目标让 latent space 与 AlexNet fc6 features 对齐。这样 latent features 既能生成图像，又和前面 feature-space 分析有联系。",
      "神经 decoder 是线性的：从 population responses 预测 512 维 latent features。训练用 1,425 张 face images，测试用剩余 100 张。线性 decoder 的选择也很重要，它让读出能力更容易解释，不是一个巨大非线性模型硬拟合。",
      "三个窗口的时间长度被控制一致。ML short 是 50-75 和 75-100 ms，long 是 120-145 和 145-170 ms，combined 是 62-87 和 132-157 ms；AM 延后 20 ms。每个窗口都含两个子窗，允许 decoder 给子窗分配不同轴。",
      "评价时，作者把神经重建图和 best possible reconstruction 都送入 face DNN，看哪种时间窗重建离对应目标最近。这个 criterion 更关注身份相似性，而不只是像不像一张脸。",
      "模拟分析进一步说明 Fig. 5d 的交叉曲线：早期少数低维高方差特征在细胞少时有优势；晚期高维多样特征在细胞多时胜出。这个模拟把结果和“检测-辨别 trade-off”联系起来。",
    ],
    confusions: [
      "combined window 好不奇怪，因为它包含早晚信息；真正关键是 long 单独在多细胞时超过 short。",
      "重建失败不是生成模型坏了，因为 best possible reconstruction 已经给出生成模型上限。",
      "DNN 评价不是用来证明 DNN 等于大脑，而是提供一个标准化的面孔身份相似度度量。",
    ],
    remember: "Fig. 5 的功能论证是：晚期轴切换让神经群体携带更多可解码的面孔身份信息。",
  },
  {
    id: "extended-replication",
    label: "Extended 1-3",
    title: "复现性：ML、AM、不同猴子都看到了什么",
    pages: [17, 18, 19, 20, 21, 22],
    question: "主文主要讲 monkey A 的 ML；扩展图回答这个现象是不是只在一个动物、一个 patch、一个 session 出现。",
    keyPoints: [
      "Extended Data Fig. 1 展示 ML/AM 定位和 face selectivity distribution。",
      "Extended Data Fig. 2 在 monkey J 的 ML 中复现主文 Fig. 2-5 的主要结果。",
      "Extended Data Fig. 3 在 monkey A 和 M 的 AM 中展示类似动态，但 AM latency 更晚。",
      "不同实验中 faces/objects 有分块呈现，也有随机 interleaving，结果一致。",
      "这些扩展图支撑“concerted switching”不是单一数据集偶然现象。",
    ],
    detail: [
      "Extended Data Fig. 1 的作用是证明记录位置和细胞选择性。它包括 fMRI 激活、探针路径、screening stimuli 响应矩阵和 FSI 分布。你可以把它看作“我们确实在 face patches 中记录”的证据。",
      "Extended Data Fig. 2 基本是 monkey J ML 的主文复刻：object axes 指向 face quadrant，face axes 分散；face-object axes 早期对齐后期分离；face-space 高维调谐出现；重建分析也支持晚期信息。",
      "Extended Data Fig. 3 是 AM 的关键。AM 也有轴反转和高维新调谐，但整体 latency 比 ML 晚。这很符合面孔系统层级：ML 更早，AM 更晚、更高阶。",
      "AM 中还有一个细节：有时约 160 ms 出现短暂 second re-alignment，主文提到 ML 没有这个现象。这提示不同 patch 的 recurrent dynamics 不完全一样。",
      "分块呈现和 interleaving 都能看到结果，排除一个担忧：是不是 block context 或 adaptation 让细胞在 face block 和 object block 中切换策略。随机混合刺激仍复现，说明刺激本身足以触发切换。",
    ],
    confusions: [
      "Extended Data 不是“可看可不看”的补充。对于顶刊论文，扩展图常常承担重复性和控制论证的重任。",
      "AM 更晚不代表 AM 不重要；它说明切换可能沿面孔层级传播或在不同 patch 中以不同时间尺度发生。",
      "face selectivity 比例低于早期单电极研究不等于定位失败，Neuropixels 记录范围更广，包含更多边界和弱驱动单位。",
    ],
    remember: "Extended 1-3 的学习重点是复现性：同样故事在不同猴子和 face patch 中成立，AM 稍晚。",
  },
  {
    id: "extended-controls",
    label: "Extended 4-8",
    title: "关键控制：从刺激分布到退化脸，再到 patch 外单位",
    pages: [23, 24, 25, 26, 27, 28, 29, 30, 31, 32],
    question: "这些扩展图是审稿人会盯得最紧的地方：所有简单替代理论都要被处理。",
    keyPoints: [
      "Extended Data Fig. 4 证明轴模型可靠，并排除刺激分布和 AlexNet out-of-distribution 的解释。",
      "Extended Data Fig. 5 深入量化 switch time、PC1/PC2 反转、raw response cross-time correlation 和单刺激 faceness score。",
      "Extended Data Fig. 6 展示 face patch 外的 axis dynamics，提示更一般的 IT motif。",
      "Extended Data Fig. 7 系统测试 cell-intrinsic 与 low/high spatial frequency 替代解释。",
      "Extended Data Fig. 8 用 degraded faces 和 VGGFace2 face space 支撑稳健性。",
    ],
    detail: [
      "Extended Data Fig. 4 的重点是“轴结果不是数学假象”。真实神经元的 face/object axis 不相关，但 AlexNet artificial face-selective units 作为固定轴模型会表现出相关。这是本文方法论上很强的一步。",
      "Extended Data Fig. 5 把 Fig. 3 的动态拆得更细：switch time 分布集中，PC1/PC2 上多数细胞发生反转，response sparseness 上升，单张图也能触发可测的 axis-change signature。",
      "Extended Data Fig. 6 扩展到其他偏好类别的 IT units。某些 monkey-body、stubby、spiky、face outside patch units 也有类似轴变化，但 animal-selective units 不明显。这让人看到一个更大问题：IT 是否普遍用“先粗分类、后细辨别”的动态策略。",
      "Extended Data Fig. 7 是最密集的替代解释排除。它检验高平均响应、弱刺激延迟、适应阈值变化、空间频率逐步到达。每个控制都针对一个很自然的质疑，因此建议你读主文 Fig. 3 后马上读这张。",
      "Extended Data Fig. 8 很有说服力，因为 degraded faces 平均响应可以弱，但只要足以被系统作为脸处理，仍然触发 axis change。并且用 VGGFace2/ResNet-50 face space 重做，说明高维新调谐不是 AlexNet 坐标系独有产物。",
    ],
    confusions: [
      "刺激分布控制不是小问题。faces 和 objects 在 feature space 中分布不同，如果不控制，axis 差异可能被误认为编码差异。",
      "degraded faces 的意义不是研究视觉噪声本身，而是分离“响应强度”和“面孔性”。",
      "patch 外发现较弱 dynamics 不等于本文面孔结论泛化失败，而是提示这个机制可能还有更广适用范围。",
    ],
    remember: "Extended 4-8 是本文可信度的支架：它们把“编码切换”从一个漂亮现象变成难以用简单因素解释的机制。",
  },
  {
    id: "extended-decoding-rnn",
    label: "Extended 9-10",
    title: "解码时间程和 RNN 机制假说",
    pages: [33, 34],
    question: "最后两张扩展图回答两个问题：身份信息是否确实晚到？什么网络机制可能产生轴反转？",
    keyPoints: [
      "Extended Data Fig. 9 显示 face categorization 早，face identity discrimination 晚。",
      "固定低维 synthetic face variation 后，晚期 identity discrimination 仍提升，支持高维特征贡献。",
      "低维 face-space dimensions 可由低维 object-space dimensions 预测，符合早期检测逻辑。",
      "Extended Data Fig. 10 用简单 RNN 证明局部抑制和长程兴奋可以产生梯度反转。",
      "RNN 是机制示意，不是最终电路证明。",
    ],
    detail: [
      "Extended Data Fig. 9a-c 连接 Fig. 4 和 Fig. 5：低 face-space 维度和低 object-space 维度相互对齐，所以早期编码低维特征很适合做 face categorization。",
      "Extended Data Fig. 9d 显示时间程：分类 face vs object 的 population separation 先达到高水平，身份 discrimination 后面继续上升。这与 Sugase 等经典“先全局类别、后细节身份”的时间层级一致。",
      "Extended Data Fig. 9e-f 的 synthetic faces 控制很漂亮。作者固定低维 shape/appearance PCs，只让高维特征变化。如果晚期提升还存在，就说明不是低维检测特征残留，而是高维身份维度在起作用。",
      "Extended Data Fig. 10 则从机制角度补一个 toy model：RNN 接收线性梯度输入，训练目标是第二时间步输出反向梯度。学到的权重矩阵有局部抑制和长程兴奋结构；手工构造类似结构也能产生反转。",
      "这个模型和生理结论之间要保持距离。它说明“recurrent network 可以实现轴反转”，支持作者关于 local recurrence/lateral inhibition 的推测，但没有直接记录抑制性中间神经元或操纵局部回路。",
    ],
    confusions: [
      "identity discrimination 晚到不代表早期没有身份信息，而是晚期信息更适合精细区分。",
      "synthetic faces 的低维固定是为了隔离高维身份信息，不是因为自然面孔真的只有这些离散低维位置。",
      "RNN 模型是 proof of principle，不是完整面孔系统模型。",
    ],
    remember: "Extended 9-10 把功能和机制收束起来：晚期高维身份信息增强，recurrent inhibition-like dynamics 可能产生轴反转。",
  },
  {
    id: "reading-guide",
    label: "复习路线",
    title: "怎么高效复习这篇论文",
    pages: [1, 2, 5, 7, 8, 9, 34],
    question: "如果你要做组会或快速掌握，不要从第 1 页线性读到第 38 页，可以按证据链读。",
    keyPoints: [
      "第一遍：只读摘要、Fig. 1、Fig. 3、Fig. 5f，抓住“检测到辨别”的故事。",
      "第二遍：读 Fig. 2，理解为什么时间平均已经显示 face/object axes 分开。",
      "第三遍：读 Fig. 4，理解后期不是噪声，而是高维面孔调谐展开。",
      "第四遍：读 Extended Data Fig. 4-8，检查所有替代解释如何被排除。",
      "最后读 Methods 中 axis、time-window、reconstruction 三段，确认你能复述分析流程。",
    ],
    detail: [
      "组会讲这篇文章，建议用一句主线贯穿：同一个 face-cell population 在 100 ms 左右从“是不是脸”的低维通用检测轴，切到“是哪张脸”的高维专用辨别轴。",
      "Fig. 1 负责提出两种理论和 axis framework；Fig. 2 负责证明 face/object 轴不同；Fig. 3 负责证明它们早期相同、后期切换；Fig. 4 负责解释切换后新增什么信息；Fig. 5 负责证明这些新增信息有功能价值。",
      "如果听众偏计算神经科学，重点讲 feature space、linear regression axis、cosine similarity、cross-window decoding failure。如果听众偏系统神经科学，重点讲 ML/AM 时序、face patch specificity、stimulus-gated dynamics 和 recurrence。",
      "最容易被问的问题有四个：为什么不是 adaptation？为什么不是 response magnitude？为什么不是 DNN feature artifact？为什么不是 top-down feedback？对应答案分别在 Extended Data Fig. 7、7/8、4/8、AM latency 与 Fig. 3/Extended Data Fig. 3。",
    ],
    confusions: [
      "不要把 Fig. 2 当最终结论，Fig. 2 是时间平均后的现象；Fig. 3 才揭示为什么时间平均会看到不同轴。",
      "不要只讲“late response better”。更准确是 late response 在细胞数足够时更适合身份 discrimination，而 short response 对 detection 更高效。",
      "不要忽略 Extended Data；这篇文章的大部分防守都在扩展图里。",
    ],
    remember: "这篇论文的证据链是：理论争论 -> 轴模型 -> 早晚动态 -> 高维新调谐 -> 解码功能 -> 控制和机制假说。",
  },
];

function imagePath(pageNumber: number) {
  return `/paper-it-switching/pages/page-${String(pageNumber).padStart(2, "0")}.jpg`;
}

function pageLabel(pages: number[]) {
  if (pages.length === 1) return `p.${pages[0]}`;
  return `p.${pages[0]}-${pages[pages.length - 1]}`;
}

function SectionView({ section, index }: { section: Section; index: number }) {
  return (
    <section className={styles.section} id={section.id}>
      <div className={styles.sectionInner}>
        <article className={styles.explain}>
          <div className={styles.eyebrow}>
            <span className={styles.sectionNo}>{index + 1}</span>
            <span className={styles.pageRange}>{section.label}</span>
            <span className={styles.pageRange}>{pageLabel(section.pages)}</span>
          </div>
          <h2>{section.title}</h2>
          <p className={styles.question}>{section.question}</p>

          <div className={styles.block}>
            <h3>这一部分原文要点</h3>
            <ul>
              {section.keyPoints.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </div>

          <div className={styles.block}>
            <h3>详细解释</h3>
            {section.detail.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>

          <div className={styles.block}>
            <h3>容易混淆点</h3>
            <ul>
              {section.confusions.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </div>

          <div className={styles.takeaway}>
            <strong>这一部分要记住</strong>
            {section.remember}
          </div>
        </article>

        <aside className={styles.pdfPane} aria-label={`${section.title} 对应 PDF 页面`}>
          <div className={styles.pdfPaneHeader}>
            <strong>{section.label}</strong>
            <span>{pageLabel(section.pages)}</span>
          </div>
          <div className={styles.pageStack}>
            {section.pages.map((pageNumber) => (
              <figure className={styles.pageFigure} key={`${section.id}-${pageNumber}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className={styles.pageImage} src={imagePath(pageNumber)} alt={`论文第 ${pageNumber} 页`} loading="lazy" />
                <figcaption>
                  <span>PDF page {pageNumber}</span>
                  <span>Rapid concerted switching</span>
                </figcaption>
              </figure>
            ))}
          </div>
        </aside>
      </div>
    </section>
  );
}

export default function PaperExplainerPage() {
  return (
    <div className={styles.shell}>
      <header className={styles.topbar}>
        <div className={styles.topbarInner}>
          <div className={styles.brand}>
            <span className={styles.brandLabel}>Local paper explainer</span>
            <h1>Rapid concerted switching of the neural code in the inferotemporal cortex</h1>
          </div>
          <nav className={styles.nav} aria-label="论文详解章节导航">
            {sections.map((section, index) => (
              <a href={`#${section.id}`} key={section.id}>
                {index + 1}. {section.label}
              </a>
            ))}
          </nav>
          <a className={styles.homeLink} href="/">
            回到上传器
          </a>
        </div>
      </header>

      <main>
        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <h2>顶刊论文细读版</h2>
            <p>
              这个页面按论文证据链重新切分：左侧是中文精讲，右侧是对应 PDF 原页。它是临时本地学习页，不调用模型，也不会上传文件。
            </p>
            <p>
              推荐阅读方式：先顺着左侧解释抓住主线，再对照右侧图页看数据形态。遇到不懂的轴、时间窗、R²、ν⊥，直接跳到 Methods 章节回看。
            </p>
            <div className={styles.heroStats}>
              <span>Nature Article</span>
              <span>38 PDF pages</span>
              <span>14 study sections</span>
              <span>ML / AM face patches</span>
              <span>axis switching around 100 ms</span>
            </div>
          </div>
          <aside className={styles.heroPreview} aria-label="论文第一页预览">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imagePath(1)} alt="论文第一页" />
          </aside>
        </section>

        {sections.map((section, index) => (
          <SectionView key={section.id} section={section} index={index} />
        ))}
      </main>

      <footer className={styles.footer}>
        本地学习页生成自论文 PDF：Rapid concerted switching of the neural code in the inferotemporal cortex.pdf
      </footer>
    </div>
  );
}
