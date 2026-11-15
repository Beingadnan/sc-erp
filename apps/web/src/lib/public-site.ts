// Server-side only: imported from server components of the public site.
import { cache } from 'react';

const API = process.env.API_URL ?? 'http://localhost:4000';

export interface PublicSite {
  name: string;
  slug: string;
  campuses: Array<{
    id: string;
    name: string;
    board: string;
    address: string | null;
    phone: string | null;
    email: string | null;
  }>;
  pages: Array<{ slug: string; title: string }>;
}

export interface PublicPage {
  title: string;
  body: string;
  publishedAt: string;
}

const get = async <T>(path: string): Promise<T | null> => {
  const res = await fetch(`${API}/api/v1/public/schools/${path}`, { cache: 'no-store' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Public site request failed (${res.status})`);
  return (await res.json()) as T;
};

const clean = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 50);

/** Cached per request so layout and page share one call. */
export const getSite = cache((school: string) => get<PublicSite>(clean(school)));
export const getPage = cache((school: string, page: string) =>
  get<PublicPage>(`${clean(school)}/pages/${clean(page)}`),
);
