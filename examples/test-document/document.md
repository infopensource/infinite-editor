# Infinite Editor Markdown 全功能测试文档

> 这是一份用于检查 Markdown 编辑、所见即所得预览、分页与导出的综合测试文档。
> 它覆盖常用 Markdown、GFM 表格与任务列表、数学公式以及化学式。

## 1. 标题层级

### 三级标题

#### 四级标题

##### 五级标题

###### 六级标题

普通段落支持中文、English、数字 0123456789 与标点符号。  
这一行使用两个空格产生硬换行；同一段中的下一行用于检查软换行。

---

## 2. 行内样式

这里有 **粗体**、*斜体*、***粗斜体***、~~删除线~~、~~**组合样式**~~ 与 `inline_code()`。

转义字符：\*不是斜体\*，实体字符：&copy; &amp; &lt; &gt;。快捷链接：<https://dioxuslabs.com/>，邮箱：<test@example.com>。

[普通链接](https://commonmark.org/ "CommonMark")、[引用式链接][markdown-guide]，以及带说明文字的图片：

![Infinite Editor 的文档与 Markdown 编辑场景](document.assets/sample-image.png "示例图片")

*图 1：Infinite Editor 示例文档中的图片、替代文本与资源加载。*

[markdown-guide]: https://www.markdownguide.org/ "Markdown Guide"

## 3. 引用与嵌套

> 一级引用包含 **强调文本** 和行内公式 $a^2+b^2=c^2$。
>
> > 二级嵌套引用。
>
> 1. 引用中的有序列表
> 2. 第二项

## 4. 列表与任务

- 无序列表第一项
- 第二项包含嵌套内容
  - 子项目 A
  - 子项目 B
- 第三项包含多个段落

  这是同一列表项中的第二个段落。

1. 有序列表第一项
2. 第二项
   1. 嵌套编号 2.1
   2. 嵌套编号 2.2
3. 第三项

- [x] 已完成：标题与段落
- [x] 已完成：公式与化学式
- [ ] 待检查：分页和导出

## 5. GFM 表格

| 功能 | 语法示例 | 对齐 | 状态 |
| :--- | :---: | ---: | :---: |
| 粗体 | `**text**` | 左/中/右 | ✅ |
| 行内公式 | `$E=mc^2$` | 右对齐 | ✅ |
| 化学式 | `\ce{H2O}` | 居中 | ✅ |
| 转义竖线 | `a \| b` | 右对齐 | ✅ |

## 6. 代码

行内代码中的 Markdown 标记不会生效：`**not bold**`。

```rust
#[component]
fn Counter() -> Element {
    let mut count = use_signal(|| 0);
    rsx! {
        button { onclick: move |_| *count.write() += 1, "计数：{count}" }
    }
}
```

```json
{
  "name": "infinite-editor",
  "features": ["markdown", "math", "chemistry"]
}
```

    这是缩进代码块。
    Markdown 标记 **不会** 在这里渲染。

## 7. 数学公式

行内公式：质能方程 $E=mc^2$，欧拉恒等式 $e^{i\pi}+1=0$，分数 $\frac{1}{n}\sum_{i=1}^{n}x_i$。

二次方程求根公式：

$$
x=\frac{-b\pm\sqrt{b^2-4ac}}{2a}
$$

带上下标、积分、极限和矩阵的综合公式：

$$
\lim_{n\to\infty}\left(1+\frac{1}{n}\right)^n=e,
\qquad
\int_{-\infty}^{\infty}e^{-x^2}\,dx=\sqrt{\pi}
$$

$$
\mathbf{A}=
\begin{bmatrix}
1 & 2 & 3 \\
4 & 5 & 6 \\
7 & 8 & 9
\end{bmatrix}
$$

分段函数：

$$
f(x)=
\begin{cases}
x^2, & x\ge 0 \\
-x, & x<0
\end{cases}
$$

## 8. 化学式与化学反应

行内化学式：水 $\ce{H2O}$、硫酸 $\ce{H2SO4}$、硫酸根 $\ce{SO4^2-}$、铵根 $\ce{NH4+}$。

配平反应、状态与反应条件：

$$
\ce{2H2(g) + O2(g) -> 2H2O(l)}
$$

$$
\ce{N2(g) + 3H2(g) <=>[高温、高压][催化剂] 2NH3(g)}
$$

离子反应与沉淀：

$$
\ce{Ag+(aq) + Cl-(aq) -> AgCl(s) v}
$$

有机化学简式：

$$
\ce{CH3COOH + C2H5OH <=> CH3COOC2H5 + H2O}
$$

## 9. 分隔线与特殊测试

下面是第二种分隔线写法：

***

连续空格不会被当作多个普通空格；反斜杠转义符号：\# \[ \] \( \) \{ \}。

<!-- infinite-editor:page-break -->

## 10. 显式分页后的内容

如果分页功能正常，本节应从新页面开始。最后用一段较长文字检查自动换行、跨页排版、光标编辑与导出结果：Infinite Editor 应在 Markdown 源码和所见即所得模式之间保持内容一致，并正确处理中文、西文、公式、表格、列表和代码块等不同类型的文档节点。

文档测试结束。
