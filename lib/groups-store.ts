import { useSyncExternalStore } from 'react';

export type Group = {
  id: string;
  name: string;
  color: string;
  memberIds: string[];
};

/**
 * Curated swatch palette for group dots. Six warm-aligned shades that
 * read well next to the heatmap colors without clashing.
 */
export const GROUP_COLOR_SWATCHES = [
  '#86A789', // sage
  '#E8C547', // honey
  '#D08C5C', // terracotta
  '#C45A4D', // clay
  '#E94E77', // brand pink
  '#8B5B9F', // plum
] as const;

/**
 * Initial mock groups. Member IDs are intentionally synthetic — they
 * make the "N members" copy render correctly in the list view, but
 * won't collide with real friend ids in the edit form (where the chip
 * picker starts empty until the user picks members from the real list).
 *
 * TODO: replace with a Supabase-backed groups table that owns these
 * rows. The store API below stays the same.
 */
const INITIAL_GROUPS: Group[] = [
  {
    id: 'close-friends',
    name: 'Close friends',
    color: GROUP_COLOR_SWATCHES[0],
    memberIds: ['mock-cf-1', 'mock-cf-2', 'mock-cf-3', 'mock-cf-4'],
  },
  {
    id: 'nyc-crew',
    name: 'NYC crew',
    color: GROUP_COLOR_SWATCHES[2],
    memberIds: ['mock-nyc-1', 'mock-nyc-2', 'mock-nyc-3', 'mock-nyc-4', 'mock-nyc-5'],
  },
  {
    id: 'college',
    name: 'College',
    color: GROUP_COLOR_SWATCHES[5],
    memberIds: ['mock-co-1', 'mock-co-2', 'mock-co-3'],
  },
];

// Module-level state shared across all consumers so that creating a
// group in the homepage's "Manage groups" modal is visible the next
// time the modal opens from the Friends page (and vice versa).
let groups: Group[] = INITIAL_GROUPS;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function getGroups(): Group[] {
  return groups;
}

export function setGroups(next: Group[]) {
  groups = next;
  emit();
}

export function upsertGroup(group: Group) {
  const existingIndex = groups.findIndex((g) => g.id === group.id);
  if (existingIndex >= 0) {
    groups = groups.map((g, i) => (i === existingIndex ? group : g));
  } else {
    groups = [...groups, group];
  }
  emit();
}

export function deleteGroup(id: string) {
  groups = groups.filter((g) => g.id !== id);
  emit();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useGroups(): Group[] {
  return useSyncExternalStore(subscribe, getGroups, getGroups);
}

/**
 * Generate a stable id from a name for newly-created groups. Falls
 * back to a timestamp suffix if the slug collides.
 */
export function generateGroupId(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const base = slug || 'group';
  if (!groups.some((g) => g.id === base)) return base;
  return `${base}-${Date.now()}`;
}
