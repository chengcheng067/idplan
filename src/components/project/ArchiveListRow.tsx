import type { Project } from '../../core/types/entities';

/** 已完成项目收敛弱化行 */
export function ArchiveListRow({
  project,
  onOpen,
}: {
  project: Project;
  onOpen(): void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 border-b border-line/60 px-2 py-2.5 text-left last:border-b-0 hover:bg-sand/40"
    >
      <span className="text-sm text-mist line-through decoration-mist/30">{project.name}</span>
      <span className="ml-auto text-xs tabular-nums text-mist">
        {project.plannedStartAt.slice(0, 10)} — {project.plannedEndAt.slice(0, 10)}
      </span>
    </button>
  );
}
