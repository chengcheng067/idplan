/**
 * H 版 · B2 打印时间轴 = **双栏分段轴甘特**（2026-10-13「5 块 × 4 模板」重构 · 批 D）。
 *
 * 依据 §1.4 的 H·B2 行（定稿形态）。用户原话：「H 版的甘特图，你可以根据主视觉来做
 * 设计。当然，做出来默认是打开的呀」⇒ **它出现在每一张 H 的纸上**，标准是
 * 「经得起每次都看」，不是「能用」。故三段式**全用 H 的既有语法件**：
 *   · 出血巨字页锚 / 双栏 + 中轴 / 3px 栏头线 / 实底状态标签 / 1px 发丝线 /
 *     mono 数字 / 居中摘要 / 通栏线 —— 一样没发明；
 *   · 新增的三件（跨度条 / 栏内标尺 / 通栏覆盖带）是**甘特的物理必需品**，
 *     没有任何替代方案。
 *
 * ── 三段 ──
 *   ① `ap-span-band` 通栏覆盖带：全部阶段区间的**合并覆盖**（gate 橙 / ink 墨分色段）
 *      + 1px 墨色基线 + 月份 mono 刻度 —— 一眼看全项目时间轮廓的页级基准。
 *   ② 双栏分段轴甘特（`ap-cols` + 中轴）：每栏一条栏内标尺 + 每阶段一行
 *      （`NN 名称` + 跨度条 + 条左端内嵌实底状态标签 + 右端两端日期）。
 *   ③ 本组件**不管** `ap-sum`（它在页级渲染，载荷由 `ApSpanPage.summary` 给）。
 *
 * ── ⚠️ 一条几何硬事实（设计侧明写、team-lead 裁定「保双栏」）──
 * **甘特需要一条共享轴，而双栏天然是两条独立轴 —— 两者不可兼得。**
 * 保双栏 ⇒ 栏内位置与长度可读、两栏等长，但**栏与栏之间的位置不能直接互比**。
 * 缓解靠 ① 通栏覆盖带给全局轮廓 + ② 栏内标尺让每栏自明 + ③ **把这句写进 B2 的
 * 口径注**（`AP_SPAN_NOTE`，本页渲染在 `ap-sum` 之前）。
 *
 * ── 误读防线（与 E 的跨度条同性质，但这里是「条不是状态」的反面）──
 * H 的读者是「跳读海报」的读者，第一眼找的是**状态**（橙 = 要人动）。B2 的条如果
 * 被读成状态就会误导：**条长只表示时间跨度，与状态无关**；状态由条左端的实底标签
 * （与 B4 同一套标签语义）承担。故：
 *   ① 条与标签之间留一条**纸色 1px 缝**（`border-right`）—— 标签再长也不会被读成
 *      「条更长」；
 *   ② 口径注与 `ap-sum` 副行都写「条 = 时间跨度，非完成度」；
 *   ③ 机器断言逐条对账「条像素宽 = 跨度% × 栏宽」（`data-span-width`），
 *      标签溢出**不计入**条长（它是绝对定位子元素，不改父盒宽度）。
 */

import type { JSX } from 'react';

import type { ApSpanPage, ApSpanRow } from './shared';
import {
  AP_SPAN_BAND_MIN_TICK_GAP_PCT,
  AP_SPAN_BAND_TRACK_PX,
  AP_SPAN_COL_MIN_TICK_GAP_PCT,
  AP_SPAN_COL_TRACK_PX,
  layoutTicks,
} from './shared';

