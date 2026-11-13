import type { ComponentProps } from 'react'
import Markdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'

/**
 * Assistant replies are Markdown (tables, lists, bold). Rendered with react-markdown, which never renders raw HTML.
 * Images are shown as their alt text and never loaded, and links keep only http(s), mailto and relative URLs:
 * a reply influenced by prompt injection cannot load a URL that leaks data, or run script.
 */
const MARKDOWN_COMPONENTS: ComponentProps<typeof Markdown>['components'] = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow">
      {children}
    </a>
  ),
  img: ({ alt }) => (alt ? <span>[{alt}]</span> : null),
  table: ({ children }) => (
    <div className="dopus-table">
      <table>{children}</table>
    </div>
  ),
}

export function AssistantText({ text }: { text: string }) {
  return (
    <div className="dopus-text dopus-markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={MARKDOWN_COMPONENTS}
        urlTransform={(url) =>
          /^(https?:|mailto:|\/|#)/i.test(url) ? defaultUrlTransform(url) : ''
        }
      >
        {text}
      </Markdown>
    </div>
  )
}
