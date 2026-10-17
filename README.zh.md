---
description: "dsh-annotate：选中助手回答里的文字写下备注，攒够了一次性发给 agent。"
---

# dsh-annotate

[English](README.md) | 中文

选中助手回答里的一段文字，写下你对它的备注；标多少条都行，最后一起发给 agent。

## 它做什么

- 在回答里选中文字，选区旁浮出一个「标注」按钮，点开写这条备注；**Enter 保存，Shift+Enter 换行**。按钮与卡片进出各有一段短动画。
- 可以标多次，每条各自独立：引用是各自的选段，备注是各自的话。
- **在输入框里按 Enter 时，待发的标注会跟着一起发出去**：草稿在前、标注在后拼成一条消息；输入框为空时就是单独把标注发出去。Shift+Enter 仍是换行（不触发发送）。
- 待发送的标注以 **chip** 的形式排在**输入框正上方**一行（形态和原生图片/文件附件一样），每条显示引用 + 备注、可单独删除，末尾是一条带计数的「一起发送（n）」。
- 「一起发送」把它们拼成**一条**编号消息发进当前会话：

  ```
  Please address each of my annotations on your answer above:

  1. Quote: "this step overwrites the original file"
     Comment: it should back it up first

  2. Quote: "about 3 seconds"
     Comment: where does that number come from?
  ```

- 高亮是尽力而为：选区还有效时用 CSS Custom Highlight API 画出来，DOM 重排后就没了——**清单才是记录**，不是那层高亮。

**不做**消息锚定，也不做持久化：引用原文随消息一起发出去，所以下一轮 agent 看得到，你以后回看也看得到；标注只活在浏览器内存里，刷新即散。

## 安装

```sh
# from GitHub
dsh plugin --profile web add github:DWJZ/dsh-annotate

# local development (the profile links the checkout, so edits apply on restart)
dsh plugin --profile web add link:/path/to/dsh-annotate
```

桌面应用（`desktop` profile）由它自己的插件管理器添加。

## 使用

1. 在回答里选中文字。
2. 点「标注」，写备注，「保存」。重复第 1–2 步。
3. 在输入框顶部那条带子里核对 chip，点「一起发送（n）」。

## 已知限制

- **宿主半侧只是一个注册行。** 客户端 bundle 是扫描 Loader entry 里带 `dsh.client` 的包组合出来的，所以没有这一行，`client/` 那半边不会被加载。它不注册任何别的东西。
- 标注**不持久**：刷新页面即丢失（引用原文在发出去的消息里，所以不会丢上下文）。
- 高亮**不跟随重排**：流式输出或切换会话后可能消失，清单仍然完整。
- 助手正在输出时也可以标注，但那段文字随流式更新重排后，高亮可能已经不在原处。

## 测试

```sh
npm test
```

纯函数（拼消息、压行）与假 React 的挂载用例：断言拼出来的消息内容与格式、清单的增删与清空、发送只发一次。

## 许可证

MIT
