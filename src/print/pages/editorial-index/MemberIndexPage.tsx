/**
 * E 版 P2 · 成员执行体目录（01 文档 §6 / 02 文档 §6）。
 *
 * ── 目录读法 ──
 * 行 = 成员执行体（human / agent）。VM 已把 Agent 行排在前（适配器排序），
 * 本目录按「执行体类型」分两章：Agent 执行体 / 人类成员。每行：
 * [目录号 | 姓名 + 类型签 | 角色 | agentKind | 负责任务数]。
 *
 * ── 朱红纪律（01 §6：Agent 行朱红强调，整页不许单色红）──
 * 朱红只给 Agent 章：章头、行首粗签、行号描边。人类章一律近黑 + 灰。
 * 灰度下朱红变中灰 ⇒ Agent 行同时带「AGENT」文字签与粗左边线，
 * 不靠色相单独表意（01 §2）。agentKind 是开放字符串，未知值原样显示。
 *
 * ── 大编号 ──
 * 成员目录的锚点编号是**目录号**（VM 排序后的物理序，01 起）——成员没有
 * orderIndex，编一个序号就是伪造字段，目录号只表达「本条是第几条」。
 */

import { MemberActorKind } from '../../../core/types/enums';
import type { PrintMemberVM, PrintViewModel } from '../../model/print-view-model';
import { EmptyPrintState } from '../../parts/EmptyPrintState';
import type { EiEntry } from './shared';

export interface MemberIndexPageProps {
  vm: PrintViewModel;
  /** 本物理页要渲染的条目（分页产物；行带目录号 seq） */
  entries: readonly EiEntry<PrintMemberVM & { seq: number }>[];
  compact?: boolean;
}

export function MemberIndexPage({ vm, entries, compact }: MemberIndexPageProps): JSX.Element {
  return (
    <>
      <div className="ei-index" data-density={compact ? 'compact' : undefined}>
        {entries.map((entry, i) =>
          entry.kind === 'chapter' ? (
            <ChapterHead key={`ch-${i}`} entry={entry} />
          ) : (
            <MemberRow key={entry.row!.id} member={entry.row!} index={entry.row!.seq} />
          ),
        )}
      </div>
      {/* 口径注（压到主体底部）：责任数口径 + agentKind 开放字符串纪律 */}
      <p className="ei-note">
        口径：负责任务数 = 被指派 + 本人产出的可见阶段任务数（Agent 常见「产出者不在指派人里」）；
        <strong>agentKind 为开放字符串，未知值原样显示</strong>，不收敛枚举。
      </p>
    </>
  );
}

/** 章头：粗章节线 + 章名（Agent 章朱红焦点 / 人类章近黑） */
function ChapterHead({ entry }: { entry: EiEntry<PrintMemberVM> }): JSX.Element {
  const chapter = entry.chapter!;
  const agent = chapter.kind === 'agent';
  return (
    <div className="ei-chapter" data-focus={agent || undefined} data-testid={`ei-chapter-${chapter.kind}`}>
      <span className="ei-chapter__label">
        <span className="ei-chapter__glyph" aria-hidden>
          {agent ? '◆' : '○'}
        </span>
        {chapter.label}
      </span>
      <span className="ei-chapter__count">{chapter.count} 执行体</span>
    </div>
  );
}

/** 目录行：目录号 + 姓名 + 类型签 + 角色 + agentKind + 负责任务数 */
function MemberRow({ member, index }: { member: PrintMemberVM; index: number }): JSX.Element {
  const isAgent = member.actorKind === MemberActorKind.Agent;
  return (
    <div
      className="ei-row ei-row--member"
      data-agent={isAgent || undefined}
      data-testid={`ei-member-row-${member.id}`}
    >
      <span className="ei-row__no" data-focus={isAgent || undefined}>
        {String(index).padStart(2, '0')}
      </span>
      <span className="ei-row__name" title={member.name}>
        {member.name}
      </span>
      {/* 类型签：文字 + 字形双编码（灰度可辨） */}
      <span className="ei-row__kind" data-agent={isAgent || undefined}>
        <span className="ei-row__glyph" aria-hidden>
          {isAgent ? '◆' : '○'}
        </span>
        {isAgent ? 'Agent' : 'human'}
      </span>
      <span className="ei-row__role">{member.role}</span>
      {/* agentKind 开放字符串：未知值原样显示，不收敛枚举（01 §3.2） */}
      <span className="ei-row__agentkind">{member.agentKind ?? '—'}</span>
      <span className="ei-row__tasks">{member.taskCount} 项</span>
    </div>
  );
}

/* ------------------------------------------------------------------ 条目构造 */

/** 成员目录条目（Agent 章在前——适配器已排序，此处只分组） */
export function buildMemberIndexEntries(vm: PrintViewModel): EiEntry<PrintMemberVM & { seq: number }>[] {
  const entries: EiEntry<PrintMemberVM & { seq: number }>[] = [];
  const agents = vm.members
    .map((m, i) => ({ ...m, seq: i + 1 }))
    .filter((m) => m.actorKind === MemberActorKind.Agent);
  const humans = vm.members
    .map((m, i) => ({ ...m, seq: i + 1 }))
    .filter((m) => m.actorKind !== MemberActorKind.Agent);
  if (agents.length > 0) {
    entries.push({ kind: 'chapter', chapter: { kind: 'agent', label: 'Agent 执行体', count: agents.length } });
    for (const row of agents) entries.push({ kind: 'row', row });
  }
  if (humans.length > 0) {
    entries.push({ kind: 'chapter', chapter: { kind: 'human', label: '人类成员', count: humans.length } });
    for (const row of humans) entries.push({ kind: 'row', row });
  }
  return entries;
}

/** 空态：无相关成员 */
export function memberIndexIsEmpty(vm: PrintViewModel): boolean {
  return vm.members.length === 0;
}

export function MemberIndexEmpty(): JSX.Element {
  return <EmptyPrintState kind="members" />;
}
