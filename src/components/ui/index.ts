// 通用组件层 barrel · 规格 §3 / 画板 08
// 统一从 '@/components/ui' 导入所有通用件与类型。

export { Button } from './Button';
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button';

export { Tag } from './Tag';
export type { TagProps, TagTone } from './Tag';

export { Input, Textarea } from './Input';
export type { InputProps, TextareaProps } from './Input';

export { Card } from './Card';
export type { CardProps, CardVariant } from './Card';

export { EmptyState } from './EmptyState';
export type { EmptyStateProps } from './EmptyState';

export { SegmentedControl } from './SegmentedControl';
export type { SegmentedControlProps, SegmentedOption } from './SegmentedControl';

export { Chip } from './Chip';
export type { ChipProps } from './Chip';
