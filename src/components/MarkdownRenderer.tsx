import React, { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Copy } from 'lucide-react';
import Prism from 'prismjs';

// Import essential language syntaxes for Prism
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-yaml';

interface CodeBlockProps {
  language?: string;
  code: string;
}

export const CodeBlock: React.FC<CodeBlockProps> = ({ language, code }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy code:', err);
    }
  };

  const cleanLang = (language || '').trim().toLowerCase();
  const displayLang = cleanLang ? cleanLang.toUpperCase() : 'CODE';

  // Highlight syntax with Prism if supported, otherwise return plain code
  const getHighlightedHtml = () => {
    if (cleanLang && Prism.languages[cleanLang]) {
      try {
        return Prism.highlight(code, Prism.languages[cleanLang], cleanLang);
      } catch (err) {
        console.warn('Prism highlight error:', err);
      }
    }
    // Fallback for JS/TS aliases
    if (cleanLang === 'js' || cleanLang === 'node') {
      return Prism.highlight(code, Prism.languages.javascript, 'javascript');
    }
    if (cleanLang === 'ts') {
      return Prism.highlight(code, Prism.languages.typescript, 'typescript');
    }
    if (cleanLang === 'sh' || cleanLang === 'shell' || cleanLang === 'zsh') {
      return Prism.highlight(code, Prism.languages.bash, 'bash');
    }
    if (cleanLang === 'py') {
      return Prism.highlight(code, Prism.languages.python, 'python');
    }
    return null;
  };

  const highlightedHtml = getHighlightedHtml();

  return (
    <div className="my-4 rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] overflow-hidden text-xs md:text-sm font-mono elevation-low group transition-all duration-200">
      {/* Code Header Bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border-light)] bg-[var(--bg-tertiary)]">
        <span className="text-[11px] font-semibold tracking-wider text-[var(--text-muted)] uppercase font-mono">
          {displayLang}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-sans font-medium text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] active:scale-[0.97] transition-all cursor-pointer focus-visible:ring-1 focus-visible:ring-[var(--accent-primary)]"
          title="Copy code to clipboard"
          aria-label="Copy code to clipboard"
        >
          {copied ? (
            <>
              <Check size={13} className="text-[var(--success)]" />
              <span className="text-[var(--success)]">Copied</span>
            </>
          ) : (
            <>
              <Copy size={13} />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>

      {/* Code Content Container */}
      <div className="overflow-x-auto p-4 max-h-[500px] overflow-y-auto scrollbar-thin bg-[var(--bg-card)]">
        {highlightedHtml ? (
          <pre className="!bg-transparent !p-0 !m-0 !border-0 font-mono text-[13px] leading-relaxed text-[var(--text-secondary)]">
            <code
              className={`language-${cleanLang} !bg-transparent !p-0`}
              dangerouslySetInnerHTML={{ __html: highlightedHtml }}
            />
          </pre>
        ) : (
          <pre className="!bg-transparent !p-0 !m-0 !border-0 font-mono text-[13px] leading-relaxed text-[var(--text-secondary)]">
            <code className="!bg-transparent !p-0">{code}</code>
          </pre>
        )}
      </div>
    </div>
  );
};

interface MarkdownRendererProps {
  content: string;
  isUser?: boolean;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, isUser = false }) => {
  return (
    <div className={isUser ? "user-markdown leading-relaxed" : "assistant-markdown leading-relaxed"}>
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const match = /language-(\w+)/.exec(className || '');
            const rawCode = String(children).replace(/\n$/, '');
            const isMultiline = rawCode.includes('\n');

            // Fenced code block or explicitly tagged code
            if (match || isMultiline) {
              return <CodeBlock language={match ? match[1] : ''} code={rawCode} />;
            }

            // Inline code with consistent padding, rounded-lg and border tokens
            return (
              <code
                className="font-mono text-[13px] px-1.5 py-0.5 rounded-lg bg-[var(--bg-secondary)] text-[var(--text-accent)] border border-[var(--border-light)] font-medium"
                {...props}
              >
                {children}
              </code>
            );
          },
          pre({ children }) {
            // Passthrough so CodeBlock handles styling avoiding double wrappers
            return <>{children}</>;
          },
          table({ children }) {
            return (
              <div className="my-5 w-full overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] elevation-low">
                <table className="w-full text-left border-collapse text-xs md:text-sm">
                  {children}
                </table>
              </div>
            );
          },
          thead({ children }) {
            return (
              <thead className="bg-[var(--bg-tertiary)] border-b border-[var(--border)]">
                {children}
              </thead>
            );
          },
          th({ children }) {
            return (
              <th className="px-4 py-2.5 font-semibold text-[11px] tracking-wider uppercase text-[var(--text-muted)] font-mono">
                {children}
              </th>
            );
          },
          td({ children }) {
            return (
              <td className="px-4 py-2.5 border-b border-[var(--border-light)] text-[var(--text-secondary)] last:border-b-0 leading-normal">
                {children}
              </td>
            );
          },
          h1({ children }) {
            return (
              <h1 className="text-xl md:text-2xl font-semibold tracking-tight text-[var(--text-primary)] mt-6 mb-3 first:mt-0">
                {children}
              </h1>
            );
          },
          h2({ children }) {
            return (
              <h2 className="text-lg md:text-xl font-semibold tracking-tight text-[var(--text-primary)] mt-5 mb-2.5 first:mt-0">
                {children}
              </h2>
            );
          },
          h3({ children }) {
            return (
              <h3 className="text-base font-semibold text-[var(--text-primary)] mt-4 mb-2 first:mt-0">
                {children}
              </h3>
            );
          },
          h4({ children }) {
            return (
              <h4 className="text-sm font-semibold text-[var(--text-primary)] mt-3 mb-1.5 first:mt-0">
                {children}
              </h4>
            );
          },
          p({ children }) {
            return (
              <p className="mb-4 last:mb-0 leading-[1.75] text-[var(--text-secondary)]">
                {children}
              </p>
            );
          },
          ul({ children }) {
            return (
              <ul className="list-disc pl-5 my-3 space-y-1.5 marker:text-[var(--text-muted)] text-[var(--text-secondary)]">
                {children}
              </ul>
            );
          },
          ol({ children }) {
            return (
              <ol className="list-decimal pl-5 my-3 space-y-1.5 marker:text-[var(--text-muted)] text-[var(--text-secondary)]">
                {children}
              </ol>
            );
          },
          li({ children }) {
            return (
              <li className="leading-relaxed pl-1 text-[var(--text-secondary)]">
                {children}
              </li>
            );
          },
          blockquote({ children }) {
            return (
              <blockquote className="border border-[var(--border-light)] bg-[var(--bg-secondary)] rounded-xl p-3.5 my-4 text-[var(--text-secondary)] italic">
                {children}
              </blockquote>
            );
          },
          a({ href, children }) {
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[var(--text-primary)] hover:text-[var(--text-accent)] underline underline-offset-4 decoration-[var(--border)] hover:decoration-[var(--accent-primary)] transition-colors font-medium break-words"
              >
                {children}
              </a>
            );
          },
          hr() {
            return (
              <hr className="my-6 border-t border-[var(--border-light)]" />
            );
          },
        }}
      >
        {content}
      </Markdown>
    </div>
  );
};
