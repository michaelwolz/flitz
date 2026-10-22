import { useState } from "react";

export function useCopy(onError: () => void) {
  const [copied, setCopied] = useState(false);
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      onError();
    }
  }
  return { copied, copy };
}
