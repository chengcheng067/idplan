import { useEffect, useState } from 'react';

import type { UpdateProjectCmd } from '../../core/types/dto';
import type { Project } from '../../core/types/entities';
import { ImeInput } from '../common/ImeInput';
import { Modal } from '../common/Modal';
import {
  PROJECT_COVER_TOKENS,
  PROJECT_SHORT_LABEL_MAX_LENGTH,
  isProjectCoverToken,
  normalizeProjectCoverColor,
  normalizeProjectShortLabel,
  projectCoverColorCss,
  resolveProjectShortLabel,
} from '../../lib/projectAccent';
import { cn } from '../../lib/cn';

/**
 * 侧栏方块外观编辑弹窗（v0.7 · B1 自定义入口）。
 *
 * 为什么单独成文件、而不是塞进 ProjectCard 的「项目重命名」弹窗：
 *   1. ProjectCard 已达 350+ 行，再加一个带 6 个色板 + 实时预览的表单会显著降低可读性；
 *   2. 外观编辑与重命名是**两个不同的领域动作**（前者只动展示字段，后者动 name 并影响
 *      所有视图的标题），混在一个弹窗里会让人以为「保存简称也会改项目名」。
 *
 * ── 关键设计：改动闸门（dirty / colorTouched）──
 * 只把**用户真正改动过**的字段放进 patch：
 *   · 简称：与 `project.shortLabel ?? null` 归一后比较，未变则不下发；
 *   · 颜色：额外加一道 `colorTouched` —— 因为 v0.6 老数据/夹具里可能残留裸 hex
 *     （本仓库测试夹具 tests/fixtures/v07-board-seed.json 就有 `#3D6B5B`）。
 *     若「打开弹窗即回写」，用户只是来看一眼简称就会把旧的 hex 静默归一成 null。
 *     这不是数据损坏（该字段此前无渲染消费方），但属于**用户没要求的副作用**，
 *     故必须由用户实际点色板才允许回写。
 *
 * 保存走 `UpdateProjectCmd` 的字段级更新语义（undefined = 不变），
 * 与 repos.projects.update 的 put 合并一致，不会碰到其它字段。
 */
