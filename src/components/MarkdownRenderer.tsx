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
    <div className="my-4 rounded-xl border border-white/[0.08] dark:border-white/[0.08] light:border-black/[0.08] bg-[#0c0c0e] dark:bg-[#0c0c0e] light:bg-[#f6f6f8] overflow-hidden text-xs md:text-sm font-mono shadow-sm group">
      {/* Code Header Bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/[0.06] dark:border-white/[0.06] light:border-black/[0.06] bg-white/[0.02] dark:bg-white/[0.02] light:bg-black/[0.02]">
        <span className="text-[11px] font-semibold tracking-wider text-text-dim uppercase font-mono">
          {displayLang}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-sans font-medium text-text-dim hover:text-text-offwhite dark:hover:text-white light:hover:text-zinc-900 hover:bg-white/5 dark:hover:bg-white/5 light:hover:bg-black/5 transition-colors cursor-pointer"
          title="Copy code to clipboard"
        >
          {copied ? (
            <>
              <Check size={12} className="text-emerald-400" />
              <span className="text-emerald-400">Copied</span>
            </>
          ) : (
            <>
              <Copy size={12} />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>

      {/* Code Content Container */}
      <div className="overflow-x-auto p-4 max-h-[500px] overflow-y-auto scrollbar-thin">
        {highlightedHtml ? (
          <pre className="!bg-transparent !p-0 !m-0 !border-0 font-mono text-[13px] leading-relaxed text-text-assistant dark:text-zinc-200 light:text-zinc-800">
            <code
              className={`language-${cleanLang} !bg-transparent !p-0`}
              dangerouslySetInnerHTML={{ __html: highlightedHtml }}
            />
          </pre>
        ) : (
          <pre className="!bg-transparent !p-0 !m-0 !border-0 font-mono text-[13px] leading-relaxed text-text-assistant dark:text-zinc-200 light:text-zinc-800">
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
    <div className={isUser ? "user-markdown" : "assistant-markdown"}>
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

            // Inline code
            return (
              <code
                className="font-mono text-[13px] px-1.5 py-0.5 rounded bg-white/[0.08] dark:bg-white/[0.08] light:bg-black/[0.06] text-white/95 dark:text-zinc-100 light:text-zinc-900 border border-white/[0.06] dark:border-white/[0.06] light:border-black/[0.06]"
                {...props}
              >
                {children}
              </code>
            );
          },
          pre({ children }) {
            // Passthrough so CodeBlock handles styling and avoiding double wrapper
            return <>{children}</>;
          },
          table({ children }) {
            return (
              <div className="my-5 w-full overflow-x-auto rounded-xl border border-white/[0.08] dark:border-white/[0.08] light:border-black/[0.08] bg-[#0c0c0e]/50 dark:bg-[#0c0c0e]/50 light:bg-[#f8f8fa]">
                <table className="w-full text-left border-collapse text-xs md:text-sm">
                  {children}
                </table>
              </div>
            );
          },
          thead({ children }) {
            return (
              <thead className="bg-white/[0.03] dark:bg-white/[0.03] light:bg-black/[0.03] border-b border-white/[0.08] dark:border-white/[0.08] light:border-black/[0.08]">
                {children}
              </thead>
            );
          },
          th({ children }) {
            return (
              <th className="px-4 py-2.5 font-semibold text-[11px] tracking-wider uppercase text-text-dim">
                {children}
              </th>
            );
          },
          td({ children }) {
            return (
              <td className="px-4 py-2.5 border-b border-white/[0.04] dark:border-white/[0.04] light:border-black/[0.04] text-text-assistant dark:text-zinc-300 light:text-zinc-700 last:border-b-0 leading-normal">
                {children}
              </td>
            );
          },
          h1({ children }) {
            return (
              <h1 className="text-xl md:text-2xl font-semibold tracking-tight text-text-offwhite dark:text-white light:text-zinc-900 mt-6 mb-3 first:mt-0">
                {children}
              </h1>
            );
          },
          h2({ children }) {
            return (
              <h2 className="text-lg md:text-xl font-semibold tracking-tight text-text-offwhite dark:text-white light:text-zinc-900 mt-5 mb-2.5 first:mt-0">
                {children}
              </h2>
            );
          },
          h3({ children }) {
            return (
              <h3 className="text-base font-semibold text-text-offwhite dark:text-white light:text-zinc-900 mt-4 mb-2 first:mt-0">
                {children}
              </h3>
            );
          },
          h4({ children }) {
            return (
              <h4 className="text-sm font-semibold text-text-offwhite dark:text-white light:text-zinc-900 mt-3 mb-1.5 first:mt-0">
                {children}
              </h4>
            );
          },
          p({ children }) {
            return (
              <p className="mb-4 last:mb-0 leading-[1.75] text-text-assistant dark:text-zinc-300 light:text-zinc-700">
                {children}
              </p>
            );
          },
          ul({ children }) {
            return (
              <ul className="list-disc pl-5 my-3 space-y-1.5 marker:text-text-dim/80">
                {children}
              </ul>
            );
          },
          ol({ children }) {
            return (
              <ol className="list-decimal pl-5 my-3 space-y-1.5 marker:text-text-dim/80">
                {children}
              </ol>
            );
          },
          li({ children }) {
            return (
              <li className="leading-relaxed pl-1 text-text-assistant dark:text-zinc-300 light:text-zinc-700">
                {children}
              </li>
            );
          },
          blockquote({ children }) {
            return (
              <blockquote className="border-l-2 border-accent-blue/40 dark:border-accent-blue/40 light:border-accent-blue/50 pl-4 py-1 my-4 text-text-muted dark:text-zinc-400 light:text-zinc-600 italic bg-white/[0.01] rounded-r-lg">
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
                className="text-accent-blue hover:underline underline-offset-4 decoration-accent-blue/40 hover:decoration-accent-blue transition-colors font-medium break-words"
              >
                {children}
              </a>
            );
          },
          hr() {
            return (
              <hr className="my-6 border-t border-white/[0.08] dark:border-white/[0.08] light:border-black/[0.08]" />
            );
          },
        }}
      >
        {content}
      </Markdown>
    </div>
  );
};
