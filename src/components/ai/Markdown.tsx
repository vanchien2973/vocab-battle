import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { useMemo } from 'react';

/** Renders model output as Markdown; HTML is sanitized because the text comes from an AI. */
export function Markdown({ text }: { text: string }) {
  const html = useMemo(
    () => DOMPurify.sanitize(marked.parse(text, { async: false, breaks: true, gfm: true }) as string),
    [text],
  );
  return <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}
