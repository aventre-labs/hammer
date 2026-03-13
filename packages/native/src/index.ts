/**
 * @gsd/native — High-performance Rust modules exposed via N-API.
 *
 * Modules:
 * - grep: ripgrep-backed regex search (content + filesystem)
 * - html: HTML to Markdown conversion
 */

export { searchContent, grep } from "./grep/index.js";
export type {
  ContextLine,
  GrepMatch,
  GrepOptions,
  GrepResult,
  SearchMatch,
  SearchOptions,
  SearchResult,
} from "./grep/index.js";

export { htmlToMarkdown } from "./html/index.js";
export type { HtmlToMarkdownOptions } from "./html/index.js";