export function SpanGantt({ page }: { page: ApSpanPage }): JSX.Element {
  // 抽稀 + 贴右缘的右对齐档（两步必须一起做，见 `layoutTicks` 的注释）
  const colTicks = layoutTicks(page.ticks, AP_SPAN_COL_MIN_TICK_GAP_PCT, AP_SPAN_COL_TRACK_PX);
  const bandTicks = layoutTicks(page.ticks, AP_SPAN_BAND_MIN_TICK_GAP_PCT, AP_SPAN_BAND_TRACK_PX);
  return (
    <div className="ap-span" data-print-span="">
      {/* ── ① 通栏覆盖带（714px 通栏；与栏内标尺同一 0→100% 映射）──
          两层**各自成行**：刻度行在上、覆盖段行在下（各自绝对定位在自己的行盒里）。
          第一版把两层压进一个盒（段 `bottom:0`、刻度 `top:0` + padding-top 让位），
          实测段会骑到刻度字上 —— 拆成两行后互不侵占，且都不越出流盒。 */}
      <div className="ap-span-band" data-print-span-band="" aria-hidden>
        <div className="ap-span-band__axis">
          {bandTicks.map((t) => (
            <span
              key={t.label}
              className="ap-span-band__tick"
              data-print-month-tick=""
              data-tick-left={t.leftPercent.toFixed(2)}
              data-tick-align={t.align}
              style={{ left: `${t.leftPercent}%` }}
            >
              {t.label}
            </span>
          ))}
        </div>
        <div className="ap-span-band__track">
          {page.cover.map((seg) => (
            <span
              key={`${seg.tone}-${seg.left}-${seg.width}`}
              className="ap-span-band__seg"
              data-tone={seg.tone}
              data-cover-left={seg.left.toFixed(4)}
              data-cover-width={seg.width.toFixed(4)}
              style={{ left: `${seg.left}%`, width: `${seg.width}%` }}
            />
          ))}
        </div>
      </div>

      {/* ── ② 双栏分段轴甘特（H 的签名双栏 + 中轴）── */}
      <div className="ap-cols" data-cols={page.columns.length} data-gantt="">
        {page.columns.map((c) => (
          <section className="ap-col" key={c.key} data-tone={c.tone}>
            <div className="ap-col__head">
              <span className="ap-col__label">
                {c.label}
                <span className="ap-col__en">{c.en}</span>
              </span>
              <span className="ap-col__count">{c.rows.length}</span>
            </div>
            <div className="ap-col__rule" aria-hidden />
            <p className="ap-col__note">{c.note}</p>
            {/* 栏内时间标尺（1px + 月份 mono；栏内全宽，与 ① 同一映射）。
                与覆盖带同构：刻度行在上、基线在下，两层互不侵占。 */}
            <div className="ap-col__ruler" data-print-span-ruler="">
              <div className="ap-col__ruler-axis">
                {colTicks.map((t) => (
                  <span
                    key={t.label}
                    className="ap-col__ruler-tick"
                    data-print-month-tick=""
                    data-tick-left={t.leftPercent.toFixed(2)}
                    data-tick-align={t.align}
                    style={{ left: `${t.leftPercent}%` }}
                  >
                    {t.label}
                  </span>
                ))}
              </div>
            </div>
            <div className="ap-col__rows">
              {c.rows.map((r) => (
                <SpanRow key={r.key} row={r} />
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* ── 口径注（几何硬事实必须写在这；与「条 = 时长跨度」同处）── */}
      <p className="ap-span-note" data-print-span-note="">
        {page.note}
      </p>
    </div>
  );
}

/** 一行：块头（NN + 名称 + 两端日期）+ 轨道（条 + 条左端内嵌标签） */
function SpanRow({ row }: { row: ApSpanRow }): JSX.Element {
  return (
    <div className="ap-span-row" data-tone={row.tone} data-testid={`ap-span-row-${row.no}`}>
      <div className="ap-span-row__head">
        <span className="ap-span-row__no">{row.no}</span>
        <span className="ap-span-row__name" title={row.name}>
          {row.name}
        </span>
        <span className="ap-span-row__dates">{`${row.startAt} → ${row.endAt}`}</span>
      </div>
      <div className="ap-span-row__track">
        <span
          className="ap-span-row__bar"
          data-tone={row.tone}
          data-span-left={row.left.toFixed(4)}
          data-span-width={row.width.toFixed(4)}
          data-span-days={row.days}
          style={{ left: `${row.left}%`, width: `${row.width}%` }}
          title={`${row.no}. ${row.name}（${row.startAt} → ${row.endAt} · ${row.days} 天）`}
        >
          {/* 条左端内嵌实底状态标签（与 B4 同一套标签语义；纸色 1px 缝见 CSS） */}
          <span className="ap-block__tag" data-tone={row.tone} data-span-tag="">
            <span className="ap-block__glyph" aria-hidden>
              {row.glyph}
            </span>
            {row.tag}
          </span>
        </span>
      </div>
    </div>
  );
}
