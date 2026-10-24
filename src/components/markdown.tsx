import { Fragment, type ReactNode } from 'react';
import { parseMarkdown, type Block, type Inline } from '@/lib/markdown';

/**
 * Draws the Markdown of a description (see `lib/markdown.ts`): elements built from a tree, never HTML, so nothing a member
 * typed can add a tag, a script or a picture to the page. Links open in a new tab and carry no referrer.
 */

function inline(nodes: readonly Inline[]): ReactNode {
  return nodes.map((node, index) => {
    switch (node.type) {
      case 'text':
        return <Fragment key={index}>{node.text}</Fragment>;
      case 'strong':
        return <strong key={index}>{inline(node.children)}</strong>;
      case 'em':
        return <em key={index}>{inline(node.children)}</em>;
      case 'code':
        return (
          <code key={index} className="bg-surface-2 rounded-xs px-1 font-mono text-small">
            {node.text}
          </code>
        );
      case 'link':
        return (
          <a
            key={index}
            href={node.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-ink underline underline-offset-2"
          >
            {inline(node.children)}
          </a>
        );
    }
  });
}

function blocks(nodes: readonly Block[]): ReactNode {
  return nodes.map((node, index) => {
    switch (node.type) {
      case 'heading':
        return node.level <= 2 ? (
          <h3 key={index} className="text-card-title mt-1">
            {inline(node.children)}
          </h3>
        ) : (
          <h4 key={index} className="text-body-strong">
            {inline(node.children)}
          </h4>
        );
      case 'paragraph':
        return (
          <p key={index}>
            {node.lines.map((line, lineIndex) => (
              <Fragment key={lineIndex}>
                {lineIndex > 0 && <br />}
                {inline(line)}
              </Fragment>
            ))}
          </p>
        );
      case 'list': {
        const Tag = node.ordered ? 'ol' : 'ul';
        return (
          <Tag
            key={index}
            className={`${node.ordered ? 'list-decimal' : 'list-disc'} flex flex-col gap-0.5 pl-5`}
          >
            {node.items.map((item, itemIndex) => (
              <li key={itemIndex}>{inline(item)}</li>
            ))}
          </Tag>
        );
      }
      case 'quote':
        return (
          <blockquote
            key={index}
            className="border-line text-muted-foreground flex flex-col gap-2 border-l-2 pl-3"
          >
            {blocks(node.blocks)}
          </blockquote>
        );
      case 'code':
        return (
          <pre
            key={index}
            className="bg-surface-2 overflow-x-auto rounded-sm p-3 font-mono text-small"
          >
            {node.text}
          </pre>
        );
      case 'rule':
        return <hr key={index} className="border-line" />;
    }
  });
}

export function Markdown({ source, className }: { source: string; className?: string }) {
  return (
    <div className={`flex flex-col gap-2 break-words ${className ?? ''}`}>
      {blocks(parseMarkdown(source))}
    </div>
  );
}
