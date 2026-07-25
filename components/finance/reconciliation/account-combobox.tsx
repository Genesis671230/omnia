"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";

export type ComboboxAccount = { account_id: string; account_name: string; account_type: string };

export function AccountCombobox({
  accounts,
  value,
  onChange,
  defaultToAccountId,
  defaultFromAccountId,
  defaultAccountId,
  suggestedAccountId,
  placeholder = "Select account",
}: {
  accounts: ComboboxAccount[];
  value?: string;
  onChange: (accountId: string) => void;
  defaultAccountId?: string;
  defaultToAccountId?:string,
  defaultFromAccountId?:string,
  suggestedAccountId?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = accounts.find((a) => a.account_id === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter(
      (a) => a.account_name.toLowerCase().includes(q) || a.account_type.toLowerCase().includes(q),
    );
  }, [accounts, query]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery("");
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const isDefault = selected?.account_id === defaultAccountId;
  const isSuggested = !isDefault && selected?.account_id === suggestedAccountId;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-[13px] ${
          selected ? "border-[#D6CCBA] bg-white text-[#1F1B16]" : "border-[#E0A45F] bg-[#FFF7EA] text-[#8A8175]"
        }`}
      >
        <span className="flex min-w-0 items-center gap-1 truncate">
          {isDefault && <span className="shrink-0">⭐</span>}
          {selected ? selected.account_name : placeholder}
          {isSuggested && (
            <span className="ml-1 shrink-0 rounded-full bg-[#FFF0D9] px-1.5 py-0.5 text-[10px] font-medium text-[#B0762E]">
              suggested
            </span>
          )}
        </span>
        <ChevronDown size={14} className="shrink-0 text-[#8A8175]" />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 right-0 z-50 mb-1 max-h-64 overflow-hidden rounded-lg border border-[#D6CCBA] bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b border-[#EAE3D6] px-3 py-2">
            <Search size={13} className="text-[#8A8175]" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search accounts…"
              className="w-full text-[13px] outline-none placeholder:text-[#B4AA9B]"
            />
          </div>
          <div className="max-h-52 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-[12px] text-[#8A8175]">No accounts match "{query}"</div>
            ) : (
              filtered.map((a) => (
                <button
                  key={a.account_id}
                  type="button"
                  onClick={() => { onChange(a.account_id); setOpen(false); }}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[13px] hover:bg-[#FBF8F1]"
                >
                  <span className="flex min-w-0 items-center gap-1 truncate">
                    {a.account_id === defaultAccountId && <span className="shrink-0">⭐</span>}
                    <span className="truncate">{a.account_name}</span>
                    <span className="ml-1 shrink-0 text-[11px] text-[#B4AA9B]">{a.account_type}</span>
                  </span>
                  {a.account_id === value && <Check size={14} className="shrink-0 text-[#B08343]" />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}