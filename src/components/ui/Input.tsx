// 通用输入框 / 多行输入框组件 · 规格 §3.3 / 画板 08
//
// 底层复用 src/components/common/ImeInput（IME 安全受控输入替身）：它已满足
// 「IME 组合输入不被打断」的需求（仅做 onChange 透传 + Enter 守卫），接口与 <input> 一致，
// 故这里直接把它当作 <input> / <textarea> 的 drop-in 替代，不再绕开。
//
// 统一：高 44，横向 padding 14，圆角 16，文字 13/400。多行最小高 72。
// 注：聚焦态原规格要求 border 2px；此处保持 1px 描边 + shadow-accent 外发光，
// 以避免 focus 时 1px→2px 造成的内容区位移（细微偏差，已在交接报告说明）。

import {
  forwardRef,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { ImeInput, ImeTextarea } from '../common/ImeInput';
import { cn } from '../../lib/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: string; // 有值 → 错误态 + 下方 11/400 clay 错误文字，gap 6
  label?: string; // 可选标签
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: string;
  label?: string;
}

/** 计算输入框 / 多行框的共有 className（不含高度，由调用方追加）。 */
function fieldClass(extra: string, error?: string): string {
  return cn(
    'w-full rounded-lg border bg-paper px-[14px] text-[13px] text-ink placeholder:text-mist',
    'transition-colors focus:outline-none focus:bg-paper focus:shadow-accent',
    // 默认 / 错误：切换描边色（保持 1px，见文件头注释）
    error ? 'border-clay focus:border-clay' : 'border-line focus:border-pine',
    // 禁用态
    'disabled:bg-sunken disabled:border-line disabled:text-mist',
    extra,
  );
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { error, label, className, id, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className={cn('flex flex-col gap-[6px]', className)}>
      {label && (
        <label htmlFor={inputId} className="text-[13px] text-ink">
          {label}
        </label>
      )}
      <ImeInput ref={ref} id={inputId} className={fieldClass('h-[44px]', error)} {...rest} />
      {error && <p className="text-[11px] font-normal text-clay">{error}</p>}
    </div>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { error, label, className, id, ...rest },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className={cn('flex flex-col gap-[6px]', className)}>
      {label && (
        <label htmlFor={inputId} className="text-[13px] text-ink">
          {label}
        </label>
      )}
      <ImeTextarea
        ref={ref}
        id={inputId}
        className={fieldClass('min-h-[72px] py-[14px] resize-y', error)}
        {...rest}
      />
      {error && <p className="text-[11px] font-normal text-clay">{error}</p>}
    </div>
  );
});
