import { useState, useRef, useId } from 'react';
import { useLiveQuery } from '@tanstack/react-db';
import { usersCollection } from '../collections';
import type { User } from '../api';

interface Props {
  onSelect: (user: User) => void;
  placeholder?: string;
  excludeId?: string;
  users?: User[];
}

export function UserSearch({
  onSelect,
  placeholder = 'Search by name or email…',
  excludeId,
  users: usersProp,
}: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: fetchedUsers } = useLiveQuery(usersCollection);
  const allUsers = usersProp ?? fetchedUsers;

  const q = query.toLowerCase().trim();
  const matches =
    q.length === 0
      ? []
      : (allUsers ?? [])
          .filter((u: User) => u.id !== excludeId)
          .filter(
            (u: User) =>
              u.name.toLowerCase().includes(q) ||
              u.email.toLowerCase().includes(q),
          )
          .slice(0, 8);

  function select(user: User) {
    onSelect(user);
    setQuery('');
    setOpen(false);
    setActiveIndex(-1);
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || matches.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, matches.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      select(matches[activeIndex] as User);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open && matches.length > 0}
        aria-controls={listboxId}
        aria-activedescendant={activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
        aria-autocomplete="list"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActiveIndex(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => { setTimeout(() => { setOpen(false); setActiveIndex(-1); }, 150); }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        style={{
          width: '100%',
          padding: '0.5rem',
          fontSize: 14,
          boxSizing: 'border-box',
          border: '1px solid #ddd',
          borderRadius: 4,
        }}
      />
      {open && matches.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            background: '#fff',
            border: '1px solid #ddd',
            borderTop: 'none',
            borderRadius: '0 0 4px 4px',
            zIndex: 10,
            maxHeight: 240,
            overflowY: 'auto',
            listStyle: 'none',
            margin: 0,
            padding: 0,
          }}
        >
          {matches.map((u: User, i: number) => (
            <li
              key={u.id}
              id={`${listboxId}-option-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              onMouseDown={() => select(u as User)}
              onMouseEnter={() => setActiveIndex(i)}
              style={{
                padding: '0.5rem 0.75rem',
                cursor: 'pointer',
                fontSize: 14,
                background: i === activeIndex ? '#f0f0f0' : '#fff',
              }}
            >
              <span style={{ fontWeight: 500 }}>{u.name}</span>
              <span style={{ color: '#888', marginLeft: '0.5rem', fontSize: 13 }}>
                {u.email}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
