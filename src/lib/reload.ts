/**
 * 应用内 reload 的唯一出口。
 *
 * 为什么收口成函数：切工作区后必须整页重载（新区的 IndexedDB 库、bootstrap、
 * 身份记忆都要从头装配），而 jsdom 的 `window.location.reload` 会抛
 * 「Not implemented」—— 单测里 mock 本模块即可，不用去戳 location 对象。
 */
export function reloadApp(): void {
  window.location.reload();
}