export function ProjectAppearanceDialog({
  open,
  project,
  stageAccentColor,
  onClose,
  onSave,
}: {
  open: boolean;
  project: Project;
  /** 「跟随阶段色」时方块的取色（由调用方按当前阶段算好传入，本组件不认识 Stage） */
  stageAccentColor: string;
  onClose(): void;
  onSave(patch: UpdateProjectCmd): void;
}): JSX.Element {
  const [label, setLabel] = useState('');
  const [color, setColor] = useState<string | null>(null);
  /** 用户是否**实际点过**色板（见文件头「改动闸门」） */
  const [colorTouched, setColorTouched] = useState(false);

  // 每次打开都用当前项目值重置草稿：避免「上次编辑到一半取消 → 再打开看到脏值」
  useEffect(() => {
    if (!open) return;
    setLabel(project.shortLabel ?? '');
    setColor(isProjectCoverToken(project.coverColor) ? project.coverColor : null);
    setColorTouched(false);
  }, [open, project.shortLabel, project.coverColor]);

  const nextLabel = normalizeProjectShortLabel(label);
  const labelChanged = nextLabel !== (project.shortLabel ?? null);
  const nextColor = normalizeProjectCoverColor(color);
  const colorChanged = colorTouched && nextColor !== (project.coverColor ?? null);
  const dirty = labelChanged || colorChanged;

  const confirm = (): void => {
    if (!dirty) {
      onClose();
      return;
    }
    const patch: UpdateProjectCmd = {};
    if (labelChanged) patch.shortLabel = nextLabel;
    if (colorChanged) patch.coverColor = nextColor;
    onSave(patch);
    onClose();
  };

  /** 预览用取色：未指定 → 阶段色；指定 → 白名单取色（不合法则仍回落阶段色） */
  const previewAccent =
    color === null ? stageAccentColor : (projectCoverColorCss(color) ?? stageAccentColor);

  return (
    <Modal open={open} onClose={onClose} ariaLabel="侧栏方块外观">
      <div className="glass-strong iridescent-border dialog-pop w-full max-w-md rounded-3xl p-6 shadow-overlay outline-none">
        <h2 className="font-display text-display-md">侧栏方块外观</h2>
        <p className="mt-1 text-xs text-mist">
          只影响<span className="font-medium text-ink">折叠态侧栏</span>（64px）里的项目方块；
          展开态侧栏与其它视图始终显示完整项目名。
        </p>

        {/* ── 简称 ── */}
        <label
          htmlFor="project-short-label"
          className="mt-5 block text-xs font-medium text-ink"
        >
          方块简称
        </label>
        <ImeInput
          id="project-short-label"
          data-project-short-label-input=""
          value={label}
          maxLength={PROJECT_SHORT_LABEL_MAX_LENGTH}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') confirm();
          }}
          placeholder={`留空则用项目名首字（${resolveProjectShortLabel(project.name, null)}）`}
          aria-label="方块简称"
          className="soft-input mt-2 w-full rounded-2xl px-4 py-3 text-sm text-ink outline-none placeholder:text-mist"
        />
        <p className="mt-1 text-[11px] text-mist">
          最多 {PROJECT_SHORT_LABEL_MAX_LENGTH} 个字，留空即回到「项目名首字」。
        </p>

        {/* ── 颜色 ── */}
        <div className="mt-5 text-xs font-medium text-ink">方块颜色</div>
        <p className="mt-1 text-[11px] text-mist">
          默认跟随项目当前阶段色；选任一颜色后优先使用该颜色。
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3" role="radiogroup" aria-label="方块颜色">
          {/* 跟随阶段色（= coverColor 置 null） */}
          <button
            type="button"
            role="radio"
            aria-checked={color === null}
            aria-label="跟随阶段色"
            title="跟随阶段色"
            data-cover-swatch="auto"
            onClick={() => {
              setColor(null);
              setColorTouched(true);
            }}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-full border transition-all duration-200 ease-in-out hover:-translate-y-0.5',
              color === null ? 'border-pine ring-2 ring-pine/40' : 'border-line',
            )}
          >
            {/*
              「跟随」用**当前阶段色**显示而非灰色占位：用户能直接看到「不自定义会长什么样」，
              比一个中性灰更可判断。title/aria-label 已说明这是「跟随」语义。
            */}
            <span
              aria-hidden
              className="h-5 w-5 rounded-full"
              style={{ backgroundColor: stageAccentColor }}
            />
          </button>

          {PROJECT_COVER_TOKENS.map((token) => (
            <button
              key={token.key}
              type="button"
              role="radio"
              aria-checked={color === token.key}
              aria-label={token.label}
              title={token.label}
              data-cover-swatch={token.key}
              onClick={() => {
                setColor(token.key);
                setColorTouched(true);
              }}
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-full border transition-all duration-200 ease-in-out hover:-translate-y-0.5',
                color === token.key ? 'border-pine ring-2 ring-pine/40' : 'border-line',
              )}
            >
              <span aria-hidden className="h-5 w-5 rounded-full" style={{ backgroundColor: token.css }} />
            </button>
          ))}
        </div>

        {/* ── 实时预览（与侧栏折叠态方块的尺寸/文字口径一致） ── */}
        <div className="mt-4 flex items-center gap-3 rounded-2xl bg-sunken px-3 py-2">
          <span className="text-[11px] text-mist">预览</span>
          <span className="flex h-9 w-10 items-center justify-center gap-1 rounded-md bg-paper">
            <span
              aria-hidden
              className="h-5 w-1 rounded-[2px]"
              style={{ backgroundColor: previewAccent }}
            />
            <span className="max-w-[24px] truncate text-[12px] font-medium leading-4 text-ink">
              {resolveProjectShortLabel(project.name, nextLabel)}
            </span>
          </span>
        </div>

        {/* ── 动作 ── */}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="soft-btn-ghost rounded-2xl px-5 py-2.5 text-sm font-medium transition-all duration-200 ease-in-out hover:-translate-y-0.5"
          >
            取消
          </button>
          <button
            type="button"
            data-project-appearance-save=""
            onClick={confirm}
            disabled={!dirty}
            className="soft-btn-primary rounded-2xl px-5 py-2.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 disabled:shadow-none"
          >
            保存
          </button>
        </div>
      </div>
    </Modal>
  );
}
